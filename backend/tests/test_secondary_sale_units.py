from __future__ import annotations

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from models import *  # noqa: F401,F403
from models.product import Product
from models.sales import SaleItem
from api.routes.sales import _stock_targets
from services.sales_pricing import resolve_sale_items


class SecondarySaleUnitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = Path(self.temp.name) / "units.db"
        engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        self.engine = engine
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, role=None)
        self.product = Product(
            code="UNIT-1", name="Stylos", product_type="product",
            unit="pcs", sale_unit="caisse", sale_to_base_factor=24,
            purchase_price=Decimal("2"), sale_price=Decimal("3"),
            sale_unit_price=Decimal("65"), stock_quantity=Decimal("50"),
            is_active=1,
        )
        self.db.add(self.product)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def test_caisse_uses_its_price_and_converts_to_pieces(self):
        rows, overrides = resolve_sale_items(self.db, self.user, [{
            "product_id": self.product.id, "quantity": 2,
            "sale_unit": "caisse", "unit_price": 65,
        }])
        row = rows[0]
        self.assertEqual(Decimal("24"), row["conversion_factor"])
        self.assertEqual(Decimal("48"), row["base_quantity"])
        self.assertEqual(Decimal("65.0000"), row["unit_price"])
        self.assertEqual(Decimal("48.0000"), row["purchase_price"])
        self.assertEqual([], overrides)

    def test_piece_keeps_base_price_and_quantity(self):
        rows, _ = resolve_sale_items(self.db, self.user, [{
            "product_id": self.product.id, "quantity": 2,
            "sale_unit": "pcs", "unit_price": 3,
        }])
        self.assertEqual(Decimal("1"), rows[0]["conversion_factor"])
        self.assertEqual(Decimal("2"), rows[0]["base_quantity"])

    def test_unknown_unit_is_rejected(self):
        with self.assertRaises(HTTPException):
            resolve_sale_items(self.db, self.user, [{
                "product_id": self.product.id, "quantity": 1,
                "sale_unit": "palette", "unit_price": 65,
            }])

    def test_stock_target_uses_base_quantity(self):
        line = SaleItem(product=self.product, quantity=2, base_quantity=48)
        targets = _stock_targets(line)
        self.assertEqual(Decimal("48"), Decimal(str(targets[0][1])))


if __name__ == "__main__":
    unittest.main()
