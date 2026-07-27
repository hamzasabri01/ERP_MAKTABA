"""api/routes/products.py"""
import csv
import io
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime
from pathlib import Path
from uuid import uuid4
from core.database import get_db
from core.security import get_current_user
from core.settings_store import load_settings
from models.product import Product, Category, Supplier
from api.schemas import ProductCreate, ProductUpdate, ProductOut
from api.audit import log_action, model_snapshot
from services.money import decimal_value, policy_from_settings, quantize_money, quantize_percent, quantize_price, quantize_quantity
from services.stock import apply_stock_movement

router = APIRouter()
UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "products"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 10000
ALLOWED_CSV_TYPES = {
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "text/plain",
    "application/octet-stream",
}
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
ALLOWED_IMAGE_SUFFIXES = {
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
}


def _read_limited_upload(stream, max_bytes: int, label: str) -> bytes:
    data = stream.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"{label} trop volumineux")
    if not data:
        raise HTTPException(400, f"{label} vide")
    return data


def _validate_image_content(data: bytes, content_type: str) -> str:
    signatures = {
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    }
    if content_type not in ALLOWED_IMAGE_TYPES or not signatures.get(content_type, False):
        raise HTTPException(400, "Contenu image invalide. Utilisez JPG, PNG ou WebP")
    return ALLOWED_IMAGE_TYPES[content_type]


def _validate_image_filename(filename: str | None, content_type: str) -> None:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_IMAGE_SUFFIXES.get(content_type, set()):
        raise HTTPException(400, "Extension image invalide ou incoherente")


def _code_prefix(product_type):
    return "SRV" if product_type == "service" else "PRD"


def _gen_code(db, product_type="product", used_codes=None):
    used_codes = used_codes or set()
    prefix = _code_prefix(product_type)
    next_number = (
        db.query(func.count(Product.id))
        .filter(Product.code.ilike(f"{prefix}%"))
        .scalar()
        or 0
    ) + 1
    while True:
        code = f"{prefix}{str(next_number).zfill(5)}"
        code_key = code.lower()
        exists = db.query(Product.id).filter(func.lower(Product.code) == code_key).first()
        if not exists and code_key not in used_codes:
            used_codes.add(code.lower())
            return code
        next_number += 1


def _supplier_code(db, offset=1):
    count = db.query(func.count(Supplier.id)).scalar() or 0
    return f"FRN{str(count + offset).zfill(4)}"


def _to_out(p: Product) -> ProductOut:
    out = ProductOut.model_validate(p)
    out.category_name = p.category.name if p.category else ""
    out.supplier_name = p.supplier.company_name if p.supplier else ""
    out.margin_pct    = round(p.margin_pct, 2)
    out.stock_value   = quantize_money(p.stock_value)
    out.is_low_stock  = p.is_low_stock
    return out


EXPORT_COLUMNS = [
    "code", "name", "product_type", "category", "supplier", "barcode", "unit",
    "purchase_price", "sale_price", "stock_quantity", "min_stock", "tax_rate",
    "tva_enabled", "description", "is_active",
]

HEADER_ALIASES = {
    "code": "code",
    "reference": "code",
    "ref": "code",
    "sku": "code",
    "name": "name",
    "nom": "name",
    "produit": "name",
    "product": "name",
    "product_type": "product_type",
    "type": "product_type",
    "category": "category",
    "categorie": "category",
    "catégorie": "category",
    "supplier": "supplier",
    "fournisseur": "supplier",
    "barcode": "barcode",
    "code_barres": "barcode",
    "code-barres": "barcode",
    "unit": "unit",
    "unite": "unit",
    "unité": "unit",
    "purchase_price": "purchase_price",
    "prix_achat": "purchase_price",
    "p_achat": "purchase_price",
    "sale_price": "sale_price",
    "prix_vente": "sale_price",
    "p_vente": "sale_price",
    "stock_quantity": "stock_quantity",
    "stock": "stock_quantity",
    "min_stock": "min_stock",
    "stock_min": "min_stock",
    "tax_rate": "tax_rate",
    "tva": "tax_rate",
    "tva_enabled": "tva_enabled",
    "description": "description",
    "is_active": "is_active",
    "actif": "is_active",
}


def _clean(value):
    return str(value or "").strip()


def _key(value):
    return _clean(value).lower()


def _decimal(value, default=Decimal("0"), *, kind="price"):
    text = _clean(value).replace(" ", "").replace(",", ".")
    if not text:
        value = default
    else:
        value = decimal_value(text, kind)
    if value < 0:
        raise HTTPException(400, f"{kind} ne peut pas etre negatif")
    if kind == "tax_rate":
        value = quantize_percent(value)
        if value > 100:
            raise HTTPException(400, "tax_rate doit etre compris entre 0 et 100")
        return value
    return quantize_quantity(value) if kind in {"stock_quantity", "min_stock"} else quantize_price(value)


def _validate_tax_rate(value):
    rate = quantize_percent(value)
    policy = policy_from_settings(load_settings())
    if rate not in policy.allowed_tax_rates:
        allowed = ", ".join(format(item, "f") for item in policy.allowed_tax_rates)
        raise HTTPException(400, f"Taux de taxe invalide. Taux autorises: {allowed}")
    return rate


def _int_flag(value, default=1):
    text = _key(value)
    if text in ("0", "false", "non", "no", "inactive", "inactif"):
        return 0
    if text in ("1", "true", "oui", "yes", "active", "actif"):
        return 1
    return default


def _detect_dialect(sample):
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;	")
    except csv.Error:
        return csv.excel


def _read_import_rows(raw):
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "Fichier trop grand. Maximum 5 MB")
    text = raw.decode("utf-8-sig", errors="replace")
    dialect = _detect_dialect(text[:4096])
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise HTTPException(400, "Fichier CSV vide ou en-tetes manquants")
    mapped_headers = {h: HEADER_ALIASES.get(_key(h), _key(h)) for h in reader.fieldnames}
    rows = []
    for row in reader:
        normalized = {}
        for header, value in row.items():
            key = mapped_headers.get(header)
            if key:
                normalized[key] = value
        rows.append(normalized)
        if len(rows) > MAX_IMPORT_ROWS:
            raise HTTPException(400, f"Maximum {MAX_IMPORT_ROWS} lignes par import")
    return rows


@router.get("", response_model=List[ProductOut])
def list_products(
    q: Optional[str] = None,
    category_id: Optional[int] = None,
    product_type: Optional[str] = None,
    low_stock: bool = False,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = db.query(Product).options(joinedload(Product.category), joinedload(Product.supplier))
    if q:
        query = query.filter(or_(
            Product.name.ilike(f"%{q}%"),
            Product.code.ilike(f"%{q}%"),
            Product.barcode.ilike(f"%{q}%"),
        ))
    if category_id:
        query = query.filter(Product.category_id == category_id)
    if product_type:
        query = query.filter(Product.product_type == product_type)
    if low_stock:
        query = query.filter(
            Product.product_type == "product",
            Product.stock_quantity <= Product.min_stock,
        )
    products = query.filter(Product.is_active == 1).order_by(Product.name).offset(skip).limit(limit).all()
    return [_to_out(p) for p in products]


@router.get("/export")
def export_products(db: Session = Depends(get_db), user=Depends(get_current_user)):
    products = (
        db.query(Product)
        .options(joinedload(Product.category), joinedload(Product.supplier))
        .filter(Product.is_active == 1)
        .order_by(Product.name)
        .all()
    )
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=EXPORT_COLUMNS, delimiter=";")
    writer.writeheader()
    for p in products:
        writer.writerow({
            "code": p.code or "",
            "name": p.name or "",
            "product_type": p.product_type or "product",
            "category": p.category.name if p.category else "",
            "supplier": p.supplier.company_name if p.supplier else "",
            "barcode": p.barcode or "",
            "unit": p.unit or "pcs",
            "purchase_price": p.purchase_price or 0,
            "sale_price": p.sale_price or 0,
            "stock_quantity": p.stock_quantity or 0,
            "min_stock": p.min_stock or 0,
            "tax_rate": p.tax_rate or 0,
            "tva_enabled": p.tva_enabled,
            "description": p.description or "",
            "is_active": p.is_active,
        })
    buffer.seek(0)
    filename = f"products-{datetime.now().strftime('%Y%m%d-%H%M')}.csv"
    return StreamingResponse(
        iter([buffer.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
def import_products(file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Format CSV uniquement")
    if file.content_type and file.content_type.lower() not in ALLOWED_CSV_TYPES:
        raise HTTPException(400, "Type de fichier CSV invalide")

    rows = _read_import_rows(_read_limited_upload(file.file, MAX_IMPORT_BYTES, "Fichier CSV"))
    now = datetime.utcnow()
    result = {
        "total": len(rows),
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "errors": [],
    }

    categories = {c.name.lower(): c for c in db.query(Category).all()}
    suppliers = {s.company_name.lower(): s for s in db.query(Supplier).all()}
    products_by_code = {p.code.lower(): p for p in db.query(Product).filter(Product.code != None).all() if p.code}
    products_by_barcode = {p.barcode.lower(): p for p in db.query(Product).filter(Product.barcode != None).all() if p.barcode}
    next_numbers = {
        "product": (db.query(func.count(Product.id)).filter(Product.code.ilike("PRD%")).scalar() or 0) + 1,
        "service": (db.query(func.count(Product.id)).filter(Product.code.ilike("SRV%")).scalar() or 0) + 1,
    }
    next_supplier_number = (db.query(func.count(Supplier.id)).scalar() or 0) + 1
    import_batch = uuid4().hex

    for index, row in enumerate(rows, start=2):
        name = _clean(row.get("name"))
        if not name:
            result["skipped"] += 1
            result["errors"].append({"row": index, "message": "Nom produit obligatoire"})
            continue

        product_type = _key(row.get("product_type")) or "product"
        if product_type not in ("product", "service"):
            product_type = "service" if product_type in ("service", "services") else "product"

        category_id = None
        category_name = _clean(row.get("category"))
        if category_name:
            category = categories.get(category_name.lower())
            if not category:
                category = Category(name=category_name, description="")
                db.add(category)
                db.flush()
                categories[category_name.lower()] = category
            category_id = category.id

        supplier_id = None
        supplier_name = _clean(row.get("supplier"))
        if supplier_name:
            supplier = suppliers.get(supplier_name.lower())
            if not supplier:
                supplier = Supplier(company_name=supplier_name, code=f"FRN{str(next_supplier_number).zfill(4)}")
                next_supplier_number += 1
                db.add(supplier)
                db.flush()
                suppliers[supplier_name.lower()] = supplier
            supplier_id = supplier.id

        incoming_code = _clean(row.get("code"))
        barcode = _clean(row.get("barcode"))
        product = products_by_code.get(incoming_code.lower()) if incoming_code else None
        if not product and barcode:
            product = products_by_barcode.get(barcode.lower())

        if product:
            code = product.code or _gen_code(db, product_type, set(products_by_code.keys()))
        else:
            prefix = _code_prefix(product_type)
            code = f"{prefix}{str(next_numbers[product_type]).zfill(5)}"
            next_numbers[product_type] += 1
            while code.lower() in products_by_code:
                code = f"{prefix}{str(next_numbers[product_type]).zfill(5)}"
                next_numbers[product_type] += 1

        old_stock = product.stock_quantity if product else 0
        incoming_stock = _decimal(row.get("stock_quantity"), Decimal("0"), kind="stock_quantity")
        data = {
            "code": code,
            "name": name,
            "category_id": category_id,
            "supplier_id": supplier_id,
            "description": _clean(row.get("description")),
            "purchase_price": _decimal(row.get("purchase_price"), Decimal("0"), kind="purchase_price"),
            "sale_price": _decimal(row.get("sale_price"), Decimal("0"), kind="sale_price"),
            "stock_quantity": old_stock if product else 0,
            "min_stock": _decimal(row.get("min_stock"), Decimal("5"), kind="min_stock"),
            "barcode": barcode,
            "unit": _clean(row.get("unit")) or "pcs",
            "tax_rate": _validate_tax_rate(_decimal(row.get("tax_rate"), Decimal("20"), kind="tax_rate")),
            "tva_enabled": _int_flag(row.get("tva_enabled"), 1),
            "product_type": product_type,
            "is_active": _int_flag(row.get("is_active"), 1),
            "updated_at": now,
        }

        if product:
            for key, value in data.items():
                setattr(product, key, value)
            result["updated"] += 1
            if product.product_type == "product" and quantize_quantity(old_stock or 0) != incoming_stock:
                apply_stock_movement(
                    db,
                    product,
                    "inventory",
                    incoming_stock,
                    operation_key=f"product-import:{import_batch}:row:{index}:product:{product.id}",
                    user_id=user.id,
                    unit_cost=product.purchase_price or 0,
                    reference="IMPORT",
                    notes="Synchronisation stock import produits",
                    source_type="product_import",
                    source_id=product.id,
                    expected_before=old_stock,
                )
        else:
            product = Product(**data)
            db.add(product)
            db.flush()
            if product.product_type == "product" and incoming_stock > 0:
                apply_stock_movement(
                    db,
                    product,
                    "in",
                    incoming_stock,
                    operation_key=f"product-import:{import_batch}:row:{index}:product:{product.id}",
                    user_id=user.id,
                    unit_cost=product.purchase_price or 0,
                    reference="IMPORT",
                    notes="Stock initial import produits",
                    source_type="product_import",
                    source_id=product.id,
                )
            result["created"] += 1

        products_by_code[code.lower()] = product
        if barcode:
            products_by_barcode[barcode.lower()] = product

        if (result["created"] + result["updated"]) % 500 == 0:
            db.flush()

    db.commit()
    return result


@router.get("/next-code")
def next_product_code(product_type: str = "product", db: Session = Depends(get_db), user=Depends(get_current_user)):
    normalized = "service" if product_type == "service" else "product"
    return {"code": _gen_code(db, normalized), "product_type": normalized}


@router.get("/{pid}", response_model=ProductOut)
def get_product(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Product).options(joinedload(Product.category), joinedload(Product.supplier)).filter(Product.id == pid).first()
    if not p:
        raise HTTPException(404, "Produit non trouvé")
    return _to_out(p)


@router.post("/{pid}/image", response_model=ProductOut)
def upload_product_image(
    pid: int,
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    p = db.query(Product).filter(Product.id == pid).first()
    if not p:
        raise HTTPException(404, "Produit non trouvé")
    content_type = (image.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Format image invalide. Utilisez JPG, PNG ou WebP")
    _validate_image_filename(image.filename, content_type)

    data = _read_limited_upload(image.file, MAX_IMAGE_BYTES, "Image")
    ext = _validate_image_content(data, content_type)

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"product-{pid}-{uuid4().hex[:10]}{ext}"
    path = UPLOAD_DIR / filename
    with path.open("wb") as fh:
        fh.write(data)

    old_path = None
    if p.image_path and p.image_path.startswith("/uploads/products/"):
        old_path = UPLOAD_DIR / Path(p.image_path).name

    p.image_path = f"/uploads/products/{filename}"
    p.updated_at = datetime.utcnow()
    db.commit()

    if old_path and old_path.exists() and old_path != path:
        try:
            old_path.unlink()
        except OSError:
            pass

    db.expire(p)
    p = db.query(Product).options(joinedload(Product.category), joinedload(Product.supplier)).filter(Product.id == pid).first()
    return _to_out(p)


@router.delete("/{pid}/image", response_model=ProductOut)
def delete_product_image(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Product).filter(Product.id == pid).first()
    if not p:
        raise HTTPException(404, "Produit non trouvé")
    old_path = None
    if p.image_path and p.image_path.startswith("/uploads/products/"):
        old_path = UPLOAD_DIR / Path(p.image_path).name
    p.image_path = None
    p.updated_at = datetime.utcnow()
    db.commit()
    if old_path and old_path.exists():
        try:
            old_path.unlink()
        except OSError:
            pass
    db.expire(p)
    p = db.query(Product).options(joinedload(Product.category), joinedload(Product.supplier)).filter(Product.id == pid).first()
    return _to_out(p)


@router.post("", response_model=ProductOut, status_code=201)
def create_product(body: ProductCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    data = body.model_dump()
    data["tax_rate"] = _validate_tax_rate(data.get("tax_rate", 0))
    initial_stock = quantize_quantity(data.pop("stock_quantity", 0) or 0)
    data["code"] = _gen_code(db, data.get("product_type") or "product")
    data["stock_quantity"] = 0
    data["updated_at"] = datetime.utcnow()
    p = Product(**data)
    db.add(p)
    db.flush()
    if p.product_type == "product" and initial_stock > 0:
        apply_stock_movement(
            db,
            p,
            "in",
            initial_stock,
            operation_key=f"product:{p.id}:create:{uuid4().hex}",
            user_id=user.id,
            unit_cost=p.purchase_price or 0,
            reference="PRODUCT-CREATE",
            notes="Stock initial creation produit",
            source_type="product",
            source_id=p.id,
        )
    db.commit()
    db.refresh(p)
    log_action(
        db,
        user,
        "create",
        "product",
        p.id,
        f"Produit cree: {p.name}",
        after=model_snapshot(p, ["id", "code", "name", "sale_price", "stock_quantity", "product_type"]),
    )
    db.commit()
    db.expire(p)
    p = db.query(Product).options(joinedload(Product.category), joinedload(Product.supplier)).filter(Product.id == p.id).first()
    return _to_out(p)


@router.put("/{pid}", response_model=ProductOut)
def update_product(pid: int, body: ProductUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Product).filter(Product.id == pid).first()
    if not p:
        raise HTTPException(404, "Produit non trouvé")
    before = model_snapshot(p, ["code", "name", "purchase_price", "sale_price", "stock_quantity", "min_stock", "is_active", "product_type"])
    payload = body.model_dump(exclude_none=True, exclude={"code"})
    if "tax_rate" in payload:
        payload["tax_rate"] = _validate_tax_rate(payload["tax_rate"])
    stock_quantity = payload.pop("stock_quantity", None)
    for k, v in payload.items():
        setattr(p, k, v)
    if stock_quantity is not None and p.product_type == "product":
        requested_stock = quantize_quantity(stock_quantity or 0)
        if quantize_quantity(p.stock_quantity or 0) != requested_stock:
            apply_stock_movement(
                db,
                p,
                "inventory",
                requested_stock,
                operation_key=f"product:{p.id}:edit:{uuid4().hex}",
                user_id=user.id,
                unit_cost=p.purchase_price or 0,
                reference="PRODUCT-EDIT",
                notes="Ajustement depuis fiche produit",
                source_type="product",
                source_id=p.id,
                expected_before=p.stock_quantity,
            )
    p.updated_at = datetime.utcnow()
    after = model_snapshot(p, ["code", "name", "purchase_price", "sale_price", "stock_quantity", "min_stock", "is_active", "product_type"])
    log_action(db, user, "update", "product", p.id, f"Produit modifie: {p.name}", before=before, after=after)
    db.commit()
    db.expire(p)
    p = db.query(Product).options(joinedload(Product.category), joinedload(Product.supplier)).filter(Product.id == pid).first()
    return _to_out(p)


@router.delete("/{pid}")
def delete_product(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Product).filter(Product.id == pid).first()
    if not p:
        raise HTTPException(404, "Produit non trouvé")
    before = model_snapshot(p, ["code", "name", "is_active", "stock_quantity"])
    p.is_active = 0
    p.updated_at = datetime.utcnow()
    log_action(db, user, "archive", "product", p.id, f"Produit archive: {p.name}", before=before, after=model_snapshot(p, ["code", "name", "is_active", "stock_quantity"]))
    db.commit()
    return {"ok": True}
