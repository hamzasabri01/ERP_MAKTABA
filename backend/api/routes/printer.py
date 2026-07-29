from datetime import datetime, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from models.printer import PrintJob, PrinterCounter
from models.product import Product
from models.expense import Expense
from api.audit import log_action

router = APIRouter()
LABELS = {"bw": "Photocopie N&B", "color": "Photocopie couleur", "scan": "Scan document"}


class JobIn(BaseModel):
    service_type: str
    quantity: int = Field(ge=1, le=100000)
    unit_price: Decimal = Field(ge=0, decimal_places=2)
    notes: str = ""

    @field_validator("service_type")
    @classmethod
    def valid_type(cls, value):
        value = str(value).lower()
        if value not in LABELS:
            raise ValueError("Type de service invalide")
        return value


class CounterIn(BaseModel):
    bw_total: int = Field(ge=0)
    color_total: int = Field(ge=0)
    scan_total: int = Field(ge=0)
    notes: str = ""


def _job_out(row):
    return {
        "id": row.id, "date_time": row.date_time, "service_type": row.service_type,
        "service_label": LABELS.get(row.service_type, row.service_type),
        "quantity": row.quantity, "unit_price": float(row.unit_price or 0),
        "total_amount": float(row.total_amount or 0), "notes": row.notes or "",
    }


@router.get("")
def overview(db: Session = Depends(get_db), user=Depends(get_current_user)):
    now = datetime.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    jobs = db.query(PrintJob).filter(PrintJob.date_time >= month_start).order_by(PrintJob.date_time.desc()).all()
    counters = db.query(PrinterCounter).order_by(PrinterCounter.recorded_at.desc()).limit(30).all()
    printing_expenses = db.query(Expense).filter(
        Expense.date >= month_start,
        Expense.category.in_(("Papier impression", "Toner / Encre", "Maintenance imprimante")),
    ).all()

    def summary(rows):
        return {
            "quantity": sum(row.quantity for row in rows),
            "revenue": round(sum(float(row.total_amount or 0) for row in rows), 2),
            "by_type": {
                key: sum(row.quantity for row in rows if row.service_type == key)
                for key in LABELS
            },
        }

    return {
        "today": summary([row for row in jobs if row.date_time >= day_start]),
        "month": summary(jobs),
        "month_expenses": round(sum(float(row.amount or 0) for row in printing_expenses), 2),
        "month_net": round(
            sum(float(row.total_amount or 0) for row in jobs)
            - sum(float(row.amount or 0) for row in printing_expenses),
            2,
        ),
        "jobs": [_job_out(row) for row in jobs[:100]],
        "counters": [{
            "id": row.id, "recorded_at": row.recorded_at, "bw_total": row.bw_total,
            "color_total": row.color_total, "scan_total": row.scan_total, "notes": row.notes or "",
        } for row in counters],
    }


@router.post("/jobs", status_code=201)
def create_job(body: JobIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    job = PrintJob(
        service_type=body.service_type, quantity=body.quantity, unit_price=body.unit_price,
        total_amount=body.unit_price * body.quantity, notes=body.notes.strip()[:500], user_id=user.id,
    )
    db.add(job)
    db.flush()
    log_action(db, user, "create", "print_job", job.id, f"Impression enregistrée: {LABELS[body.service_type]} × {body.quantity}")
    db.commit()
    db.refresh(job)
    return _job_out(job)


@router.post("/counters", status_code=201)
def create_counter(body: CounterIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    previous = db.query(PrinterCounter).order_by(PrinterCounter.recorded_at.desc()).first()
    if previous and (body.bw_total < previous.bw_total or body.color_total < previous.color_total or body.scan_total < previous.scan_total):
        raise HTTPException(409, "Le nouveau compteur ne peut pas être inférieur au dernier relevé")
    row = PrinterCounter(**body.model_dump(), user_id=user.id)
    db.add(row)
    db.flush()
    log_action(db, user, "create", "printer_counter", row.id, "Relevé compteur Konica Minolta C454e enregistré")
    db.commit()
    db.refresh(row)
    return {"id": row.id, **body.model_dump(), "recorded_at": row.recorded_at}


@router.post("/setup-services")
def setup_services(db: Session = Depends(get_db), user=Depends(get_current_user)):
    created = []
    for key, name in LABELS.items():
        code = f"SRV-PRINT-{key.upper()}"
        product = db.query(Product).filter(Product.code == code).first()
        if not product:
            product = Product(
                code=code, name=name, product_type="service", pricing_mode="manual",
                sale_price=0, purchase_price=0, stock_quantity=0, min_stock=0,
                tax_rate=0, tva_enabled=0, unit="pcs", is_active=1,
            )
            db.add(product)
            created.append(name)
    db.commit()
    return {"created": created, "count": len(created)}
