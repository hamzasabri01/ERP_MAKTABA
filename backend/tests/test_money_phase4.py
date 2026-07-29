from __future__ import annotations

import sqlite3
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from api.schemas import PaymentIn, PurchaseCreate, SaleCreate
from core.database import Base
from migrations.phase4_decimal_money import DOWN_TABLES, downgrade, upgrade
from models import *  # noqa: F401,F403 - register the complete SQLAlchemy graph
from models.purchase import Purchase
from models.sales import Sale
from api.routes import purchases as purchase_routes, sales as sale_routes
from services.money import MoneyPolicy, calculate_document
from services.document_workflow import validate_payment_amount


class ExactMoneyTests(unittest.TestCase):
    def test_binary_float_regression_is_exact(self):
        result = calculate_document([{"quantity": "3", "unit_price": "0.1", "tax_rate": "0"}])
        self.assertEqual(result["subtotal"], Decimal("0.30"))
        self.assertEqual(result["tax_amount"], Decimal("0.00"))
        self.assertEqual(result["total_amount"], Decimal("0.30"))

    def test_exclusive_tax_and_both_discounts(self):
        result = calculate_document(
            [{"quantity": "2", "unit_price": "19.995", "discount": "10", "tax_rate": "20"}],
            "5",
        )
        self.assertEqual(result["discount_amount"], Decimal("5.80"))
        self.assertEqual(result["subtotal"], Decimal("34.19"))
        self.assertEqual(result["tax_amount"], Decimal("6.84"))
        self.assertEqual(result["total_amount"], Decimal("41.03"))

    def test_inclusive_tax_extracts_tax_without_changing_total(self):
        result = calculate_document(
            [{"quantity": "1", "unit_price": "120", "tax_rate": "20"}],
            policy=MoneyPolicy(price_tax_mode="inclusive"),
        )
        self.assertEqual(result["subtotal"], Decimal("100.00"))
        self.assertEqual(result["tax_amount"], Decimal("20.00"))
        self.assertEqual(result["total_amount"], Decimal("120.00"))

    def test_document_rounding_allocates_residual_and_preserves_sums(self):
        result = calculate_document(
            [{"quantity": 1, "unit_price": "0.025", "tax_rate": 20} for _ in range(3)],
            policy=MoneyPolicy(rounding_scope="document"),
        )
        self.assertEqual(sum(line["line_total"] for line in result["items"]), result["subtotal"])
        self.assertEqual(sum(line["tax_amount"] for line in result["items"]), result["tax_amount"])
        self.assertEqual(result["total_amount"], Decimal("0.10"))

    def test_tax_breakdown_is_exact_for_mixed_rates(self):
        result = calculate_document([
            {"quantity": 1, "unit_price": 100, "tax_rate": 20},
            {"quantity": 2, "unit_price": 50, "tax_rate": 7},
        ])
        self.assertEqual([row["rate"] for row in result["tax_breakdown"]], [Decimal("7.0000"), Decimal("20.0000")])
        self.assertEqual(sum(row["tax_amount"] for row in result["tax_breakdown"]), result["tax_amount"])
        self.assertEqual(sum(row["total_amount"] for row in result["tax_breakdown"]), result["total_amount"])

    def test_global_tax_switch_forces_zero_and_removes_breakdown(self):
        result = calculate_document(
            [{"quantity": 2, "unit_price": 50, "tax_rate": 20}],
            policy=MoneyPolicy(tax_enabled=False),
        )
        self.assertEqual(result["items"][0]["tax_rate"], Decimal("0"))
        self.assertEqual(result["items"][0]["tax_amount"], Decimal("0.00"))
        self.assertEqual(result["tax_amount"], Decimal("0.00"))
        self.assertEqual(result["total_amount"], Decimal("100.00"))
        self.assertEqual(result["tax_breakdown"], [])

    def test_invalid_boundaries_are_rejected(self):
        invalid_lines = [
            {"quantity": 0, "unit_price": 1, "tax_rate": 20},
            {"quantity": 1, "unit_price": -1, "tax_rate": 20},
            {"quantity": 1, "unit_price": 1, "purchase_price": -1, "tax_rate": 20},
            {"quantity": 1, "unit_price": 1, "discount": 101, "tax_rate": 20},
            {"quantity": 1, "unit_price": 1, "tax_rate": 19},
            {"quantity": 1, "unit_price": "NaN", "tax_rate": 20},
        ]
        for line in invalid_lines:
            with self.subTest(line=line), self.assertRaises(HTTPException):
                calculate_document([line])

    def test_request_contracts_reject_invalid_money(self):
        for schema, payload in (
            (SaleCreate, {"items": [{"quantity": 0, "unit_price": 1}]}),
            (PurchaseCreate, {"items": [{"quantity": 1, "unit_price": -1}]}),
            (PaymentIn, {"amount": -1}),
            (PaymentIn, {"amount": "Infinity"}),
        ):
            with self.subTest(schema=schema.__name__), self.assertRaises(ValidationError):
                schema(**payload)
        with self.assertRaises(HTTPException):
            validate_payment_amount(PaymentIn(amount=0).amount, Decimal("10.00"))
        with self.assertRaises(HTTPException):
            validate_payment_amount(PaymentIn(amount=Decimal("10.01")).amount, Decimal("10.00"))


class DecimalMigrationTests(unittest.TestCase):
    def _create_phase3_database(self, path: Path):
        connection = sqlite3.connect(path)
        connection.execute("CREATE TABLE categories(id INTEGER PRIMARY KEY)")
        connection.execute("CREATE TABLE suppliers(id INTEGER PRIMARY KEY)")
        connection.execute("CREATE TABLE users(id INTEGER PRIMARY KEY)")
        for table, ddl in DOWN_TABLES.items():
            connection.execute(ddl.format(table=table))
        connection.execute(
            "INSERT INTO sales(id,number,doc_type,status,discount,subtotal,tax_amount,total_amount,paid_amount,version) "
            "VALUES(1,'FAC-T','invoice','draft',12.3456,0.3,0.06,0.36,0,1)"
        )
        connection.execute(
            "INSERT INTO sale_items(id,sale_id,description,quantity,unit_price,purchase_price,discount,tax_rate,line_total) "
            "VALUES(1,1,'line',3,0.1,0.05,0,20,0.3)"
        )
        connection.execute(
            "INSERT INTO purchases(id,number,doc_type,status,subtotal,tax_amount,total_amount,paid_amount,is_paid,version) "
            "VALUES(1,'BC-T','order','draft',10.01,2.0,12.01,0,0,1)"
        )
        connection.execute(
            "INSERT INTO purchase_items(id,purchase_id,description,quantity,unit_price,tax_rate,line_total,received_quantity) "
            "VALUES(1,1,'line',1,10.01,20,10.01,0)"
        )
        connection.commit()
        connection.close()

    @staticmethod
    def _snapshot(path: Path):
        connection = sqlite3.connect(path)
        tables = tuple(DOWN_TABLES)
        result = {}
        for table in tables:
            columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
            result[table] = (columns, connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall())
        connection.close()
        return result

    def test_upgrade_and_downgrade_preserve_every_original_value(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "phase4.db"
            self._create_phase3_database(path)
            before = self._snapshot(path)
            upgrade(path)
            connection = sqlite3.connect(path)
            types = {row[1]: row[2] for row in connection.execute("PRAGMA table_info(sales)")}
            self.assertEqual(types["total_amount"], "NUMERIC(18,2)")
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            connection.close()
            downgrade(path)
            self.assertEqual(self._snapshot(path), before)


class DocumentRouteCalculationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.temp.name) / 'routes.db'}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.user = SimpleNamespace(id=1, username="tester", full_name="Test User")

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def test_sale_create_persists_only_server_calculated_totals(self):
        body = SaleCreate(items=[{"quantity": "3", "unit_price": "0.1", "tax_rate": "0"}])
        result = sale_routes.create_sale(body, self.db, self.user)
        stored = self.db.get(Sale, result.id)
        self.assertEqual(stored.subtotal, Decimal("0.30"))
        self.assertEqual(stored.total_amount, Decimal("0.30"))
        self.assertEqual(stored.items[0].line_total, Decimal("0.30"))
        self.assertEqual(stored.items[0].total_amount, Decimal("0.30"))
        self.assertEqual(result.currency_code, "MAD")

    def test_purchase_create_persists_discount_tax_and_breakdown(self):
        body = PurchaseCreate(
            discount="5",
            items=[{"quantity": "2", "unit_price": "19.995", "discount": "10", "tax_rate": "20"}],
        )
        with patch.object(purchase_routes, "load_settings", return_value={"tva_enabled": True}):
            result = purchase_routes.create_purchase(body, self.db, self.user)
        stored = self.db.get(Purchase, result.id)
        self.assertEqual(stored.discount_amount, Decimal("5.80"))
        self.assertEqual(stored.subtotal, Decimal("34.19"))
        self.assertEqual(stored.tax_amount, Decimal("6.84"))
        self.assertEqual(stored.total_amount, Decimal("41.03"))
        self.assertEqual(stored.items[0].tax_amount, Decimal("6.84"))
        self.assertEqual(result.tax_breakdown[0].rate, 20)


if __name__ == "__main__":
    unittest.main()
