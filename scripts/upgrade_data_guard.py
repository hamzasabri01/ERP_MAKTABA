"""Offline backup and integrity guard used by update-existing.ps1.

Uses only Python's standard library so it also works before dependencies are
updated. It never modifies the live database except for SQLite checkpointing
performed by the backup API itself.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


COUNT_TABLES = (
    "products", "categories", "suppliers", "clients", "users", "roles",
    "sales", "sale_items", "purchases", "purchase_items", "stock_movements",
    "expenses", "cash_sessions", "cash_transactions", "payments",
)


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path), timeout=60)
    connection.execute("PRAGMA busy_timeout=60000")
    return connection


def snapshot(path: Path) -> dict:
    if not path.is_file():
        raise RuntimeError(f"Database not found: {path}")
    with connect(path) as database:
        integrity = database.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise RuntimeError(f"Database integrity check failed: {integrity}")
        tables = {
            row[0]
            for row in database.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        counts = {
            table: database.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            for table in COUNT_TABLES
            if table in tables
        }
        product_stock = None
        if "products" in tables:
            columns = {
                row[1] for row in database.execute("PRAGMA table_info(products)")
            }
            if "stock_quantity" in columns:
                product_stock = database.execute(
                    "SELECT COALESCE(SUM(stock_quantity), 0) FROM products"
                ).fetchone()[0]
        return {
            "database": str(path.resolve()),
            "integrity": "ok",
            "counts": counts,
            "product_stock": str(product_stock) if product_stock is not None else None,
        }


def backup(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    with connect(source) as live, connect(destination) as copy:
        live.backup(copy, pages=256)
        copy.commit()
    snapshot(destination)


def verify(before_path: Path, database_path: Path) -> dict:
    before = json.loads(before_path.read_text(encoding="utf-8"))
    after = snapshot(database_path)
    missing = {}
    for table, expected in before.get("counts", {}).items():
        actual = after["counts"].get(table)
        if actual is None or actual < expected:
            missing[table] = {"before": expected, "after": actual}
    if missing:
        raise RuntimeError(
            "Data count decreased after update: " + json.dumps(missing, ensure_ascii=False)
        )
    return after


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("snapshot", "backup", "verify"))
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--before", type=Path)
    args = parser.parse_args()

    if args.action == "backup":
        if not args.output:
            parser.error("--output is required for backup")
        backup(args.database, args.output)
        result = snapshot(args.output)
    elif args.action == "verify":
        if not args.before:
            parser.error("--before is required for verify")
        result = verify(args.before, args.database)
    else:
        result = snapshot(args.database)

    # Keep the file human-readable in UTF-8, but never send raw non-ASCII paths
    # to the Windows console. Older/default Windows code pages (for example
    # cp1252) cannot encode Arabic user-profile names and used to abort an
    # otherwise successful backup with UnicodeEncodeError.
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.action == "snapshot" and args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
