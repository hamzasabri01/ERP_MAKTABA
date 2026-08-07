"""api/routes/products.py"""
import csv
import io
from decimal import Decimal, ROUND_FLOOR
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
from models.product import Product, ProductBundleComponent, Category, Supplier
from api.schemas import BundleComponentOut, BundleComponentsUpdate, ProductBulkArchive, ProductCreate, ProductUpdate, ProductOut
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
    return "SRV" if product_type == "service" else ("BND" if product_type == "bundle" else "PRD")


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
    if p.product_type == "bundle":
        capacities = [
            (Decimal(str(row.component.stock_quantity or 0)) / Decimal(str(row.quantity))).to_integral_value(rounding=ROUND_FLOOR)
            for row in p.bundle_components
            if row.component and Decimal(str(row.quantity or 0)) > 0
        ]
        out.stock_quantity = float(min(capacities)) if capacities else 0
        out.stock_value = 0
        out.is_low_stock = False
    return out


EXPORT_COLUMNS = [
    "code", "name", "product_type", "pricing_mode", "category", "supplier", "barcode", "unit",
    "purchase_unit", "purchase_to_base_factor", "allow_fractional_sale",
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
    "pricing_mode": "pricing_mode",
    "mode_tarification": "pricing_mode",
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
    "purchase_unit": "purchase_unit",
    "unite_achat": "purchase_unit",
    "purchase_to_base_factor": "purchase_to_base_factor",
    "facteur_conversion": "purchase_to_base_factor",
    "allow_fractional_sale": "allow_fractional_sale",
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


def _ensure_unique_barcode(db: Session, barcode, exclude_id: int | None = None) -> str:
    normalized = str(barcode or "").strip()
    if not normalized:
        return ""
    query = db.query(Product).filter(func.lower(Product.barcode) == normalized.lower())
    if exclude_id is not None:
        query = query.filter(Product.id != exclude_id)
    duplicate = query.first()
    if duplicate:
        raise HTTPException(409, f"Ce code EAN appartient déjà au produit « {duplicate.name} »")
    return normalized


def _validate_product_references(db: Session, data: dict) -> None:
    category_id = data.get("category_id")
    supplier_id = data.get("supplier_id")
    if category_id is not None and not db.query(Category.id).filter(Category.id == category_id).first():
        raise HTTPException(400, "La catégorie sélectionnée est introuvable")
    if supplier_id is not None and not db.query(Supplier.id).filter(
        Supplier.id == supplier_id,
        Supplier.is_active == 1,
    ).first():
        raise HTTPException(400, "Le fournisseur sélectionné est introuvable ou archivé")


def _ean13_check_digit(first_twelve_digits: str) -> str:
    if len(first_twelve_digits) != 12 or not first_twelve_digits.isdigit():
        raise ValueError("EAN-13 requires exactly 12 digits before the check digit")
    weighted_sum = sum(
        int(digit) * (1 if index % 2 == 0 else 3)
        for index, digit in enumerate(first_twelve_digits)
    )
    return str((10 - weighted_sum % 10) % 10)


def _is_valid_ean13(value) -> bool:
    code = str(value or "").strip()
    return (
        len(code) == 13
        and code.isdigit()
        and code[-1] == _ean13_check_digit(code[:12])
    )


def _generate_internal_ean13(db: Session, product_id: int, reserved: set[str] | None = None) -> str:
    """Generate a deterministic, scanner-compatible internal EAN-13."""
    reserved = reserved if reserved is not None else set()
    sequence = int(product_id)
    while sequence <= 999_999_999:
        base = f"611{sequence:09d}"
        barcode = f"{base}{_ean13_check_digit(base)}"
        exists = db.query(Product.id).filter(Product.barcode == barcode).first()
        if not exists and barcode not in reserved:
            reserved.add(barcode)
            return barcode
        sequence += 1
    raise HTTPException(409, "Impossible de générer un nouveau code EAN-13 unique")


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
            "pricing_mode": p.pricing_mode or "fixed",
            "category": p.category.name if p.category else "",
            "supplier": p.supplier.company_name if p.supplier else "",
            "barcode": p.barcode or "",
            "unit": p.unit or "pcs",
            "purchase_unit": p.purchase_unit or p.unit or "pcs",
            "purchase_to_base_factor": p.purchase_to_base_factor or 1,
            "allow_fractional_sale": int(bool(p.allow_fractional_sale)),
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
        "bundle": (db.query(func.count(Product.id)).filter(Product.code.ilike("BND%")).scalar() or 0) + 1,
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
            product_type = "service" if product_type in ("service", "services") else ("bundle" if product_type in ("bundle", "pack") else "product")
        pricing_mode = _key(row.get("pricing_mode")) or ("editable" if product_type == "service" else "fixed")
        if pricing_mode not in ("fixed", "editable", "manual"):
            pricing_mode = "editable" if product_type == "service" else "fixed"

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
            "purchase_unit": _clean(row.get("purchase_unit")) or _clean(row.get("unit")) or "pcs",
            "purchase_to_base_factor": _decimal(row.get("purchase_to_base_factor"), Decimal("1"), kind="stock_quantity") or Decimal("1"),
            "allow_fractional_sale": bool(_int_flag(row.get("allow_fractional_sale"), 0)),
            "tax_rate": _validate_tax_rate(_decimal(row.get("tax_rate"), Decimal("20"), kind="tax_rate")),
            "tva_enabled": _int_flag(row.get("tva_enabled"), 1),
            "product_type": product_type,
            "pricing_mode": pricing_mode,
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
    normalized = product_type if product_type in ("product", "service", "bundle") else "product"
    return {"code": _gen_code(db, normalized), "product_type": normalized}


@router.get("/stats")
def product_catalog_stats(db: Session = Depends(get_db), user=Depends(get_current_user)):
    counts = dict(
        db.query(Product.product_type, func.count(Product.id))
        .filter(Product.is_active == 1)
        .group_by(Product.product_type)
        .all()
    )
    product_count = int(counts.get("product", 0))
    service_count = int(counts.get("service", 0))
    bundle_count = int(counts.get("bundle", 0))
    return {
        "total": product_count + service_count + bundle_count,
        "product": product_count,
        "service": service_count,
        "bundle": bundle_count,
        "low": int(
            db.query(func.count(Product.id))
            .filter(
                Product.is_active == 1,
                Product.product_type == "product",
                Product.stock_quantity <= Product.min_stock,
            )
            .scalar() or 0
        ),
    }


@router.get("/{pid}/components", response_model=List[BundleComponentOut])
def get_bundle_components(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    bundle = db.query(Product).filter(Product.id == pid, Product.product_type == "bundle").first()
    if not bundle:
        raise HTTPException(404, "Pack scolaire non trouvé")
    return [
        BundleComponentOut(
            id=row.id,
            product_id=row.component_product_id,
            product_name=row.component.name,
            unit=row.component.unit or "",
            quantity=row.quantity,
        )
        for row in bundle.bundle_components
    ]


@router.put("/{pid}/components", response_model=List[BundleComponentOut])
def update_bundle_components(
    pid: int,
    body: BundleComponentsUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    bundle = db.query(Product).filter(Product.id == pid, Product.product_type == "bundle").first()
    if not bundle:
        raise HTTPException(404, "Pack scolaire non trouvé")
    if not body.components:
        raise HTTPException(400, "Le pack doit contenir au moins un produit")
    ids = [row.product_id for row in body.components]
    if len(ids) != len(set(ids)) or pid in ids:
        raise HTTPException(400, "Composants du pack invalides ou dupliqués")
    products = {
        product.id: product for product in db.query(Product).filter(
            Product.id.in_(ids), Product.is_active == 1, Product.product_type == "product"
        ).all()
    }
    if len(products) != len(ids):
        raise HTTPException(400, "Un composant est introuvable ou ne gère pas le stock")
    before = [{"product_id": row.component_product_id, "quantity": str(row.quantity)} for row in bundle.bundle_components]
    bundle.bundle_components.clear()
    db.flush()
    for row in body.components:
        bundle.bundle_components.append(ProductBundleComponent(
            component_product_id=row.product_id,
            quantity=quantize_quantity(row.quantity),
        ))
    log_action(
        db, user, "update", "product_bundle", bundle.id,
        f"Composition du pack modifiée: {bundle.name}",
        before={"components": before},
        after={"components": [row.model_dump(mode="json") for row in body.components]},
    )
    db.commit()
    return get_bundle_components(pid, db, user)


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
    _validate_product_references(db, data)
    data["barcode"] = _ensure_unique_barcode(db, data.get("barcode"))
    data["tax_rate"] = _validate_tax_rate(data.get("tax_rate", 0))
    if data.get("product_type") == "service":
        data["stock_quantity"] = 0
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
    _validate_product_references(db, payload)
    if "barcode" in payload:
        payload["barcode"] = _ensure_unique_barcode(db, payload.get("barcode"), exclude_id=pid)
    requested_type = payload.get("product_type", p.product_type)
    if p.product_type == "product" and requested_type != "product" and quantize_quantity(p.stock_quantity or 0) != 0:
        raise HTTPException(409, "Mettez le stock à zéro avant de convertir ce produit")
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


@router.post("/bulk/archive")
def archive_products_bulk(body: ProductBulkArchive, db: Session = Depends(get_db), user=Depends(get_current_user)):
    product_ids = list(dict.fromkeys(body.product_ids))
    products = db.query(Product).filter(Product.id.in_(product_ids), Product.is_active == 1).all()
    active_ids = {product.id for product in products}

    dependent_rows = (
        db.query(ProductBundleComponent, Product)
        .join(Product, Product.id == ProductBundleComponent.bundle_product_id)
        .filter(
            ProductBundleComponent.component_product_id.in_(active_ids),
            Product.is_active == 1,
            ~Product.id.in_(active_ids),
        )
        .all()
    ) if active_ids else []
    if dependent_rows:
        bundle_names = sorted({bundle.name for _, bundle in dependent_rows})
        preview = ", ".join(bundle_names[:5])
        suffix = "…" if len(bundle_names) > 5 else ""
        raise HTTPException(
            409,
            f"Ces produits sont utilisés dans des packs actifs: {preview}{suffix}. "
            "Sélectionnez également ces packs ou modifiez leur composition.",
        )

    now = datetime.utcnow()
    archived_ids = []
    for product in products:
        before = model_snapshot(product, ["code", "name", "is_active", "stock_quantity"])
        product.is_active = 0
        product.updated_at = now
        archived_ids.append(product.id)
        log_action(
            db, user, "archive", "product", product.id,
            f"Produit archive en lot: {product.name}",
            before=before,
            after=model_snapshot(product, ["code", "name", "is_active", "stock_quantity"]),
        )
    db.commit()
    return {
        "ok": True,
        "requested_count": len(product_ids),
        "archived_count": len(archived_ids),
        "already_archived_or_missing_count": len(product_ids) - len(archived_ids),
        "archived_ids": archived_ids,
    }


@router.post("/bulk/generate-ean")
def generate_missing_ean_codes(db: Session = Depends(get_db), user=Depends(get_current_user)):
    products = (
        db.query(Product)
        .filter(
            Product.is_active == 1,
            Product.product_type.in_(("product", "bundle")),
            or_(Product.barcode == None, func.trim(Product.barcode) == ""),  # noqa: E711
        )
        .order_by(Product.id)
        .all()
    )
    reserved: set[str] = set()
    generated = []
    now = datetime.utcnow()
    for product in products:
        before = {"barcode": product.barcode or ""}
        product.barcode = _generate_internal_ean13(db, product.id, reserved)
        product.updated_at = now
        generated.append({"id": product.id, "name": product.name, "barcode": product.barcode})
        log_action(
            db, user, "generate_ean", "product", product.id,
            f"Code EAN-13 généré pour {product.name}",
            before=before,
            after={"barcode": product.barcode},
        )
    db.commit()
    return {
        "ok": True,
        "generated_count": len(generated),
        "unchanged_count": (
            db.query(func.count(Product.id))
            .filter(
                Product.is_active == 1,
                Product.product_type.in_(("product", "bundle")),
                Product.barcode != None,  # noqa: E711
                func.trim(Product.barcode) != "",
            )
            .scalar()
            or 0
        ) - len(generated),
        "products": generated,
    }


@router.post("/bulk/repair-ean")
def repair_product_ean_codes(
    body: ProductBulkArchive,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    product_ids = list(dict.fromkeys(body.product_ids))
    products = (
        db.query(Product)
        .filter(
            Product.id.in_(product_ids),
            Product.is_active == 1,
            Product.product_type.in_(("product", "bundle")),
        )
        .order_by(Product.id)
        .all()
    )
    reserved: set[str] = set()
    repaired = []
    unchanged = 0
    now = datetime.utcnow()
    for product in products:
        old_barcode = str(product.barcode or "").strip()
        if _is_valid_ean13(old_barcode):
            unchanged += 1
            continue

        if old_barcode.isdigit() and len(old_barcode) in {12, 13}:
            first_twelve = old_barcode[:12]
            candidate = f"{first_twelve}{_ean13_check_digit(first_twelve)}"
            duplicate = db.query(Product.id).filter(
                Product.barcode == candidate,
                Product.id != product.id,
            ).first()
            new_barcode = (
                _generate_internal_ean13(db, product.id, reserved)
                if duplicate or candidate in reserved
                else candidate
            )
            reserved.add(new_barcode)
        elif not old_barcode:
            new_barcode = _generate_internal_ean13(db, product.id, reserved)
        else:
            # Do not overwrite another valid symbology (EAN-8, UPC, Code 128, etc.).
            continue

        product.barcode = new_barcode
        product.updated_at = now
        repaired.append({
            "id": product.id,
            "name": product.name,
            "old_barcode": old_barcode,
            "barcode": new_barcode,
        })
        log_action(
            db, user, "repair_ean", "product", product.id,
            f"Code EAN-13 corrigé pour {product.name}",
            before={"barcode": old_barcode},
            after={"barcode": new_barcode},
        )
    db.commit()
    return {
        "ok": True,
        "requested_count": len(product_ids),
        "repaired_count": len(repaired),
        "unchanged_count": unchanged,
        "skipped_count": len(product_ids) - len(repaired) - unchanged,
        "products": repaired,
    }
