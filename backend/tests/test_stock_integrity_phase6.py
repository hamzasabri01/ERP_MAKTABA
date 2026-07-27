from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
import sqlite3
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from api.routes import sales as sale_routes
from api.routes import stock as stock_routes
from api.schemas import InventoryCountIn, InventorySessionCreate
from core.database import Base
from migrations.phase6_stock_integrity import downgrade, upgrade
from models import *  # noqa: F401,F403 - register the complete SQLAlchemy graph
from models.product import Product
from models.sales import Sale, SaleItem
from models.stock import InventorySession, StockMovement
from models.user import User
from services.stock import apply_stock_movement, reconcile_stock, reverse_stock_movement


class AtomicStockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "stock.db"
        self.engine = create_engine(
            f"sqlite:///{self.path}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )

        @event.listens_for(self.engine, "connect")
        def configure_sqlite(connection, _record):
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        db = self.Session()
        self.user = User(
            id=1,
            username="tester",
            password_hash="test-only",
            full_name="Test User",
            is_active=True,
        )
        self.product = Product(
            code="STK-1",
            name="Produit stock",
            product_type="product",
            stock_quantity=0,
            purchase_price=Decimal("10"),
            sale_price=Decimal("20"),
            is_active=1,
        )
        self.service = Product(
            code="SRV-1",
            name="Service",
            product_type="service",
            stock_quantity=0,
            purchase_price=0,
            sale_price=50,
            is_active=1,
        )
        db.add_all([self.user, self.product, self.service])
        db.flush()
        apply_stock_movement(
            db,
            self.product,
            "in",
            100,
            operation_key="test:initial",
            source_type="product",
            source_id=self.product.id,
            reference="INITIAL",
        )
        db.commit()
        self.product_id = self.product.id
        self.service_id = self.service.id
        db.close()

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def test_two_stale_sessions_cannot_drive_stock_negative(self):
        first = self.Session()
        second = self.Session()
        first_product = first.get(Product, self.product_id)
        second_product = second.get(Product, self.product_id)
        self.assertEqual(first_product.stock_quantity, 100)
        self.assertEqual(second_product.stock_quantity, 100)

        apply_stock_movement(
            first,
            first_product,
            "out",
            80,
            operation_key="race:first",
            source_type="sale",
            source_id=1,
        )
        first.commit()
        with self.assertRaises(HTTPException) as caught:
            apply_stock_movement(
                second,
                second_product,
                "out",
                80,
                operation_key="race:second",
                source_type="sale",
                source_id=2,
            )
        self.assertEqual(caught.exception.status_code, 400)
        second.rollback()
        first.close()
        second.close()

        db = self.Session()
        self.assertEqual(db.get(Product, self.product_id).stock_quantity, 20)
        self.assertEqual(db.query(StockMovement).filter(StockMovement.movement_type == "out").count(), 1)
        self.assertGreaterEqual(db.get(Product, self.product_id).stock_quantity, 0)
        db.close()

    def test_operation_replay_and_reversal_are_each_written_once(self):
        db = self.Session()
        product = db.get(Product, self.product_id)
        movement = apply_stock_movement(
            db,
            product,
            "out",
            12,
            operation_key="replay:movement",
            source_type="sale",
            source_id=10,
        )
        replay = apply_stock_movement(
            db,
            product,
            "out",
            12,
            operation_key="replay:movement",
            source_type="sale",
            source_id=10,
        )
        self.assertEqual(movement.id, replay.id)
        reversal = reverse_stock_movement(
            db,
            movement,
            operation_key="replay:reversal",
            user_id=None,
            reference="CANCEL-T",
            notes="test",
        )
        replay_reversal = reverse_stock_movement(
            db,
            movement,
            operation_key="replay:reversal",
            user_id=None,
            reference="CANCEL-T",
            notes="test",
        )
        self.assertEqual(reversal.id, replay_reversal.id)
        db.commit()
        self.assertEqual(db.get(Product, self.product_id).stock_quantity, 100)
        self.assertEqual(db.query(StockMovement).filter_by(operation_key="replay:movement").count(), 1)
        self.assertEqual(db.query(StockMovement).filter_by(reverses_movement_id=movement.id).count(), 1)
        db.close()

    def test_services_never_receive_stock_movements(self):
        db = self.Session()
        with self.assertRaises(HTTPException) as caught:
            apply_stock_movement(
                db,
                db.get(Product, self.service_id),
                "in",
                1,
                operation_key="service:invalid",
                source_type="manual",
            )
        self.assertEqual(caught.exception.status_code, 400)
        db.rollback()
        self.assertEqual(db.query(StockMovement).filter_by(product_id=self.service_id).count(), 0)
        db.close()

    def test_reconciliation_is_zero_when_healthy_and_detects_direct_corruption(self):
        db = self.Session()
        healthy = reconcile_stock(db)
        self.assertTrue(healthy["ok"])
        self.assertEqual(healthy["mismatch_count"], 0)
        db.get(Product, self.product_id).stock_quantity = 99
        db.commit()
        broken = reconcile_stock(db)
        self.assertFalse(broken["ok"])
        self.assertEqual(broken["mismatch_count"], 1)
        self.assertEqual(broken["items"][0]["difference"], Decimal("-1.0000"))
        db.close()

    def test_inventory_state_machine_and_stale_snapshot_guard(self):
        db = self.Session()
        created = stock_routes.create_inventory_session(
            InventorySessionCreate(product_ids=[self.product_id], notes="Comptage test"),
            "inventory-create",
            db,
            self.user,
        )
        self.assertEqual(created.status, "draft")
        counted = stock_routes.count_inventory_session(
            created.id,
            InventoryCountIn(items=[{"product_id": self.product_id, "quantity": 94}]),
            "inventory-count",
            "1",
            db,
            self.user,
        )
        self.assertEqual(counted.status, "counted")
        self.assertEqual(counted.version, 2)
        validated = stock_routes.validate_inventory_session(
            created.id,
            "inventory-validate",
            "2",
            db,
            self.user,
        )
        self.assertEqual(validated.status, "validated")
        self.assertEqual(validated.version, 3)
        self.assertEqual(db.get(Product, self.product_id).stock_quantity, 94)
        movement = db.query(StockMovement).filter_by(source_type="inventory_session", source_id=created.id).one()
        self.assertEqual(movement.source_line_id, validated.lines[0].id)
        replay = stock_routes.validate_inventory_session(
            created.id,
            "inventory-validate",
            "2",
            db,
            self.user,
        )
        self.assertEqual(replay.version, 3)
        self.assertEqual(db.query(StockMovement).filter_by(source_type="inventory_session", source_id=created.id).count(), 1)

        second = stock_routes.create_inventory_session(
            InventorySessionCreate(product_ids=[self.product_id]),
            "inventory-create-stale",
            db,
            self.user,
        )
        stock_routes.count_inventory_session(
            second.id,
            InventoryCountIn(items=[{"product_id": self.product_id, "quantity": 90}]),
            "inventory-count-stale",
            "1",
            db,
            self.user,
        )
        db.get(Product, self.product_id).stock_quantity = 93
        db.commit()
        with self.assertRaises(HTTPException) as caught:
            stock_routes.validate_inventory_session(
                second.id,
                "inventory-validate-stale",
                "2",
                db,
                self.user,
            )
        self.assertEqual(caught.exception.status_code, 409)
        db.rollback()
        self.assertEqual(db.get(InventorySession, second.id).status, "counted")
        db.close()

    def test_concurrent_sale_confirmation_commits_only_available_stock(self):
        db = self.Session()
        sale_ids = []
        for index in range(2):
            sale = Sale(
                number=f"RACE-{index}",
                doc_type="invoice",
                status="draft",
                total_amount=1600,
                paid_amount=0,
                version=1,
            )
            db.add(sale)
            db.flush()
            db.add(SaleItem(
                sale_id=sale.id,
                product_id=self.product_id,
                quantity=80,
                unit_price=20,
                purchase_price=10,
                line_total=1600,
            ))
            sale_ids.append(sale.id)
        db.commit()
        db.close()

        def confirm(sale_id):
            session = self.Session()
            try:
                result = sale_routes.confirm_sale(
                    sale_id,
                    f"confirm-{sale_id}",
                    "1",
                    session,
                    self.user,
                )
                return ("ok", result.status)
            except HTTPException as exc:
                session.rollback()
                return ("http", exc.status_code)
            finally:
                session.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(confirm, sale_ids))
        self.assertEqual(sum(1 for kind, _ in results if kind == "ok"), 1)
        self.assertEqual(sum(1 for kind, status in results if kind == "http" and status == 400), 1)
        db = self.Session()
        self.assertEqual(db.get(Product, self.product_id).stock_quantity, 20)
        self.assertEqual(
            db.query(StockMovement).filter(
                StockMovement.source_type == "sale",
                StockMovement.source_id.in_(sale_ids),
                StockMovement.kind == "movement",
            ).count(),
            1,
        )
        db.close()


class Phase6MigrationTests(unittest.TestCase):
    def test_upgrade_and_downgrade_preserve_legacy_stock_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "legacy-stock.db"
            connection = sqlite3.connect(path)
            connection.executescript(
                """
                CREATE TABLE users(id INTEGER PRIMARY KEY);
                CREATE TABLE products(id INTEGER PRIMARY KEY);
                CREATE TABLE sales(id INTEGER PRIMARY KEY, number TEXT);
                CREATE TABLE purchases(id INTEGER PRIMARY KEY, number TEXT);
                INSERT INTO users VALUES(1);
                INSERT INTO products VALUES(1);
                INSERT INTO sales VALUES(5,'FAC-TEST');
                CREATE TABLE stock_movements(
                    id INTEGER PRIMARY KEY,
                    product_id INTEGER,
                    movement_type VARCHAR(20),
                    quantity NUMERIC(18,4),
                    before_qty NUMERIC(18,4),
                    after_qty NUMERIC(18,4),
                    unit_cost NUMERIC(18,4),
                    reference VARCHAR(100),
                    notes TEXT,
                    created_at DATETIME,
                    created_by INTEGER,
                    FOREIGN KEY(product_id) REFERENCES products(id),
                    FOREIGN KEY(created_by) REFERENCES users(id)
                );
                INSERT INTO stock_movements VALUES(1,1,'out',2,10,8,3,'FAC-TEST','legacy','2026-01-01',1);
                """
            )
            before = connection.execute("SELECT * FROM stock_movements").fetchall()
            connection.commit()
            connection.close()

            upgrade(path)
            connection = sqlite3.connect(path)
            migrated = connection.execute(
                "SELECT warehouse_code,source_type,source_id,operation_key,kind FROM stock_movements"
            ).fetchone()
            self.assertEqual(migrated, ("MAIN", "sale", 5, "legacy:stock:1", "movement"))
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'inventory_%'"
                ).fetchone()[0],
                2,
            )
            connection.close()

            downgrade(path)
            connection = sqlite3.connect(path)
            self.assertEqual(connection.execute("SELECT * FROM stock_movements").fetchall(), before)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            connection.close()


if __name__ == "__main__":
    unittest.main()
