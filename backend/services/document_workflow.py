"""Central workflow and concurrency rules for financial documents."""
from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from models.workflow import OperationKey
from services.money import quantize_money

SALE_DRAFT = "draft"
SALE_CONFIRMED = "confirmed"
SALE_PARTIALLY_PAID = "partially_paid"
SALE_PAID = "paid"
SALE_CANCELLED = "cancelled"

PURCHASE_DRAFT = "draft"
PURCHASE_CONFIRMED = "confirmed"
PURCHASE_PARTIALLY_RECEIVED = "partially_received"
PURCHASE_RECEIVED = "received"
PURCHASE_PARTIALLY_PAID = "partially_paid"
PURCHASE_PAID = "paid"
PURCHASE_CANCELLED = "cancelled"

ACTIVE_SALE_STATUSES = (SALE_CONFIRMED, SALE_PARTIALLY_PAID, SALE_PAID)
OPEN_SALE_STATUSES = (SALE_CONFIRMED, SALE_PARTIALLY_PAID)
ACTIVE_PURCHASE_STATUSES = (
    PURCHASE_CONFIRMED,
    PURCHASE_PARTIALLY_RECEIVED,
    PURCHASE_RECEIVED,
    PURCHASE_PARTIALLY_PAID,
    PURCHASE_PAID,
)
PAYABLE_PURCHASE_STATUSES = (PURCHASE_RECEIVED, PURCHASE_PARTIALLY_PAID)

SALE_TRANSITIONS = {
    SALE_DRAFT: {SALE_CONFIRMED},
    SALE_CONFIRMED: {SALE_PARTIALLY_PAID, SALE_PAID, SALE_CANCELLED},
    SALE_PARTIALLY_PAID: {SALE_PARTIALLY_PAID, SALE_PAID, SALE_CANCELLED},
    SALE_PAID: set(),
    SALE_CANCELLED: set(),
}

PURCHASE_TRANSITIONS = {
    PURCHASE_DRAFT: {PURCHASE_CONFIRMED, PURCHASE_CANCELLED},
    PURCHASE_CONFIRMED: {PURCHASE_PARTIALLY_RECEIVED, PURCHASE_RECEIVED, PURCHASE_CANCELLED},
    PURCHASE_PARTIALLY_RECEIVED: {PURCHASE_PARTIALLY_RECEIVED, PURCHASE_RECEIVED},
    PURCHASE_RECEIVED: {PURCHASE_PARTIALLY_PAID, PURCHASE_PAID},
    PURCHASE_PARTIALLY_PAID: {PURCHASE_PARTIALLY_PAID, PURCHASE_PAID},
    PURCHASE_PAID: set(),
    PURCHASE_CANCELLED: set(),
}


def money(value: Any) -> Decimal:
    return quantize_money(value)


def assert_transition(document_type: str, current: str, target: str) -> None:
    transitions = SALE_TRANSITIONS if document_type == "sale" else PURCHASE_TRANSITIONS
    if target not in transitions.get(current, set()):
        raise HTTPException(409, f"Transition interdite: {current} -> {target}")


def payment_target(document_type: str, current: str, paid: Any, total: Any) -> str:
    paid_value = money(paid)
    total_value = money(total)
    if paid_value <= 0 or paid_value >= total_value:
        target = SALE_PAID if document_type == "sale" else PURCHASE_PAID
    else:
        target = SALE_PARTIALLY_PAID if document_type == "sale" else PURCHASE_PARTIALLY_PAID
    assert_transition(document_type, current, target)
    return target


def validate_payment_amount(amount: Any, balance_due: Any) -> Decimal:
    amount_value = money(amount)
    due_value = money(balance_due)
    if amount_value <= 0:
        raise HTTPException(400, "Le montant du paiement doit etre strictement positif")
    if amount_value > due_value:
        raise HTTPException(400, f"Le paiement depasse le solde restant ({due_value:.2f})")
    return amount_value


def parse_if_match(value: str | None) -> int:
    if not value:
        raise HTTPException(428, "En-tete If-Match requis")
    match = re.fullmatch(r'(?:W/)?"?(\d+)"?', value.strip())
    if not match:
        raise HTTPException(400, "En-tete If-Match invalide")
    return int(match.group(1))


def claim_version(db: Session, model, document_id: int, if_match: str | None) -> int:
    expected = parse_if_match(if_match)
    result = db.execute(
        update(model)
        .where(model.id == document_id, model.version == expected)
        .values(version=expected + 1)
    )
    if result.rowcount != 1:
        raise HTTPException(409, "Le document a ete modifie par une autre operation; rechargez-le")
    return expected + 1


def request_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def claim_idempotency(
    db: Session,
    *,
    scope: str,
    key: str | None,
    payload: Any,
    user_id: int | None,
) -> bool:
    """Return True for a safe replay, False when this call owns the operation."""
    clean_key = (key or "").strip()
    if not clean_key:
        raise HTTPException(428, "En-tete Idempotency-Key requis")
    if len(clean_key) > 128:
        raise HTTPException(400, "Idempotency-Key trop long")
    fingerprint = request_hash(payload)
    result = db.execute(
        OperationKey.__table__.insert()
        .prefix_with("OR IGNORE")
        .values(scope=scope, idempotency_key=clean_key, request_hash=fingerprint, created_by=user_id)
    )
    row = db.query(OperationKey).filter(
        OperationKey.scope == scope,
        OperationKey.idempotency_key == clean_key,
    ).first()
    if row is None:
        raise HTTPException(409, "Impossible de reserver l'operation")
    if row.request_hash != fingerprint:
        raise HTTPException(409, "Idempotency-Key deja utilise avec une autre requete")
    return result.rowcount == 0
