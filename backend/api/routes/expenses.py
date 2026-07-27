"""Expense CRUD with immutable payment ledger entries and cash linking."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from api.payments import register_payment, register_reversal
from api.routes.settings import _load as load_settings
from api.schemas import ExpenseCreate, ExpenseOut
from core.database import get_db
from core.security import get_current_user
from models.expense import Expense
from models.payment import Payment
from services.document_workflow import claim_idempotency

router = APIRouter()


@router.get("", response_model=List[ExpenseOut])
def list_expenses(
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return db.query(Expense).order_by(Expense.date.desc()).offset(skip).limit(limit).all()


@router.get("/categories")
def get_categories(user=Depends(get_current_user)):
    settings = load_settings()
    raw = settings.get("expense_categories") or ""
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or Expense.CATEGORIES


@router.post("", response_model=ExpenseOut, status_code=201)
def create_expense(
    body: ExpenseCreate,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    payload = body.model_dump()
    if claim_idempotency(
        db,
        scope="expense:create",
        key=idempotency_key,
        payload=payload,
        user_id=user.id,
    ):
        payment = db.query(Payment).filter(
            Payment.document_type == "expense",
            Payment.idempotency_key == idempotency_key,
            Payment.kind == "payment",
        ).first()
        if payment:
            expense = db.query(Expense).filter(Expense.id == payment.document_id).first()
            if expense:
                return expense
        raise HTTPException(409, "Depense introuvable pour cette operation")

    expense = Expense(**body.model_dump(), user_id=user.id)
    if not expense.date:
        expense.date = datetime.now()
    db.add(expense)
    db.flush()
    register_payment(
        db,
        user,
        "expense",
        expense.id,
        expense.amount,
        expense.payment_method,
        reference=expense.reference or f"EXP-{expense.id}",
        notes=f"Reglement depense: {expense.description}",
        cash_direction="out",
        idempotency_key=idempotency_key or "",
    )
    db.commit()
    db.refresh(expense)
    return expense


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: int,
    body: ExpenseCreate,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if claim_idempotency(
        db,
        scope=f"expense:{expense_id}:update",
        key=idempotency_key,
        payload=body.model_dump(),
        user_id=user.id,
    ):
        expense = db.query(Expense).filter(Expense.id == expense_id).first()
        if not expense:
            raise HTTPException(404, "Depense non trouvee")
        return expense
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Depense non trouvee")
    originals = db.query(Payment).filter(
        Payment.document_type == "expense",
        Payment.document_id == expense.id,
        Payment.kind == "payment",
    ).all()
    for original in originals:
        register_reversal(
            db,
            user,
            original,
            idempotency_key=f"{idempotency_key}:reverse:{original.id}",
            notes=f"Modification depense #{expense.id}",
        )
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(expense, key, value)
    register_payment(
        db,
        user,
        "expense",
        expense.id,
        expense.amount,
        expense.payment_method,
        reference=expense.reference or f"EXP-{expense.id}",
        notes=f"Nouveau reglement depense: {expense.description}",
        cash_direction="out",
        idempotency_key=f"{idempotency_key}:replacement",
    )
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: int,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if claim_idempotency(
        db,
        scope=f"expense:{expense_id}:delete",
        key=idempotency_key,
        payload={},
        user_id=user.id,
    ):
        return {"ok": True}
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Depense non trouvee")
    originals = db.query(Payment).filter(
        Payment.document_type == "expense",
        Payment.document_id == expense.id,
        Payment.kind == "payment",
    ).all()
    for original in originals:
        register_reversal(
            db,
            user,
            original,
            idempotency_key=f"{idempotency_key}:reverse:{original.id}",
            notes=f"Suppression depense #{expense.id}",
        )
    db.delete(expense)
    db.commit()
    return {"ok": True}
