from __future__ import annotations

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from models import *  # noqa: F401,F403
from models.product import Product
from models.user import Role, User
from services.sales_pricing import resolve_sale_items


class ServicePricingLogicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = Path(self.temp.name) / "pricing.db"
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        role = Role(name="cashier-test", permissions="sales,sales.service_price_edit")
        self.user = User(username="cashier-test", password_hash="x", role=role)
        self.product = Product(
            code="PRD-1", name="Cahier", product_type="product", pricing_mode="fixed",
            purchase_price=6, sale_price=10, tax_rate=20, tva_enabled=1, is_active=1,
        )
        self.service = Product(
            code="SRV-1", name="Photocopie", product_type="service", pricing_mode="editable",
            purchase_price=99, sale_price=0.5, tax_rate=20, tva_enabled=1, is_active=1,
        )
        self.db.add_all([role, self.user, self.product, self.service])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def test_service_price_is_editable_and_catalog_values_are_server_authoritative(self):
        lines, overrides = resolve_sale_items(self.db, self.user, [{
            "product_id": self.service.id,
            "description": "",
            "quantity": Decimal("12"),
            "unit_price": Decimal("0.40"),
            "purchase_price": Decimal("0"),
            "discount": Decimal("0"),
            "tax_rate": Decimal("0"),
            "price_override_reason": "Tarif quantité",
        }])
        self.assertEqual(Decimal("0.4000"), lines[0]["unit_price"])
        self.assertEqual(Decimal("0.5000"), lines[0]["catalog_unit_price"])
        self.assertEqual(Decimal("99.0000"), lines[0]["purchase_price"])
        self.assertEqual(Decimal("20"), lines[0]["tax_rate"])
        self.assertTrue(lines[0]["price_overridden"])
        self.assertEqual(1, len(overrides))

    def test_physical_product_price_cannot_be_forged_by_cashier(self):
        with self.assertRaises(HTTPException) as caught:
            resolve_sale_items(self.db, self.user, [{
                "product_id": self.product.id,
                "quantity": 1,
                "unit_price": 1,
                "discount": 0,
                "tax_rate": 0,
            }])
        self.assertEqual(403, caught.exception.status_code)

    def test_fixed_service_rejects_a_different_price(self):
        self.service.pricing_mode = "fixed"
        self.db.commit()
        with self.assertRaises(HTTPException) as caught:
            resolve_sale_items(self.db, self.user, [{
                "product_id": self.service.id,
                "quantity": 1,
                "unit_price": 1,
                "discount": 0,
                "tax_rate": 20,
            }])
        self.assertEqual(400, caught.exception.status_code)

    def test_service_never_inherits_client_supplied_purchase_cost(self):
        lines, _ = resolve_sale_items(self.db, self.user, [{
            "product_id": self.service.id,
            "quantity": 1,
            "unit_price": Decimal("0.50"),
            "purchase_price": Decimal("0.01"),
            "discount": 0,
            "tax_rate": 20,
        }])
        self.assertEqual(Decimal("99.0000"), lines[0]["purchase_price"])


if __name__ == "__main__":
    unittest.main()
