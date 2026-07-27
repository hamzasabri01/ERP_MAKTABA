"""Cash balance calculation, action permissions, and reconciliation."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from core.security import get_user_permissions
from models.cash import CashSession, CashTransaction
from models.payment import Payment
from services.money import decimal_sum, quantize_money

ZERO = Decimal("0")
STANDARD_CASH_ACTIONS = {"read", "open", "close", "transaction", "adjust"}


def require_cash_action(user, action: str) -> None:
    permissions = get_user_permissions(user)
    required = f"cash.{action}"
    if "all" in permissions or required in permissions:
        return
    if "cash" in permissions and action in STANDARD_CASH_ACTIONS:
        return
    raise HTTPException(403, f"Permission requise: {required}")


def session_totals(session: CashSession) -> tuple[Decimal, Decimal, Decimal]:
    total_in = decimal_sum(
        transaction.amount for transaction in session.transactions if transaction.direction == "in"
    )
    total_out = decimal_sum(
        transaction.amount for transaction in session.transactions if transaction.direction == "out"
    )
    expected = quantize_money((session.opening_balance or ZERO) + total_in - total_out)
    return total_in, total_out, expected


def reconcile_cash(db: Session, session_id: int | None = None) -> dict:
    open_sessions = db.query(CashSession).filter(CashSession.status == "open").all()
    query = db.query(CashSession)
    if session_id is not None:
        session = query.filter(CashSession.id == session_id).first()
    else:
        session = query.filter(CashSession.status == "open").order_by(CashSession.opened_at.desc()).first()
    if session_id is not None and not session:
        raise HTTPException(404, "Session de caisse non trouvee")

    items = []
    payment_count = 0
    transaction_count = 0
    expected = ZERO
    recorded = ZERO
    if len(open_sessions) > 1:
        items.append({
            "entity_type": "cash_system",
            "entity_id": 0,
            "reason": "multiple_open_sessions",
            "expected_amount": 1,
            "actual_amount": len(open_sessions),
            "difference": len(open_sessions) - 1,
        })

    orphan_cash_payments = db.query(Payment).filter(
        Payment.payment_mode == "cash",
        Payment.cash_session_id.is_(None),
    ).all()
    for payment in orphan_cash_payments:
        items.append({
            "entity_type": "payment",
            "entity_id": payment.id,
            "reason": "cash_payment_without_session",
            "expected_amount": abs(payment.amount or ZERO),
            "actual_amount": ZERO,
            "difference": -abs(payment.amount or ZERO),
        })

    orphan_payment_transactions = []
    if session:
        total_in, total_out, expected = session_totals(session)
        recorded = quantize_money(
            session.closing_balance if session.status == "closed" and session.closing_balance is not None else expected
        )
        transaction_count = len(session.transactions)
        payments = db.query(Payment).filter(Payment.cash_session_id == session.id).all()
        payment_count = len(payments)
        transaction_by_payment = {
            transaction.payment_id: transaction
            for transaction in session.transactions
            if transaction.payment_id is not None
        }
        for payment in payments:
            transaction = transaction_by_payment.get(payment.id)
            expected_direction = (
                "in" if payment.document_type == "sale" and payment.amount > 0
                else "out" if payment.document_type in {"purchase", "expense"} and payment.amount > 0
                else "out" if payment.document_type == "sale"
                else "in"
            )
            if (
                not transaction
                or quantize_money(transaction.amount or ZERO) != abs(quantize_money(payment.amount or ZERO))
                or transaction.direction != expected_direction
            ):
                actual = quantize_money(transaction.amount or ZERO) if transaction else ZERO
                items.append({
                    "entity_type": "payment",
                    "entity_id": payment.id,
                    "reason": "payment_cash_transaction_mismatch",
                    "expected_amount": abs(quantize_money(payment.amount or ZERO)),
                    "actual_amount": actual,
                    "difference": actual - abs(quantize_money(payment.amount or ZERO)),
                })
        payment_ids = {payment.id for payment in payments}
        orphan_payment_transactions = [
            transaction for transaction in session.transactions
            if transaction.payment_id is not None and transaction.payment_id not in payment_ids
        ]
        for transaction in orphan_payment_transactions:
            items.append({
                "entity_type": "cash_transaction",
                "entity_id": transaction.id,
                "reason": "cash_transaction_without_payment",
                "expected_amount": ZERO,
                "actual_amount": transaction.amount or ZERO,
                "difference": transaction.amount or ZERO,
            })
        if session.status == "closed":
            stored_expected = quantize_money(session.expected_balance or ZERO)
            if stored_expected != expected:
                items.append({
                    "entity_type": "cash_session",
                    "entity_id": session.id,
                    "reason": "stored_expected_balance_mismatch",
                    "expected_amount": expected,
                    "actual_amount": stored_expected,
                    "difference": stored_expected - expected,
                })
            stored_difference = quantize_money(session.difference or ZERO)
            calculated_difference = recorded - expected
            if stored_difference != calculated_difference:
                items.append({
                    "entity_type": "cash_session",
                    "entity_id": session.id,
                    "reason": "stored_difference_mismatch",
                    "expected_amount": calculated_difference,
                    "actual_amount": stored_difference,
                    "difference": stored_difference - calculated_difference,
                })

    difference = quantize_money(recorded - expected)
    return {
        "ok": not items,
        "session_id": session.id if session else None,
        "open_session_count": len(open_sessions),
        "payment_count": payment_count,
        "transaction_count": transaction_count,
        "expected_balance": expected,
        "recorded_balance": recorded,
        "difference": difference,
        "orphan_cash_payment_count": len(orphan_cash_payments),
        "orphan_payment_transaction_count": len(orphan_payment_transactions),
        "items": items,
        "checked_at": datetime.utcnow(),
    }
