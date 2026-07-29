"""Purchase CRUD protected by the centralized document workflow."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from api.audit import log_action, model_snapshot
from api.payments import register_payment
from api.schemas import DocumentPreviewOut, PaymentIn, PurchaseCreate, PurchaseItemOut, PurchaseOut, PurchaseReceiveIn
from core.database import get_db
from core.security import get_current_user
from core.settings_store import load_settings
from models.product import Product
from models.purchase import Purchase, PurchaseItem
from services.money import calculate_document, parse_tax_breakdown, policy_from_settings, quantize_quantity, serialize_tax_breakdown
from services.stock import apply_stock_movement
from services.credit import document_paid_total, sync_document_paid_amount
from services.document_numbers import (
    commit_number_allocation,
    reserve_document_number,
    void_document_allocation,
    void_reserved_allocation,
)
from services.document_workflow import (
    PAYABLE_PURCHASE_STATUSES,
    PURCHASE_CANCELLED,
    PURCHASE_CONFIRMED,
    PURCHASE_PARTIALLY_RECEIVED,
    PURCHASE_RECEIVED,
    assert_transition,
    claim_idempotency,
    claim_version,
    money,
    payment_target,
    validate_payment_amount,
)

router = APIRouter()


def _creator_name(user) -> str:
    return (user.full_name or user.username or "").strip() if user else ""


def _to_out(p: Purchase, include_items: bool = True) -> PurchaseOut:
    items = []
    if include_items:
        items = [PurchaseItemOut(
            id=i.id,
            product_id=i.product_id,
            product_name=i.product.name if i.product else (i.description or ""),
            description=i.description or "",
            quantity=i.quantity or 0,
            purchase_unit=i.purchase_unit or (i.product.purchase_unit if i.product else ""),
            conversion_factor=i.conversion_factor or 1,
            base_quantity=i.base_quantity or i.quantity or 0,
            unit_price=i.unit_price or 0,
            discount=i.discount or 0,
            discount_amount=i.discount_amount or 0,
            tax_rate=i.tax_rate if i.tax_rate is not None else 20,
            tax_amount=i.tax_amount or 0,
            total_amount=i.total_amount or i.line_total or 0,
            line_total=i.line_total or 0,
            received_quantity=i.received_quantity or 0,
            received_base_quantity=i.received_base_quantity or 0,
            remaining_quantity=max((i.quantity or 0) - (i.received_quantity or 0), 0),
        ) for i in (p.items or [])]
    return PurchaseOut(
        id=p.id,
        number=p.number or "",
        doc_type=p.doc_type,
        status=p.status,
        supplier_id=p.supplier_id,
        supplier_name=p.supplier.company_name if p.supplier else "—",
        date_time=p.date_time,
        expected_date=p.expected_date,
        notes=p.notes or "",
        discount=p.discount or 0,
        discount_amount=p.discount_amount or 0,
        subtotal=p.subtotal or 0,
        tax_amount=p.tax_amount or 0,
        total_amount=p.total_amount or 0,
        paid_amount=p.paid_amount or 0,
        payment_status=p.payment_status,
        created_by=p.created_by,
        created_by_name=_creator_name(p.creator),
        version=p.version or 1,
        currency_code=p.currency_code or "MAD",
        price_tax_mode=p.price_tax_mode or "exclusive",
        rounding_scope=p.rounding_scope or "line",
        tax_breakdown=parse_tax_breakdown(p.tax_breakdown_json),
        items=items,
    )


def _compute(items_data: list[dict], discount=0) -> dict:
    return calculate_document(items_data, discount, policy_from_settings(load_settings()))


def _normalize_purchase_items(db: Session, raw_items: list[dict]) -> list[dict]:
    product_ids = {int(row["product_id"]) for row in raw_items if row.get("product_id")}
    products = {
        product.id: product
        for product in db.query(Product).filter(Product.id.in_(product_ids)).all()
    } if product_ids else {}
    normalized = []
    for index, raw in enumerate(raw_items):
        row = dict(raw)
        product_id = row.get("product_id")
        if not product_id:
            row.update(conversion_factor=1, base_quantity=quantize_quantity(row.get("quantity", 0)))
            normalized.append(row)
            continue
        product = products.get(int(product_id))
        if not product or not product.is_active or product.product_type != "product":
            raise HTTPException(400, f"Produit stockable invalide à la ligne {index + 1}")
        configured_factor = quantize_quantity(product.purchase_to_base_factor or 1)
        requested_factor = row.get("conversion_factor")
        factor = quantize_quantity(requested_factor if requested_factor is not None else configured_factor)
        if factor <= 0:
            raise HTTPException(400, f"Facteur de conversion invalide à la ligne {index + 1}")
        quantity = quantize_quantity(row.get("quantity", 0))
        row.update({
            "description": row.get("description") or product.name,
            "purchase_unit": str(row.get("purchase_unit") or product.purchase_unit or product.unit or "pcs")[:20],
            "conversion_factor": factor,
            "base_quantity": quantize_quantity(quantity * factor),
            "tax_rate": product.tax_rate if product.tva_enabled else 0,
        })
        normalized.append(row)
    return normalized


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


def _purchase_item(purchase_id: int, item: dict) -> PurchaseItem:
    return PurchaseItem(
        purchase_id=purchase_id,
        product_id=item.get("product_id"),
        description=item.get("description", ""),
        quantity=item["quantity"],
        purchase_unit=item.get("purchase_unit", ""),
        conversion_factor=item.get("conversion_factor", 1),
        base_quantity=item.get("base_quantity", item["quantity"]),
        unit_price=item["unit_price"],
        discount=item.get("discount", 0),
        tax_rate=item.get("tax_rate", 0),
        discount_amount=item["discount_amount"],
        line_total=item["line_total"],
        tax_amount=item["tax_amount"],
        total_amount=item["total_amount"],
        received_quantity=0,
        received_base_quantity=0,
    )


@router.get("", response_model=List[PurchaseOut])
def list_purchases(q: Optional[str] = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), user=Depends(get_current_user)):
    query = db.query(Purchase).options(joinedload(Purchase.supplier), joinedload(Purchase.creator)).outerjoin(Purchase.supplier)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Purchase.number.ilike(like), Purchase.notes.ilike(like)))
    rows = query.order_by(Purchase.date_time.desc()).offset(skip).limit(min(limit, 300)).all()
    return [_to_out(row, include_items=False) for row in rows]


@router.post("/preview", response_model=DocumentPreviewOut)
def preview_purchase(body: PurchaseCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    items = _normalize_purchase_items(db, [item.model_dump() for item in body.items])
    return _preview(_compute(items, body.discount))


@router.get("/{pid}", response_model=PurchaseOut)
def get_purchase(pid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    purchase = db.query(Purchase).options(
        joinedload(Purchase.supplier), joinedload(Purchase.creator),
        selectinload(Purchase.items).joinedload(PurchaseItem.product),
    ).filter(Purchase.id == pid).first()
    if not purchase:
        raise HTTPException(404, "Commande non trouvee")
    return _to_out(purchase)


@router.post("", response_model=PurchaseOut, status_code=201)
def create_purchase(body: PurchaseCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    items_data = _normalize_purchase_items(db, [item.model_dump() for item in body.items])
    calculation = _compute(items_data, body.discount)
    document_date = body.date_time or datetime.now()
    allocation = reserve_document_number(
        db, "purchase", body.doc_type, document_date=document_date, created_by=user.id,
    )
    try:
        purchase = Purchase(
            number=allocation.document_number, doc_type=body.doc_type, status="draft",
            supplier_id=body.supplier_id, date_time=document_date,
            expected_date=body.expected_date, notes=body.notes, discount=body.discount,
            created_by=user.id, **_document_values(calculation),
        )
        db.add(purchase)
        db.flush()
        for item in calculation["items"]:
            db.add(_purchase_item(purchase.id, item))
        commit_number_allocation(db, allocation.allocation_id, purchase.id)
        log_action(db, user, "create", "purchase", purchase.id, f"Achat cree: {purchase.number}", after=model_snapshot(purchase, ["number", "doc_type", "status", "supplier_id", "total_amount", "paid_amount"]))
        db.commit()
    except Exception as exc:
        db.rollback()
        void_reserved_allocation(db, allocation.allocation_id, f"creation_failed_{type(exc).__name__}")
        raise
    return get_purchase(purchase.id, db, user)


@router.put("/{pid}", response_model=PurchaseOut)
def update_purchase(pid: int, body: PurchaseCreate, if_match: Optional[str] = Header(default=None, alias="If-Match"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    purchase = db.query(Purchase).options(selectinload(Purchase.items)).filter(Purchase.id == pid).first()
    if not purchase:
        raise HTTPException(404, "Commande non trouvee")
    if purchase.status != "draft":
        raise HTTPException(409, "Seul un brouillon peut etre modifie")
    purchase.version = claim_version(db, Purchase, purchase.id, if_match)
    items_data = _normalize_purchase_items(db, [item.model_dump() for item in body.items])
    calculation = _compute(items_data, body.discount)
    for key, value in body.model_dump(exclude={"items"}).items():
        setattr(purchase, key, value)
    for key, value in _document_values(calculation).items():
        setattr(purchase, key, value)
    for item in list(purchase.items):
        db.delete(item)
    db.flush()
    for item in calculation["items"]:
        db.add(_purchase_item(purchase.id, item))
    log_action(db, user, "update", "purchase", purchase.id, f"Achat modifie: {purchase.number}", after=model_snapshot(purchase, ["status", "total_amount", "version"]))
    db.commit()
    return get_purchase(pid, db, user)


@router.post("/{pid}/confirm", response_model=PurchaseOut)
def confirm_purchase(pid: int, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"), if_match: Optional[str] = Header(default=None, alias="If-Match"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    purchase = db.query(Purchase).options(selectinload(Purchase.items)).filter(Purchase.id == pid).first()
    if not purchase:
        raise HTTPException(404, "Commande non trouvee")
    if claim_idempotency(db, scope=f"purchase:{pid}:confirm", key=idempotency_key, payload={}, user_id=user.id):
        db.expire_all()
        return get_purchase(pid, db, user)
    assert_transition("purchase", purchase.status, PURCHASE_CONFIRMED)
    if not purchase.items:
        raise HTTPException(400, "La commande doit contenir au moins une ligne")
    purchase.version = claim_version(db, Purchase, purchase.id, if_match)
    purchase.status = PURCHASE_CONFIRMED
    log_action(db, user, "confirm", "purchase", purchase.id, f"Achat confirme: {purchase.number}", after=model_snapshot(purchase, ["status", "total_amount", "version"]))
    db.commit()
    return get_purchase(pid, db, user)


@router.post("/{pid}/receive", response_model=PurchaseOut)
def receive_purchase(pid: int, body: Optional[PurchaseReceiveIn] = None, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"), if_match: Optional[str] = Header(default=None, alias="If-Match"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    purchase = db.query(Purchase).options(selectinload(Purchase.items).joinedload(PurchaseItem.product)).filter(Purchase.id == pid).first()
    if not purchase:
        raise HTTPException(404, "Commande non trouvee")
    payload = body.model_dump() if body else {"items": "all_remaining"}
    if claim_idempotency(db, scope=f"purchase:{pid}:receive", key=idempotency_key, payload=payload, user_id=user.id):
        db.expire_all()
        return get_purchase(pid, db, user)
    if purchase.status not in (PURCHASE_CONFIRMED, PURCHASE_PARTIALLY_RECEIVED):
        raise HTTPException(409, f"Reception interdite pour le statut {purchase.status}")

    by_id = {item.id: item for item in purchase.items}
    requested: list[tuple[PurchaseItem, object]] = []
    if body and body.items:
        seen = set()
        for line in body.items:
            if line.item_id in seen:
                raise HTTPException(400, "Une ligne de reception est dupliquee")
            seen.add(line.item_id)
            item = by_id.get(line.item_id)
            if not item:
                raise HTTPException(400, "Ligne de commande invalide")
            quantity = quantize_quantity(line.quantity)
            if quantity <= 0:
                raise HTTPException(400, "La quantite recue doit etre positive")
            remaining = quantize_quantity(item.quantity or 0) - quantize_quantity(item.received_quantity or 0)
            if quantity > remaining:
                raise HTTPException(400, "La quantite recue depasse la quantite restante")
            requested.append((item, quantity))
    else:
        requested = [(item, (item.quantity or 0) - (item.received_quantity or 0)) for item in purchase.items if (item.quantity or 0) > (item.received_quantity or 0)]
    if not requested:
        raise HTTPException(400, "Aucune quantite restante a recevoir")

    purchase.version = claim_version(db, Purchase, purchase.id, if_match)
    for item, quantity in requested:
        product = item.product
        base_quantity = quantity
        if product:
            factor = quantize_quantity(item.conversion_factor or 1)
            base_quantity = quantize_quantity(quantity * factor)
            base_unit_cost = quantize_quantity((item.unit_price or 0) / factor)
            previous_quantity = quantize_quantity(product.stock_quantity or 0)
            previous_cost = quantize_quantity(product.purchase_price or 0)
            resulting_quantity = previous_quantity + base_quantity
            if base_unit_cost > 0:
                # CMP: conserve la valeur du stock existant et y ajoute la
                # valeur de cette réception (même lorsqu'elle est partielle).
                product.purchase_price = quantize_quantity(
                    ((previous_quantity * previous_cost) + (base_quantity * base_unit_cost))
                    / resulting_quantity
                ) if resulting_quantity > 0 else base_unit_cost
            apply_stock_movement(
                db, product, "in", base_quantity,
                operation_key=f"purchase:{purchase.id}:receive:{idempotency_key}:item:{item.id}",
                user_id=user.id, unit_cost=base_unit_cost,
                reference=purchase.number, notes="Entree stock reception fournisseur",
                source_type="purchase", source_id=purchase.id, source_line_id=item.id,
            )
        item.received_quantity = quantize_quantity(item.received_quantity or 0) + quantity
        item.received_base_quantity = quantize_quantity(item.received_base_quantity or 0) + base_quantity

    fully_received = all(quantize_quantity(item.received_quantity or 0) >= quantize_quantity(item.quantity or 0) for item in purchase.items)
    target = PURCHASE_RECEIVED if fully_received else PURCHASE_PARTIALLY_RECEIVED
    assert_transition("purchase", purchase.status, target)
    purchase.status = target
    log_action(db, user, "receive", "purchase", purchase.id, f"Reception achat: {purchase.number}", after={"status": target, "received_lines": len(requested), "version": purchase.version})
    db.commit()
    return get_purchase(pid, db, user)


@router.post("/{pid}/payment", response_model=PurchaseOut)
def pay_purchase(pid: int, body: PaymentIn, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"), if_match: Optional[str] = Header(default=None, alias="If-Match"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    purchase = db.query(Purchase).filter(Purchase.id == pid).first()
    if not purchase:
        raise HTTPException(404, "Commande non trouvee")
    payload = {"amount": str(body.amount), "payment_mode": body.payment_mode}
    if claim_idempotency(db, scope=f"purchase:{pid}:payment", key=idempotency_key, payload=payload, user_id=user.id):
        db.expire_all()
        return get_purchase(pid, db, user)
    if purchase.status not in PAYABLE_PURCHASE_STATUSES:
        raise HTTPException(409, f"Paiement interdit pour le statut {purchase.status}")
    current_paid = document_paid_total(db, "purchase", purchase.id)
    amount = validate_payment_amount(body.amount, money(purchase.total_amount) - current_paid)
    purchase.version = claim_version(db, Purchase, purchase.id, if_match)
    register_payment(
        db, user, "purchase", purchase.id, amount, body.payment_mode,
        reference=purchase.number, notes=f"Paiement achat {purchase.number}", cash_direction="out",
        idempotency_key=idempotency_key or "",
        allow_without_cash_session=body.allow_without_cash_session,
    )
    new_paid = sync_document_paid_amount(db, "purchase", purchase.id)
    target = payment_target("purchase", purchase.status, new_paid, purchase.total_amount)
    purchase.status = target
    purchase.is_paid = 1 if target == "paid" else 2
    log_action(db, user, "payment", "purchase", purchase.id, f"Paiement achat: {purchase.number}", after={"amount": str(amount), "payment_mode": body.payment_mode, "paid_amount": purchase.paid_amount, "status": target, "version": purchase.version})
    db.commit()
    return get_purchase(pid, db, user)


@router.post("/{pid}/cancel", response_model=PurchaseOut)
def cancel_purchase(pid: int, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"), if_match: Optional[str] = Header(default=None, alias="If-Match"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    purchase = db.query(Purchase).filter(Purchase.id == pid).first()
    if not purchase:
        raise HTTPException(404, "Commande non trouvee")
    if claim_idempotency(db, scope=f"purchase:{pid}:cancel", key=idempotency_key, payload={}, user_id=user.id):
        db.expire_all()
        return get_purchase(pid, db, user)
    assert_transition("purchase", purchase.status, PURCHASE_CANCELLED)
    previous = purchase.status
    purchase.version = claim_version(db, Purchase, purchase.id, if_match)
    purchase.status = PURCHASE_CANCELLED
    log_action(db, user, "cancel", "purchase", purchase.id, f"Achat annule: {purchase.number}", before={"status": previous}, after={"status": purchase.status, "stock_reversal": "not_required_before_receipt", "payment_reversal": "not_required_before_payment", "journal_reversal": "not_applicable_no_ledger_module"})
    db.commit()
    return get_purchase(pid, db, user)


@router.delete("/{pid}")
def delete_purchase(pid: int, if_match: Optional[str] = Header(default=None, alias="If-Match"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    purchase = db.query(Purchase).filter(Purchase.id == pid).first()
    if not purchase:
        raise HTTPException(404, "Commande non trouvee")
    if purchase.status != "draft":
        raise HTTPException(409, "Seul un brouillon peut etre supprime; annulez le document confirme")
    claim_version(db, Purchase, purchase.id, if_match)
    before = model_snapshot(purchase, ["number", "doc_type", "status", "total_amount"])
    void_document_allocation(db, "purchase", purchase.number, purchase.id, "draft_deleted")
    db.delete(purchase)
    log_action(db, user, "delete", "purchase", pid, f"Achat supprime: {before.get('number')}", before=before)
    db.commit()
    return {"ok": True}
