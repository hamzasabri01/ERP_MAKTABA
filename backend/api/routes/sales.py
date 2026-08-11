"""api/routes/sales.py — Full sales CRUD with business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import datetime, date, timedelta
from core.database import get_db
from core.security import get_current_user
from models.sales import Sale, SaleItem
from models.client import Client
from models.product import Product
from models.stock import StockMovement
from api.schemas import DocumentPreviewOut, SaleCreate, SaleReturnIn, SaleOut, SaleItemOut, PaymentIn
from api.audit import log_action, model_snapshot
from api.payments import register_payment
from api.payments import register_reversal
from models.payment import Payment
from core.settings_store import load_settings
from services.money import calculate_document, decimal_sum, parse_tax_breakdown, policy_from_settings, quantize_quantity, serialize_tax_breakdown
from services.credit import document_paid_total, sync_client_credit, sync_document_paid_amount
from services.document_numbers import (
    commit_number_allocation,
    reserve_document_number,
    void_document_allocation,
    void_reserved_allocation,
)
from services.document_workflow import (
    ACTIVE_SALE_STATUSES,
    OPEN_SALE_STATUSES,
    SALE_CANCELLED,
    SALE_CONFIRMED,
    assert_transition,
    claim_idempotency,
    claim_version,
    money,
    payment_target,
    validate_payment_amount,
)
from services.stock import apply_stock_movement, reverse_stock_movement
from services.sales_pricing import resolve_sale_items

router = APIRouter()


def _compute_sale(items_data: list, discount=0) -> dict:
    return calculate_document(items_data, discount, policy_from_settings(load_settings()))


def _preview(calculation: dict) -> DocumentPreviewOut:
    return DocumentPreviewOut(
        **{key: calculation[key] for key in (
            "discount_amount", "subtotal", "tax_amount", "total_amount",
            "currency_code", "price_tax_mode", "rounding_scope", "tax_breakdown",
        )},
        items=[{"index": index, **line} for index, line in enumerate(calculation["items"])],
    )


def _document_values(calculation: dict) -> dict:
    return {
        "discount_amount": calculation["discount_amount"],
        "subtotal": calculation["subtotal"],
        "tax_amount": calculation["tax_amount"],
        "total_amount": calculation["total_amount"],
        "currency_code": calculation["currency_code"],
        "price_tax_mode": calculation["price_tax_mode"],
        "rounding_scope": calculation["rounding_scope"],
        "tax_breakdown_json": serialize_tax_breakdown(calculation["tax_breakdown"]),
    }


def _client_open_credit(db: Session, client_id: int):
    rows = db.query(Sale).filter(
        Sale.client_id == client_id,
        Sale.doc_type == "invoice",
        Sale.status.in_(OPEN_SALE_STATUSES),
        Sale.total_amount > Sale.paid_amount,
    ).all()
    return decimal_sum(s.balance_due for s in rows)


def _creator_name(user) -> str:
    if not user:
        return ""
    return (user.full_name or user.username or "").strip()


def _stock_targets(item: SaleItem) -> list[tuple[Product, object, str]]:
    """Expand a school bundle into stock-managed component quantities."""
    product = item.product
    if not product:
        return []
    if product.product_type == "product":
        return [(product, item.base_quantity or item.quantity or 0, f"item:{item.id}")]
    if product.product_type == "bundle":
        if not product.bundle_components:
            raise HTTPException(409, f"Le pack {product.name} ne contient aucun produit")
        return [
            (
                component.component,
                (item.quantity or 0) * (component.quantity or 0),
                f"item:{item.id}:component:{component.id}",
            )
            for component in product.bundle_components
        ]
    return []


def _to_sale_out(s: Sale, include_items: bool = True) -> SaleOut:
    items = []
    if include_items:
        items = [SaleItemOut(
        id=i.id,
        product_id=i.product_id,
        product_name=i.product.name if i.product else (i.description or ""),
        description=i.description or "",
        quantity=i.quantity or 1,
        sale_unit=i.sale_unit or (i.product.unit if i.product else ""),
        conversion_factor=i.conversion_factor or 1,
        base_quantity=i.base_quantity or i.quantity or 1,
        unit_price=i.unit_price or 0,
        catalog_unit_price=i.catalog_unit_price or i.unit_price or 0,
        price_overridden=bool(i.price_overridden),
        price_override_reason=i.price_override_reason or "",
        purchase_price=i.purchase_price or 0,
        discount=i.discount or 0,
        discount_amount=i.discount_amount or 0,
        tax_rate=i.tax_rate if i.tax_rate is not None else 20,
        tax_amount=i.tax_amount or 0,
        total_amount=i.total_amount or i.line_total or 0,
        line_total=i.line_total or 0,
        ) for i in (s.items or [])]
    return SaleOut(
        id=s.id,
        number=s.number or "",
        doc_type=s.doc_type or "invoice",
        status=s.status or "draft",
        client_id=s.client_id,
        parent_id=s.parent_id,
        client_name=s.client.name if s.client else "—",
        date_time=s.date_time,
        due_date=s.due_date,
        notes=s.notes or "",
        discount=s.discount or 0,
        discount_amount=s.discount_amount or 0,
        subtotal=s.subtotal or 0,
        tax_amount=s.tax_amount or 0,
        total_amount=s.total_amount or 0,
        paid_amount=s.paid_amount or 0,
        balance_due=s.balance_due,
        payment_mode=s.payment_mode or "",
        created_by=s.created_by,
        created_by_name=_creator_name(s.creator),
        updated_at=s.updated_at,
        version=s.version or 1,
        currency_code=s.currency_code or "MAD",
        price_tax_mode=s.price_tax_mode or "exclusive",
        rounding_scope=s.rounding_scope or "line",
        tax_breakdown=parse_tax_breakdown(s.tax_breakdown_json),
        items=items,
    )


@router.get("", response_model=List[SaleOut])
def list_sales(
    doc_type: str = "invoice",
    status: Optional[str] = None,
    client_id: Optional[int] = None,
    q: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = (
        db.query(Sale)
        .options(joinedload(Sale.client), joinedload(Sale.creator))
        .filter(Sale.doc_type == doc_type)
    )
    if status:
        query = query.filter(Sale.status == status)
    if client_id:
        query = query.filter(Sale.client_id == client_id)
    if q:
        query = query.filter(Sale.number.ilike(f"%{q}%"))
    if date_from:
        query = query.filter(func.date(Sale.date_time) >= date_from)
    if date_to:
        query = query.filter(func.date(Sale.date_time) <= date_to)
    sales = query.order_by(Sale.date_time.desc()).offset(skip).limit(limit).all()
    return [_to_sale_out(s, include_items=False) for s in sales]


@router.post("/preview", response_model=DocumentPreviewOut)
def preview_sale(
    body: SaleCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    items, _ = resolve_sale_items(db, user, [item.model_dump() for item in body.items])
    return _preview(_compute_sale(items, body.discount))


@router.get("/{sid}", response_model=SaleOut)
def get_sale(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    s = (
        db.query(Sale)
        .options(joinedload(Sale.client), joinedload(Sale.creator), selectinload(Sale.items).joinedload(SaleItem.product))
        .filter(Sale.id == sid).first()
    )
    if not s:
        raise HTTPException(404, "Vente non trouvée")
    return _to_sale_out(s)


@router.post("/{sid}/return", response_model=SaleOut, status_code=201)
def create_sale_return(
    sid: int,
    body: SaleReturnIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    source = db.query(Sale).options(
        selectinload(Sale.items).joinedload(SaleItem.product)
    ).filter(Sale.id == sid).first()
    if not source or source.doc_type != "invoice" or source.status not in ACTIVE_SALE_STATUSES:
        raise HTTPException(409, "Seule une facture confirmée peut faire l'objet d'un retour")
    payload = body.model_dump(mode="json")
    if claim_idempotency(db, scope=f"sale:{sid}:return", key=idempotency_key, payload=payload, user_id=user.id):
        existing = db.query(Sale).filter(
            Sale.parent_id == sid,
            Sale.doc_type == "credit_note",
            Sale.notes.like(f"%return-key:{idempotency_key}%"),
        ).first()
        if not existing:
            raise HTTPException(409, "Retour introuvable pour cette opération")
        return get_sale(existing.id, db, user)

    source_by_id = {item.id: item for item in source.items}
    submitted = {}
    for row in body.items:
        if row.sale_item_id in submitted:
            raise HTTPException(400, "Une ligne de retour est dupliquée")
        item = source_by_id.get(row.sale_item_id)
        if not item:
            raise HTTPException(400, "Ligne de facture invalide")
        submitted[row.sale_item_id] = {
            "quantity": quantize_quantity(row.quantity),
            "condition": row.condition,
            "restock": bool(row.restock and row.condition == "resalable"),
        }

    prior_returns = db.query(SaleItem).join(Sale).filter(
        Sale.parent_id == source.id,
        Sale.doc_type == "credit_note",
        Sale.status.in_(ACTIVE_SALE_STATUSES),
    ).all()
    already_returned = {}
    for row in prior_returns:
        # Return lines keep the original sale item id in their description metadata.
        marker = (row.description or "").split("[source-item:")
        if len(marker) < 2:
            continue
        try:
            source_item_id = int(marker[-1].split("]", 1)[0])
        except ValueError:
            continue
        already_returned[source_item_id] = quantize_quantity(
            already_returned.get(source_item_id, 0) + (row.quantity or 0)
        )

    raw_items = []
    return_options = {}
    for source_item_id, options in submitted.items():
        quantity = options["quantity"]
        original = source_by_id[source_item_id]
        remaining = quantize_quantity(original.quantity or 0) - already_returned.get(source_item_id, 0)
        if quantity > remaining:
            raise HTTPException(
                409,
                f"Quantité retournée supérieure au disponible pour {original.product.name if original.product else original.description}",
            )
        product_type = original.product.product_type if original.product else ""
        should_restock = bool(options["restock"] and product_type in {"product", "bundle"})
        return_options[source_item_id] = {
            "condition": options["condition"],
            "restock": should_restock,
        }
        raw_items.append({
            "product_id": original.product_id,
            "description": (
                f"{original.description or (original.product.name if original.product else '')} "
                f"[source-item:{original.id}] [condition:{options['condition']}] "
                f"[restock:{1 if should_restock else 0}]"
            ),
            "quantity": quantity,
            "sale_unit": original.sale_unit or (original.product.unit if original.product else ""),
            "unit_price": original.unit_price or 0,
            "purchase_price": original.purchase_price or 0,
            "discount": original.discount or 0,
            "tax_rate": original.tax_rate or 0,
            "catalog_unit_price": original.catalog_unit_price or original.unit_price or 0,
            "price_overridden": original.price_overridden,
            "price_override_reason": original.price_override_reason or "",
        })
    if not raw_items:
        raise HTTPException(400, "Aucune ligne à retourner")

    calculation = _compute_sale(raw_items, source.discount or 0)
    exchange_calculation = None
    exchange_overrides = []
    if body.resolution == "exchange":
        if not body.exchange_items:
            raise HTTPException(400, "Ajoutez au moins un article de remplacement")
        exchange_rows, exchange_overrides = resolve_sale_items(
            db, user, [item.model_dump() for item in body.exchange_items]
        )
        exchange_calculation = _compute_sale(exchange_rows, 0)
    elif body.exchange_items:
        raise HTTPException(400, "Les articles de remplacement sont réservés au mode échange")

    now = datetime.now()
    allocation = reserve_document_number(db, "sale", "credit_note", document_date=now, created_by=user.id)
    exchange_allocation = None
    exchange = None
    try:
        credit = Sale(
            number=allocation.document_number,
            doc_type="credit_note",
            status=SALE_CONFIRMED,
            parent_id=source.id,
            client_id=source.client_id,
            date_time=now,
            notes=f"Retour {source.number} — {body.reason} — résolution:{body.resolution} — return-key:{idempotency_key}",
            discount=source.discount or 0,
            payment_mode=body.resolution,
            paid_amount=0,
            created_by=user.id,
            **_document_values(calculation),
        )
        db.add(credit)
        db.flush()
        return_lines = []
        for row in calculation["items"]:
            line = SaleItem(
                sale_id=credit.id,
                product_id=row.get("product_id"),
                description=row.get("description", ""),
                quantity=row["quantity"],
                sale_unit=row.get("sale_unit", ""),
                conversion_factor=row.get("conversion_factor", 1),
                base_quantity=row.get("base_quantity", row["quantity"]),
                unit_price=row["unit_price"],
                catalog_unit_price=row.get("catalog_unit_price", row["unit_price"]),
                price_overridden=row.get("price_overridden", False),
                price_override_reason=row.get("price_override_reason", ""),
                purchase_price=row.get("purchase_price", 0),
                discount=row.get("discount", 0),
                tax_rate=row.get("tax_rate", 0),
                discount_amount=row["discount_amount"],
                tax_amount=row["tax_amount"],
                total_amount=row["total_amount"],
                line_total=row["line_total"],
            )
            db.add(line)
            return_lines.append(line)
        db.flush()
        for line in return_lines:
            marker = (line.description or "").split("[source-item:")
            source_item_id = int(marker[-1].split("]", 1)[0]) if len(marker) > 1 else None
            if not source_item_id or not return_options[source_item_id]["restock"]:
                continue
            for product, quantity, key_suffix in _stock_targets(line):
                apply_stock_movement(
                    db, product, "in", quantity,
                    operation_key=f"sale:{credit.id}:return:{key_suffix}",
                    user_id=user.id, unit_cost=product.purchase_price or 0,
                    reference=credit.number, notes=f"Retour client: {body.reason}",
                    source_type="sale_return", source_id=credit.id, source_line_id=line.id,
                )

        if exchange_calculation:
            exchange_allocation = reserve_document_number(
                db, "sale", "invoice", document_date=now, created_by=user.id
            )
            credited = min(exchange_calculation["total_amount"], calculation["total_amount"])
            exchange = Sale(
                number=exchange_allocation.document_number,
                doc_type="invoice",
                status=SALE_CONFIRMED,
                parent_id=credit.id,
                client_id=source.client_id,
                date_time=now,
                notes=f"Échange lié à {credit.number} / facture initiale {source.number}",
                discount=0,
                payment_mode="exchange_credit",
                paid_amount=credited,
                created_by=user.id,
                **_document_values(exchange_calculation),
            )
            db.add(exchange)
            db.flush()
            exchange_lines = []
            for row in exchange_calculation["items"]:
                line = SaleItem(
                    sale_id=exchange.id,
                    product_id=row.get("product_id"),
                    description=row.get("description", ""),
                quantity=row["quantity"],
                sale_unit=row.get("sale_unit", ""),
                conversion_factor=row.get("conversion_factor", 1),
                base_quantity=row.get("base_quantity", row["quantity"]),
                    unit_price=row["unit_price"],
                    catalog_unit_price=row.get("catalog_unit_price", row["unit_price"]),
                    price_overridden=row.get("price_overridden", False),
                    price_override_reason=row.get("price_override_reason", ""),
                    purchase_price=row.get("purchase_price", 0),
                    discount=row.get("discount", 0),
                    tax_rate=row.get("tax_rate", 0),
                    discount_amount=row["discount_amount"],
                    tax_amount=row["tax_amount"],
                    total_amount=row["total_amount"],
                    line_total=row["line_total"],
                )
                db.add(line)
                exchange_lines.append(line)
            db.flush()
            for line in exchange_lines:
                for product, quantity, key_suffix in _stock_targets(line):
                    apply_stock_movement(
                        db, product, "out", quantity,
                        operation_key=f"sale:{exchange.id}:exchange:{key_suffix}",
                        user_id=user.id, unit_cost=product.purchase_price or 0,
                        reference=exchange.number, notes=f"Article de remplacement pour {source.number}",
                        source_type="sale_exchange", source_id=exchange.id, source_line_id=line.id,
                    )
            for override in exchange_overrides:
                line = exchange_lines[override["line_index"]]
                log_action(
                    db, user, "price_override", "sale_item", line.id,
                    f"Prix d'échange modifié pour {override['product_name']}",
                    after={"sale_id": exchange.id, **override},
                )
            commit_number_allocation(db, exchange_allocation.allocation_id, exchange.id)
        commit_number_allocation(db, allocation.allocation_id, credit.id)
        log_action(
            db, user, "return", "sale", source.id,
            f"Retour client créé: {credit.number}",
            after={
                "credit_note_id": credit.id,
                "exchange_invoice_id": exchange.id if exchange else None,
                "resolution": body.resolution,
                "reason": body.reason,
                "credit_total": credit.total_amount,
                "exchange_total": exchange.total_amount if exchange else 0,
                "price_difference": (
                    (exchange.total_amount or 0) - (credit.total_amount or 0)
                    if exchange else -(credit.total_amount or 0)
                ),
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        if exchange_allocation:
            void_reserved_allocation(
                db, exchange_allocation.allocation_id, f"exchange_failed_{type(exc).__name__}"
            )
        void_reserved_allocation(db, allocation.allocation_id, f"return_failed_{type(exc).__name__}")
        raise
    result = get_sale(credit.id, db, user)
    result.return_credit_amount = float(credit.total_amount or 0)
    result.exchange_total = float(exchange.total_amount or 0) if exchange else 0
    result.price_difference = result.exchange_total - result.return_credit_amount
    result.exchange_invoice_id = exchange.id if exchange else None
    result.exchange_invoice_number = exchange.number if exchange else ""
    return result


@router.post("/{sid}/convert-to-invoice", response_model=SaleOut, status_code=201)
def convert_quote_to_invoice(
    sid: int,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    source = (
        db.query(Sale)
        .options(selectinload(Sale.items).joinedload(SaleItem.product))
        .filter(Sale.id == sid)
        .first()
    )
    if not source:
        raise HTTPException(404, "Devis non trouve")
    if source.doc_type != "quote":
        raise HTTPException(400, "Seuls les devis peuvent etre convertis en facture")
    if source.status == "cancelled":
        raise HTTPException(400, "Impossible de convertir un devis annule")
    if not source.items:
        raise HTTPException(400, "Le devis doit contenir au moins une ligne")
    existing_invoice = db.query(Sale).filter(
        Sale.parent_id == source.id,
        Sale.doc_type == "invoice",
        Sale.status != SALE_CANCELLED,
    ).order_by(Sale.id).first()
    if existing_invoice:
        return get_sale(existing_invoice.id, db, user)

    for item in source.items:
        if item.product_id and item.product and item.product.product_type == "product":
            available = item.product.stock_quantity or 0
            requested = item.quantity or 0
            if available < requested:
                raise HTTPException(
                    400,
                    f"Stock insuffisant pour {item.product.name}. Disponible: {available}, demande: {requested}",
                )

    conversion_date = datetime.now()
    db.rollback()
    allocation = reserve_document_number(
        db, "sale", "invoice", document_date=conversion_date, created_by=user.id,
    )
    try:
        source = (
            db.query(Sale)
            .options(selectinload(Sale.items).joinedload(SaleItem.product))
            .filter(Sale.id == sid)
            .first()
        )
        if not source or source.doc_type != "quote" or source.status == "cancelled":
            raise HTTPException(409, "Le devis a change avant sa conversion")
        existing_invoice = db.query(Sale).filter(
            Sale.parent_id == source.id,
            Sale.doc_type == "invoice",
            Sale.status != SALE_CANCELLED,
        ).order_by(Sale.id).first()
        if existing_invoice:
            db.rollback()
            void_reserved_allocation(db, allocation.allocation_id, "quote_already_converted")
            return get_sale(existing_invoice.id, db, user)
        claim_idempotency(
            db,
            scope=f"sale:{sid}:convert-to-invoice",
            key=idempotency_key,
            payload={"source_id": sid},
            user_id=user.id,
        )
        source.version = claim_version(db, Sale, source.id, if_match)
        due_date = None
        if source.client_id:
            client = db.query(Client).filter(Client.id == source.client_id).first()
            if client:
                due_date = conversion_date + timedelta(days=client.payment_terms or 0)

        invoice = Sale(
            number=allocation.document_number,
            doc_type="invoice",
            status="draft",
            client_id=source.client_id,
            date_time=conversion_date,
            due_date=due_date,
            notes=f"Converti depuis {source.number}" + (f"\n{source.notes}" if source.notes else ""),
            discount=source.discount or 0,
            discount_amount=source.discount_amount or 0,
            subtotal=source.subtotal or 0,
            tax_amount=source.tax_amount or 0,
            total_amount=source.total_amount or 0,
            paid_amount=0,
            payment_mode=source.payment_mode or "Espece",
            created_by=user.id,
            parent_id=source.id,
            updated_at=datetime.utcnow(),
            currency_code=source.currency_code or "MAD",
            price_tax_mode=source.price_tax_mode or "exclusive",
            rounding_scope=source.rounding_scope or "line",
            tax_breakdown_json=source.tax_breakdown_json or "[]",
        )
        db.add(invoice)
        db.flush()

        for item in source.items:
            db.add(SaleItem(
                sale_id=invoice.id,
                product_id=item.product_id,
                description=item.description or "",
                quantity=item.quantity or 1,
                sale_unit=item.sale_unit or "",
                conversion_factor=item.conversion_factor or 1,
                base_quantity=item.base_quantity or item.quantity or 1,
                unit_price=item.unit_price or 0,
                catalog_unit_price=item.catalog_unit_price or item.unit_price or 0,
                price_overridden=bool(item.price_overridden),
                price_override_reason=item.price_override_reason or "",
                purchase_price=item.purchase_price or 0,
                discount=item.discount or 0,
                tax_rate=item.tax_rate if item.tax_rate is not None else 20,
                discount_amount=item.discount_amount or 0,
                tax_amount=item.tax_amount or 0,
                total_amount=item.total_amount or item.line_total or 0,
                line_total=item.line_total or 0,
            ))

        source.updated_at = datetime.utcnow()
        commit_number_allocation(db, allocation.allocation_id, invoice.id)
        db.commit()
    except Exception as exc:
        db.rollback()
        void_reserved_allocation(db, allocation.allocation_id, f"conversion_failed_{type(exc).__name__}")
        raise
    return get_sale(invoice.id, db, user)


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(body: SaleCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if money(body.paid_amount) != 0:
        raise HTTPException(400, "Un brouillon ne peut pas contenir de paiement; confirmez puis encaissez")
    if body.client_id and not db.query(Client.id).filter(
        Client.id == body.client_id,
        Client.is_active.is_(True),
    ).first():
        raise HTTPException(400, "Le client sélectionné est introuvable ou archivé")
    items_data, price_overrides = resolve_sale_items(db, user, [i.model_dump() for i in body.items])
    calculation = _compute_sale(items_data, body.discount)
    document_date = body.date_time or datetime.now()
    allocation = reserve_document_number(
        db, "sale", body.doc_type, document_date=document_date, created_by=user.id,
    )
    try:
        due_date = body.due_date
        if not due_date and body.doc_type == "invoice" and body.client_id:
            client = db.query(Client).filter(Client.id == body.client_id).first()
            if client:
                due_date = document_date + timedelta(days=client.payment_terms or 0)
        s = Sale(
            number=allocation.document_number,
            doc_type=body.doc_type,
            status="draft",
            client_id=body.client_id,
            date_time=document_date,
            due_date=due_date,
            notes=body.notes,
            discount=body.discount,
            payment_mode=body.payment_mode,
            paid_amount=0,
            created_by=user.id,
            updated_at=datetime.utcnow(),
            **_document_values(calculation),
        )
        db.add(s)
        db.flush()
        for item in calculation["items"]:
            si = SaleItem(
                sale_id=s.id,
                product_id=item.get("product_id"),
                description=item.get("description", ""),
                quantity=item["quantity"],
                sale_unit=item.get("sale_unit", ""),
                conversion_factor=item.get("conversion_factor", 1),
                base_quantity=item.get("base_quantity", item["quantity"]),
                unit_price=item["unit_price"],
                catalog_unit_price=item.get("catalog_unit_price", item["unit_price"]),
                price_overridden=item.get("price_overridden", False),
                price_override_reason=item.get("price_override_reason", ""),
                purchase_price=item.get("purchase_price", 0),
                discount=item.get("discount", 0),
                tax_rate=item.get("tax_rate", 20),
                discount_amount=item["discount_amount"],
                tax_amount=item["tax_amount"],
                total_amount=item["total_amount"],
                line_total=item["line_total"],
            )
            db.add(si)
        db.flush()
        for override in price_overrides:
            line = s.items[override["line_index"]] if override["line_index"] < len(s.items) else None
            log_action(
                db,
                user,
                "price_override",
                "sale_item",
                line.id if line else "",
                f"Prix modifie pour {override['product_name']}: "
                f"{override['catalog_unit_price']} -> {override['applied_unit_price']}",
                before={"sale_id": s.id, "unit_price": override["catalog_unit_price"]},
                after={"sale_id": s.id, **override},
            )
        commit_number_allocation(db, allocation.allocation_id, s.id)
        log_action(db, user, "create", "sale", s.id, f"Document vente cree: {s.number}", after=model_snapshot(s, ["number", "doc_type", "status", "client_id", "total_amount", "paid_amount"]))
        db.commit()
    except Exception as exc:
        db.rollback()
        void_reserved_allocation(db, allocation.allocation_id, f"creation_failed_{type(exc).__name__}")
        raise
    db.expire(s)
    return get_sale(s.id, db, user)


@router.put("/{sid}", response_model=SaleOut)
def update_sale(
    sid: int,
    body: SaleCreate,
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    s = db.query(Sale).filter(Sale.id == sid).first()
    if not s:
        raise HTTPException(404, "Vente non trouvée")
    if s.status not in ("draft",):
        raise HTTPException(400, "Seuls les brouillons peuvent être modifiés")
    if money(body.paid_amount) != 0:
        raise HTTPException(400, "Un brouillon ne peut pas contenir de paiement")
    if body.client_id and not db.query(Client.id).filter(
        Client.id == body.client_id,
        Client.is_active.is_(True),
    ).first():
        raise HTTPException(400, "Le client sélectionné est introuvable ou archivé")
    s.version = claim_version(db, Sale, s.id, if_match)
    items_data, price_overrides = resolve_sale_items(db, user, [i.model_dump() for i in body.items])
    calculation = _compute_sale(items_data, body.discount)
    for k, v in {**body.model_dump(exclude={"items"}), **_document_values(calculation)}.items():
        if hasattr(s, k):
            setattr(s, k, v)
    s.updated_at = datetime.utcnow()
    log_action(db, user, "update", "sale", s.id, f"Document vente modifie: {s.number}", after=model_snapshot(s, ["number", "doc_type", "status", "client_id", "total_amount", "paid_amount"]))
    # Replace items
    for item in list(s.items):
        db.delete(item)
    db.flush()
    for item in calculation["items"]:
        si = SaleItem(
            sale_id=s.id,
            product_id=item.get("product_id"),
            description=item.get("description", ""),
            quantity=item["quantity"],
            sale_unit=item.get("sale_unit", ""),
            conversion_factor=item.get("conversion_factor", 1),
            base_quantity=item.get("base_quantity", item["quantity"]),
            unit_price=item["unit_price"],
            catalog_unit_price=item.get("catalog_unit_price", item["unit_price"]),
            price_overridden=item.get("price_overridden", False),
            price_override_reason=item.get("price_override_reason", ""),
            purchase_price=item.get("purchase_price", 0),
            discount=item.get("discount", 0),
            tax_rate=item.get("tax_rate", 20),
            discount_amount=item["discount_amount"],
            tax_amount=item["tax_amount"],
            total_amount=item["total_amount"],
            line_total=item["line_total"],
        )
        db.add(si)
    db.flush()
    for override in price_overrides:
        line = s.items[override["line_index"]] if override["line_index"] < len(s.items) else None
        log_action(
            db, user, "price_override", "sale_item", line.id if line else "",
            f"Prix modifie pour {override['product_name']}: "
            f"{override['catalog_unit_price']} -> {override['applied_unit_price']}",
            before={"sale_id": s.id, "unit_price": override["catalog_unit_price"]},
            after={"sale_id": s.id, **override},
        )
    db.commit()
    return get_sale(sid, db, user)


@router.post("/{sid}/confirm", response_model=SaleOut)
def confirm_sale(
    sid: int,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    s = db.query(Sale).options(selectinload(Sale.items).joinedload(SaleItem.product)).filter(Sale.id == sid).first()
    if not s:
        raise HTTPException(404, "Vente non trouvée")
    if claim_idempotency(db, scope=f"sale:{sid}:confirm", key=idempotency_key, payload={}, user_id=user.id):
        db.expire_all()
        return get_sale(sid, db, user)
    assert_transition("sale", s.status, SALE_CONFIRMED)
    if not s.items:
        raise HTTPException(400, "La vente doit contenir au moins une ligne")
    if money(s.total_amount) <= 0:
        raise HTTPException(400, "Le total du document doit être strictement positif")

    if s.doc_type == "invoice" and s.client_id and s.balance_due > 0:
        client = db.query(Client).filter(Client.id == s.client_id).first()
        if client and (client.credit_limit or 0) > 0:
            projected_credit = _client_open_credit(db, client.id) + s.balance_due
            if projected_credit > (client.credit_limit or 0):
                raise HTTPException(
                    400,
                    f"Limite credit depassee pour {client.name}. Disponible: {max((client.credit_limit or 0) - _client_open_credit(db, client.id), 0):.2f} MAD",
                )

    affects_stock = s.doc_type in ("invoice", "delivery", "credit_note")
    stock_direction = "in" if s.doc_type == "credit_note" else "out"

    if affects_stock:
        for item in s.items:
            for product, quantity, key_suffix in _stock_targets(item):
                apply_stock_movement(
                    db, product, stock_direction, quantity,
                    operation_key=f"sale:{s.id}:confirm:{key_suffix}",
                    user_id=user.id,
                    unit_cost=product.purchase_price or 0,
                    reference=s.number,
                    notes="Retour stock avoir client" if stock_direction == "in" else "Mouvement stock confirmation vente",
                    source_type="sale", source_id=s.id, source_line_id=item.id,
                )

    s.version = claim_version(db, Sale, s.id, if_match)
    s.status = SALE_CONFIRMED
    s.updated_at = datetime.utcnow()
    if s.client_id:
        client = db.query(Client).filter(Client.id == s.client_id).first()
        if client:
            sync_client_credit(db, client.id)
    log_action(db, user, "confirm", "sale", s.id, f"Vente confirmee: {s.number}", after=model_snapshot(s, ["number", "doc_type", "status", "total_amount", "paid_amount"]))
    db.commit()
    return get_sale(sid, db, user)


@router.post("/{sid}/cancel", response_model=SaleOut)
def cancel_sale(
    sid: int,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    s = db.query(Sale).options(selectinload(Sale.items).joinedload(SaleItem.product)).filter(Sale.id == sid).first()
    if not s:
        raise HTTPException(404, "Vente non trouvée")
    if claim_idempotency(db, scope=f"sale:{sid}:cancel", key=idempotency_key, payload={}, user_id=user.id):
        db.expire_all()
        return get_sale(sid, db, user)
    assert_transition("sale", s.status, SALE_CANCELLED)
    previous_status = s.status
    previous_paid = document_paid_total(db, "sale", s.id)

    # Reverse the exact committed stock entries once. Draft sales have no entries.
    original_movements = db.query(StockMovement).filter(
        StockMovement.source_type == "sale",
        StockMovement.source_id == s.id,
        StockMovement.kind == "movement",
    ).order_by(StockMovement.id).all()
    for movement in original_movements:
        reverse_stock_movement(
            db,
            movement,
            operation_key=f"sale:{s.id}:cancel:movement:{movement.id}",
            user_id=user.id,
            reference=f"CANCEL-{s.number}",
            notes="Contre-mouvement exact annulation vente",
        )

    originals = db.query(Payment).filter(
        Payment.document_type == "sale",
        Payment.document_id == s.id,
        Payment.kind == "payment",
    ).all()
    recorded = money(sum(money(p.amount) for p in originals))
    reversal_count = 0
    for original in originals:
        already_reversed = db.query(Payment.id).filter(Payment.reverses_payment_id == original.id).first()
        if not already_reversed:
            register_reversal(
                db, user, original,
                idempotency_key=idempotency_key or "",
                notes=f"Annulation document {s.number}",
            )
            reversal_count += 1
    legacy_untracked = max(previous_paid - recorded, money(0))
    if legacy_untracked > 0:
        register_payment(
            db, user, "sale", s.id, -legacy_untracked, s.payment_mode,
            reference=s.number, notes=f"Annulation paiement historique non detaille {s.number}",
            kind="reversal", idempotency_key=idempotency_key or "", record_cash=False,
        )
        reversal_count += 1

    s.version = claim_version(db, Sale, s.id, if_match)
    s.status = SALE_CANCELLED
    s.paid_amount = sync_document_paid_amount(db, "sale", s.id)
    s.updated_at = datetime.utcnow()
    if s.client_id:
        client = db.query(Client).filter(Client.id == s.client_id).first()
        if client:
            sync_client_credit(db, client.id)
    log_action(db, user, "cancel", "sale", s.id, f"Vente annulee: {s.number}", before={"status": previous_status, "paid_amount": str(previous_paid)}, after={"status": s.status, "paid_amount": "0.00", "stock_reversed": affects_stock if (affects_stock := s.doc_type in ("invoice", "delivery", "credit_note")) else False, "payment_reversals": reversal_count, "journal_reversal": "not_applicable_no_ledger_module"})
    db.commit()
    return get_sale(sid, db, user)


@router.post("/{sid}/payment", response_model=SaleOut)
def record_payment(
    sid: int,
    body: PaymentIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    s = db.query(Sale).filter(Sale.id == sid).first()
    if not s:
        raise HTTPException(404, "Vente non trouvée")
    payload = {"amount": str(body.amount), "payment_mode": body.payment_mode}
    if claim_idempotency(db, scope=f"sale:{sid}:payment", key=idempotency_key, payload=payload, user_id=user.id):
        db.expire_all()
        return get_sale(sid, db, user)
    if s.status not in OPEN_SALE_STATUSES:
        raise HTTPException(409, f"Paiement interdit pour le statut {s.status}")
    current_paid = document_paid_total(db, "sale", s.id)
    amount = validate_payment_amount(body.amount, money(s.total_amount) - current_paid)
    s.version = claim_version(db, Sale, s.id, if_match)
    register_payment(
        db, user, "sale", s.id, amount, body.payment_mode,
        reference=s.number, notes=f"Paiement vente {s.number}", cash_direction="in",
        idempotency_key=idempotency_key or "",
        allow_without_cash_session=body.allow_without_cash_session,
    )
    new_paid = sync_document_paid_amount(db, "sale", s.id)
    s.payment_mode = body.payment_mode
    s.status = payment_target("sale", s.status, new_paid, s.total_amount)
    s.updated_at = datetime.utcnow()
    if s.client_id:
        sync_client_credit(db, s.client_id)
    log_action(db, user, "payment", "sale", s.id, f"Paiement vente: {s.number}", after={"amount": body.amount, "payment_mode": body.payment_mode, "paid_amount": s.paid_amount, "status": s.status})
    db.commit()
    return get_sale(sid, db, user)


@router.delete("/{sid}")
def delete_sale(
    sid: int,
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    s = db.query(Sale).filter(Sale.id == sid).first()
    if not s:
        raise HTTPException(404, "Vente non trouvée")
    if s.status != "draft":
        raise HTTPException(409, "Seul un brouillon peut etre supprime; annulez ou inversez le document final")
    claim_version(db, Sale, s.id, if_match)
    before = model_snapshot(s, ["number", "doc_type", "status", "total_amount"])
    void_document_allocation(db, "sale", s.number, s.id, "draft_deleted")
    db.delete(s)
    log_action(db, user, "delete", "sale", sid, f"Document vente supprime: {before.get('number')}", before=before)
    db.commit()
    return {"ok": True}
