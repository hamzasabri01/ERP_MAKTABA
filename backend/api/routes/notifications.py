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

    stock_products = db.query(Product).filter(
        Product.is_active == 1,
        Product.product_type == "product",
        Product.stock_quantity <= Product.min_stock,
    ).order_by(Product.stock_quantity.asc(), Product.name.asc()).all()
    out_of_stock = [product for product in stock_products if (product.stock_quantity or 0) <= 0]
    low_stock = [product for product in stock_products if (product.stock_quantity or 0) > 0]

    if out_of_stock:
        items.append({
            "id": "stock-out-summary",
            "type": "stock_out",
            "level": "danger",
            "title": "Rupture de stock",
            "message": f"{len(out_of_stock)} produit(s) sans stock disponible",
            "path": "/stock?status=out",
            "quantity": len(out_of_stock),
            "updated_at": max((p.updated_at or p.created_at for p in out_of_stock), default=datetime.utcnow()).isoformat(),
        })

    if low_stock:
        items.append({
            "id": "stock-low-summary",
            "type": "stock_low",
            "level": "warning",
            "title": "Stock faible",
            "message": f"{len(low_stock)} produit(s) ont atteint le seuil minimum",
            "path": "/stock?status=low",
            "quantity": len(low_stock),
            "updated_at": max((p.updated_at or p.created_at for p in low_stock), default=datetime.utcnow()).isoformat(),
        })

    for product in stock_products[:8]:
        current = float(product.stock_quantity or 0)
        minimum = float(product.min_stock or 0)
        items.append({
            "id": f"stock-product-{product.id}",
            "type": "stock_product",
            "level": "danger" if current <= 0 else "warning",
            "title": product.name,
            "message": (
                f"Rupture — stock actuel: {current:g} {product.unit or 'pcs'}"
                if current <= 0
                else f"Reste {current:g} {product.unit or 'pcs'} — seuil: {minimum:g}"
            ),
            "path": f"/stock?product={product.id}",
            "product_id": product.id,
            "quantity": current,
            "min_stock": minimum,
            "updated_at": (product.updated_at or product.created_at or datetime.utcnow()).isoformat(),
        })

    client_due = db.query(func.sum(Sale.total_amount - Sale.paid_amount)).filter(
        Sale.doc_type == "invoice",
        Sale.status.in_(OPEN_SALE_STATUSES),
        Sale.total_amount > Sale.paid_amount,
    ).scalar() or 0
    if client_due > 0:
        items.append({
            "id": "clients-due",
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
            "id": "suppliers-due",
            "type": "suppliers",
            "level": "warning",
            "title": "Dettes fournisseurs",
            "message": f"{round(supplier_due, 2)} MAD restent a payer",
            "path": "/suppliers",
        })

    open_cash = db.query(CashSession).filter(CashSession.status == "open").order_by(CashSession.opened_at.desc()).first()
    if open_cash:
        items.append({
            "id": f"cash-open-{open_cash.id}",
            "type": "cash",
            "level": "info",
            "title": "Caisse ouverte",
            "message": f"Session ouverte depuis {open_cash.opened_at.strftime('%d/%m/%Y %H:%M') if open_cash.opened_at else ''}",
            "path": "/cash",
        })

    return {
        "items": items,
        "count": len(items),
        "stock_alert_count": len(stock_products),
        "out_of_stock_count": len(out_of_stock),
        "low_stock_count": len(low_stock),
        "runtime_at": datetime.utcnow().isoformat(),
    }
