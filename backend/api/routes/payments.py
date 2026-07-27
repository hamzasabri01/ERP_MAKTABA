"""api/routes/payments.py"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user, get_user_permissions
from models.payment import Payment

router = APIRouter()


@router.get("")
def list_payments(
    document_type: Optional[str] = Query(default=None),
    document_id: Optional[int] = Query(default=None),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    permissions = get_user_permissions(user)
    if "all" not in permissions and not permissions.intersection({"sales", "purchases", "cash", "cash.read"}):
        raise HTTPException(403, "Acces refuse aux paiements")
    q = db.query(Payment)
    if document_type:
        q = q.filter(Payment.document_type == document_type)
    if document_id:
        q = q.filter(Payment.document_id == document_id)
    rows = q.order_by(Payment.created_at.desc()).limit(limit).all()
    return [
        {
            "id": p.id,
            "document_type": p.document_type,
            "document_id": p.document_id,
            "amount": p.amount or 0,
            "payment_mode": p.payment_mode or "",
            "payment_reference": p.payment_reference or "",
            "reference": p.reference or "",
            "notes": p.notes or "",
            "created_at": p.created_at,
            "created_by": p.created_by,
            "kind": p.kind or "payment",
            "reverses_payment_id": p.reverses_payment_id,
            "cash_session_id": p.cash_session_id,
            "operation_key": p.operation_key or "",
        }
        for p in rows
    ]
