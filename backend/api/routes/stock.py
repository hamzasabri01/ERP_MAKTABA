"""Stock API: atomic movements, reconciliation, and controlled inventories."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from math import ceil
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from api.audit import log_action
from api.schemas import (
    InventoryCountIn,
    InventoryCountLineOut,
    InventorySessionCreate,
    InventorySessionOut,
    StockAdjustIn,
    StockMovementOut,
    StockReconciliationOut,
    StockSummaryOut,
)
from core.database import get_db
from core.security import get_current_user
from models.product import Product
from models.sales import Sale, SaleItem
from models.stock import InventoryCountLine, InventorySession, StockMovement
from services.document_workflow import claim_idempotency, claim_version
from services.money import quantize_money, quantize_quantity
from services.stock import apply_stock_movement, reconcile_stock

router = APIRouter()


def _to_out(movement: StockMovement) -> StockMovementOut:
    return StockMovementOut(
        id=movement.id,
        product_id=movement.product_id,
        product_name=movement.product.name if movement.product else "-",
        movement_type=movement.movement_type,
        quantity=movement.quantity,
        before_qty=movement.before_qty or 0,
        after_qty=movement.after_qty or 0,
        unit_cost=movement.unit_cost or 0,
        reference=movement.reference or "",
        notes=movement.notes or "",
        warehouse_code=movement.warehouse_code or "MAIN",
        source_type=movement.source_type or "",
        source_id=movement.source_id,
        source_line_id=movement.source_line_id,
        operation_key=movement.operation_key or "",
        kind=movement.kind or "movement",
        reverses_movement_id=movement.reverses_movement_id,
        created_by=movement.created_by,
        created_by_name=(movement.creator.full_name or movement.creator.username) if movement.creator else "",
        created_at=movement.created_at,
    )


def _inventory_query(db: Session):
    return db.query(InventorySession).options(
        selectinload(InventorySession.lines).joinedload(InventoryCountLine.product)
    )


def _inventory_out(session: InventorySession) -> InventorySessionOut:
    return InventorySessionOut(
        id=session.id,
        reference=session.reference,
        status=session.status,
        warehouse_code=session.warehouse_code or "MAIN",
        notes=session.notes or "",
        version=session.version,
        created_by=session.created_by,
        created_at=session.created_at,
        counted_at=session.counted_at,
        validated_at=session.validated_at,
        lines=[
            InventoryCountLineOut(
                id=line.id,
                product_id=line.product_id,
                product_code=line.product.code or "" if line.product else "",
                product_name=line.product.name if line.product else "-",
                unit=line.product.unit or "" if line.product else "",
                expected_qty=line.expected_qty,
                counted_qty=line.counted_qty,
                difference=line.difference,
                movement_id=line.movement_id,
            )
            for line in sorted(session.lines, key=lambda item: ((item.product.name or "").lower(), item.id))
        ],
    )


def stock_summary(db: Session) -> StockSummaryOut:
    products = db.query(Product).filter(Product.is_active == 1, Product.product_type == "product").all()
    today = date.today()
    last_movement = db.query(func.max(StockMovement.created_at)).scalar()
    movements_today = (
        db.query(func.count(StockMovement.id))
        .filter(func.date(StockMovement.created_at) == today)
        .scalar()
        or 0
    )
    return StockSummaryOut(
        products_count=len(products),
        stock_value=quantize_money(sum((p.stock_quantity or 0) * (p.purchase_price or 0) for p in products)),
        low_stock_count=sum(1 for p in products if 0 < (p.stock_quantity or 0) <= (p.min_stock or 0)),
        out_of_stock_count=sum(1 for p in products if (p.stock_quantity or 0) <= 0),
        movements_today=movements_today,
        last_movement_at=last_movement,
        runtime_at=datetime.utcnow(),
    )


@router.get("/summary", response_model=StockSummaryOut)
def get_summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return stock_summary(db)


@router.get("/reconciliation", response_model=StockReconciliationOut)
def get_reconciliation(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return reconcile_stock(db)


@router.get("/reorder-suggestions")
def get_reorder_suggestions(
    sales_days: int = 30,
    lead_time_days: int = 14,
    safety_days: int = 7,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Suggest replenishment from net sales velocity and configured minimum stock."""
    sales_days = min(max(sales_days, 7), 365)
    lead_time_days = min(max(lead_time_days, 1), 180)
    safety_days = min(max(safety_days, 0), 90)
    since = datetime.now() - timedelta(days=sales_days)
    products = db.query(Product).filter(
        Product.is_active == 1,
        Product.product_type == "product",
    ).all()
    quantities: dict[int, float] = {}
    rows = (
        db.query(SaleItem.product_id, SaleItem.quantity, Sale.doc_type)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(
            SaleItem.product_id.isnot(None),
            Sale.date_time >= since,
            Sale.status.in_(("confirmed", "partially_paid", "paid")),
        )
        .all()
    )
    for product_id, quantity, doc_type in rows:
        direction = -1 if doc_type == "credit_note" else 1
        quantities[product_id] = quantities.get(product_id, 0.0) + direction * float(quantity or 0)

    suggestions = []
    coverage_days = lead_time_days + safety_days
    for product in products:
        sold = max(quantities.get(product.id, 0.0), 0.0)
        velocity = sold / sales_days
        current = float(product.stock_quantity or 0)
        minimum = float(product.min_stock or 0)
        velocity_target = ceil(velocity * coverage_days)
        target_stock = max(velocity_target, ceil(minimum))
        suggested = max(ceil(target_stock - current), 0)
        low = current <= minimum
        if not low and suggested <= 0:
            continue
        suggestions.append({
            "product_id": product.id,
            "product_code": product.code or "",
            "product_name": product.name,
            "unit": product.unit or "pcs",
            "current_stock": current,
            "min_stock": minimum,
            "sales_quantity": round(sold, 4),
            "daily_velocity": round(velocity, 4),
            "days_cover": round(current / velocity, 1) if velocity > 0 else None,
            "target_stock": target_stock,
            "suggested_quantity": suggested,
            "is_out_of_stock": current <= 0,
        })
    suggestions.sort(key=lambda row: (
        not row["is_out_of_stock"],
        row["days_cover"] if row["days_cover"] is not None else 999999,
        -row["suggested_quantity"],
    ))
    return {
        "sales_days": sales_days,
        "lead_time_days": lead_time_days,
        "safety_days": safety_days,
        "generated_at": datetime.utcnow(),
        "items": suggestions,
    }


@router.get("/inventory-sessions", response_model=List[InventorySessionOut])
def list_inventory_sessions(
    limit: int = 20,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rows = _inventory_query(db).order_by(InventorySession.created_at.desc()).limit(min(max(limit, 1), 100)).all()
    return [_inventory_out(row) for row in rows]


@router.post("/inventory-sessions", response_model=InventorySessionOut, status_code=201)
def create_inventory_session(
    body: InventorySessionCreate,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    payload = body.model_dump()
    replay = claim_idempotency(
        db,
        scope="stock:inventory:create",
        key=idempotency_key,
        payload=payload,
        user_id=user.id,
    )
    if replay:
        existing = _inventory_query(db).filter(InventorySession.idempotency_key == idempotency_key).first()
        if not existing:
            raise HTTPException(409, "Session d'inventaire introuvable pour cette operation")
        return _inventory_out(existing)

    warehouse = str(body.warehouse_code or "MAIN").strip().upper()
    if warehouse != "MAIN":
        raise HTTPException(400, "Entrepot inconnu")
    product_ids = list(dict.fromkeys(body.product_ids))
    query = db.query(Product).filter(Product.is_active == 1, Product.product_type == "product")
    if product_ids:
        query = query.filter(Product.id.in_(product_ids))
    products = query.order_by(Product.name).limit(2000).all()
    if not products:
        raise HTTPException(400, "Aucun produit stockable a inventorier")
    if product_ids and len(products) != len(product_ids):
        raise HTTPException(400, "Un ou plusieurs produits sont invalides ou ne gerent pas le stock")

    now = datetime.utcnow()
    session = InventorySession(
        reference=f"INV-{now.strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:6].upper()}",
        status="draft",
        warehouse_code=warehouse,
        notes=body.notes or "",
        idempotency_key=idempotency_key,
        version=1,
        created_by=user.id,
        created_at=now,
    )
    db.add(session)
    db.flush()
    for product in products:
        db.add(InventoryCountLine(
            session_id=session.id,
            product_id=product.id,
            expected_qty=quantize_quantity(product.stock_quantity or 0),
        ))
    log_action(
        db,
        user,
        "create",
        "inventory_session",
        session.id,
        f"Session inventaire creee: {session.reference}",
        after={"status": "draft", "warehouse_code": warehouse, "line_count": len(products)},
    )
    db.commit()
    created = _inventory_query(db).filter(InventorySession.id == session.id).first()
    return _inventory_out(created)


@router.get("/inventory-sessions/{session_id}", response_model=InventorySessionOut)
def get_inventory_session(
    session_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    session = _inventory_query(db).filter(InventorySession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session d'inventaire non trouvee")
    return _inventory_out(session)


@router.post("/inventory-sessions/{session_id}/count", response_model=InventorySessionOut)
def count_inventory_session(
    session_id: int,
    body: InventoryCountIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    session = _inventory_query(db).filter(InventorySession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session d'inventaire non trouvee")
    replay = claim_idempotency(
        db,
        scope=f"stock:inventory:{session_id}:count",
        key=idempotency_key,
        payload=body.model_dump(),
        user_id=user.id,
    )
    if replay:
        db.expire_all()
        return _inventory_out(_inventory_query(db).filter(InventorySession.id == session_id).first())
    if session.status != "draft":
        raise HTTPException(409, "Seule une session brouillon peut etre comptee")

    submitted = {}
    for item in body.items:
        if item.product_id in submitted:
            raise HTTPException(400, "Un produit est duplique dans le comptage")
        submitted[item.product_id] = quantize_quantity(item.quantity)
    expected_ids = {line.product_id for line in session.lines}
    if set(submitted) != expected_ids:
        raise HTTPException(400, "Le comptage doit contenir exactement toutes les lignes de la session")

    now = datetime.utcnow()
    session.version = claim_version(db, InventorySession, session.id, if_match)
    for line in session.lines:
        line.counted_qty = submitted[line.product_id]
        line.difference = quantize_quantity(line.counted_qty - line.expected_qty)
        line.counted_by = user.id
        line.counted_at = now
    session.status = "counted"
    session.counted_by = user.id
    session.counted_at = now
    log_action(
        db,
        user,
        "count",
        "inventory_session",
        session.id,
        f"Comptage inventaire: {session.reference}",
        after={
            "status": "counted",
            "changed_lines": sum(1 for line in session.lines if line.difference != 0),
            "version": session.version,
        },
    )
    db.commit()
    counted = _inventory_query(db).filter(InventorySession.id == session.id).first()
    return _inventory_out(counted)


@router.post("/inventory-sessions/{session_id}/validate", response_model=InventorySessionOut)
def validate_inventory_session(
    session_id: int,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    session = _inventory_query(db).filter(InventorySession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Session d'inventaire non trouvee")
    replay = claim_idempotency(
        db,
        scope=f"stock:inventory:{session_id}:validate",
        key=idempotency_key,
        payload={},
        user_id=user.id,
    )
    if replay:
        db.expire_all()
        return _inventory_out(_inventory_query(db).filter(InventorySession.id == session_id).first())
    if session.status != "counted":
        raise HTTPException(409, "La session doit etre comptee avant validation")

    session.version = claim_version(db, InventorySession, session.id, if_match)
    for line in session.lines:
        actual = db.query(Product.stock_quantity).filter(Product.id == line.product_id).scalar()
        if actual is None:
            raise HTTPException(409, f"Produit {line.product_id} introuvable")
        if quantize_quantity(actual) != quantize_quantity(line.expected_qty):
            raise HTTPException(
                409,
                f"Le stock de {line.product.name if line.product else line.product_id} a change depuis le debut de l'inventaire",
            )
        if quantize_quantity(line.difference or 0) == 0:
            continue
        movement = apply_stock_movement(
            db,
            line.product,
            "inventory",
            line.counted_qty,
            operation_key=f"inventory:{session.id}:validate:line:{line.id}",
            user_id=user.id,
            unit_cost=line.product.purchase_price or 0,
            reference=session.reference,
            notes=session.notes or "Validation inventaire",
            source_type="inventory_session",
            source_id=session.id,
            source_line_id=line.id,
            warehouse_code=session.warehouse_code,
            expected_before=line.expected_qty,
        )
        line.movement_id = movement.id

    now = datetime.utcnow()
    session.status = "validated"
    session.validated_by = user.id
    session.validated_at = now
    log_action(
        db,
        user,
        "validate",
        "inventory_session",
        session.id,
        f"Inventaire valide: {session.reference}",
        after={
            "status": "validated",
            "movement_count": sum(1 for line in session.lines if line.movement_id),
            "version": session.version,
        },
    )
    db.commit()
    validated = _inventory_query(db).filter(InventorySession.id == session.id).first()
    return _inventory_out(validated)


@router.get("", response_model=List[StockMovementOut])
def list_movements(
    product_id: Optional[int] = None,
    movement_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = db.query(StockMovement).options(joinedload(StockMovement.product), joinedload(StockMovement.creator))
    if product_id:
        query = query.filter(StockMovement.product_id == product_id)
    if movement_type:
        query = query.filter(StockMovement.movement_type == movement_type)
    rows = query.order_by(StockMovement.created_at.desc(), StockMovement.id.desc()).offset(skip).limit(limit).all()
    return [_to_out(movement) for movement in rows]


@router.post("/adjust", status_code=201)
def adjust_stock(
    body: StockAdjustIn,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    payload = body.model_dump()
    replay = claim_idempotency(
        db,
        scope="stock:manual",
        key=idempotency_key,
        payload=payload,
        user_id=user.id,
    )
    operation_key = f"stock:manual:{idempotency_key}"
    if replay:
        existing = db.query(StockMovement).options(
            joinedload(StockMovement.product), joinedload(StockMovement.creator)
        ).filter(StockMovement.operation_key == operation_key).first()
        if not existing:
            raise HTTPException(409, "Mouvement stock introuvable pour cette operation")
        return {
            "ok": True,
            "new_stock": existing.after_qty,
            "movement": _to_out(existing),
            "summary": stock_summary(db),
        }

    product = db.query(Product).filter(Product.id == body.product_id, Product.is_active == 1).first()
    if not product:
        raise HTTPException(404, "Produit non trouve")
    movement = apply_stock_movement(
        db,
        product,
        body.movement_type,
        body.quantity,
        operation_key=operation_key,
        user_id=user.id,
        unit_cost=body.unit_cost or 0,
        reference=body.reference or "MANUAL",
        notes=body.notes or "",
        source_type="manual",
        source_id=product.id,
        expected_before=product.stock_quantity if body.movement_type in {"adjustment", "inventory"} else None,
    )
    log_action(
        db,
        user,
        "create",
        "stock_movement",
        movement.id,
        f"Mouvement stock {body.movement_type}: {product.name}",
        after={
            "product_id": product.id,
            "movement_type": body.movement_type,
            "quantity": body.quantity,
            "before_qty": movement.before_qty,
            "after_qty": movement.after_qty,
            "operation_key": operation_key,
        },
    )
    db.commit()
    result = db.query(StockMovement).options(
        joinedload(StockMovement.product), joinedload(StockMovement.creator)
    ).filter(StockMovement.id == movement.id).first()
    return {
        "ok": True,
        "new_stock": result.after_qty,
        "movement": _to_out(result),
        "summary": stock_summary(db),
    }


@router.post("/inventory", status_code=201)
def legacy_inventory_adjustment(
    body: dict,
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Compatibility endpoint; new clients should use inventory sessions."""
    items = body.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "Aucune ligne d'inventaire")
    replay = claim_idempotency(
        db,
        scope="stock:legacy-inventory",
        key=idempotency_key,
        payload=body,
        user_id=user.id,
    )
    reference = body.get("reference") or f"INV-{datetime.utcnow().strftime('%Y%m%d-%H%M')}"
    if replay:
        rows = db.query(StockMovement).filter(
            StockMovement.operation_key.like(f"stock:legacy-inventory:{idempotency_key}:%")
        ).all()
        return {"ok": True, "reference": reference, "updated": len(rows), "errors": [], "summary": stock_summary(db)}

    seen = set()
    movements = []
    for row in items:
        product_id = int(row.get("product_id") or 0)
        if product_id in seen:
            raise HTTPException(400, "Un produit est duplique dans l'inventaire")
        seen.add(product_id)
        product = db.query(Product).filter(
            Product.id == product_id, Product.is_active == 1, Product.product_type == "product"
        ).first()
        if not product:
            raise HTTPException(400, f"Produit stockable introuvable: {product_id}")
        counted = quantize_quantity(row.get("quantity"))
        if counted == quantize_quantity(product.stock_quantity or 0):
            continue
        movements.append(apply_stock_movement(
            db,
            product,
            "inventory",
            counted,
            operation_key=f"stock:legacy-inventory:{idempotency_key}:{product.id}",
            user_id=user.id,
            unit_cost=product.purchase_price or 0,
            reference=reference,
            notes=body.get("notes") or "Inventaire",
            source_type="legacy_inventory",
            source_id=product.id,
            expected_before=product.stock_quantity,
        ))
    log_action(
        db,
        user,
        "inventory",
        "stock",
        reference,
        f"Inventaire stock historique: {len(movements)} ligne(s)",
        after={"reference": reference, "count": len(movements)},
    )
    db.commit()
    return {
        "ok": True,
        "reference": reference,
        "updated": len(movements),
        "errors": [],
        "summary": stock_summary(db),
    }
