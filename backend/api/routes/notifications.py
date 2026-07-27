from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models.cash import CashSession
from models.product import Product
from models.purchase import Purchase
from models.sales import Sale
from services.document_workflow import OPEN_SALE_STATUSES, PAYABLE_PURCHASE_STATUSES

router = APIRouter()


@router.get("")
def list_notifications(db: Session = Depends(get_db), user=Depends(get_current_user)):
    items = []

    low_stock = db.query(func.count(Product.id)).filter(
        Product.is_active == 1,
        Product.product_type == "product",
        Product.stock_quantity <= Product.min_stock,
    ).scalar() or 0
    if low_stock:
        items.append({
            "type": "stock",
            "level": "warning",
            "title": "Stock faible",
            "message": f"{low_stock} produit(s) sous le seuil minimum",
            "path": "/stock",
        })

    client_due = db.query(func.sum(Sale.total_amount - Sale.paid_amount)).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(OPEN_SALE_STATUSES),
        Sale.total_amount > Sale.paid_amount,
    ).scalar() or 0
    if client_due > 0:
        items.append({
            "type": "clients",
            "level": "danger",
            "title": "Creances clients",
            "message": f"{round(client_due, 2)} MAD restent a encaisser",
            "path": "/clients",
        })

    supplier_due = db.query(func.sum(Purchase.total_amount - Purchase.paid_amount)).filter(
        Purchase.status.in_(PAYABLE_PURCHASE_STATUSES),
        Purchase.total_amount > Purchase.paid_amount,
    ).scalar() or 0
    if supplier_due > 0:
        items.append({
            "type": "suppliers",
            "level": "warning",
            "title": "Dettes fournisseurs",
            "message": f"{round(supplier_due, 2)} MAD restent a payer",
            "path": "/suppliers",
        })

    open_cash = db.query(CashSession).filter(CashSession.status == "open").order_by(CashSession.opened_at.desc()).first()
    if open_cash:
        items.append({
            "type": "cash",
            "level": "info",
            "title": "Caisse ouverte",
            "message": f"Session ouverte depuis {open_cash.opened_at.strftime('%d/%m/%Y %H:%M') if open_cash.opened_at else ''}",
            "path": "/cash",
        })

    return {"items": items, "count": len(items), "runtime_at": datetime.utcnow().isoformat()}
