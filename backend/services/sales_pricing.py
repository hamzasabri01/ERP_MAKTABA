"""Server-authoritative pricing rules for sales lines."""
from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from core.security import user_has_permission
from models.product import Product
from services.money import quantize_price


def _has_permission(user, permission: str) -> bool:
    """Keep unit-test service users usable while enforcing permissions for real users."""
    if getattr(user, "role", None) is None:
        return False
    return user_has_permission(user, permission)


def resolve_sale_items(db: Session, user, items: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Replace client-controlled catalog fields with authoritative database values.

    Returns normalized calculation lines and a list of accepted overrides to audit
    once the document has an id.
    """
    product_ids = {int(item["product_id"]) for item in items if item.get("product_id") is not None}
    products = {
        product.id: product
        for product in db.query(Product).filter(Product.id.in_(product_ids)).all()
    } if product_ids else {}

    normalized: list[dict] = []
    overrides: list[dict] = []
    for index, raw in enumerate(items):
        item = dict(raw)
        product_id = item.get("product_id")
        if product_id is None:
            # Free-text lines remain supported for quotes and exceptional sales,
            # but can never inject a purchase cost.
            item["purchase_price"] = Decimal("0")
            item["catalog_unit_price"] = quantize_price(item.get("unit_price", 0))
            item["price_overridden"] = False
            item["price_override_reason"] = ""
            normalized.append(item)
            continue

        product = products.get(int(product_id))
        if not product or not product.is_active:
            raise HTTPException(400, f"Produit introuvable ou inactif à la ligne {index + 1}")

        catalog_price = quantize_price(product.sale_price or 0)
        requested_price = quantize_price(item.get("unit_price", catalog_price))
        quantity = Decimal(str(item.get("quantity", 0)))
        if product.product_type in {"product", "bundle"} and not product.allow_fractional_sale:
            if quantity != quantity.to_integral_value():
                raise HTTPException(400, f"{product.name} doit être vendu en quantité entière")
        pricing_mode = (product.pricing_mode or ("editable" if product.product_type == "service" else "fixed")).lower()
        overridden = requested_price != catalog_price

        if product.product_type in {"product", "bundle"} and overridden:
            if not _has_permission(user, "sales.product_price_edit"):
                raise HTTPException(
                    403,
                    f"Modification du prix non autorisée pour {product.name}. Prix catalogue: {catalog_price}",
                )
        elif product.product_type == "service":
            if pricing_mode == "fixed" and overridden:
                raise HTTPException(400, f"Le prix du service {product.name} est fixe")
            if pricing_mode in {"editable", "manual"} and not _has_permission(user, "sales.service_price_edit"):
                raise HTTPException(403, f"Permission requise pour saisir le prix du service {product.name}")

        reason = str(item.get("price_override_reason") or "").strip()[:300]
        if product.product_type in {"product", "bundle"} and overridden and not reason:
            raise HTTPException(400, f"Motif obligatoire pour modifier le prix de {product.name}")

        item.update({
            "description": item.get("description") or product.name,
            "unit_price": requested_price,
            "catalog_unit_price": catalog_price,
            "price_overridden": overridden,
            "price_override_reason": reason,
            "purchase_price": quantize_price(product.purchase_price or 0),
            "tax_rate": product.tax_rate if product.tva_enabled else Decimal("0"),
        })
        normalized.append(item)
        if overridden:
            overrides.append({
                "line_index": index,
                "product_id": product.id,
                "product_name": product.name,
                "product_type": product.product_type,
                "pricing_mode": pricing_mode,
                "catalog_unit_price": str(catalog_price),
                "applied_unit_price": str(requested_price),
                "reason": reason,
            })
    return normalized, overrides
