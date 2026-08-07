"""Minimal adapter to the existing Product/POS public model conventions."""
from __future__ import annotations

from sqlalchemy.orm import Session

from models.product import Product


RESEARCH_SERVICE_CODE = "SRV-RESEARCH"


def ensure_research_service(db: Session) -> Product:
    service = db.query(Product).filter(Product.code == RESEARCH_SERVICE_CODE).first()
    if service:
        if service.product_type != "service":
            raise RuntimeError("Reserved research service code is already used by a physical product")
        service.is_active = 1
        service.pricing_mode = "manual"
        return service
    service = Product(
        code=RESEARCH_SERVICE_CODE,
        name="Préparation recherche scolaire",
        description="Service à prix libre calculé depuis une demande de recherche approuvée.",
        product_type="service",
        pricing_mode="manual",
        purchase_price=0,
        sale_price=0,
        stock_quantity=0,
        min_stock=0,
        unit="service",
        purchase_unit="service",
        purchase_to_base_factor=1,
        allow_fractional_sale=False,
        tax_rate=0,
        tva_enabled=0,
        is_active=1,
    )
    db.add(service)
    db.flush()
    return service
