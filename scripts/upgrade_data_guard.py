"""Offline backup and integrity guard used by update-existing.ps1.

Uses only Python's standard library so it also works before dependencies are
updated. Read operations use SQLite's read-only mode; the live database is
never changed by this module.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


# These are deliberately limited to durable business facts. Derived balances,
# sequence counters and migration/backfill columns are not suitable guards:
# an additive migration may legitimately initialise them. A metric is captured
# only when both its table and column already exist in the pre-upgrade schema.
BUSINESS_TOTAL_COLUMNS = {
    "products": ("stock_quantity",),
    "sales": ("total_amount",),
    "sale_items": ("quantity",),
    "purchases": ("total_amount",),
    "purchase_items": ("quantity",),
    "stock_movements": ("quantity",),
    "expenses": ("amount",),
    "cash_transactions": ("amount",),
    "payments": ("amount",),
    "print_jobs": ("quantity", "total_amount"),
    "product_bundle_components": ("quantity",),
}


def connect(path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    if read_only:
        # Path.as_uri() also quotes spaces, non-ASCII characters, ``?`` and
        # ``#`` correctly for SQLite's URI parser on Windows and Unix.
        uri = path.resolve().as_uri() + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=60)
        connection.execute("PRAGMA query_only=ON")
    else:
        connection = sqlite3.connect(str(path), timeout=60)
    connection.execute("PRAGMA busy_timeout=60000")
    return connection


def _quoted(identifier: str) -> str:
    """Return a safely quoted SQLite identifier discovered from the schema."""

    return '"' + identifier.replace('"', '""') + '"'


def _user_tables(database: sqlite3.Connection) -> list[str]:
    """Return every user-created table, excluding SQLite internal tables."""

    return [
        row[0]
        for row in database.execute(
            """SELECT name
                 FROM sqlite_schema
                WHERE type = 'table'
                  AND substr(name, 1, 7) <> 'sqlite_'
                ORDER BY name"""
        ).fetchall()
    ]


def _columns(database: sqlite3.Connection, table: str) -> set[str]:
    return {
        row[1]
        for row in database.execute(
            f"PRAGMA table_info({_quoted(table)})"
        ).fetchall()
    }


def _decimal(value: Any, table: str, column: str) -> Decimal:
    if value is None:
        return Decimal(0)
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise RuntimeError(
            f"Non-numeric value in guarded business total {table}.{column}: "
            f"{value!r}"
        ) from error
    if not number.is_finite():
        raise RuntimeError(
            f"Non-finite value in guarded business total {table}.{column}: "
            f"{value!r}"
        )
    return number


def _decimal_text(number: Decimal) -> str:
    """Canonicalise a total so harmless SQLite type changes compare equally."""

    if not number.is_finite():
        raise RuntimeError("A guarded business total must be finite")
    if number == 0:
        return "0"
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _column_total(
    database: sqlite3.Connection, table: str, column: str
) -> str:
    # Sum row-by-row with Decimal. SQLite's SUM changes to binary floating
    # point as soon as it sees a REAL, which can make a type-only migration
    # appear to have changed a monetary total.
    query = f"SELECT {_quoted(column)} FROM {_quoted(table)}"
    with localcontext() as context:
        # This comfortably exceeds SQLite's exact INTEGER range even when a
        # very large table is summed, and avoids Decimal's default 28-digit
        # rounding silently weakening the guard.
        context.prec = 1000
        total = Decimal(0)
        for (value,) in database.execute(query):
            total += _decimal(value, table, column)
    return _decimal_text(total)


def _integrity_check(database: sqlite3.Connection) -> None:
    results = [row[0] for row in database.execute("PRAGMA integrity_check")]
    if results != ["ok"]:
        raise RuntimeError(
            "Database integrity check failed: "
            + json.dumps(results, ensure_ascii=False)
        )


def _foreign_key_check(database: sqlite3.Connection) -> None:
    violations = [
        {
            "table": row[0],
            "rowid": row[1],
            "parent": row[2],
            "foreign_key": row[3],
        }
        for row in database.execute("PRAGMA foreign_key_check")
    ]
    if violations:
        raise RuntimeError(
            "Database foreign key check failed: "
            + json.dumps(violations, ensure_ascii=False)
        )


def snapshot(path: Path) -> dict:
    if not path.is_file():
        raise RuntimeError(f"Database not found: {path}")
    with closing(connect(path, read_only=True)) as database:
        # Pin all reads to one SQLite snapshot if another process is still
        # winding down while the updater starts its checks.
        database.execute("BEGIN")
        _integrity_check(database)
        _foreign_key_check(database)

        tables = _user_tables(database)
        counts = {
            table: database.execute(
                f"SELECT COUNT(*) FROM {_quoted(table)}"
            ).fetchone()[0]
            for table in tables
        }
        table_set = set(tables)
        business_totals: dict[str, dict[str, str]] = {}
        for table, guarded_columns in BUSINESS_TOTAL_COLUMNS.items():
            if table not in table_set:
                continue
            existing_columns = _columns(database, table)
            totals = {
                column: _column_total(database, table, column)
                for column in guarded_columns
                if column in existing_columns
            }
            if totals:
                business_totals[table] = totals

        # ``product_stock`` is retained for consumers of snapshots produced by
        # older versions of this CLI. The authoritative representation is now
        # the extensible business_totals mapping.
        product_stock = business_totals.get("products", {}).get("stock_quantity")
        return {
            "database": str(path.resolve()),
            "integrity": "ok",
            "foreign_keys": "ok",
            "counts": counts,
            "business_totals": business_totals,
            "product_stock": product_stock,
        }


def _same_file(source: Path, destination: Path) -> bool:
    if source.resolve() == destination.resolve():
        return True
    return source.exists() and destination.exists() and source.samefile(destination)


def _is_live_database_artifact(database: Path, candidate: Path) -> bool:
    """Protect the main database and its SQLite journal/WAL sidecars."""

    resolved_database = database.resolve()
    live_files = [resolved_database]
    live_files.extend(
        Path(str(resolved_database) + suffix)
        for suffix in ("-wal", "-shm", "-journal")
    )
    return any(_same_file(live_file, candidate) for live_file in live_files)


def backup(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise RuntimeError(f"Database not found: {source}")
    if _is_live_database_artifact(source, destination):
        raise RuntimeError("Backup destination must differ from the live database")

    # Validate before touching an existing destination. This also ensures the
    # source is readable before the old backup is replaced.
    snapshot(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with closing(connect(source, read_only=True)) as live, closing(
            connect(temporary_path)
        ) as copy:
            live.backup(copy, pages=256)
            copy.commit()
        snapshot(temporary_path)
        # os.replace semantics through Path.replace are atomic on the same
        # filesystem. A failed copy therefore never leaves a partial backup at
        # the path update-existing.ps1 may use for automatic restoration.
        temporary_path.replace(destination)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def _before_counts(before: dict) -> dict[str, int]:
    counts = before.get("counts")
    if not isinstance(counts, dict):
        raise RuntimeError("Invalid pre-upgrade snapshot: counts must be an object")
    validated: dict[str, int] = {}
    for table, count in counts.items():
        if not isinstance(table, str) or isinstance(count, bool) or not isinstance(count, int):
            raise RuntimeError("Invalid pre-upgrade snapshot: malformed table count")
        if count < 0:
            raise RuntimeError("Invalid pre-upgrade snapshot: negative table count")
        validated[table] = count
    return validated


def _before_totals(before: dict) -> dict[str, dict[str, str]]:
    totals = before.get("business_totals", {})
    if not isinstance(totals, dict):
        raise RuntimeError(
            "Invalid pre-upgrade snapshot: business_totals must be an object"
        )
    validated: dict[str, dict[str, str]] = {}
    for table, columns in totals.items():
        if not isinstance(table, str) or not isinstance(columns, dict):
            raise RuntimeError("Invalid pre-upgrade snapshot: malformed business total")
        validated[table] = {}
        for column, value in columns.items():
            if not isinstance(column, str):
                raise RuntimeError("Invalid pre-upgrade snapshot: malformed total column")
            try:
                canonical = _decimal_text(Decimal(str(value)))
            except (InvalidOperation, ValueError) as error:
                raise RuntimeError(
                    "Invalid pre-upgrade snapshot: malformed business total value"
                ) from error
            validated[table][column] = canonical

    # Accept snapshots from the previous CLI format as well. A missing legacy
    # value means the old database did not have the products.stock_quantity
    # metric, so there is nothing to compare.
    if (
        before.get("product_stock") is not None
        and "stock_quantity" not in validated.get("products", {})
    ):
        try:
            stock = _decimal_text(Decimal(str(before["product_stock"])))
        except (InvalidOperation, ValueError) as error:
            raise RuntimeError(
                "Invalid pre-upgrade snapshot: malformed product_stock"
            ) from error
        validated.setdefault("products", {})["stock_quantity"] = stock
    return validated


def verify(before_path: Path, database_path: Path) -> dict:
    try:
        before = json.loads(before_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cannot read pre-upgrade snapshot: {before_path}") from error
    if not isinstance(before, dict):
        raise RuntimeError("Invalid pre-upgrade snapshot: root must be an object")

    before_counts = _before_counts(before)
    before_totals = _before_totals(before)
    after = snapshot(database_path)

    missing_tables = sorted(set(before_counts) - set(after["counts"]))
    decreased_counts = {
        table: {"before": expected, "after": after["counts"][table]}
        for table, expected in before_counts.items()
        if table in after["counts"] and after["counts"][table] < expected
    }

    changed_totals: dict[str, dict[str, dict[str, str | None]]] = {}
    for table, columns in before_totals.items():
        for column, expected in columns.items():
            actual = after["business_totals"].get(table, {}).get(column)
            if actual is None or Decimal(actual) != Decimal(expected):
                changed_totals.setdefault(table, {})[column] = {
                    "before": expected,
                    "after": actual,
                }

    problems: dict[str, Any] = {}
    if missing_tables:
        problems["missing_tables"] = missing_tables
    if decreased_counts:
        problems["decreased_counts"] = decreased_counts
    if changed_totals:
        problems["changed_business_totals"] = changed_totals
    if problems:
        raise RuntimeError(
            "Data verification failed after update: "
            + json.dumps(problems, ensure_ascii=False, sort_keys=True)
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
        if args.output and _is_live_database_artifact(args.database, args.output):
            parser.error("--output must differ from the live database")
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
