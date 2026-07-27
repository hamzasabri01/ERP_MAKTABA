from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user, user_has_permission
from models.client import Client
from models.product import Product, Supplier
from models.purchase import Purchase
from models.sales import Sale

router = APIRouter()


@router.get("")
def global_search(
    q: str = Query("", min_length=0),
    limit: int = 8,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    term = (q or "").strip()
    if len(term) < 2:
        return {"items": []}

    like = f"%{term}%"
    max_rows = min(max(limit, 3), 12)
    items = []

    if user_has_permission(user, "products"):
        for p in db.query(Product).filter(
            Product.is_active == 1,
            or_(Product.name.ilike(like), Product.code.ilike(like), Product.barcode.ilike(like)),
        ).order_by(Product.name).limit(max_rows).all():
            items.append({"type": "product", "title": p.name, "subtitle": p.code or "", "path": "/products"})

    if user_has_permission(user, "clients"):
        for c in db.query(Client).filter(
            Client.is_active == True,
            or_(Client.name.ilike(like), Client.code.ilike(like), Client.phone.ilike(like)),
        ).order_by(Client.name).limit(max_rows).all():
            items.append({"type": "client", "title": c.name, "subtitle": c.phone or c.code or "", "path": "/clients"})

    if user_has_permission(user, "suppliers"):
        for s in db.query(Supplier).filter(
            Supplier.is_active == True,
            or_(Supplier.company_name.ilike(like), Supplier.code.ilike(like), Supplier.phone.ilike(like)),
        ).order_by(Supplier.company_name).limit(max_rows).all():
            items.append({"type": "supplier", "title": s.company_name, "subtitle": s.phone or s.code or "", "path": "/suppliers"})

    if user_has_permission(user, "sales"):
        for s in db.query(Sale).filter(Sale.number.ilike(like)).order_by(Sale.date_time.desc()).limit(max_rows).all():
            items.append({"type": "sale", "title": s.number, "subtitle": f"{s.doc_type} - {s.status}", "path": "/sales"})

    if user_has_permission(user, "purchases"):
        for p in db.query(Purchase).filter(Purchase.number.ilike(like)).order_by(Purchase.date_time.desc()).limit(max_rows).all():
            items.append({"type": "purchase", "title": p.number, "subtitle": p.status, "path": "/purchases"})

    return {"items": items[: max_rows * 3]}
