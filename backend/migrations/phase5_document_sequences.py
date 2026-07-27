"""Phase 5: transactional document sequences and permanent number allocations."""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime
import re
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "proerp.db"
NUMBER_PATTERN = re.compile(r"^(.*)-(\d{4})-(\d+)$")

CREATE_SEQUENCES = """
CREATE TABLE document_sequences (
    id INTEGER NOT NULL PRIMARY KEY,
    company_key VARCHAR(64) NOT NULL DEFAULT 'default',
    domain VARCHAR(20) NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    fiscal_year INTEGER NOT NULL,
    next_value INTEGER NOT NULL DEFAULT 1,
    last_value INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CONSTRAINT uq_document_sequence_scope
        UNIQUE(company_key, domain, document_type, fiscal_year)
)
"""

CREATE_ALLOCATIONS = """
CREATE TABLE document_number_allocations (
    id INTEGER NOT NULL PRIMARY KEY,
    sequence_id INTEGER NOT NULL,
    company_key VARCHAR(64) NOT NULL DEFAULT 'default',
    domain VARCHAR(20) NOT NULL,
    document_type VARCHAR(30) NOT NULL,
    fiscal_year INTEGER NOT NULL,
    prefix VARCHAR(20) NOT NULL,
    serial_number INTEGER,
    document_number VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'reserved',
    reason VARCHAR(120) NOT NULL DEFAULT 'allocated',
    document_id INTEGER,
    created_by INTEGER,
    allocated_at DATETIME NOT NULL,
    committed_at DATETIME,
    voided_at DATETIME,
    CONSTRAINT uq_document_allocation_number UNIQUE(domain, document_number),
    CONSTRAINT uq_document_allocation_serial
        UNIQUE(company_key, domain, document_type, fiscal_year, serial_number),
    FOREIGN KEY(sequence_id) REFERENCES document_sequences(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
)
"""

INDEXES = (
    "CREATE INDEX ix_document_sequence_scope ON document_sequences(company_key,domain,document_type,fiscal_year)",
    "CREATE INDEX ix_document_allocation_status ON document_number_allocations(status)",
    "CREATE INDEX ix_document_allocation_scope ON document_number_allocations(company_key,domain,document_type,fiscal_year)",
    "CREATE INDEX ix_document_allocation_document ON document_number_allocations(domain,document_id)",
)


def _year(value, fallback: int) -> int:
    try:
        return datetime.fromisoformat(str(value)).year
    except (TypeError, ValueError):
        return fallback


def _historical_documents(connection: sqlite3.Connection) -> list[dict]:
    documents: list[dict] = []
    for domain, table in (("sale", "sales"), ("purchase", "purchases")):
        rows = connection.execute(
            f"SELECT id, number, doc_type, date_time, created_at, created_by FROM {table} ORDER BY id"
        ).fetchall()
        for row in rows:
            document_id, number, document_type, date_time, created_at, created_by = row
            match = NUMBER_PATTERN.match(str(number or ""))
            fallback_year = _year(date_time, datetime.now().year)
            documents.append({
                "domain": domain,
                "document_id": document_id,
                "number": str(number or ""),
                "document_type": str(document_type or ("invoice" if domain == "sale" else "order")),
                "fiscal_year": int(match.group(2)) if match else fallback_year,
                "prefix": match.group(1)[:20] if match else "LEGACY",
                "serial": int(match.group(3)) if match else None,
                "allocated_at": created_at or date_time or datetime.utcnow().isoformat(sep=" "),
                "created_by": created_by,
            })
    return documents


def upgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(CREATE_SEQUENCES)
        connection.execute(CREATE_ALLOCATIONS)
        for statement in INDEXES:
            connection.execute(statement)

        documents = _historical_documents(connection)
        maxima: dict[tuple[str, str, int], int] = defaultdict(int)
        for document in documents:
            if document["serial"] is not None:
                scope = (document["domain"], document["document_type"], document["fiscal_year"])
                maxima[scope] = max(maxima[scope], document["serial"])
        for document in documents:
            scope = (document["domain"], document["document_type"], document["fiscal_year"])
            maxima.setdefault(scope, 0)

        sequence_ids: dict[tuple[str, str, int], int] = {}
        now = datetime.utcnow().isoformat(sep=" ")
        for scope, maximum in sorted(maxima.items()):
            domain, document_type, fiscal_year = scope
            cursor = connection.execute(
                """
                INSERT INTO document_sequences(
                    company_key,domain,document_type,fiscal_year,
                    next_value,last_value,created_at,updated_at
                ) VALUES('default',?,?,?,?,?,?,?)
                """,
                (domain, document_type, fiscal_year, maximum + 1, maximum, now, now),
            )
            sequence_ids[scope] = int(cursor.lastrowid)

        for document in documents:
            scope = (document["domain"], document["document_type"], document["fiscal_year"])
            connection.execute(
                """
                INSERT INTO document_number_allocations(
                    sequence_id,company_key,domain,document_type,fiscal_year,prefix,
                    serial_number,document_number,status,reason,document_id,created_by,
                    allocated_at,committed_at,voided_at
                ) VALUES(?,'default',?,?,?,?,?,?,'committed','legacy_backfill',?,?,?, ?,NULL)
                """,
                (
                    sequence_ids[scope],
                    document["domain"],
                    document["document_type"],
                    document["fiscal_year"],
                    document["prefix"],
                    document["serial"],
                    document["number"],
                    document["document_id"],
                    document["created_by"],
                    document["allocated_at"],
                    document["allocated_at"],
                ),
            )

        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if errors:
            raise RuntimeError(f"Foreign key errors after phase5 migration: {errors[:5]}")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.close()


def downgrade(db_path: Path = DB_PATH) -> None:
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DROP TABLE IF EXISTS document_number_allocations")
        connection.execute("DROP TABLE IF EXISTS document_sequences")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
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
    print(f"phase5 {args.direction}: ok")
