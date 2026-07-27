"""Credit balances derived from final documents and the payment ledger."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.client import Client
from models.payment import Payment
from models.product import Supplier
from models.purchase import Purchase
from models.sales import Sale
from services.document_workflow import ACTIVE_SALE_STATUSES, PAYABLE_PURCHASE_STATUSES
from services.money import quantize_money

ZERO = Decimal("0")


def document_paid_total(db: Session, document_type: str, document_id: int) -> Decimal:
    total = db.query(func.coalesce(func.sum(Payment.amount), 0)).filter(
        Payment.document_type == document_type,
        Payment.document_id == document_id,
    ).scalar()
    return quantize_money(total or ZERO)


def sync_document_paid_amount(db: Session, document_type: str, document_id: int) -> Decimal:
    paid = max(document_paid_total(db, document_type, document_id), ZERO)
    model = Sale if document_type == "sale" else Purchase if document_type == "purchase" else None
    if model is None:
        return paid
    document = db.query(model).filter(model.id == document_id).first()
    if document:
        document.paid_amount = paid
    return paid


def client_credit_balance(db: Session, client_id: int) -> Decimal:
    invoices = db.query(Sale).filter(
        Sale.client_id == client_id,
        Sale.doc_type == "invoice",
        Sale.status.in_(ACTIVE_SALE_STATUSES),
    ).all()
    return quantize_money(sum(
        max(quantize_money(sale.total_amount or ZERO) - document_paid_total(db, "sale", sale.id), ZERO)
        for sale in invoices
    ))


def supplier_credit_balance(db: Session, supplier_id: int) -> Decimal:
    purchases = db.query(Purchase).filter(
        Purchase.supplier_id == supplier_id,
        Purchase.status.in_(PAYABLE_PURCHASE_STATUSES),
    ).all()
    return quantize_money(sum(
        max(quantize_money(purchase.total_amount or ZERO) - document_paid_total(db, "purchase", purchase.id), ZERO)
        for purchase in purchases
    ))


def sync_client_credit(db: Session, client_id: int) -> Decimal:
    balance = client_credit_balance(db, client_id)
    client = db.query(Client).filter(Client.id == client_id).first()
    if client:
        client.credit_balance = balance
    return balance


def reconcile_credit(db: Session) -> dict:
    items = []
    clients = db.query(Client).order_by(Client.id).all()
    suppliers = db.query(Supplier).order_by(Supplier.id).all()
    for client in clients:
        calculated = client_credit_balance(db, client.id)
        stored = quantize_money(client.credit_balance or ZERO)
        difference = stored - calculated
        if difference != ZERO:
            items.append({
                "party_type": "client",
                "party_id": client.id,
                "name": client.name or "",
                "stored_balance": stored,
                "calculated_balance": calculated,
                "difference": difference,
            })
    return {
        "ok": not items,
        "client_count": len(clients),
        "supplier_count": len(suppliers),
        "mismatch_count": len(items),
        "items": items,
        "checked_at": datetime.utcnow(),
    }
