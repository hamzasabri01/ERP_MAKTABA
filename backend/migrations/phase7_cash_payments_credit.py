"""Phase 7: controlled cash sessions, payment ledger links, and credit repair."""
from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime
from decimal import Decimal
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "proerp.db"

CASH_SESSION_COLUMNS = (
    ("version", "INTEGER NOT NULL DEFAULT 1"),
    ("closed_by", "INTEGER REFERENCES users(id)"),
    ("difference_reason", "TEXT NOT NULL DEFAULT ''"),
    ("approved_by", "INTEGER REFERENCES users(id)"),
    ("approved_at", "DATETIME"),
)

CASH_TRANSACTION_COLUMNS = (
    ("payment_id", "INTEGER REFERENCES payments(id)"),
    ("kind", "VARCHAR(20) NOT NULL DEFAULT 'movement'"),
    ("reverses_transaction_id", "INTEGER REFERENCES cash_transactions(id)"),
    ("operation_key", "VARCHAR(180)"),
)

PAYMENT_COLUMNS = (
    ("payment_reference", "VARCHAR(80)"),
    ("operation_key", "VARCHAR(180)"),
    ("cash_session_id", "INTEGER REFERENCES cash_sessions(id)"),
)

OLD_CASH_SESSIONS = """
CREATE TABLE {table} (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    opened_by INTEGER,
    opened_at DATETIME,
    closed_at DATETIME,
    opening_balance NUMERIC(18,2),
    closing_balance NUMERIC(18,2),
    expected_balance NUMERIC(18,2),
    difference NUMERIC(18,2),
    status VARCHAR(20),
    notes TEXT,
    FOREIGN KEY(opened_by) REFERENCES users(id)
)
"""

OLD_CASH_TRANSACTIONS = """
CREATE TABLE {table} (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    direction VARCHAR(10),
    amount NUMERIC(18,2),
    source VARCHAR(30),
    reference VARCHAR(100),
    description TEXT,
    created_at DATETIME,
    created_by INTEGER,
    FOREIGN KEY(session_id) REFERENCES cash_sessions(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
)
"""

OLD_PAYMENTS = """
CREATE TABLE {table} (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    document_type VARCHAR(30) NOT NULL,
    document_id INTEGER NOT NULL,
    amount NUMERIC(18,2),
    payment_mode VARCHAR(50),
    reference VARCHAR(120),
    notes TEXT,
    created_at DATETIME,
    created_by INTEGER,
    kind VARCHAR(20) NOT NULL DEFAULT 'payment',
    reverses_payment_id INTEGER,
    idempotency_key VARCHAR(128),
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(reverses_payment_id) REFERENCES payments(id)
)
"""

INDEXES = (
    "CREATE UNIQUE INDEX uq_cash_single_open ON cash_sessions(status) WHERE status='open'",
    "CREATE INDEX ix_cash_session_status ON cash_sessions(status)",
    "CREATE UNIQUE INDEX uq_cash_transaction_operation ON cash_transactions(operation_key)",
    "CREATE UNIQUE INDEX uq_cash_transaction_reversal ON cash_transactions(reverses_transaction_id)",
    "CREATE UNIQUE INDEX uq_cash_transaction_payment ON cash_transactions(payment_id)",
    "CREATE INDEX ix_cash_transaction_session ON cash_transactions(session_id)",
    "CREATE INDEX ix_cash_transaction_payment ON cash_transactions(payment_id)",
    "CREATE UNIQUE INDEX uq_payment_reference ON payments(payment_reference)",
    "CREATE UNIQUE INDEX uq_payment_operation ON payments(operation_key)",
    "CREATE UNIQUE INDEX uq_payment_reversal ON payments(reverses_payment_id)",
    "CREATE INDEX ix_payment_cash_session ON payments(cash_session_id)",
)


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _backfill_document_payments(connection: sqlite3.Connection, table: str, document_type: str) -> None:
    date_column = "date_time"
    rows = connection.execute(
        f"SELECT id,number,paid_amount,{date_column},created_by"
        + (",payment_mode" if table == "sales" else "")
        + f" FROM {table} WHERE coalesce(paid_amount,0)<>0 ORDER BY id"
    ).fetchall()
    for row in rows:
        document_id, number, paid_amount, created_at, created_by, *mode = row
        ledger = _money(connection.execute(
            "SELECT coalesce(sum(amount),0) FROM payments WHERE document_type=? AND document_id=?",
            (document_type, document_id),
        ).fetchone()[0])
        gap = _money(paid_amount) - ledger
        if gap == 0:
            continue
        original_mode = mode[0] if mode else "unknown"
        payment_reference = f"PAY-LEGACY-{document_type[0].upper()}-{int(document_id):08d}"
        operation_key = f"phase7:legacy:{document_type}:{document_id}"
        connection.execute(
            """
            INSERT INTO payments(
                document_type,document_id,amount,payment_mode,reference,notes,
                created_at,created_by,kind,reverses_payment_id,idempotency_key,
                payment_reference,operation_key,cash_session_id
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                document_type,
                document_id,
                str(gap),
                "legacy",
                number or "",
                f"Solde historique migre; mode original: {original_mode}",
                created_at or datetime.utcnow().isoformat(sep=" "),
                created_by,
                "payment" if gap > 0 else "reversal",
                None,
                "phase7-backfill",
                payment_reference,
                operation_key,
                None,
            ),
        )


def _sync_client_balances(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE phase7_client_balance_backup (
            client_id INTEGER PRIMARY KEY,
            credit_balance NUMERIC(18,2)
        )
        """
    )
    connection.execute(
        "INSERT INTO phase7_client_balance_backup(client_id,credit_balance) "
        "SELECT id,credit_balance FROM clients"
    )
    client_ids = [row[0] for row in connection.execute("SELECT id FROM clients").fetchall()]
    for client_id in client_ids:
        invoices = connection.execute(
            """
            SELECT id,total_amount FROM sales
            WHERE client_id=? AND doc_type='invoice'
              AND status IN ('confirmed','partially_paid','paid')
            """,
            (client_id,),
        ).fetchall()
        balance = Decimal("0")
        for sale_id, total_amount in invoices:
            paid = _money(connection.execute(
                "SELECT coalesce(sum(amount),0) FROM payments WHERE document_type='sale' AND document_id=?",
                (sale_id,),
            ).fetchone()[0])
            balance += max(_money(total_amount) - paid, Decimal("0"))
        connection.execute(
            "UPDATE clients SET credit_balance=? WHERE id=?",
            (str(balance.quantize(Decimal("0.01"))), client_id),
        )


def _backfill_expense_payments(connection: sqlite3.Connection) -> None:
    if connection.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='expenses'"
    ).fetchone()[0] == 0:
        return
    rows = connection.execute(
        "SELECT id,amount,payment_method,reference,date,user_id FROM expenses WHERE coalesce(amount,0)>0 ORDER BY id"
    ).fetchall()
    for expense_id, amount, payment_method, reference, created_at, created_by in rows:
        if connection.execute(
            "SELECT count(*) FROM payments WHERE document_type='expense' AND document_id=?",
            (expense_id,),
        ).fetchone()[0]:
            continue
        connection.execute(
            """
            INSERT INTO payments(
                document_type,document_id,amount,payment_mode,reference,notes,
                created_at,created_by,kind,reverses_payment_id,idempotency_key,
                payment_reference,operation_key,cash_session_id
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                "expense",
                expense_id,
                str(_money(amount)),
                "legacy",
                reference or f"EXP-{expense_id}",
                f"Depense historique migree; mode original: {payment_method or 'unknown'}",
                created_at or datetime.utcnow().isoformat(sep=" "),
                created_by,
                "payment",
                None,
                "phase7-backfill",
                f"PAY-LEGACY-E-{int(expense_id):08d}",
                f"phase7:legacy:expense:{expense_id}",
                None,
            ),
        )


def upgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        for name, definition in CASH_SESSION_COLUMNS:
            connection.execute(f"ALTER TABLE cash_sessions ADD COLUMN {name} {definition}")
        for name, definition in CASH_TRANSACTION_COLUMNS:
            connection.execute(f"ALTER TABLE cash_transactions ADD COLUMN {name} {definition}")
        for name, definition in PAYMENT_COLUMNS:
            connection.execute(f"ALTER TABLE payments ADD COLUMN {name} {definition}")

        connection.execute(
            """
            UPDATE cash_transactions
            SET kind='movement',
                operation_key='legacy:cash-transaction:' || id
            """
        )
        connection.execute(
            """
            UPDATE payments
            SET payment_reference='PAY-LEGACY-PMT-' || printf('%08d',id),
                operation_key='legacy:payment:' || id,
                payment_mode=CASE lower(trim(coalesce(payment_mode,'')))
                    WHEN 'espece' THEN 'cash'
                    WHEN 'espèce' THEN 'cash'
                    WHEN 'cash' THEN 'cash'
                    WHEN 'carte' THEN 'card'
                    WHEN 'card' THEN 'card'
                    WHEN 'virement' THEN 'bank'
                    WHEN 'bank' THEN 'bank'
                    WHEN 'cheque' THEN 'cheque'
                    WHEN 'chèque' THEN 'cheque'
                    WHEN 'credit' THEN 'credit'
                    WHEN 'crédit' THEN 'credit'
                    ELSE 'legacy'
                END
            """
        )
        _backfill_document_payments(connection, "sales", "sale")
        _backfill_document_payments(connection, "purchases", "purchase")
        _backfill_expense_payments(connection)
        _sync_client_balances(connection)

        for statement in INDEXES:
            connection.execute(statement)
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if errors:
            raise RuntimeError(f"Foreign key errors after phase7 migration: {errors[:5]}")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.close()


def _rebuild_table(connection, table: str, temporary: str, ddl: str, columns: str, where: str = "") -> None:
    connection.execute(f"DROP TABLE IF EXISTS {temporary}")
    connection.execute(ddl.format(table=temporary))
    connection.execute(
        f"INSERT INTO {temporary} ({columns}) SELECT {columns} FROM {table} {where}"
    )
    connection.execute(f"DROP TABLE {table}")
    connection.execute(f"ALTER TABLE {temporary} RENAME TO {table}")


def downgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='phase7_client_balance_backup'"
        ).fetchone()[0]:
            connection.execute(
                """
                UPDATE clients SET credit_balance=(
                    SELECT credit_balance FROM phase7_client_balance_backup
                    WHERE client_id=clients.id
                )
                WHERE id IN (SELECT client_id FROM phase7_client_balance_backup)
                """
            )
            connection.execute("DROP TABLE phase7_client_balance_backup")

        cash_tx_columns = (
            "id,session_id,direction,amount,source,reference,description,created_at,created_by"
        )
        _rebuild_table(
            connection,
            "cash_transactions",
            "__phase7_cash_transactions_old",
            OLD_CASH_TRANSACTIONS,
            cash_tx_columns,
        )
        payment_columns = (
            "id,document_type,document_id,amount,payment_mode,reference,notes,"
            "created_at,created_by,kind,reverses_payment_id,idempotency_key"
        )
        _rebuild_table(
            connection,
            "payments",
            "__phase7_payments_old",
            OLD_PAYMENTS,
            payment_columns,
            "WHERE operation_key IS NULL OR operation_key NOT LIKE 'phase7:legacy:%'",
        )
        cash_session_columns = (
            "id,opened_by,opened_at,closed_at,opening_balance,closing_balance,"
            "expected_balance,difference,status,notes"
        )
        _rebuild_table(
            connection,
            "cash_sessions",
            "__phase7_cash_sessions_old",
            OLD_CASH_SESSIONS,
            cash_session_columns,
        )
        connection.execute("CREATE INDEX ix_payments_doc ON payments(document_type,document_id)")
        connection.execute("CREATE INDEX ix_payments_created ON payments(created_at)")
        connection.execute("CREATE INDEX ix_payment_reversal ON payments(reverses_payment_id)")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if errors:
            raise RuntimeError(f"Foreign key errors after phase7 downgrade: {errors[:5]}")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("direction", choices=("up", "down"), nargs="?", default="up")
    parser.add_argument("--db", type=Path, default=DB_PATH)
    args = parser.parse_args()
    (upgrade if args.direction == "up" else downgrade)(args.db)
    print(f"phase7 {args.direction}: ok")
