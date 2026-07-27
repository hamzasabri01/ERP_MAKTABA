"""Shared, idempotent payment and cash-linking helpers."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from core.security import user_has_permission
from models.cash import CashSession, CashTransaction
from models.payment import Payment
from services.money import quantize_money

PAYMENT_MODES = {"cash", "card", "bank", "cheque", "credit", "legacy"}


def normalize_payment_mode(mode: str, *, allow_legacy: bool = False) -> str:
    aliases = {
        "cash": "cash", "espece": "cash", "espèce": "cash", "caisse": "cash",
        "card": "card", "carte": "card",
        "bank": "bank", "virement": "bank", "banque": "bank",
        "cheque": "cheque", "chèque": "cheque",
        "credit": "credit", "crédit": "credit",
        "legacy": "legacy",
    }
    normalized = aliases.get(str(mode or "").strip().lower())
    if not normalized or (normalized == "legacy" and not allow_legacy):
        raise HTTPException(400, "Mode de paiement invalide")
    return normalized


def is_cash_mode(mode: str) -> bool:
    return normalize_payment_mode(mode, allow_legacy=True) == "cash"


def _payment_operation_key(
    document_type: str,
    document_id: int,
    kind: str,
    idempotency_key: str,
    reverses_payment_id: int | None,
) -> str:
    clean = str(idempotency_key or "").strip()
    if not clean:
        raise HTTPException(428, "Idempotency-Key requis pour le paiement")
    suffix = reverses_payment_id if reverses_payment_id is not None else "new"
    return f"payment:{document_type}:{document_id}:{kind}:{suffix}:{clean}"[:180]


def register_payment(
    db: Session,
    user,
    document_type: str,
    document_id: int,
    amount: Decimal,
    payment_mode: str,
    reference: str = "",
    notes: str = "",
    cash_direction: str = "in",
    *,
    kind: str = "payment",
    reverses_payment_id: int | None = None,
    idempotency_key: str = "",
    record_cash: bool = True,
    allow_without_cash_session: bool = False,
) -> Payment:
    operation_key = _payment_operation_key(
        document_type, document_id, kind, idempotency_key, reverses_payment_id
    )
    existing = db.query(Payment).filter(Payment.operation_key == operation_key).first()
    if existing:
        return existing

    amount_value = quantize_money(amount)
    if kind == "payment" and amount_value <= 0:
        raise HTTPException(400, "Le montant du paiement doit etre strictement positif")
    if kind == "reversal" and amount_value >= 0:
        raise HTTPException(400, "Le montant d'une contre-passation doit etre negatif")
    mode = normalize_payment_mode(payment_mode, allow_legacy=kind in {"legacy", "reversal"})
    if kind == "payment" and mode == "credit":
        raise HTTPException(400, "Le credit n'est pas un reglement; laissez le solde ouvert")

    cash_session = None
    if record_cash and mode == "cash":
        cash_session = db.query(CashSession).filter(CashSession.status == "open").first()
        if not cash_session:
            if not allow_without_cash_session:
                raise HTTPException(409, "Ouvrez une session de caisse avant un paiement en especes")
            if not user_has_permission(user, "cash.payment_without_session"):
                raise HTTPException(403, "Permission exceptionnelle requise pour payer sans caisse ouverte")

    payment = Payment(
        document_type=document_type,
        document_id=document_id,
        amount=amount_value,
        payment_mode=mode,
        payment_reference=f"PAY-{datetime.now().strftime('%Y%m%d')}-{uuid4().hex[:12].upper()}",
        reference=reference or "",
        notes=notes or "",
        created_by=getattr(user, "id", None),
        created_at=datetime.now(),
        kind=kind,
        reverses_payment_id=reverses_payment_id,
        idempotency_key=idempotency_key or "",
        operation_key=operation_key,
        cash_session_id=cash_session.id if cash_session else None,
    )
    db.add(payment)
    db.flush()

    if cash_session:
        if cash_direction not in {"in", "out"}:
            raise HTTPException(500, "Direction de caisse invalide")
        original_cash_transaction_id = None
        if reverses_payment_id is not None:
            original_cash_transaction = db.query(CashTransaction).filter(
                CashTransaction.payment_id == reverses_payment_id
            ).first()
            original_cash_transaction_id = original_cash_transaction.id if original_cash_transaction else None
        db.add(CashTransaction(
            session_id=cash_session.id,
            direction=cash_direction,
            amount=abs(amount_value),
            source=document_type,
            reference=payment.payment_reference,
            description=notes or f"Paiement {document_type}",
            created_by=getattr(user, "id", None),
            created_at=datetime.now(),
            payment_id=payment.id,
            kind="reversal" if kind == "reversal" else "movement",
            reverses_transaction_id=original_cash_transaction_id,
            operation_key=f"cash:{operation_key}"[:180],
        ))
    return payment


def register_reversal(
    db: Session,
    user,
    original: Payment,
    *,
    idempotency_key: str,
    notes: str,
) -> Payment:
    existing = db.query(Payment).filter(Payment.reverses_payment_id == original.id).first()
    if existing:
        return existing
    if (original.amount or 0) > 0:
        direction = "out" if original.document_type == "sale" else "in"
    else:
        direction = "in" if original.document_type == "sale" else "out"
    return register_payment(
        db,
        user,
        original.document_type,
        original.document_id,
        -abs(Decimal(str(original.amount or 0))),
        original.payment_mode,
        reference=original.reference,
        notes=notes,
        cash_direction=direction,
        kind="reversal",
        reverses_payment_id=original.id,
        idempotency_key=idempotency_key,
        record_cash=original.cash_session_id is not None,
    )
