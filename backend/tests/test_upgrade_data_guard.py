from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GUARD_PATH = ROOT / "scripts" / "upgrade_data_guard.py"
spec = importlib.util.spec_from_file_location("upgrade_data_guard", GUARD_PATH)
upgrade_data_guard = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(upgrade_data_guard)


class UpgradeDataGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.database = self.folder / "proerp.db"
        self.before = self.folder / "before.json"
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.executescript(
                """
                CREATE TABLE categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                CREATE TABLE products(
                    id INTEGER PRIMARY KEY,
                    category_id INTEGER REFERENCES categories(id),
                    name TEXT NOT NULL,
                    stock_quantity NUMERIC
                );
                CREATE TABLE sales(id INTEGER PRIMARY KEY, total_amount NUMERIC);
                INSERT INTO categories VALUES(1, 'Papeterie');
                INSERT INTO products VALUES(1, 1, 'Stylo', '12.500');
                INSERT INTO sales VALUES(1, '20.00');
                """
            )
            connection.commit()
        finally:
            connection.close()

        snapshot = upgrade_data_guard.snapshot(self.database)
        self.before.write_text(json.dumps(snapshot), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_verify_accepts_additive_schema_changes(self):
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("ALTER TABLE products ADD COLUMN updated_at TEXT")
            connection.execute("CREATE TABLE audit_logs(id INTEGER PRIMARY KEY)")
            connection.commit()
        finally:
            connection.close()

        result = upgrade_data_guard.verify(self.before, self.database)
        self.assertEqual(result["counts"]["products"], 1)
        self.assertEqual(result["business_totals"]["products"]["stock_quantity"], "12.5")

    def test_verify_rejects_deleted_rows(self):
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("DELETE FROM products")
            connection.commit()
        finally:
            connection.close()

        with self.assertRaisesRegex(RuntimeError, "decreased_counts"):
            upgrade_data_guard.verify(self.before, self.database)

    def test_verify_rejects_changed_business_totals(self):
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("UPDATE sales SET total_amount = '10.00'")
            connection.commit()
        finally:
            connection.close()

        with self.assertRaisesRegex(RuntimeError, "changed_business_totals"):
            upgrade_data_guard.verify(self.before, self.database)

    def test_backup_captures_committed_wal_data(self):
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("INSERT INTO products VALUES(2, 1, 'Cahier', '7.5')")
            connection.commit()
        finally:
            connection.close()

        destination = self.folder / "backup.db"
        upgrade_data_guard.backup(self.database, destination)
        backup_snapshot = upgrade_data_guard.snapshot(destination)
        self.assertEqual(backup_snapshot["counts"]["products"], 2)
        self.assertEqual(
            backup_snapshot["business_totals"]["products"]["stock_quantity"],
            "20",
        )


if __name__ == "__main__":
    unittest.main()
