"""Phase 6: source-linked stock movements, reversals, and inventory sessions."""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "proerp.db"

INVENTORY_SESSIONS = """
CREATE TABLE inventory_sessions (
    id INTEGER NOT NULL PRIMARY KEY,
    reference VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    warehouse_code VARCHAR(30) NOT NULL DEFAULT 'MAIN',
    notes TEXT,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME NOT NULL,
    counted_by INTEGER,
    counted_at DATETIME,
    validated_by INTEGER,
    validated_at DATETIME,
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(counted_by) REFERENCES users(id),
    FOREIGN KEY(validated_by) REFERENCES users(id)
)
"""

INVENTORY_LINES = """
CREATE TABLE inventory_count_lines (
    id INTEGER NOT NULL PRIMARY KEY,
    session_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    expected_qty NUMERIC(18,4) NOT NULL,
    counted_qty NUMERIC(18,4),
    difference NUMERIC(18,4),
    movement_id INTEGER,
    counted_by INTEGER,
    counted_at DATETIME,
    CONSTRAINT uq_inventory_session_product UNIQUE(session_id, product_id),
    FOREIGN KEY(session_id) REFERENCES inventory_sessions(id),
    FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(movement_id) REFERENCES stock_movements(id),
    FOREIGN KEY(counted_by) REFERENCES users(id)
)
"""

OLD_STOCK_MOVEMENTS = """
CREATE TABLE {table} (
    id INTEGER NOT NULL PRIMARY KEY,
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
)
"""

ADDED_COLUMNS = (
    ("warehouse_code", "VARCHAR(30) NOT NULL DEFAULT 'MAIN'"),
    ("source_type", "VARCHAR(30) NOT NULL DEFAULT 'legacy'"),
    ("source_id", "INTEGER"),
    ("source_line_id", "INTEGER"),
    ("operation_key", "VARCHAR(180)"),
    ("kind", "VARCHAR(20) NOT NULL DEFAULT 'movement'"),
    ("reverses_movement_id", "INTEGER REFERENCES stock_movements(id)"),
)

INDEXES = (
    "CREATE UNIQUE INDEX uq_stock_movement_operation ON stock_movements(operation_key)",
    "CREATE UNIQUE INDEX uq_stock_movement_reversal ON stock_movements(reverses_movement_id)",
    "CREATE INDEX ix_stock_source ON stock_movements(source_type,source_id)",
    "CREATE INDEX ix_stock_warehouse ON stock_movements(warehouse_code)",
    "CREATE INDEX ix_inventory_session_status ON inventory_sessions(status)",
    "CREATE INDEX ix_inventory_session_created ON inventory_sessions(created_at)",
    "CREATE INDEX ix_inventory_line_product ON inventory_count_lines(product_id)",
)


def upgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        for name, definition in ADDED_COLUMNS:
            connection.execute(f"ALTER TABLE stock_movements ADD COLUMN {name} {definition}")

        connection.execute(
            """
            UPDATE stock_movements
            SET warehouse_code='MAIN',
                source_type='legacy',
                operation_key='legacy:stock:' || id,
                kind=CASE WHEN reference LIKE 'CANCEL-%' THEN 'reversal' ELSE 'movement' END
            """
        )
        connection.execute(
            """
            UPDATE stock_movements
            SET source_type='sale',
                source_id=(SELECT sales.id FROM sales WHERE sales.number=stock_movements.reference)
            WHERE EXISTS(SELECT 1 FROM sales WHERE sales.number=stock_movements.reference)
            """
        )
        connection.execute(
            """
            UPDATE stock_movements
            SET source_type='sale',
                source_id=(SELECT sales.id FROM sales WHERE sales.number=substr(stock_movements.reference,8))
            WHERE reference LIKE 'CANCEL-%'
              AND EXISTS(SELECT 1 FROM sales WHERE sales.number=substr(stock_movements.reference,8))
            """
        )
        connection.execute(
            """
            UPDATE stock_movements
            SET source_type='purchase',
                source_id=(SELECT purchases.id FROM purchases WHERE purchases.number=stock_movements.reference)
            WHERE EXISTS(SELECT 1 FROM purchases WHERE purchases.number=stock_movements.reference)
            """
        )
        connection.execute(
            """
            UPDATE stock_movements
            SET source_type=CASE
                WHEN reference='IMPORT' THEN 'product_import'
                WHEN reference LIKE 'PRODUCT-%' THEN 'product'
                WHEN reference='MANUAL' THEN 'manual'
                ELSE source_type
            END,
            source_id=CASE
                WHEN reference LIKE 'PRODUCT-%' THEN product_id
                ELSE source_id
            END
            """
        )

        connection.execute(INVENTORY_SESSIONS)
        connection.execute(INVENTORY_LINES)
        for statement in INDEXES:
            connection.execute(statement)

        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if errors:
            raise RuntimeError(f"Foreign key errors after phase6 migration: {errors[:5]}")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.close()


def downgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=60)
    temporary = "__phase6_stock_movements_old"
    old_columns = (
        "id,product_id,movement_type,quantity,before_qty,after_qty,"
        "unit_cost,reference,notes,created_at,created_by"
    )
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DROP TABLE IF EXISTS inventory_count_lines")
        connection.execute("DROP TABLE IF EXISTS inventory_sessions")
        connection.execute(f"DROP TABLE IF EXISTS {temporary}")
        connection.execute(OLD_STOCK_MOVEMENTS.format(table=temporary))
        connection.execute(
            f"INSERT INTO {temporary} ({old_columns}) SELECT {old_columns} FROM stock_movements"
        )
        connection.execute("DROP TABLE stock_movements")
        connection.execute(f"ALTER TABLE {temporary} RENAME TO stock_movements")
        connection.execute("CREATE INDEX IF NOT EXISTS ix_stock_product ON stock_movements(product_id)")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if errors:
            raise RuntimeError(f"Foreign key errors after phase6 downgrade: {errors[:5]}")
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
    print(f"phase6 {args.direction}: ok")
