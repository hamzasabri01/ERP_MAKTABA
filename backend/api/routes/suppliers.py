"""api/routes/suppliers.py"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from api.audit import log_action, model_snapshot
from api.payments import register_payment
from api.schemas import (
    PaymentIn,
    SupplierCreate,
    SupplierCreditPurchaseOut,
    SupplierCreditSummaryOut,
    SupplierOut,
    SupplierUpdate,
)
from core.database import get_db
from core.security import get_current_user
from models.product import Supplier
from models.purchase import Purchase
from services.document_workflow import (
    ACTIVE_PURCHASE_STATUSES,
    PAYABLE_PURCHASE_STATUSES,
    claim_idempotency,
    claim_version,
    money,
    payment_target,
    validate_payment_amount,
)
from services.money import decimal_sum
from services.credit import document_paid_total, supplier_credit_balance, sync_document_paid_amount

router = APIRouter()


def _gen_code(db: Session) -> str:
    count = db.query(func.count(Supplier.id)).scalar() or 0
    return f"FRN{str(count + 1).zfill(4)}"


def _supplier_metrics(db: Session, supplier_id: int) -> dict:
    purchases = db.query(Purchase).filter(Purchase.supplier_id == supplier_id, Purchase.status.in_(ACTIVE_PURCHASE_STATUSES)).all()
    total = decimal_sum(p.total_amount or 0 for p in purchases)
    payable = [p for p in purchases if p.status in PAYABLE_PURCHASE_STATUSES]
    due = supplier_credit_balance(db, supplier_id)
    return {
        "total_purchases": total,
        "credit_balance": due,
        "open_purchases_count": sum(1 for p in payable if max((p.total_amount or 0) - (p.paid_amount or 0), 0) > 0),
    }


def _to_out(db: Session, s: Supplier) -> SupplierOut:
    data = {k: getattr(s, k, None) for k in [
        "id", "code", "company_name", "contact_person", "phone", "email",
        "address", "city", "tax_id", "notes", "is_active",
    ]}
    data.update(_supplier_metrics(db, s.id))
    return SupplierOut(**data)


@router.get("", response_model=List[SupplierOut])
def list_suppliers(q: Optional[str] = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    query = db.query(Supplier)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Supplier.company_name.ilike(like), Supplier.phone.ilike(like), Supplier.code.ilike(like)))
    rows = query.filter(Supplier.is_active == True).order_by(Supplier.company_name).all()
    return [_to_out(db, row) for row in rows]


@router.get("/{sid}", response_model=SupplierOut)
def get_supplier(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    supplier = db.query(Supplier).filter(Supplier.id == sid).first()
    if not supplier:
        raise HTTPException(404, "Fournisseur non trouve")
    return _to_out(db, supplier)


@router.get("/{sid}/credit", response_model=SupplierCreditSummaryOut)
def get_supplier_credit(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    supplier = db.query(Supplier).filter(Supplier.id == sid).first()
    if not supplier:
        raise HTTPException(404, "Fournisseur non trouve")
    rows = (
        db.query(Purchase)
        .filter(Purchase.supplier_id == sid, Purchase.status.in_(PAYABLE_PURCHASE_STATUSES))
        .order_by(Purchase.date_time.desc())
        .all()
    )
    purchases = [
        SupplierCreditPurchaseOut(
            id=p.id,
            number=p.number or "",
            date_time=p.date_time,
            total_amount=p.total_amount or 0,
            paid_amount=p.paid_amount or 0,
            balance_due=max(money(p.total_amount) - document_paid_total(db, "purchase", p.id), money(0)),
            status=p.status,
            payment_status=p.payment_status,
        )
        for p in rows
        if max(money(p.total_amount) - document_paid_total(db, "purchase", p.id), money(0)) > 0
    ]
    metrics = _supplier_metrics(db, sid)
    return SupplierCreditSummaryOut(
        supplier=_to_out(db, supplier),
        purchases=purchases,
        total_due=metrics["credit_balance"],
        total_purchases=metrics["total_purchases"],
    )


@router.post("/{sid}/credit/payment", response_model=SupplierCreditSummaryOut)
def record_supplier_payment(sid: int, body: PaymentIn, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    supplier = db.query(Supplier).filter(Supplier.id == sid).first()
    if not supplier:
        raise HTTPException(404, "Fournisseur non trouve")
    payload = {"amount": str(body.amount), "payment_mode": body.payment_mode}
    if claim_idempotency(db, scope=f"supplier:{sid}:payment", key=idempotency_key, payload=payload, user_id=user.id):
        db.expire_all()
        return get_supplier_credit(sid, db, user)
    purchases = (
        db.query(Purchase)
        .filter(Purchase.supplier_id == sid, Purchase.status.in_(PAYABLE_PURCHASE_STATUSES))
        .order_by(Purchase.date_time.asc())
        .all()
    )
    if not purchases:
        raise HTTPException(400, "Aucun achat payable pour ce fournisseur")
    total_due = sum((max(money(p.total_amount) - document_paid_total(db, "purchase", p.id), money(0)) for p in purchases), money(0))
    amount = validate_payment_amount(body.amount, total_due)
    remaining = amount
    for purchase in purchases:
        current_paid = document_paid_total(db, "purchase", purchase.id)
        due = max(money(purchase.total_amount) - current_paid, money(0))
        if due <= 0:
            continue
        applied = min(due, remaining)
        purchase.version = claim_version(db, Purchase, purchase.id, str(purchase.version or 1))
        register_payment(
            db, user, "purchase", purchase.id, applied, body.payment_mode,
            reference=purchase.number, notes=f"Paiement fournisseur alloue a {purchase.number}",
            cash_direction="out", idempotency_key=f"{idempotency_key}:{purchase.id}",
            allow_without_cash_session=body.allow_without_cash_session,
        )
        new_paid = sync_document_paid_amount(db, "purchase", purchase.id)
        target = payment_target("purchase", purchase.status, new_paid, purchase.total_amount)
        purchase.status = target
        purchase.is_paid = 1 if target == "paid" else 2
        remaining -= applied
        if remaining <= 0:
            break
    log_action(db, user, "payment", "supplier_credit", sid, f"Paiement fournisseur: {supplier.company_name}", after={
        "amount": amount,
        "remaining_unallocated": str(remaining),
        "payment_mode": body.payment_mode,
    })
    db.commit()
    return get_supplier_credit(sid, db, user)


@router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(body: SupplierCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    supplier = Supplier(**body.model_dump(), code=_gen_code(db))
    db.add(supplier)
    db.flush()
    log_action(db, user, "create", "supplier", supplier.id, f"Fournisseur cree: {supplier.company_name}", after=model_snapshot(supplier, ["code", "company_name", "phone", "city"]))
    db.commit()
    db.refresh(supplier)
    return _to_out(db, supplier)


@router.put("/{sid}", response_model=SupplierOut)
def update_supplier(sid: int, body: SupplierUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    supplier = db.query(Supplier).filter(Supplier.id == sid).first()
    if not supplier:
        raise HTTPException(404, "Fournisseur non trouve")
    before = model_snapshot(supplier, ["company_name", "phone", "email", "city", "is_active"])
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(supplier, key, value)
    log_action(db, user, "update", "supplier", supplier.id, f"Fournisseur modifie: {supplier.company_name}", before=before, after=model_snapshot(supplier, ["company_name", "phone", "email", "city", "is_active"]))
    db.commit()
    db.refresh(supplier)
    return _to_out(db, supplier)


@router.delete("/{sid}")
def delete_supplier(sid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    supplier = db.query(Supplier).filter(Supplier.id == sid).first()
    if not supplier:
        raise HTTPException(404, "Fournisseur non trouve")
    before = model_snapshot(supplier, ["company_name", "is_active"])
    supplier.is_active = False
    log_action(db, user, "archive", "supplier", supplier.id, f"Fournisseur archive: {supplier.company_name}", before=before, after=model_snapshot(supplier, ["company_name", "is_active"]))
    db.commit()
    return {"ok": True}
