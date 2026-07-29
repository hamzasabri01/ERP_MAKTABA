from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api.schemas import PurchaseReceiveIn, PurchaseReceiptLineIn, SaleReturnIn, SaleReturnItemIn
from core.database import Base
from models import *  # noqa: F401,F403
from models.product import Product, ProductBundleComponent
from models.purchase import Purchase, PurchaseItem
from models.sales import Sale, SaleItem
from api.routes import purchases, sales


class SchoolProductLogicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = Path(self.temp.name) / "school-products.db"
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, autoflush=True)()
        self.user = SimpleNamespace(id=1, username="tester", full_name="Test User")

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def test_purchase_boxes_are_received_as_base_units_and_cost_is_converted(self):
        product = Product(
            code="P-BOX", name="Stylo", product_type="product", unit="pcs",
            purchase_unit="box", purchase_to_base_factor=12,
            stock_quantity=10, purchase_price=8, sale_price=12,
        )
        purchase = Purchase(number="PO-BOX", doc_type="order", status="confirmed", version=1, total_amount=240)
        self.db.add_all([product, purchase])
        self.db.flush()
        item = PurchaseItem(
            purchase_id=purchase.id, product_id=product.id, quantity=2,
            purchase_unit="box", conversion_factor=12, base_quantity=24,
            unit_price=120, line_total=240, total_amount=240,
            received_quantity=0, received_base_quantity=0,
        )
        self.db.add(item)
        self.db.commit()

        result = purchases.receive_purchase(
            purchase.id,
            PurchaseReceiveIn(items=[PurchaseReceiptLineIn(item_id=item.id, quantity=2)]),
            "receive-boxes",
            "1",
            self.db,
            self.user,
        )
        self.assertEqual("received", result.status)
        self.assertEqual(34, self.db.get(Product, product.id).stock_quantity)
        self.assertAlmostEqual(9.4118, float(self.db.get(Product, product.id).purchase_price), places=4)
        saved = self.db.get(PurchaseItem, item.id)
        self.assertEqual(24, saved.received_base_quantity)

    def test_school_bundle_deducts_each_real_component(self):
        notebook = Product(code="P-N", name="Cahier", product_type="product", stock_quantity=20, purchase_price=5, sale_price=8)
        pen = Product(code="P-S", name="Stylo", product_type="product", stock_quantity=30, purchase_price=2, sale_price=4)
        bundle = Product(code="B-1", name="Pack CP", product_type="bundle", sale_price=25)
        self.db.add_all([notebook, pen, bundle])
        self.db.flush()
        self.db.add_all([
            ProductBundleComponent(bundle_product_id=bundle.id, component_product_id=notebook.id, quantity=2),
            ProductBundleComponent(bundle_product_id=bundle.id, component_product_id=pen.id, quantity=3),
        ])
        sale = Sale(number="S-BUNDLE", doc_type="invoice", status="draft", version=1, total_amount=50, created_by=1)
        self.db.add(sale)
        self.db.flush()
        self.db.add(SaleItem(
            sale_id=sale.id, product_id=bundle.id, quantity=2, unit_price=25,
            line_total=50, total_amount=50,
        ))
        self.db.commit()

        sales.confirm_sale(sale.id, "confirm-bundle", "1", self.db, self.user)
        self.assertEqual(16, self.db.get(Product, notebook.id).stock_quantity)
        self.assertEqual(24, self.db.get(Product, pen.id).stock_quantity)

    def test_return_is_linked_to_original_and_cannot_exceed_sold_quantity(self):
        product = Product(code="P-R", name="Classeur", product_type="product", stock_quantity=5, purchase_price=10, sale_price=20)
        source = Sale(
            number="INV-RETURN", doc_type="invoice", status="confirmed", version=2,
            total_amount=100, paid_amount=100, created_by=1,
        )
        self.db.add_all([product, source])
        self.db.flush()
        line = SaleItem(
            sale_id=source.id, product_id=product.id, description="Classeur",
            quantity=5, unit_price=20, catalog_unit_price=20, purchase_price=10,
            line_total=100, total_amount=100,
        )
        self.db.add(line)
        self.db.commit()

        allocation = SimpleNamespace(document_number="AV-TEST-1", allocation_id=1)
        with patch.object(sales, "reserve_document_number", return_value=allocation), \
             patch.object(sales, "commit_number_allocation"), \
             patch.object(sales, "void_reserved_allocation"):
            returned = sales.create_sale_return(
                source.id,
                SaleReturnIn(items=[SaleReturnItemIn(sale_item_id=line.id, quantity=2)], reason="Produit défectueux", resolution="credit"),
                "return-1",
                self.db,
                self.user,
            )
        self.assertEqual(source.id, returned.parent_id)
        self.assertEqual("credit_note", returned.doc_type)
        self.assertEqual(7, self.db.get(Product, product.id).stock_quantity)

        with self.assertRaises(HTTPException) as caught:
            sales.create_sale_return(
                source.id,
                SaleReturnIn(items=[SaleReturnItemIn(sale_item_id=line.id, quantity=4)], reason="Deuxième retour", resolution="credit"),
                "return-2",
                self.db,
                self.user,
            )
        self.assertEqual(409, caught.exception.status_code)

    def test_damaged_return_is_recorded_without_increasing_stock(self):
        product = Product(
            code="P-DAMAGED", name="Cahier abîmé", product_type="product",
            stock_quantity=8, purchase_price=5, sale_price=10,
        )
        source = Sale(
            number="INV-DAMAGED", doc_type="invoice", status="paid",
            total_amount=20, paid_amount=20, created_by=1,
        )
        self.db.add_all([product, source])
        self.db.flush()
        line = SaleItem(
            sale_id=source.id, product_id=product.id, description=product.name,
            quantity=2, unit_price=10, catalog_unit_price=10, purchase_price=5,
            line_total=20, total_amount=20,
        )
        self.db.add(line)
        self.db.commit()

        allocation = SimpleNamespace(document_number="AV-DAMAGED", allocation_id=2)
        with patch.object(sales, "reserve_document_number", return_value=allocation), \
             patch.object(sales, "commit_number_allocation"), \
             patch.object(sales, "void_reserved_allocation"):
            result = sales.create_sale_return(
                source.id,
                SaleReturnIn(
                    items=[SaleReturnItemIn(
                        sale_item_id=line.id,
                        quantity=1,
                        condition="damaged",
                        restock=False,
                    )],
                    reason="Article détérioré",
                    resolution="refund",
                ),
                "return-damaged",
                self.db,
                self.user,
            )

        self.assertEqual(8, self.db.get(Product, product.id).stock_quantity)
        self.assertEqual(10, result.return_credit_amount)
        self.assertIn("[condition:damaged]", result.items[0].description)


if __name__ == "__main__":
    unittest.main()
