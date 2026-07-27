"""Controlled cash sessions, movements, reversals, and reconciliation."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from api.audit import log_action
from api.schemas import (
    CashReconciliationOut,
    CashSessionClose,
    CashSessionOpen,
    CashSessionOut,
    CashTransactionIn,
    CashTransactionOut,
    CashTransactionReverseIn,
    CreditReconciliationOut,
)
from core.database import get_db
from core.security import get_current_user
from core.settings_store import load_settings
from models.cash import CashSession, CashTransaction
from services.cash import reconcile_cash, require_cash_action, session_totals
from services.credit import reconcile_credit
from services.document_workflow import claim_idempotency, claim_version
from services.money import quantize_money

router = APIRouter()


def _session_query(db: Session):
    return db.query(CashSession).options(selectinload(CashSession.transactions))


def _to_out(session: CashSession) -> CashSessionOut:
    total_in, total_out, _expected = session_totals(session)
    return CashSessionOut(
        id=session.id,
        opened_at=session.opened_at,
        closed_at=session.closed_at,
        opening_balance=session.opening_balance or 0,
        closing_balance=session.closing_balance,
        expected_balance=session.expected_balance,
        difference=session.difference,
        status=session.status,
        notes=session.notes or "",
        version=session.version or 1,
        opened_by=session.opened_by,
        closed_by=session.closed_by,
        difference_reason=session.difference_reason or "",
        approved_by=session.approved_by,
        approved_at=session.approved_at,
        total_in=total_in,
        total_out=total_out,
    )


def _transaction_out(transaction: CashTransaction) -> CashTransactionOut:
    return CashTransactionOut(
        id=transaction.id,
        session_id=transaction.session_id,
        direction=transaction.direction,
        amount=transaction.amount or 0,
        source=transaction.source or "",
        reference=transaction.reference or "",
        description=transaction.description or "",
        created_at=transaction.created_at,
        created_by=transaction.created_by,
        payment_id=transaction.payment_id,
        payment_reference=transaction.payment.payment_reference if transaction.payment else "",
        kind=transaction.kind or "movement",
        reverses_transaction_id=transaction.reverses_transaction_id,
    )


@router.get("", response_model=List[CashSessionOut])
def list_sessions(db: Session = Depends(get_db), user=Depends(get_current_user)):
    require_cash_action(user, "read")
    sessions = _session_query(db).order_by(CashSession.opened_at.desc()).limit(50).all()
    return [_to_out(session) for session in sessions]


@router.get("/current", response_model=Optional[CashSessionOut])
def current_session(db: Session = Depends(get_db), user=Depends(get_current_user)):
    require_cash_action(user, "read")
    session = _session_query(db).filter(CashSession.status == "open").first()
    return _to_out(session) if session else None


@router.get("/current/transactions", response_model=List[CashTransactionOut])
def current_transactions(
    limit: int = 80,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    require_cash_action(user, "read")
    session = db.query(CashSession).filter(CashSession.status == "open").first()
    if not session:
        return []
    rows = (
        db.query(CashTransaction)
        .options(joinedload(CashTransaction.payment))
        .filter(CashTransaction.session_id == session.id)
        .order_by(CashTransaction.created_at.desc(), CashTransaction.id.desc())
        .limit(min(max(limit, 1), 200))
        .all()
    )
    return [_transaction_out(transaction) for transaction in rows]


@router.get("/reconciliation", response_model=CashReconciliationOut)
def cash_reconciliation(
    session_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    require_cash_action(user, "read")
    return reconcile_cash(db, session_id)


@router.get("/credit-reconciliation", response_model=CreditReconciliationOut)
def credit_reconciliation(db: Session = Depends(get_db), user=Depends(get_current_user)):
    require_cash_action(user, "read")
    return reconcile_credit(db)


@router.post("/open", response_model=CashSessionOut, status_code=201)
def open_session(
    body: CashSessionOpen,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    require_cash_action(user, "open")
    if claim_idempotency(
        db,
        scope="cash:open",
        key=idempotency_key,
        payload=body.model_dump(),
        user_id=user.id,
    ):
        session = _session_query(db).filter(
            CashSession.status == "open",
            CashSession.opened_by == user.id,
        ).first()
        if not session:
            raise HTTPException(409, "Session ouverte introuvable pour cette operation")
        return _to_out(session)

    session = CashSession(
        opened_by=user.id,
        opened_at=datetime.now(),
        opening_balance=body.opening_balance,
        notes=body.notes,
        status="open",
        version=1,
    )
    db.add(session)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Une session de caisse est deja ouverte")
    log_action(
        db,
        user,
        "open",
        "cash_session",
        session.id,
        f"Ouverture caisse #{session.id}",
        after={"opening_balance": str(session.opening_balance), "status": "open"},
    )
    db.commit()
    created = _session_query(db).filter(CashSession.id == session.id).first()
    return _to_out(created)


@router.post("/{session_id}/close", response_model=CashSessionOut)
def close_session(
    session_id: int,
    body: CashSessionClose,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    require_cash_action(user, "close")
    session = _session_query(db).filter(CashSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session non trouvee")
    if claim_idempotency(
        db,
        scope=f"cash:{session_id}:close",
        key=idempotency_key,
        payload=body.model_dump(),
        user_id=user.id,
    ):
        db.expire_all()
        return _to_out(_session_query(db).filter(CashSession.id == session_id).first())
    if session.status != "open":
        raise HTTPException(409, "Une session cloturee ne peut pas etre modifiee")

    _total_in, _total_out, expected = session_totals(session)
    actual = quantize_money(body.closing_balance)
    difference = quantize_money(actual - expected)
    reason = str(body.difference_reason or "").strip()
    if difference != 0 and len(reason) < 3:
        raise HTTPException(400, "Le motif de l'ecart de caisse est obligatoire")
    threshold = quantize_money(load_settings().get("cash_difference_approval_threshold", 100))
    approval_required = abs(difference) > threshold
    if approval_required:
        require_cash_action(user, "approve_difference")

    session.version = claim_version(db, CashSession, session.id, if_match)
    session.closed_at = datetime.now()
    session.closed_by = user.id
    session.closing_balance = actual
    session.expected_balance = expected
    session.difference = difference
    session.difference_reason = reason
    session.status = "closed"
    if approval_required:
        session.approved_by = user.id
        session.approved_at = datetime.now()
    if body.notes:
        session.notes = body.notes
    log_action(
        db,
        user,
        "close",
        "cash_session",
        session.id,
        f"Cloture caisse #{session.id}",
        after={
            "expected_balance": str(expected),
            "actual_balance": str(actual),
            "difference": str(difference),
            "difference_reason": reason,
            "approved_by": session.approved_by,
            "version": session.version,
        },
    )
    db.commit()
    closed = _session_query(db).filter(CashSession.id == session.id).first()
    return _to_out(closed)


@router.post("/{session_id}/transaction", response_model=CashTransactionOut, status_code=201)
def add_transaction(
    session_id: int,
    body: CashTransactionIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    require_cash_action(user, "adjust")
    session = db.query(CashSession).filter(CashSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session non trouvee")
    operation_key = f"cash:manual:{session_id}:{idempotency_key}"
    if claim_idempotency(
        db,
        scope=f"cash:{session_id}:transaction",
        key=idempotency_key,
        payload=body.model_dump(),
        user_id=user.id,
    ):
        existing = db.query(CashTransaction).options(joinedload(CashTransaction.payment)).filter(
            CashTransaction.operation_key == operation_key
        ).first()
        if not existing:
            raise HTTPException(409, "Transaction de caisse introuvable pour cette operation")
        return _transaction_out(existing)
    if session.status != "open":
        raise HTTPException(409, "Une session cloturee ne peut pas etre modifiee")

    transaction = CashTransaction(
        session_id=session_id,
        direction=body.direction,
        amount=body.amount,
        source="manual",
        reference=body.reference,
        description=body.description,
        created_by=user.id,
        created_at=datetime.now(),
        kind="movement",
        operation_key=operation_key,
    )
    db.add(transaction)
    db.flush()
    log_action(
        db,
        user,
        "adjust",
        "cash_transaction",
        transaction.id,
        f"Ajustement caisse #{session_id}",
        after={"direction": body.direction, "amount": str(body.amount), "reference": body.reference},
    )
    db.commit()
    created = db.query(CashTransaction).options(joinedload(CashTransaction.payment)).filter(
        CashTransaction.id == transaction.id
    ).first()
    return _transaction_out(created)


@router.post("/transactions/{transaction_id}/reverse", response_model=CashTransactionOut)
def reverse_transaction(
    transaction_id: int,
    body: CashTransactionReverseIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    require_cash_action(user, "reverse")
    original = db.query(CashTransaction).filter(CashTransaction.id == transaction_id).first()
    if not original:
        raise HTTPException(404, "Transaction de caisse non trouvee")
    if original.kind == "reversal":
        raise HTTPException(409, "Une contre-passation ne peut pas etre inversee")
    operation_key = f"cash:reverse:{transaction_id}:{idempotency_key}"
    if claim_idempotency(
        db,
        scope=f"cash:transaction:{transaction_id}:reverse",
        key=idempotency_key,
        payload=body.model_dump(),
        user_id=user.id,
    ):
        existing = db.query(CashTransaction).options(joinedload(CashTransaction.payment)).filter(
            CashTransaction.reverses_transaction_id == transaction_id
        ).first()
        if not existing:
            raise HTTPException(409, "Contre-passation introuvable pour cette operation")
        return _transaction_out(existing)
    existing = db.query(CashTransaction).filter(
        CashTransaction.reverses_transaction_id == transaction_id
    ).first()
    if existing:
        return _transaction_out(existing)
    current = db.query(CashSession).filter(CashSession.status == "open").first()
    if not current:
        raise HTTPException(409, "Ouvrez une caisse pour enregistrer la contre-passation")

    reversal = CashTransaction(
        session_id=current.id,
        direction="out" if original.direction == "in" else "in",
        amount=original.amount,
        source="manual_reversal",
        reference=f"REV-{original.reference or original.id}",
        description=body.reason,
        created_by=user.id,
        created_at=datetime.now(),
        kind="reversal",
        reverses_transaction_id=original.id,
        operation_key=operation_key,
    )
    db.add(reversal)
    db.flush()
    log_action(
        db,
        user,
        "reverse",
        "cash_transaction",
        reversal.id,
        f"Contre-passation caisse transaction #{original.id}",
        before={"direction": original.direction, "amount": str(original.amount), "session_id": original.session_id},
        after={"direction": reversal.direction, "amount": str(reversal.amount), "session_id": current.id, "reason": body.reason},
    )
    db.commit()
    created = db.query(CashTransaction).options(joinedload(CashTransaction.payment)).filter(
        CashTransaction.id == reversal.id
    ).first()
    return _transaction_out(created)
