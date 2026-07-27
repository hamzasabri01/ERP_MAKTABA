from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from api.routes import cash as cash_routes
from api.routes import expenses as expense_routes
from api.routes import sales as sale_routes
from api.schemas import (
    CashSessionClose,
    CashSessionOpen,
    CashTransactionIn,
    CashTransactionReverseIn,
    ExpenseCreate,
    PaymentIn,
)
from core.database import Base
from migrations.phase7_cash_payments_credit import downgrade, upgrade
from models import *  # noqa: F401,F403 - register all mappings
from models.cash import CashSession, CashTransaction
from models.client import Client
from models.expense import Expense
from models.payment import Payment
from models.sales import Sale
from models.user import Role, User
from services.cash import reconcile_cash
from services.credit import document_paid_total, reconcile_credit


class CashPaymentIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "phase7.db"
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
        admin_role = Role(name="admin-test", permissions="all")
        cashier_role = Role(
            name="cashier-test",
            permissions="cash,cash.read,cash.open,cash.close,cash.transaction,cash.adjust",
        )
        db.add_all([admin_role, cashier_role])
        db.flush()
        self.admin = User(
            username="admin-phase7",
            password_hash="test-only",
            full_name="Admin",
            role_id=admin_role.id,
            role=admin_role,
            is_active=True,
        )
        self.cashier = User(
            username="cashier-phase7",
            password_hash="test-only",
            full_name="Cashier",
            role_id=cashier_role.id,
            role=cashier_role,
            is_active=True,
        )
        self.client = Client(code="C-P7", name="Client Phase 7", credit_balance=0, is_active=True)
        db.add_all([self.admin, self.cashier, self.client])
        db.commit()
        self.admin_id = self.admin.id
        self.cashier_id = self.cashier.id
        self.client_id = self.client.id
        db.close()

    def tearDown(self):
        self.engine.dispose()
        self.temp.cleanup()

    def _sale(self, db, number: str, total=100):
        sale = Sale(
            number=number,
            doc_type="invoice",
            status="confirmed",
            client_id=self.client_id,
            total_amount=total,
            paid_amount=0,
            version=1,
            payment_mode="credit",
        )
        db.add(sale)
        db.commit()
        return sale

    def test_concurrent_open_has_one_database_winner(self):
        def open_from_thread(index):
            db = self.Session()
            try:
                user = db.get(User, self.admin_id)
                result = cash_routes.open_session(
                    CashSessionOpen(opening_balance=index),
                    f"open-{index}",
                    db,
                    user,
                )
                return ("ok", result.id)
            except HTTPException as exc:
                db.rollback()
                return ("http", exc.status_code)
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(open_from_thread, (1, 2)))
        self.assertEqual(sum(1 for kind, _ in results if kind == "ok"), 1)
        self.assertEqual(sum(1 for kind, status in results if kind == "http" and status == 409), 1)
        db = self.Session()
        self.assertEqual(db.query(CashSession).filter_by(status="open").count(), 1)
        db.close()

    def test_cash_action_permissions_and_exception_permission_are_enforced(self):
        db = self.Session()
        read_role = Role(name="cash-read-only", permissions="cash.read")
        db.add(read_role)
        db.flush()
        reader = User(
            username="cash-reader",
            password_hash="test-only",
            role_id=read_role.id,
            role=read_role,
            is_active=True,
        )
        db.add(reader)
        db.commit()
        self.assertIsNone(cash_routes.current_session(db, reader))
        with self.assertRaises(HTTPException) as denied_open:
            cash_routes.open_session(CashSessionOpen(opening_balance=0), "reader-open", db, reader)
        self.assertEqual(denied_open.exception.status_code, 403)
        db.rollback()

        sale = self._sale(db, "P7-EXCEPTION")
        cashier = db.get(User, self.cashier_id)
        with self.assertRaises(HTTPException) as denied_exception:
            sale_routes.record_payment(
                sale.id,
                PaymentIn(amount=10, payment_mode="cash", allow_without_cash_session=True),
                "cash-exception-denied",
                "1",
                db,
                cashier,
            )
        self.assertEqual(denied_exception.exception.status_code, 403)
        db.rollback()
        db.close()

    def test_cash_payment_requires_open_session_and_links_payment_transaction(self):
        db = self.Session()
        admin = db.get(User, self.admin_id)
        sale = self._sale(db, "P7-SALE-1")
        with self.assertRaises(HTTPException) as caught:
            sale_routes.record_payment(
                sale.id,
                PaymentIn(amount=40, payment_mode="cash"),
                "cash-no-session",
                "1",
                db,
                admin,
            )
        self.assertEqual(caught.exception.status_code, 409)
        db.rollback()
        self.assertEqual(db.query(Payment).count(), 0)

        session = cash_routes.open_session(
            CashSessionOpen(opening_balance=100),
            "cash-open-payment",
            db,
            admin,
        )
        paid = sale_routes.record_payment(
            sale.id,
            PaymentIn(amount=40, payment_mode="cash"),
            "cash-payment-1",
            "1",
            db,
            admin,
        )
        self.assertEqual(paid.status, "partially_paid")
        self.assertEqual(paid.paid_amount, 40)
        payment = db.query(Payment).one()
        transaction = db.query(CashTransaction).filter_by(payment_id=payment.id).one()
        self.assertTrue(payment.payment_reference.startswith("PAY-"))
        self.assertEqual(payment.cash_session_id, session.id)
        self.assertEqual((transaction.direction, transaction.amount), ("in", 40))
        self.assertEqual(db.get(Client, self.client_id).credit_balance, 60)

        completed = sale_routes.record_payment(
            sale.id,
            PaymentIn(amount=60, payment_mode="card"),
            "card-payment-2",
            "2",
            db,
            admin,
        )
        self.assertEqual(completed.status, "paid")
        self.assertEqual(document_paid_total(db, "sale", sale.id), 100)
        self.assertEqual(db.query(Payment).count(), 2)
        self.assertEqual(db.query(CashTransaction).count(), 1)
        self.assertEqual(db.get(Client, self.client_id).credit_balance, 0)
        refs = [row[0] for row in db.query(Payment.payment_reference).all()]
        self.assertEqual(len(refs), len(set(refs)))
        self.assertTrue(reconcile_cash(db, session.id)["ok"])
        self.assertTrue(reconcile_credit(db)["ok"])
        db.close()

    def test_payment_and_cash_reversal_are_idempotent(self):
        db = self.Session()
        admin = db.get(User, self.admin_id)
        cash_routes.open_session(CashSessionOpen(opening_balance=50), "open-reversal", db, admin)
        sale = self._sale(db, "P7-SALE-REV")
        sale_routes.record_payment(
            sale.id,
            PaymentIn(amount=25, payment_mode="cash"),
            "pay-reversal",
            "1",
            db,
            admin,
        )
        cancelled = sale_routes.cancel_sale(sale.id, "cancel-reversal", "2", db, admin)
        self.assertEqual(cancelled.status, "cancelled")
        self.assertEqual(document_paid_total(db, "sale", sale.id), 0)
        original = db.query(Payment).filter_by(kind="payment").one()
        reversal = db.query(Payment).filter_by(kind="reversal").one()
        self.assertEqual(reversal.reverses_payment_id, original.id)
        original_tx = db.query(CashTransaction).filter_by(payment_id=original.id).one()
        reversal_tx = db.query(CashTransaction).filter_by(payment_id=reversal.id).one()
        self.assertEqual(reversal_tx.reverses_transaction_id, original_tx.id)
        self.assertEqual((original_tx.direction, reversal_tx.direction), ("in", "out"))

        replay = sale_routes.cancel_sale(sale.id, "cancel-reversal", "2", db, admin)
        self.assertEqual(replay.status, "cancelled")
        self.assertEqual(db.query(Payment).filter_by(kind="reversal").count(), 1)
        self.assertEqual(db.query(CashTransaction).filter_by(kind="reversal").count(), 1)
        self.assertTrue(reconcile_cash(db)["ok"])
        db.close()

    def test_close_difference_requires_reason_and_approval_and_closed_is_immutable(self):
        db = self.Session()
        admin = db.get(User, self.admin_id)
        cashier = db.get(User, self.cashier_id)
        opened = cash_routes.open_session(
            CashSessionOpen(opening_balance=100),
            "open-close-test",
            db,
            admin,
        )
        with self.assertRaises(HTTPException) as missing_reason:
            cash_routes.close_session(
                opened.id,
                CashSessionClose(closing_balance=110),
                "close-no-reason",
                "1",
                db,
                admin,
            )
        self.assertEqual(missing_reason.exception.status_code, 400)
        db.rollback()

        with self.assertRaises(HTTPException) as missing_approval:
            cash_routes.close_session(
                opened.id,
                CashSessionClose(closing_balance=301, difference_reason="Erreur de comptage"),
                "close-no-approval",
                "1",
                db,
                cashier,
            )
        self.assertEqual(missing_approval.exception.status_code, 403)
        db.rollback()

        closed = cash_routes.close_session(
            opened.id,
            CashSessionClose(closing_balance=301, difference_reason="Erreur de comptage"),
            "close-approved",
            "1",
            db,
            admin,
        )
        self.assertEqual(closed.status, "closed")
        self.assertEqual(closed.difference, 201)
        self.assertEqual(closed.approved_by, admin.id)
        with self.assertRaises(HTTPException) as immutable:
            cash_routes.add_transaction(
                opened.id,
                CashTransactionIn(direction="in", amount=1),
                "closed-adjust",
                db,
                admin,
            )
        self.assertEqual(immutable.exception.status_code, 409)
        db.rollback()
        db.close()

    def test_manual_transaction_reversal_is_once_and_uses_open_session(self):
        db = self.Session()
        admin = db.get(User, self.admin_id)
        session = cash_routes.open_session(CashSessionOpen(opening_balance=0), "open-manual", db, admin)
        original = cash_routes.add_transaction(
            session.id,
            CashTransactionIn(direction="in", amount=35, description="Ajout"),
            "manual-add",
            db,
            admin,
        )
        reversal = cash_routes.reverse_transaction(
            original.id,
            CashTransactionReverseIn(reason="Saisie en double"),
            "manual-reverse",
            db,
            admin,
        )
        replay = cash_routes.reverse_transaction(
            original.id,
            CashTransactionReverseIn(reason="Saisie en double"),
            "manual-reverse",
            db,
            admin,
        )
        self.assertEqual(reversal.id, replay.id)
        self.assertEqual((reversal.direction, reversal.reverses_transaction_id), ("out", original.id))
        self.assertEqual(db.query(CashTransaction).count(), 2)
        self.assertTrue(reconcile_cash(db, session.id)["ok"])
        db.close()

    def test_cash_expense_requires_session_and_update_delete_reverse_payments(self):
        db = self.Session()
        admin = db.get(User, self.admin_id)
        body = ExpenseCreate(description="Fournitures", amount=20, payment_method="cash")
        with self.assertRaises(HTTPException) as blocked:
            expense_routes.create_expense(body, "expense-no-cash", db, admin)
        self.assertEqual(blocked.exception.status_code, 409)
        db.rollback()

        session = cash_routes.open_session(CashSessionOpen(opening_balance=100), "expense-open", db, admin)
        expense = expense_routes.create_expense(body, "expense-create", db, admin)
        self.assertEqual(db.query(Payment).filter_by(document_type="expense", document_id=expense.id).count(), 1)
        self.assertEqual(db.query(CashTransaction).filter_by(source="expense", direction="out").count(), 1)

        updated = expense_routes.update_expense(
            expense.id,
            ExpenseCreate(description="Fournitures corrigees", amount=25, payment_method="card"),
            "expense-update",
            db,
            admin,
        )
        self.assertEqual(updated.amount, 25)
        self.assertEqual(db.query(Payment).filter_by(document_type="expense", document_id=expense.id).count(), 3)
        self.assertEqual(db.query(CashTransaction).filter_by(source="expense", direction="in").count(), 1)
        self.assertTrue(reconcile_cash(db, session.id)["ok"])

        self.assertEqual(
            expense_routes.delete_expense(expense.id, "expense-delete", db, admin),
            {"ok": True},
        )
        self.assertIsNone(db.get(Expense, expense.id))
        self.assertEqual(db.query(Payment).filter_by(document_type="expense", document_id=expense.id).count(), 4)
        self.assertEqual(
            expense_routes.delete_expense(expense.id, "expense-delete", db, admin),
            {"ok": True},
        )
        db.close()


class Phase7MigrationTests(unittest.TestCase):
    def test_upgrade_backfills_ledger_and_downgrade_restores_legacy_state(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "legacy.db"
            connection = sqlite3.connect(path)
            connection.executescript(
                """
                CREATE TABLE users(id INTEGER PRIMARY KEY);
                INSERT INTO users VALUES(1);
                CREATE TABLE clients(id INTEGER PRIMARY KEY,name TEXT,credit_balance NUMERIC(18,2));
                INSERT INTO clients VALUES(1,'Client',0);
                CREATE TABLE sales(
                    id INTEGER PRIMARY KEY,number TEXT,doc_type TEXT,status TEXT,client_id INTEGER,
                    total_amount NUMERIC(18,2),paid_amount NUMERIC(18,2),date_time DATETIME,
                    created_by INTEGER,payment_mode TEXT
                );
                INSERT INTO sales VALUES(1,'FAC-L','invoice','partially_paid',1,100,40,'2026-01-01',1,'Espèce');
                CREATE TABLE purchases(
                    id INTEGER PRIMARY KEY,number TEXT,status TEXT,total_amount NUMERIC(18,2),
                    paid_amount NUMERIC(18,2),date_time DATETIME,created_by INTEGER
                );
                INSERT INTO purchases VALUES(1,'BC-L','received',80,30,'2026-01-01',1);
                CREATE TABLE cash_sessions(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,opened_by INTEGER,opened_at DATETIME,
                    closed_at DATETIME,opening_balance NUMERIC(18,2),closing_balance NUMERIC(18,2),
                    expected_balance NUMERIC(18,2),difference NUMERIC(18,2),status TEXT,notes TEXT
                );
                INSERT INTO cash_sessions VALUES(1,1,'2026-01-01',NULL,10,NULL,NULL,NULL,'open','');
                CREATE TABLE cash_transactions(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,session_id INTEGER,direction TEXT,
                    amount NUMERIC(18,2),source TEXT,reference TEXT,description TEXT,
                    created_at DATETIME,created_by INTEGER
                );
                CREATE TABLE payments(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,document_type TEXT NOT NULL,
                    document_id INTEGER NOT NULL,amount NUMERIC(18,2),payment_mode TEXT,
                    reference TEXT,notes TEXT,created_at DATETIME,created_by INTEGER,
                    kind TEXT NOT NULL DEFAULT 'payment',reverses_payment_id INTEGER,
                    idempotency_key TEXT
                );
                """
            )
            connection.commit()
            connection.close()

            upgrade(path)
            connection = sqlite3.connect(path)
            self.assertEqual(connection.execute("SELECT count(*) FROM payments").fetchone()[0], 2)
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM payments WHERE payment_reference<>'' AND operation_key<>''"
                ).fetchone()[0],
                2,
            )
            self.assertEqual(connection.execute("SELECT credit_balance FROM clients").fetchone()[0], 60)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO cash_sessions(opened_by,opened_at,opening_balance,status,notes,version,difference_reason) "
                    "VALUES(1,'2026-01-02',0,'open','',1,'')"
                )
            connection.rollback()
            connection.close()

            downgrade(path)
            connection = sqlite3.connect(path)
            self.assertEqual(connection.execute("SELECT count(*) FROM payments").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT credit_balance FROM clients").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT count(*) FROM cash_sessions").fetchone()[0], 1)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            connection.close()


if __name__ == "__main__":
    unittest.main()
