"""api/routes/clients.py"""
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime
from core.database import get_db
from core.security import get_current_user
from models.client import Client
from models.sales import Sale
from api.schemas import ClientCreate, ClientUpdate, ClientOut, ClientCreditInvoiceOut, ClientCreditSummaryOut, PaymentIn
from api.audit import log_action
from api.payments import register_payment
from services.document_workflow import (
    ACTIVE_SALE_STATUSES,
    OPEN_SALE_STATUSES,
    claim_idempotency,
    claim_version,
    money,
    payment_target,
    validate_payment_amount,
)
from services.money import decimal_sum, quantize_money
from services.credit import client_credit_balance, document_paid_total, sync_client_credit, sync_document_paid_amount

router = APIRouter()


def _gen_code(db):
    count = db.query(func.count(Client.id)).scalar() or 0
    return f"CLI{str(count + 1).zfill(4)}"


def _credit_sales_query(db: Session, client_id: int):
    return db.query(Sale).filter(
        Sale.client_id == client_id,
        Sale.doc_type == "invoice",
        Sale.status.in_(OPEN_SALE_STATUSES),
        Sale.total_amount > Sale.paid_amount,
    )


def _credit_metrics(client: Client, invoices: list[Sale] | None = None) -> dict:
    invoices = invoices if invoices is not None else [
        s for s in (client.sales or [])
        if s.doc_type == "invoice"
        and s.status in OPEN_SALE_STATUSES
        and (s.total_amount or 0) > (s.paid_amount or 0)
    ]
    today = datetime.utcnow().date()
    balances = {
        sale.id: quantize_money(max(money(sale.total_amount) - document_paid_total(Session.object_session(sale), "sale", sale.id), money(0)))
        for sale in invoices
    }
    total_due = decimal_sum(balances.values())
    overdue_amount = decimal_sum(
        balances[s.id] for s in invoices
        if s.due_date and s.due_date.date() < today
    )
    credit_limit = quantize_money(client.credit_limit or 0)
    credit_available = quantize_money(max(credit_limit - total_due, 0)) if credit_limit > 0 else quantize_money(0)
    credit_usage_pct = round(min((total_due / credit_limit) * 100, 100), 1) if credit_limit > 0 else 0.0
    next_due_date = min((s.due_date for s in invoices if s.due_date), default=None)
    return {
        "total_due": total_due,
        "overdue_amount": overdue_amount,
        "credit_available": credit_available,
        "credit_usage_pct": credit_usage_pct,
        "open_invoices_count": len(invoices),
        "next_due_date": next_due_date,
    }


def _client_out(client: Client, invoices: list[Sale] | None = None) -> ClientOut:
    confirmed_sales = [
        s for s in (client.sales or [])
        if s.doc_type == "invoice" and s.status in ACTIVE_SALE_STATUSES
    ]
    metrics = _credit_metrics(client, invoices)
    out = ClientOut.model_validate(client)
    out.total_sales = decimal_sum((s.total_amount or 0) for s in confirmed_sales)
    out.credit_balance = metrics["total_due"]
    out.credit_available = metrics["credit_available"]
    out.credit_usage_pct = metrics["credit_usage_pct"]
    out.overdue_amount = metrics["overdue_amount"]
    out.open_invoices_count = metrics["open_invoices_count"]
    return out


def _invoice_out(sale: Sale) -> ClientCreditInvoiceOut:
    today = datetime.utcnow().date()
    overdue_days = 0
    db = Session.object_session(sale)
    paid = document_paid_total(db, "sale", sale.id)
    balance_due = max(money(sale.total_amount) - paid, money(0))
    if sale.due_date and sale.due_date.date() < today and balance_due > 0:
        overdue_days = (today - sale.due_date.date()).days
    return ClientCreditInvoiceOut(
        id=sale.id,
        number=sale.number or "",
        date_time=sale.date_time,
        due_date=sale.due_date,
        total_amount=sale.total_amount or 0,
        paid_amount=paid,
        balance_due=balance_due,
        overdue_days=overdue_days,
        status=sale.status or "",
    )


@router.get("", response_model=List[ClientOut])
def list_clients(
    q: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = db.query(Client)
    if q:
        query = query.filter(or_(
            Client.name.ilike(f"%{q}%"),
            Client.phone.ilike(f"%{q}%"),
            Client.email.ilike(f"%{q}%"),
            Client.city.ilike(f"%{q}%"),
        ))
    clients = query.order_by(Client.name).offset(skip).limit(limit).all()
    result = []
    for c in clients:
        result.append(_client_out(c))
    return result


@router.get("/{cid}", response_model=ClientOut)
def get_client(cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.query(Client).filter(Client.id == cid).first()
    if not c:
        raise HTTPException(404, "Client non trouvé")
    return _client_out(c)


@router.get("/{cid}/credit", response_model=ClientCreditSummaryOut)
def get_client_credit(cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.query(Client).filter(Client.id == cid, Client.is_active == True).first()
    if not c:
        raise HTTPException(404, "Client non trouvÃ©")
    invoices = _credit_sales_query(db, cid).order_by(Sale.due_date.asc(), Sale.date_time.asc()).all()
    metrics = _credit_metrics(c, invoices)
    return ClientCreditSummaryOut(
        client=_client_out(c, invoices),
        invoices=[_invoice_out(s) for s in invoices],
        total_due=metrics["total_due"],
        overdue_amount=metrics["overdue_amount"],
        next_due_date=metrics["next_due_date"],
        credit_available=metrics["credit_available"],
        credit_usage_pct=metrics["credit_usage_pct"],
    )


@router.post("/{cid}/credit/payment", response_model=ClientCreditSummaryOut)
def record_client_credit_payment(
    cid: int,
    body: PaymentIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    c = db.query(Client).filter(Client.id == cid, Client.is_active == True).first()
    if not c:
        raise HTTPException(404, "Client non trouvÃ©")
    payload = {"amount": str(body.amount), "payment_mode": body.payment_mode}
    if claim_idempotency(db, scope=f"client:{cid}:payment", key=idempotency_key, payload=payload, user_id=user.id):
        db.expire_all()
        return get_client_credit(cid, db, user)
    invoices = _credit_sales_query(db, cid).order_by(Sale.due_date.asc(), Sale.date_time.asc()).all()
    if not invoices:
        raise HTTPException(400, "Aucune facture ouverte pour ce client")
    total_due = sum((max(money(s.total_amount) - document_paid_total(db, "sale", s.id), money(0)) for s in invoices), money(0))
    amount = validate_payment_amount(body.amount, total_due)
    remaining = amount

    for sale in invoices:
        if remaining <= 0:
            break
        current_paid = document_paid_total(db, "sale", sale.id)
        allocated = min(max(money(sale.total_amount) - current_paid, money(0)), remaining)
        sale.version = claim_version(db, Sale, sale.id, str(sale.version or 1))
        register_payment(
            db, user, "sale", sale.id, allocated, body.payment_mode,
            reference=sale.number, notes=f"Paiement client alloue a {sale.number}",
            cash_direction="in", idempotency_key=f"{idempotency_key}:{sale.id}",
            allow_without_cash_session=body.allow_without_cash_session,
        )
        new_paid = sync_document_paid_amount(db, "sale", sale.id)
        sale.payment_mode = body.payment_mode
        sale.status = payment_target("sale", sale.status, new_paid, sale.total_amount)
        sale.updated_at = datetime.utcnow()
        remaining -= allocated

    refreshed = _credit_sales_query(db, cid).order_by(Sale.due_date.asc(), Sale.date_time.asc()).all()
    metrics = _credit_metrics(c, refreshed)
    sync_client_credit(db, cid)
    log_action(db, user, "payment", "client_credit", cid, f"Encaissement client: {c.name}", after={"amount": str(amount), "allocated": str(amount - remaining), "payment_mode": body.payment_mode})
    db.commit()
    return get_client_credit(cid, db, user)


@router.post("", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = Client(**body.model_dump(), code=_gen_code(db))
    db.add(c)
    db.commit()
    db.refresh(c)
    return _client_out(c)


@router.put("/{cid}", response_model=ClientOut)
def update_client(cid: int, body: ClientUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.query(Client).filter(Client.id == cid).first()
    if not c:
        raise HTTPException(404, "Client non trouvé")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return _client_out(c)


@router.delete("/{cid}")
def delete_client(cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.query(Client).filter(Client.id == cid).first()
    if not c:
        raise HTTPException(404, "Client non trouvé")
    c.is_active = False
    db.commit()
    return {"ok": True}
