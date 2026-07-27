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
from api.schemas import DocumentPreviewOut, SaleCreate, SaleOut, SaleItemOut, PaymentIn
from api.audit import log_action, model_snapshot
from api.payments import register_payment
from api.payments import register_reversal
from models.payment import Payment
from core.settings_store import load_settings
from services.money import calculate_document, decimal_sum, parse_tax_breakdown, policy_from_settings, serialize_tax_breakdown
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


def _to_sale_out(s: Sale, include_items: bool = True) -> SaleOut:
    items = []
    if include_items:
        items = [SaleItemOut(
        id=i.id,
        product_id=i.product_id,
        product_name=i.product.name if i.product else (i.description or ""),
        description=i.description or "",
        quantity=i.quantity or 1,
        unit_price=i.unit_price or 0,
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
def preview_sale(body: SaleCreate, user=Depends(get_current_user)):
    return _preview(_compute_sale([item.model_dump() for item in body.items], body.discount))


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


@router.post("/{sid}/convert-to-invoice", response_model=SaleOut, status_code=201)
def convert_quote_to_invoice(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
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
                unit_price=item.unit_price or 0,
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
    items_data = [i.model_dump() for i in body.items]
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
                unit_price=item["unit_price"],
                purchase_price=item.get("purchase_price", 0),
                discount=item.get("discount", 0),
                tax_rate=item.get("tax_rate", 20),
                discount_amount=item["discount_amount"],
                tax_amount=item["tax_amount"],
                total_amount=item["total_amount"],
                line_total=item["line_total"],
            )
            db.add(si)
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
    s.version = claim_version(db, Sale, s.id, if_match)
    items_data = [i.model_dump() for i in body.items]
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
            unit_price=item["unit_price"],
            purchase_price=item.get("purchase_price", 0),
            discount=item.get("discount", 0),
            tax_rate=item.get("tax_rate", 20),
            discount_amount=item["discount_amount"],
            tax_amount=item["tax_amount"],
            total_amount=item["total_amount"],
            line_total=item["line_total"],
        )
        db.add(si)
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

    if affects_stock and stock_direction == "out":
        for item in s.items:
            if item.product_id:
                p = db.query(Product).filter(Product.id == item.product_id).first()
                if p and p.product_type == "product":
                    apply_stock_movement(
                        db,
                        p,
                        stock_direction,
                        item.quantity or 0,
                        operation_key=f"sale:{s.id}:confirm:item:{item.id}",
                        user_id=user.id,
                        unit_cost=item.purchase_price or p.purchase_price,
                        reference=s.number,
                        notes="Mouvement stock confirmation vente",
                        source_type="sale",
                        source_id=s.id,
                        source_line_id=item.id,
                    )

    if affects_stock and stock_direction == "in":
        for item in s.items:
            if item.product_id:
                p = db.query(Product).filter(Product.id == item.product_id).first()
                if p and p.product_type == "product":
                    apply_stock_movement(
                        db, p, "in", item.quantity or 0, user_id=user.id,
                        operation_key=f"sale:{s.id}:confirm:item:{item.id}",
                        unit_cost=item.purchase_price or p.purchase_price,
                        reference=s.number, notes="Retour stock avoir client",
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
