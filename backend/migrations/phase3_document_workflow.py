"""Phase 3 financial-document workflow migration (SQLite, reversible)."""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "proerp.db"


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def _add_column(connection: sqlite3.Connection, table: str, name: str, ddl: str) -> None:
    if name not in _columns(connection, table):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def upgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=30)
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("BEGIN IMMEDIATE")
        _add_column(connection, "sales", "version", "INTEGER NOT NULL DEFAULT 1")
        _add_column(connection, "purchases", "version", "INTEGER NOT NULL DEFAULT 1")
        _add_column(connection, "purchase_items", "received_quantity", "FLOAT NOT NULL DEFAULT 0")
        _add_column(connection, "payments", "kind", "VARCHAR(20) NOT NULL DEFAULT 'payment'")
        _add_column(connection, "payments", "reverses_payment_id", "INTEGER")
        _add_column(connection, "payments", "idempotency_key", "VARCHAR(128) DEFAULT ''")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS operation_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope VARCHAR(160) NOT NULL,
                idempotency_key VARCHAR(128) NOT NULL,
                request_hash VARCHAR(64) NOT NULL,
                created_by INTEGER REFERENCES users(id),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_operation_scope_key UNIQUE(scope, idempotency_key)
            )"""
        )
        connection.execute("CREATE INDEX IF NOT EXISTS ix_operation_created ON operation_keys(created_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS ix_payment_reversal ON payments(reverses_payment_id)")

        # Preserve every amount; only derive the richer state from existing totals.
        connection.execute(
            """UPDATE sales SET status='partially_paid'
               WHERE status='confirmed' AND paid_amount > 0 AND paid_amount < total_amount"""
        )
        connection.execute(
            """UPDATE sales SET status='paid'
               WHERE status='confirmed' AND total_amount > 0 AND paid_amount >= total_amount"""
        )
        connection.execute(
            """UPDATE purchase_items SET received_quantity=quantity
               WHERE purchase_id IN (SELECT id FROM purchases WHERE status='received')"""
        )
        connection.execute(
            """UPDATE purchases SET status='partially_paid'
               WHERE status='received' AND paid_amount > 0 AND paid_amount < total_amount"""
        )
        connection.execute(
            """UPDATE purchases SET status='paid'
               WHERE status='received' AND total_amount > 0 AND paid_amount >= total_amount"""
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def downgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=30)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("UPDATE sales SET status='confirmed' WHERE status='partially_paid'")
        connection.execute("UPDATE purchases SET status='received' WHERE status IN ('partially_received','partially_paid','paid')")
        connection.execute("DROP INDEX IF EXISTS ix_operation_created")
        connection.execute("DROP INDEX IF EXISTS ix_payment_reversal")
        connection.execute("DROP TABLE IF EXISTS operation_keys")
        for table, column in (
            ("payments", "idempotency_key"),
            ("payments", "reverses_payment_id"),
            ("payments", "kind"),
            ("purchase_items", "received_quantity"),
            ("purchases", "version"),
            ("sales", "version"),
        ):
            if column in _columns(connection, table):
                connection.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
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
    print(f"phase3 {args.direction}: ok")
