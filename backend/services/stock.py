"""Atomic stock updates, movement idempotency, reversals, and reconciliation."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from models.product import Product
from models.stock import StockMovement
from services.money import quantize_price, quantize_quantity

ZERO = Decimal("0")
VALID_MOVEMENTS = {"in", "out", "adjustment", "inventory"}
VALID_KINDS = {"movement", "reversal"}


def _operation_key(value: str) -> str:
    clean = str(value or "").strip()
    if not clean or len(clean) > 180:
        raise HTTPException(500, "Cle d'operation stock invalide")
    return clean


def _existing_operation(db: Session, operation_key: str) -> StockMovement | None:
    return db.query(StockMovement).filter(StockMovement.operation_key == operation_key).first()


def apply_stock_movement(
    db: Session,
    product: Product,
    movement_type: str,
    quantity: Any,
    *,
    operation_key: str,
    user_id: int | None = None,
    unit_cost: Any = ZERO,
    reference: str = "",
    notes: str = "",
    source_type: str,
    source_id: int | None = None,
    source_line_id: int | None = None,
    warehouse_code: str = "MAIN",
    kind: str = "movement",
    reverses_movement_id: int | None = None,
    expected_before: Any | None = None,
) -> StockMovement:
    clean_key = _operation_key(operation_key)
    existing = _existing_operation(db, clean_key)
    if existing:
        return existing

    clean_type = str(movement_type or "").strip().lower()
    if clean_type not in VALID_MOVEMENTS:
        raise HTTPException(400, "Type de mouvement stock invalide")
    if kind not in VALID_KINDS:
        raise HTTPException(500, "Type d'ecriture stock invalide")
    if not product or product.product_type != "product":
        raise HTTPException(400, "Les services ne gerent pas le stock")

    value = quantize_quantity(quantity)
    if clean_type in {"in", "out"} and value <= ZERO:
        raise HTTPException(400, "La quantite du mouvement doit etre strictement positive")
    if clean_type in {"adjustment", "inventory"} and value < ZERO:
        raise HTTPException(400, "Le stock cible ne peut pas etre negatif")

    now = datetime.utcnow()
    current = func.coalesce(Product.stock_quantity, 0)
    conditions = [Product.id == product.id, Product.product_type == "product"]
    if clean_type == "out":
        conditions.append(current >= value)
        target = current - value
    elif clean_type == "in":
        target = current + value
    else:
        expected = quantize_quantity(
            expected_before if expected_before is not None else product.stock_quantity or ZERO
        )
        conditions.append(current == expected)
        target = value

    result = db.execute(
        update(Product)
        .where(*conditions)
        .values(stock_quantity=target, updated_at=now)
        .returning(Product.stock_quantity)
        .execution_options(synchronize_session=False)
    ).scalar_one_or_none()
    if result is None:
        actual = db.query(Product.stock_quantity).filter(Product.id == product.id).scalar()
        if actual is None:
            raise HTTPException(404, "Produit non trouve")
        actual = quantize_quantity(actual)
        if clean_type == "out" and actual < value:
            raise HTTPException(400, f"Stock insuffisant. Disponible: {actual}")
        raise HTTPException(409, "Le stock a change pendant l'operation; rechargez puis reessayez")

    after = quantize_quantity(result)
    if clean_type == "out":
        before = after + value
        movement_qty = value
    elif clean_type == "in":
        before = after - value
        movement_qty = value
    else:
        before = quantize_quantity(
            expected_before if expected_before is not None else product.stock_quantity or ZERO
        )
        movement_qty = abs(after - before)
        if movement_qty == ZERO:
            raise HTTPException(400, "Le mouvement ne modifie pas le stock")

    movement = StockMovement(
        product_id=product.id,
        movement_type=clean_type,
        quantity=movement_qty,
        before_qty=before,
        after_qty=after,
        unit_cost=quantize_price(unit_cost or product.purchase_price or ZERO),
        reference=str(reference or "")[:100],
        notes=str(notes or ""),
        warehouse_code=str(warehouse_code or "MAIN")[:30],
        source_type=str(source_type or "system")[:30],
        source_id=source_id,
        source_line_id=source_line_id,
        operation_key=clean_key,
        kind=kind,
        reverses_movement_id=reverses_movement_id,
        created_at=now,
        created_by=user_id,
    )
    db.add(movement)
    db.flush()
    set_committed_value(product, "stock_quantity", after)
    set_committed_value(product, "updated_at", now)
    return movement


def reverse_stock_movement(
    db: Session,
    movement: StockMovement,
    *,
    operation_key: str,
    user_id: int | None,
    reference: str,
    notes: str,
) -> StockMovement:
    existing = db.query(StockMovement).filter(
        StockMovement.reverses_movement_id == movement.id
    ).first()
    if existing:
        return existing
    before = quantize_quantity(movement.before_qty or ZERO)
    after = quantize_quantity(movement.after_qty or ZERO)
    delta = after - before
    if delta == ZERO:
        raise HTTPException(409, "Un mouvement sans impact ne peut pas etre inverse")
    product = db.query(Product).filter(Product.id == movement.product_id).first()
    if not product:
        raise HTTPException(409, "Produit du mouvement introuvable")
    direction = "out" if delta > ZERO else "in"
    return apply_stock_movement(
        db,
        product,
        direction,
        abs(delta),
        operation_key=operation_key,
        user_id=user_id,
        unit_cost=movement.unit_cost or product.purchase_price or ZERO,
        reference=reference,
        notes=notes,
        source_type=movement.source_type,
        source_id=movement.source_id,
        source_line_id=movement.source_line_id,
        warehouse_code=movement.warehouse_code or "MAIN",
        kind="reversal",
        reverses_movement_id=movement.id,
    )


def reconcile_stock(db: Session) -> dict:
    products = db.query(Product).filter(Product.is_active == 1).order_by(Product.id).all()
    movements = db.query(StockMovement).order_by(StockMovement.product_id, StockMovement.id).all()
    by_product: dict[int, list[StockMovement]] = {}
    for movement in movements:
        by_product.setdefault(movement.product_id, []).append(movement)

    mismatches = []
    continuity_errors = 0
    source_gaps = 0
    checked_products = 0
    for product in products:
        rows = by_product.get(product.id, [])
        if product.product_type != "product":
            if rows:
                mismatches.append({
                    "product_id": product.id,
                    "code": product.code or "",
                    "name": product.name,
                    "reason": "service_has_movements",
                    "current_qty": product.stock_quantity or ZERO,
                    "expected_qty": ZERO,
                    "difference": product.stock_quantity or ZERO,
                    "continuity_errors": 0,
                })
            continue
        checked_products += 1
        current_qty = quantize_quantity(product.stock_quantity or ZERO)
        if not rows:
            if current_qty != ZERO:
                mismatches.append({
                    "product_id": product.id,
                    "code": product.code or "",
                    "name": product.name,
                    "reason": "missing_movement_history",
                    "current_qty": current_qty,
                    "expected_qty": ZERO,
                    "difference": current_qty,
                    "continuity_errors": 0,
                })
            continue

        local_continuity = 0
        for previous, following in zip(rows, rows[1:]):
            if quantize_quantity(previous.after_qty or ZERO) != quantize_quantity(following.before_qty or ZERO):
                local_continuity += 1
        continuity_errors += local_continuity
        source_gaps += sum(1 for movement in rows if movement.source_type in {"", "legacy", None})
        expected_qty = quantize_quantity(rows[-1].after_qty or ZERO)
        difference = current_qty - expected_qty
        if difference != ZERO or local_continuity:
            mismatches.append({
                "product_id": product.id,
                "code": product.code or "",
                "name": product.name,
                "reason": "balance_mismatch" if difference != ZERO else "movement_discontinuity",
                "current_qty": current_qty,
                "expected_qty": expected_qty,
                "difference": difference,
                "continuity_errors": local_continuity,
            })

    return {
        "ok": not mismatches and continuity_errors == 0 and source_gaps == 0,
        "checked_products": checked_products,
        "movement_count": len(movements),
        "mismatch_count": len(mismatches),
        "continuity_error_count": continuity_errors,
        "source_gap_count": source_gaps,
        "warehouse_code": "MAIN",
        "items": mismatches,
        "checked_at": datetime.utcnow(),
    }
