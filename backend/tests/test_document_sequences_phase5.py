from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from api.routes import sales as sale_routes
from api.schemas import SaleCreate
from migrations.phase5_document_sequences import downgrade, upgrade
from models import *  # noqa: F401,F403 - register the complete SQLAlchemy graph
from models.document_sequence import DocumentNumberAllocation, DocumentSequence
from models.sales import Sale
from services.document_numbers import (
    commit_number_allocation,
    reserve_document_number,
    void_document_allocation,
    void_reserved_allocation,
)


class DocumentSequenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "sequences.db"
        self.engine = create_engine(
            f"sqlite:///{self.path}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def _create_sale(self, *, prefix="FAC", year=2026):
        db = self.Session()
        allocation = reserve_document_number(
            db,
            "sale",
            "invoice",
            document_date=datetime(year, 1, 5),
            prefix=prefix,
        )
        try:
            sale = Sale(
                number=allocation.document_number,
                doc_type="invoice",
                status="draft",
                date_time=datetime(year, 1, 5),
                total_amount=0,
                paid_amount=0,
            )
            db.add(sale)
            db.flush()
            commit_number_allocation(db, allocation.allocation_id, sale.id)
            db.commit()
            return sale.id, allocation
        except Exception as exc:
            db.rollback()
            void_reserved_allocation(db, allocation.allocation_id, f"test_failed_{type(exc).__name__}")
            raise
        finally:
            db.close()

    def test_concurrent_document_creation_has_no_duplicates(self):
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda _: self._create_sale(), range(40)))
        numbers = [allocation.document_number for _, allocation in results]
        serials = sorted(allocation.serial_number for _, allocation in results)
        self.assertEqual(len(numbers), len(set(numbers)))
        self.assertEqual(serials, list(range(1, 41)))

        db = self.Session()
        self.assertEqual(db.query(Sale).count(), 40)
        self.assertEqual(db.query(DocumentNumberAllocation).filter_by(status="committed").count(), 40)
        sequence = db.query(DocumentSequence).one()
        self.assertEqual((sequence.last_value, sequence.next_value), (40, 41))
        db.close()

    def test_concurrent_sale_route_creates_unique_response_numbers(self):
        user = SimpleNamespace(id=1, username="tester", full_name="Test User")
        body = SaleCreate(items=[{"quantity": "1", "unit_price": "1", "tax_rate": "0"}])

        def create_from_route(_):
            db = self.Session()
            try:
                return sale_routes.create_sale(body, db, user).number
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=8) as pool:
            numbers = list(pool.map(create_from_route, range(20)))
        self.assertEqual(len(numbers), len(set(numbers)))
        self.assertEqual(
            sorted(int(number.rsplit("-", 1)[1]) for number in numbers),
            list(range(1, 21)),
        )

    def test_deleted_draft_number_is_voided_and_never_reused(self):
        first_id, first = self._create_sale()
        db = self.Session()
        sale = db.get(Sale, first_id)
        self.assertTrue(void_document_allocation(db, "sale", sale.number, sale.id, "draft_deleted"))
        db.delete(sale)
        db.commit()
        db.close()

        _, second = self._create_sale()
        self.assertEqual(first.serial_number + 1, second.serial_number)
        self.assertNotEqual(first.document_number, second.document_number)
        db = self.Session()
        old = db.get(DocumentNumberAllocation, first.allocation_id)
        self.assertEqual((old.status, old.reason), ("void", "draft_deleted"))
        db.close()

    def test_failed_reservation_creates_a_gap_instead_of_reuse(self):
        db = self.Session()
        first = reserve_document_number(db, "sale", "invoice", document_date=datetime(2026, 1, 1), prefix="FAC")
        void_reserved_allocation(db, first.allocation_id, "validation_failed")
        second = reserve_document_number(db, "sale", "invoice", document_date=datetime(2026, 1, 1), prefix="FAC")
        self.assertEqual(second.serial_number, first.serial_number + 1)
        self.assertEqual(db.get(DocumentNumberAllocation, first.allocation_id).status, "void")
        db.close()

    def test_prefix_change_keeps_same_sequence_and_old_number(self):
        first_id, first = self._create_sale(prefix="OLD")
        second_id, second = self._create_sale(prefix="NEW")
        self.assertEqual(first.document_number, "OLD-2026-00001")
        self.assertEqual(second.document_number, "NEW-2026-00002")
        db = self.Session()
        self.assertEqual(db.get(Sale, first_id).number, first.document_number)
        self.assertEqual(db.get(Sale, second_id).number, second.document_number)
        self.assertEqual(db.query(DocumentSequence).count(), 1)
        db.close()

    def test_year_and_document_type_have_independent_sequences(self):
        db = self.Session()
        y2025 = reserve_document_number(db, "sale", "invoice", document_date=datetime(2025, 1, 1), prefix="FAC")
        y2026 = reserve_document_number(db, "sale", "invoice", document_date=datetime(2026, 1, 1), prefix="FAC")
        quote = reserve_document_number(db, "sale", "quote", document_date=datetime(2026, 1, 1), prefix="DEV")
        self.assertEqual((y2025.serial_number, y2026.serial_number, quote.serial_number), (1, 1, 1))
        self.assertEqual(db.query(DocumentSequence).count(), 3)
        db.close()

    def test_company_scopes_are_independent(self):
        db = self.Session()
        company_a = reserve_document_number(
            db, "sale", "invoice", document_date=datetime(2026, 1, 1), company_key="company-a", prefix="FAC",
        )
        company_b = reserve_document_number(
            db, "sale", "invoice", document_date=datetime(2026, 1, 1), company_key="company-b", prefix="FAC",
        )
        self.assertEqual((company_a.serial_number, company_b.serial_number), (1, 1))
        self.assertEqual(db.query(DocumentSequence).count(), 2)
        db.close()


class DocumentSequenceMigrationTests(unittest.TestCase):
    def _create_legacy_database(self, path: Path):
        connection = sqlite3.connect(path)
        connection.executescript(
            """
            CREATE TABLE users(id INTEGER PRIMARY KEY);
            INSERT INTO users(id) VALUES(1);
            CREATE TABLE sales(
                id INTEGER PRIMARY KEY, number TEXT UNIQUE, doc_type TEXT,
                date_time DATETIME, created_at DATETIME, created_by INTEGER
            );
            CREATE TABLE purchases(
                id INTEGER PRIMARY KEY, number TEXT UNIQUE, doc_type TEXT,
                date_time DATETIME, created_at DATETIME, created_by INTEGER
            );
            INSERT INTO sales VALUES
                (1,'FAC-2025-00003','invoice','2025-02-01','2025-02-01',1),
                (2,'OLD-2025-00008','invoice','2025-03-01','2025-03-01',1),
                (3,'DEV-2026-00002','quote','2026-01-01','2026-01-01',1);
            INSERT INTO purchases VALUES
                (1,'BC-2026-00007','order','2026-01-02','2026-01-02',1);
            """
        )
        connection.commit()
        connection.close()

    def test_backfill_preserves_documents_and_uses_max_across_prefixes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "legacy.db"
            self._create_legacy_database(path)
            connection = sqlite3.connect(path)
            before = {
                table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                for table in ("sales", "purchases")
            }
            connection.close()

            upgrade(path)
            connection = sqlite3.connect(path)
            invoice = connection.execute(
                """
                SELECT last_value,next_value FROM document_sequences
                WHERE domain='sale' AND document_type='invoice' AND fiscal_year=2025
                """
            ).fetchone()
            self.assertEqual(invoice, (8, 9))
            self.assertEqual(connection.execute("SELECT count(*) FROM document_number_allocations").fetchone()[0], 4)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            connection.close()

            downgrade(path)
            connection = sqlite3.connect(path)
            after = {
                table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                for table in ("sales", "purchases")
            }
            self.assertEqual(before, after)
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'document_%'"
                ).fetchone()[0],
                0,
            )
            connection.close()


if __name__ == "__main__":
    unittest.main()
