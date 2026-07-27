"""api/routes/reports.py"""
from email.message import EmailMessage
import html
import logging
import smtplib
import ssl
import threading
import time
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, datetime, timedelta
from core.database import get_db, SessionLocal
from core.security import get_current_user
from core.settings_store import load_settings, save_settings
from api.schemas import ReportEmailRequest, ReportEmailTestRequest
from models.sales import Sale, SaleItem
from models.expense import Expense
from models.purchase import Purchase
from models.product import Product
from services.document_workflow import ACTIVE_PURCHASE_STATUSES, ACTIVE_SALE_STATUSES
from services.money import ZERO, quantize_money

router = APIRouter()
_SCHEDULER_STARTED = False
logger = logging.getLogger("secureerp.reports")


def _load_settings():
    return load_settings(include_secrets=True)


def _save_settings(settings: dict):
    save_settings(settings)


def _period_key(frequency: str, now: datetime, settings: dict):
    if frequency == "daily":
        return now.strftime("%Y-%m-%d")
    if frequency == "weekly":
        return f"{now.isocalendar().year}-W{now.isocalendar().week:02d}"
    if frequency == "monthly":
        return now.strftime("%Y-%m")
    if frequency == "yearly":
        return now.strftime("%Y")
    return now.strftime("%Y-%m-%d")


def _is_schedule_due(settings: dict, now: datetime):
    if not settings.get("report_email_enabled"):
        return False
    if not settings.get("report_email_recipients"):
        return False
    scheduled_time = settings.get("report_schedule_time") or "20:00"
    try:
        hour, minute = [int(part) for part in scheduled_time.split(":")[:2]]
    except Exception:
        hour, minute = 20, 0
    if (now.hour, now.minute) < (hour, minute):
        return False

    frequency = settings.get("report_schedule_frequency") or "daily"
    if frequency == "weekly" and now.isoweekday() != int(settings.get("report_schedule_day_of_week") or 1):
        return False
    if frequency == "monthly" and now.day != int(settings.get("report_schedule_day_of_month") or 1):
        return False
    if frequency == "yearly":
        if now.month != int(settings.get("report_schedule_month") or 1):
            return False
        if now.day != int(settings.get("report_schedule_day_of_month") or 1):
            return False

    last_key = settings.get("report_schedule_last_sent_key") or ""
    return last_key != _period_key(frequency, now, settings)


def _date_range(period_type: str, start_date: str = None, end_date: str = None):
    today = date.today()
    if period_type == "custom":
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="start_date et end_date sont requis")
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    elif period_type == "daily":
        start = end = today
    elif period_type == "weekly":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
    elif period_type == "monthly":
        start = today.replace(day=1)
        next_month = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
        end = next_month - timedelta(days=1)
    elif period_type == "yearly":
        start = today.replace(month=1, day=1)
        end = today.replace(month=12, day=31)
    else:
        raise HTTPException(status_code=400, detail="period_type invalide")
    if start > end:
        raise HTTPException(status_code=400, detail="La date debut doit etre avant la date fin")
    return start, end


def _between_dates(column, start: date, end: date):
    return func.date(column) >= start, func.date(column) <= end


def _csv_emails(value: str):
    return [email.strip() for email in (value or "").replace(";", ",").split(",") if email.strip()]


def _money(value):
    return f"{quantize_money(value or 0):,.2f}".replace(",", " ")


def _build_summary(db: Session, start: date, end: date):
    sale_filters = [
        Sale.doc_type == "invoice",
        Sale.status.in_(ACTIVE_SALE_STATUSES),
        *_between_dates(Sale.date_time, start, end),
    ]
    revenue = db.query(func.sum(Sale.total_amount)).filter(*sale_filters).scalar() or ZERO
    paid = db.query(func.sum(Sale.paid_amount)).filter(*sale_filters).scalar() or ZERO
    sale_count = db.query(func.count(Sale.id)).filter(*sale_filters).scalar() or 0
    cogs = db.query(func.sum(SaleItem.purchase_price * SaleItem.quantity)).join(Sale).filter(*sale_filters).scalar() or ZERO
    expenses = db.query(func.sum(Expense.amount)).filter(*_between_dates(Expense.date, start, end)).scalar() or ZERO
    purchases = db.query(func.sum(Purchase.total_amount)).filter(
        Purchase.status.in_(ACTIVE_PURCHASE_STATUSES),
        *_between_dates(Purchase.date_time, start, end),
    ).scalar() or ZERO
    purchase_count = db.query(func.count(Purchase.id)).filter(
        Purchase.status.in_(ACTIVE_PURCHASE_STATUSES),
        *_between_dates(Purchase.date_time, start, end),
    ).scalar() or 0

    gross_profit = revenue - cogs
    net_profit = gross_profit - expenses
    margin = (gross_profit / revenue * 100) if revenue > 0 else 0
    return {
        "revenue": quantize_money(revenue),
        "paid": quantize_money(paid),
        "unpaid": quantize_money(max(revenue - paid, 0)),
        "sale_count": sale_count,
        "cogs": quantize_money(cogs),
        "gross_profit": quantize_money(gross_profit),
        "expenses": quantize_money(expenses),
        "purchases": quantize_money(purchases),
        "purchase_count": purchase_count,
        "net_profit": quantize_money(net_profit),
        "margin_pct": round(margin, 2),
    }


def _sales_by_category_range(db: Session, start: date, end: date):
    from models.product import Category
    rows = db.query(
        Category.name.label("category"),
        func.sum(SaleItem.line_total).label("total"),
        func.count(SaleItem.id).label("count"),
    ).join(Product, SaleItem.product_id == Product.id
    ).join(Category, Product.category_id == Category.id
    ).join(Sale, SaleItem.sale_id == Sale.id
    ).filter(
        Sale.doc_type == "invoice", Sale.status.in_(ACTIVE_SALE_STATUSES),
        *_between_dates(Sale.date_time, start, end),
    ).group_by(Category.name).order_by(func.sum(SaleItem.line_total).desc()).limit(10).all()
    return [{"category": r.category, "total": quantize_money(r.total or 0), "count": r.count} for r in rows]


def _stock_summary(db: Session):
    rows = db.query(Product).filter(Product.is_active == 1, Product.product_type == "product").all()
    total_value = sum((p.stock_quantity or 0) * (p.purchase_price or 0) for p in rows)
    low_stock = [p for p in rows if (p.stock_quantity or 0) <= (p.min_stock or 0)]
    return {"total_value": quantize_money(total_value), "low_stock_count": len(low_stock), "products_count": len(rows)}


def _cash_summary(db: Session, start: date, end: date):
    from models.cash import CashTransaction
    cash_in = db.query(func.sum(CashTransaction.amount)).filter(
        CashTransaction.direction == "in",
        *_between_dates(CashTransaction.created_at, start, end),
    ).scalar() or ZERO
    cash_out = db.query(func.sum(CashTransaction.amount)).filter(
        CashTransaction.direction == "out",
        *_between_dates(CashTransaction.created_at, start, end),
    ).scalar() or ZERO
    return {"cash_in": quantize_money(cash_in), "cash_out": quantize_money(cash_out), "net_cash": quantize_money(cash_in - cash_out)}


def _period_comparison_range(start: date, end: date):
    span_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=span_days - 1)
    return previous_start, previous_end


def _variation(current: float, previous: float):
    current = current or 0
    previous = previous or 0
    if previous == 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 2)


def _report_timeseries(db: Session, start: date, end: date):
    use_month_bucket = (end - start).days > 62
    bucket_expr = func.strftime("%Y-%m", Sale.date_time) if use_month_bucket else func.date(Sale.date_time)
    expense_bucket = func.strftime("%Y-%m", Expense.date) if use_month_bucket else func.date(Expense.date)
    purchase_bucket = func.strftime("%Y-%m", Purchase.date_time) if use_month_bucket else func.date(Purchase.date_time)

    labels = []
    cursor = start
    if use_month_bucket:
        cursor = start.replace(day=1)
        while cursor <= end:
            labels.append(cursor.strftime("%Y-%m"))
            cursor = cursor.replace(year=cursor.year + 1, month=1) if cursor.month == 12 else cursor.replace(month=cursor.month + 1)
    else:
        while cursor <= end:
            labels.append(cursor.isoformat())
            cursor += timedelta(days=1)

    series = {label: {"period": label, "revenue": ZERO, "expenses": ZERO, "purchases": ZERO} for label in labels}

    sales_rows = db.query(bucket_expr.label("period"), func.sum(Sale.total_amount).label("total")).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(ACTIVE_SALE_STATUSES),
        *_between_dates(Sale.date_time, start, end),
    ).group_by(bucket_expr).all()
    for row in sales_rows:
        if row.period in series:
            series[row.period]["revenue"] = quantize_money(row.total or 0)

    expense_rows = db.query(expense_bucket.label("period"), func.sum(Expense.amount).label("total")).filter(
        *_between_dates(Expense.date, start, end),
    ).group_by(expense_bucket).all()
    for row in expense_rows:
        if row.period in series:
            series[row.period]["expenses"] = quantize_money(row.total or 0)

    purchase_rows = db.query(purchase_bucket.label("period"), func.sum(Purchase.total_amount).label("total")).filter(
        Purchase.status.in_(ACTIVE_PURCHASE_STATUSES),
        *_between_dates(Purchase.date_time, start, end),
    ).group_by(purchase_bucket).all()
    for row in purchase_rows:
        if row.period in series:
            series[row.period]["purchases"] = quantize_money(row.total or 0)

    return list(series.values())


def _stock_value_detail(db: Session, limit: int = 120):
    from models.product import Category
    rows = db.query(
        Product.id, Product.name, Product.code,
        Product.stock_quantity, Product.min_stock, Product.purchase_price, Product.sale_price,
        Category.name.label("category"),
    ).join(Category, Product.category_id == Category.id, isouter=True
    ).filter(Product.is_active == 1, Product.product_type == "product"
    ).order_by(func.coalesce(Category.name, "zzz"), Product.name).limit(limit).all()
    total_value = db.query(func.sum(Product.stock_quantity * Product.purchase_price)).filter(
        Product.is_active == 1,
        Product.product_type == "product",
    ).scalar() or ZERO
    low_stock_count = db.query(func.count(Product.id)).filter(
        Product.is_active == 1,
        Product.product_type == "product",
        Product.stock_quantity <= Product.min_stock,
    ).scalar() or 0
    return {
        "total_value": quantize_money(total_value),
        "low_stock_count": low_stock_count,
        "products": [{
            "id": r.id,
            "name": r.name,
            "code": r.code or "",
            "category": r.category or "-",
            "stock": r.stock_quantity or 0,
            "min_stock": r.min_stock or 0,
            "purchase_price": r.purchase_price or 0,
            "sale_price": r.sale_price or 0,
            "value": quantize_money((r.stock_quantity or 0) * (r.purchase_price or 0)),
            "is_low": (r.stock_quantity or 0) <= (r.min_stock or 0),
        } for r in rows],
    }


def _render_report_html(settings: dict, req: ReportEmailRequest, start: date, end: date, data: dict):
    company = html.escape(settings.get("name") or settings.get("store_name") or "Maktaba Print")
    currency = html.escape(settings.get("currency") or "MAD")
    summary_rows = [
        ("Chiffre d'affaires", data["summary"]["revenue"]),
        ("Encaisse", data["summary"]["paid"]),
        ("Reste a encaisser", data["summary"]["unpaid"]),
    ]
    if req.include_profit:
        summary_rows.extend([
            ("Cout des ventes", data["summary"]["cogs"]),
            ("Benefice net", data["summary"]["net_profit"]),
        ])
    if req.include_expenses:
        summary_rows.append(("Depenses", data["summary"]["expenses"]))
    if req.include_purchases:
        summary_rows.append(("Achats", data["summary"]["purchases"]))

    rows = "".join(
        f"<tr><td>{html.escape(label)}</td><td><strong>{_money(value)} {currency}</strong></td></tr>"
        for label, value in summary_rows
    )
    categories = "".join(
        f"<tr><td>{html.escape(r['category'])}</td><td>{r['count']}</td><td>{_money(r['total'])} {currency}</td></tr>"
        for r in data.get("categories", [])
    ) or "<tr><td colspan='3'>Aucune vente par categorie</td></tr>"
    return f"""<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#111827">
<h2>{html.escape(settings.get('report_email_subject_prefix') or 'Rapport Maktaba Print')}</h2>
<p><strong>{company}</strong><br>Periode: {start.isoformat()} au {end.isoformat()}</p>
<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d1d5db">{rows}</table>
{f"<p>Marge brute: <strong>{data['summary']['margin_pct']}%</strong> | Ventes: <strong>{data['summary']['sale_count']}</strong> | Achats: <strong>{data['summary']['purchase_count']}</strong></p>" if req.include_profit else ""}
{f"<h3>Ventes par categorie</h3>" if req.include_sales_by_category else ""}
{f'''
<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d1d5db">
<tr><th align="left">Categorie</th><th align="left">Lignes</th><th align="left">CA</th></tr>{categories}</table>
''' if req.include_sales_by_category else ""}
{f"<h3>Stock</h3><p>Valeur stock: <strong>{_money(data['stock']['total_value'])} {currency}</strong> | Produits: <strong>{data['stock']['products_count']}</strong> | Stock faible: <strong>{data['stock']['low_stock_count']}</strong></p>" if req.include_stock_value else ""}
{f"<h3>Caisse</h3><p>Entrees: <strong>{_money(data['cash']['cash_in'])} {currency}</strong> | Sorties: <strong>{_money(data['cash']['cash_out'])} {currency}</strong> | Net: <strong>{_money(data['cash']['net_cash'])} {currency}</strong></p>" if req.include_cash else ""}
</body></html>"""


def _send_report_from_settings(db: Session, settings: dict, period_type: str = None):
    req = ReportEmailRequest(
        period_type=period_type or settings.get("report_schedule_frequency") or "daily",
        recipients=settings.get("report_email_recipients", ""),
        include_profit=bool(settings.get("report_email_include_profit", True)),
        include_sales_by_category=bool(settings.get("report_email_include_sales_by_category", True)),
        include_stock_value=bool(settings.get("report_email_include_stock_value", True)),
        include_cash=bool(settings.get("report_email_include_cash", True)),
        include_expenses=bool(settings.get("report_email_include_expenses", True)),
        include_purchases=bool(settings.get("report_email_include_purchases", True)),
    )
    start, end = _date_range(req.period_type)
    data = {
        "summary": _build_summary(db, start, end),
        "categories": _sales_by_category_range(db, start, end) if req.include_sales_by_category else [],
        "stock": _stock_summary(db) if req.include_stock_value else {"total_value": 0, "products_count": 0, "low_stock_count": 0},
        "cash": _cash_summary(db, start, end) if req.include_cash else {"cash_in": 0, "cash_out": 0, "net_cash": 0},
    }
    recipients = _csv_emails(req.recipients)
    subject = f"{settings.get('report_email_subject_prefix') or 'Rapport Maktaba Print'} - {start.isoformat()} / {end.isoformat()}"
    html_body = _render_report_html(settings, req, start, end, data)
    _send_email(settings, recipients, subject, html_body)
    return {"recipients": recipients, "start": start, "end": end, "subject": subject}


def _scheduler_loop():
    while True:
        try:
            settings = _load_settings()
            tz = ZoneInfo(settings.get("report_schedule_timezone") or "Africa/Casablanca")
            now = datetime.now(tz)
            if _is_schedule_due(settings, now):
                db = SessionLocal()
                try:
                    _send_report_from_settings(db, settings)
                    settings["report_schedule_last_sent_at"] = now.isoformat()
                    settings["report_schedule_last_sent_key"] = _period_key(settings.get("report_schedule_frequency") or "daily", now, settings)
                    _save_settings(settings)
                finally:
                    db.close()
        except Exception:
            pass
        time.sleep(60)


def start_report_email_scheduler():
    global _SCHEDULER_STARTED
    if _SCHEDULER_STARTED:
        return
    _SCHEDULER_STARTED = True
    thread = threading.Thread(target=_scheduler_loop, name="report-email-scheduler", daemon=True)
    thread.start()


def _send_email(settings: dict, to_emails: list[str], subject: str, html_body: str, text_body: str = ""):
    if not settings.get("smtp_host") or not settings.get("smtp_from_email"):
        raise HTTPException(status_code=400, detail="Configuration SMTP incomplete")
    if not to_emails:
        raise HTTPException(status_code=400, detail="Aucun destinataire configure")

    msg = EmailMessage()
    from_name = settings.get("smtp_from_name") or settings.get("name") or "Maktaba Print"
    msg["From"] = f"{from_name} <{settings.get('smtp_from_email')}>"
    msg["To"] = ", ".join(to_emails)
    cc = _csv_emails(settings.get("report_email_cc", ""))
    bcc = _csv_emails(settings.get("report_email_bcc", ""))
    if cc:
        msg["Cc"] = ", ".join(cc)
    if settings.get("report_email_reply_to"):
        msg["Reply-To"] = settings["report_email_reply_to"]
    msg["Subject"] = subject
    msg.set_content(text_body or "Rapport Maktaba Print en HTML.")
    msg.add_alternative(html_body, subtype="html")

    timeout = int(settings.get("smtp_timeout_seconds") or 30)
    port = int(settings.get("smtp_port") or 587)
    security = settings.get("smtp_security") or "starttls"
    recipients = to_emails + cc + bcc

    try:
        if security == "ssl":
            with smtplib.SMTP_SSL(settings["smtp_host"], port, timeout=timeout, context=ssl.create_default_context()) as server:
                if settings.get("smtp_username"):
                    server.login(settings["smtp_username"], settings.get("smtp_password", ""))
                server.send_message(msg, to_addrs=recipients)
        else:
            with smtplib.SMTP(settings["smtp_host"], port, timeout=timeout) as server:
                if security == "starttls":
                    server.starttls(context=ssl.create_default_context())
                if settings.get("smtp_username"):
                    server.login(settings["smtp_username"], settings.get("smtp_password", ""))
                server.send_message(msg, to_addrs=recipients)
    except Exception as exc:
        logger.warning("SMTP delivery failed: %s", type(exc).__name__)
        raise HTTPException(status_code=400, detail="Echec envoi email. Verifiez la configuration SMTP et les journaux serveur")

@router.get("/profit")
def profit_report(period: str = "month", db: Session = Depends(get_db), user=Depends(get_current_user)):
    today = date.today()
    if period == "month":
        start = today.replace(day=1)
    elif period == "year":
        start = today.replace(month=1, day=1)
    else:
        start = today

    revenue = db.query(func.sum(Sale.total_amount)).filter(
        Sale.doc_type == "invoice", Sale.status.in_(ACTIVE_SALE_STATUSES),
        func.date(Sale.date_time) >= start,
    ).scalar() or ZERO

    cogs = db.query(func.sum(SaleItem.purchase_price * SaleItem.quantity)).join(Sale).filter(
        Sale.doc_type == "invoice", Sale.status.in_(ACTIVE_SALE_STATUSES),
        func.date(Sale.date_time) >= start,
    ).scalar() or ZERO

    expenses = db.query(func.sum(Expense.amount)).filter(
        func.date(Expense.date) >= start,
    ).scalar() or ZERO

    gross_profit = revenue - cogs
    net_profit = gross_profit - expenses
    margin = (gross_profit / revenue * 100) if revenue > 0 else 0

    return {
        "period": period,
        "revenue": quantize_money(revenue),
        "cogs": quantize_money(cogs),
        "gross_profit": quantize_money(gross_profit),
        "expenses": quantize_money(expenses),
        "net_profit": quantize_money(net_profit),
        "margin_pct": round(margin, 2),
    }


@router.get("/overview")
def reports_overview(period: str = "monthly", db: Session = Depends(get_db), user=Depends(get_current_user)):
    period_map = {"day": "daily", "week": "weekly", "month": "monthly", "year": "yearly"}
    period_type = period_map.get(period, period)
    start, end = _date_range(period_type)
    prev_start, prev_end = _period_comparison_range(start, end)

    summary = _build_summary(db, start, end)
    previous = _build_summary(db, prev_start, prev_end)
    cash = _cash_summary(db, start, end)
    categories = _sales_by_category_range(db, start, end)
    stock = _stock_value_detail(db)
    timeseries = _report_timeseries(db, start, end)

    return {
        "period": {
            "type": period_type,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "previous_start": prev_start.isoformat(),
            "previous_end": prev_end.isoformat(),
        },
        "summary": summary,
        "previous": previous,
        "trend": {
            "revenue": _variation(summary["revenue"], previous["revenue"]),
            "paid": _variation(summary["paid"], previous["paid"]),
            "expenses": _variation(summary["expenses"], previous["expenses"]),
            "purchases": _variation(summary["purchases"], previous["purchases"]),
            "net_profit": _variation(summary["net_profit"], previous["net_profit"]),
        },
        "cash": cash,
        "stock": stock,
        "categories": categories,
        "timeseries": timeseries,
    }


@router.get("/sales-by-category")
def sales_by_category(db: Session = Depends(get_db), user=Depends(get_current_user)):
    today = date.today()
    first_of_month = today.replace(day=1)
    from models.product import Category
    rows = db.query(
        Category.name.label("category"),
        func.sum(SaleItem.line_total).label("total"),
        func.count(SaleItem.id).label("count"),
    ).join(Product, SaleItem.product_id == Product.id
    ).join(Category, Product.category_id == Category.id
    ).join(Sale, SaleItem.sale_id == Sale.id
    ).filter(
        Sale.doc_type == "invoice", Sale.status.in_(ACTIVE_SALE_STATUSES),
        func.date(Sale.date_time) >= first_of_month,
    ).group_by(Category.name).order_by(func.sum(SaleItem.line_total).desc()).all()
    return [{"category": r.category, "total": quantize_money(r.total or 0), "count": r.count} for r in rows]

@router.get("/stock-value")
def stock_value(db: Session = Depends(get_db), user=Depends(get_current_user)):
    from models.product import Category
    rows = db.query(
        Product.id, Product.name, Product.code,
        Product.stock_quantity, Product.purchase_price, Product.sale_price,
        Category.name.label("category"),
    ).join(Category, Product.category_id == Category.id, isouter=True
    ).filter(Product.is_active == 1, Product.product_type == "product"
    ).order_by(func.coalesce(Category.name, "zzz"), Product.name).all()
    total_value = sum((r.stock_quantity or 0) * (r.purchase_price or 0) for r in rows)
    return {
        "total_value": quantize_money(total_value),
        "products": [{
            "id": r.id, "name": r.name, "code": r.code or "",
            "category": r.category or "—",
            "stock": r.stock_quantity, "purchase_price": r.purchase_price,
            "sale_price": r.sale_price,
            "value": quantize_money((r.stock_quantity or 0) * (r.purchase_price or 0)),
        } for r in rows]
    }


@router.post("/email/send")
def send_report_email(body: ReportEmailRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    settings = _load_settings()
    start, end = _date_range(body.period_type, body.start_date, body.end_date)
    recipients = _csv_emails(body.recipients) or _csv_emails(settings.get("report_email_recipients", ""))

    data = {
        "summary": _build_summary(db, start, end),
        "categories": _sales_by_category_range(db, start, end) if body.include_sales_by_category else [],
        "stock": _stock_summary(db) if body.include_stock_value else {"total_value": 0, "products_count": 0, "low_stock_count": 0},
        "cash": _cash_summary(db, start, end) if body.include_cash else {"cash_in": 0, "cash_out": 0, "net_cash": 0},
    }
    subject = body.subject or f"{settings.get('report_email_subject_prefix') or 'Rapport Maktaba Print'} - {start.isoformat()} / {end.isoformat()}"
    html_body = _render_report_html(settings, body, start, end, data)
    _send_email(settings, recipients, subject, html_body)

    settings["report_schedule_last_sent_at"] = datetime.utcnow().isoformat()
    _save_settings(settings)
    return {"ok": True, "recipients": recipients, "period": {"start": start.isoformat(), "end": end.isoformat()}, "subject": subject}


@router.post("/email/test")
def test_report_email(body: ReportEmailTestRequest, user=Depends(get_current_user)):
    settings = _load_settings()
    recipient = body.recipient or settings.get("smtp_from_email") or settings.get("report_email_recipients", "")
    recipients = _csv_emails(recipient)
    subject = f"{settings.get('report_email_subject_prefix') or 'Rapport Maktaba Print'} - Test SMTP"
    html_body = "<p>Votre configuration email Maktaba Print fonctionne correctement.</p>"
    _send_email(settings, recipients, subject, html_body, "Votre configuration email Maktaba Print fonctionne correctement.")
    return {"ok": True, "recipients": recipients}
