"""api/routes/dashboard.py — KPIs and dashboard data."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from datetime import datetime, timedelta, date
from core.database import get_db
from core.security import get_current_user
from models.sales import Sale
from models.product import Product
from models.client import Client
from models.expense import Expense
from models.purchase import Purchase
from models.cash import CashSession, CashTransaction
from services.document_workflow import ACTIVE_PURCHASE_STATUSES, ACTIVE_SALE_STATUSES, OPEN_SALE_STATUSES
from services.money import ZERO, quantize_money, quantize_quantity

router = APIRouter()


@router.get("/kpis")
def get_kpis(db: Session = Depends(get_db), user=Depends(get_current_user)):
    today = date.today()
    first_of_month = today.replace(day=1)
    first_of_year  = today.replace(month=1, day=1)

    # Revenue this month
    month_revenue = db.query(func.sum(Sale.total_amount)).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(ACTIVE_SALE_STATUSES),
        func.date(Sale.date_time) >= first_of_month,
    ).scalar() or ZERO

    # Revenue today
    today_revenue = db.query(func.sum(Sale.total_amount)).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(ACTIVE_SALE_STATUSES),
        func.date(Sale.date_time) == today,
    ).scalar() or ZERO

    # Expenses this month
    month_expenses = db.query(func.sum(Expense.amount)).filter(
        func.date(Expense.date) >= first_of_month,
    ).scalar() or ZERO

    # Purchases this month
    month_purchases = db.query(func.sum(Purchase.total_amount)).filter(
        Purchase.status.in_(ACTIVE_PURCHASE_STATUSES),
        func.date(Purchase.date_time) >= first_of_month,
    ).scalar() or ZERO

    # Profit (revenue - purchases cost - expenses)
    month_profit = month_revenue - month_purchases - month_expenses

    # Pending invoices (unpaid)
    pending_count = db.query(func.count(Sale.id)).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(OPEN_SALE_STATUSES),
        Sale.total_amount > Sale.paid_amount,
    ).scalar() or 0

    pending_amount = db.query(func.sum(Sale.total_amount - Sale.paid_amount)).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(OPEN_SALE_STATUSES),
        Sale.total_amount > Sale.paid_amount,
    ).scalar() or ZERO

    # Total clients
    total_clients = db.query(func.count(Client.id)).filter(Client.is_active == True).scalar() or 0

    # Low stock products
    low_stock = db.query(func.count(Product.id)).filter(
        Product.is_active == 1,
        Product.product_type == "product",
        Product.stock_quantity <= Product.min_stock,
    ).scalar() or 0

    # Total invoices this month
    month_invoice_count = db.query(func.count(Sale.id)).filter(
        Sale.doc_type == "invoice",
        func.date(Sale.date_time) >= first_of_month,
    ).scalar() or 0

    open_cash = db.query(CashSession).filter(CashSession.status == "open").order_by(CashSession.opened_at.desc()).first()
    cash_balance = ZERO
    cash_total_in = ZERO
    cash_total_out = ZERO
    if open_cash:
        cash_total_in = db.query(func.sum(CashTransaction.amount)).filter(CashTransaction.session_id == open_cash.id, CashTransaction.direction == "in").scalar() or ZERO
        cash_total_out = db.query(func.sum(CashTransaction.amount)).filter(CashTransaction.session_id == open_cash.id, CashTransaction.direction == "out").scalar() or ZERO
        cash_balance = (open_cash.opening_balance or 0) + cash_total_in - cash_total_out

    return {
        "month_revenue":       quantize_money(month_revenue),
        "today_revenue":       quantize_money(today_revenue),
        "month_expenses":      quantize_money(month_expenses),
        "month_purchases":     quantize_money(month_purchases),
        "month_profit":        quantize_money(month_profit),
        "pending_invoices":    pending_count,
        "pending_amount":      quantize_money(max(pending_amount, 0)),
        "total_clients":       total_clients,
        "low_stock_count":     low_stock,
        "month_invoice_count": month_invoice_count,
        "cash_is_open":        bool(open_cash),
        "cash_balance":        quantize_money(cash_balance),
        "cash_total_in":       quantize_money(cash_total_in),
        "cash_total_out":      quantize_money(cash_total_out),
    }


@router.get("/revenue-chart")
def revenue_chart(period: str = "month", db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Daily revenue for last 30 days or monthly for last 12 months."""
    today = date.today()

    if period == "year":
        # Monthly revenue for last 12 months
        rows = db.query(
            func.strftime("%Y-%m", Sale.date_time).label("period"),
            func.sum(Sale.total_amount).label("revenue"),
            func.count(Sale.id).label("count"),
        ).filter(
            Sale.doc_type == "invoice",
            Sale.status.in_(ACTIVE_SALE_STATUSES),
            Sale.date_time >= datetime(today.year - 1, today.month, 1),
        ).group_by(func.strftime("%Y-%m", Sale.date_time)).order_by("period").all()
    else:
        # Daily revenue for last 30 days
        cutoff = today - timedelta(days=29)
        rows = db.query(
            func.date(Sale.date_time).label("period"),
            func.sum(Sale.total_amount).label("revenue"),
            func.count(Sale.id).label("count"),
        ).filter(
            Sale.doc_type == "invoice",
            Sale.status.in_(ACTIVE_SALE_STATUSES),
            func.date(Sale.date_time) >= cutoff,
        ).group_by(func.date(Sale.date_time)).order_by("period").all()

    return [{"period": r.period, "revenue": quantize_money(r.revenue or 0), "count": r.count} for r in rows]


@router.get("/top-products")
def top_products(limit: int = 10, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from models.sales import SaleItem
    from sqlalchemy import desc
    first_of_month = date.today().replace(day=1)
    rows = db.query(
        SaleItem.product_id,
        func.coalesce(func.max(Product.name), "—").label("name"),
        func.sum(SaleItem.quantity).label("qty"),
        func.sum(SaleItem.line_total).label("revenue"),
    ).join(Product, SaleItem.product_id == Product.id, isouter=True
    ).join(Sale, SaleItem.sale_id == Sale.id
    ).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(ACTIVE_SALE_STATUSES),
        func.date(Sale.date_time) >= first_of_month,
    ).group_by(SaleItem.product_id).order_by(desc("revenue")).limit(limit).all()
    return [{"product_id": r.product_id, "name": r.name, "qty": quantize_quantity(r.qty or 0), "revenue": quantize_money(r.revenue or 0)} for r in rows]


@router.get("/recent-sales")
def recent_sales(limit: int = 10, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from sqlalchemy.orm import joinedload
    sales = db.query(Sale).options(joinedload(Sale.client)).filter(
        Sale.doc_type == "invoice"
    ).order_by(Sale.date_time.desc()).limit(limit).all()
    return [{
        "id": s.id,
        "number": s.number,
        "client_name": s.client.name if s.client else "—",
        "date": s.date_time.isoformat() if s.date_time else None,
        "total": s.total_amount,
        "status": s.status,
        "balance_due": s.balance_due,
    } for s in sales]


@router.get("/stock-alerts")
def stock_alerts(db: Session = Depends(get_db), user=Depends(get_current_user)):
    products = db.query(Product).filter(
        Product.is_active == 1,
        Product.product_type == "product",
        Product.stock_quantity <= Product.min_stock,
    ).order_by(Product.stock_quantity).limit(20).all()
    return [{
        "id": p.id,
        "name": p.name,
        "stock": p.stock_quantity,
        "min_stock": p.min_stock,
        "unit": p.unit,
    } for p in products]
