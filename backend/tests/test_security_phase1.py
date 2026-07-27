from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from api import audit
from api.routes import backups, products, settings
from core.security import build_content_security_policy, validate_runtime_security
from tools.migrate_smtp_secret import migrate
from tools.scrub_audit_secrets import _scrub_json


class Phase1SecurityTests(unittest.TestCase):
    def test_settings_response_never_contains_smtp_password(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "company_settings.json"
            settings_file.write_text(
                json.dumps({"name": "Test", "smtp_password": "do-not-return"}),
                encoding="utf-8",
            )
            with patch.object(settings, "SETTINGS_FILE", settings_file):
                payload = settings.get_settings(user=object())

        self.assertNotIn("smtp_password", payload)
        self.assertNotIn("do-not-return", json.dumps(payload))
        self.assertIn("smtp_password_configured", payload)

    def test_smtp_migration_removes_legacy_json_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            settings_file = root / "company_settings.json"
            env_file = root / ".env"
            settings_file.write_text(
                json.dumps({"company_name": "Test", "smtp_password": "migration-secret"}),
                encoding="utf-8",
            )

            self.assertEqual("migrated", migrate(settings_file, env_file))
            stored_settings = json.loads(settings_file.read_text(encoding="utf-8"))
            stored_env = env_file.read_text(encoding="utf-8")

        self.assertNotIn("smtp_password", stored_settings)
        self.assertIn("SMTP_PASSWORD=", stored_env)
        self.assertNotIn("migration-secret", json.dumps(stored_settings))

    def test_audit_dump_redacts_nested_secrets(self):
        payload = {
            "smtp_password": "top-secret",
            "nested": {"access_token": "token-value", "safe": "visible"},
            "items": [{"passphrase": "hidden"}],
        }
        dumped = audit._dump(payload)
        self.assertNotIn("top-secret", dumped)
        self.assertNotIn("token-value", dumped)
        self.assertNotIn("hidden", dumped)
        self.assertIn("visible", dumped)
        self.assertIn("[REDACTED]", dumped)

    def test_historical_audit_json_is_redacted(self):
        scrubbed = _scrub_json(json.dumps({"safe": "ok", "nested": {"secret_key": "legacy"}}))
        self.assertNotIn("legacy", scrubbed)
        self.assertIn("[REDACTED]", scrubbed)

    def test_sqlite_copy_includes_committed_wal_data(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_path = root / "source.db"
            destination = root / "snapshot.db"
            source = sqlite3.connect(source_path)
            source.execute("PRAGMA journal_mode=WAL")
            source.execute("CREATE TABLE first_table (id INTEGER PRIMARY KEY, value TEXT)")
            source.execute("INSERT INTO first_table(value) VALUES ('first')")
            source.commit()
            source.execute("CREATE TABLE wal_table (id INTEGER PRIMARY KEY, value TEXT)")
            source.execute("INSERT INTO wal_table(value) VALUES ('committed-in-wal')")
            source.commit()

            with patch.object(backups, "DB_PATH", source_path):
                backups._copy_sqlite_database(destination)

            restored = sqlite3.connect(destination)
            integrity = restored.execute("PRAGMA integrity_check").fetchone()[0]
            value = restored.execute("SELECT value FROM wal_table").fetchone()[0]
            restored.close()
            source.close()

        self.assertEqual("ok", integrity)
        self.assertEqual("committed-in-wal", value)

    def test_zip_slip_member_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            archive = root / "malicious.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("proerp.db", b"not-used")
                zf.writestr("../escape.txt", b"escape")
            with zipfile.ZipFile(archive) as zf:
                with self.assertRaises(HTTPException):
                    backups._safe_extract_backup(zf, root / "extract")

    def test_oversized_restore_stream_is_rejected(self):
        stream = io.BytesIO(b"x" * 17)
        with self.assertRaises(HTTPException):
            backups._copy_upload_limited(stream, io.BytesIO(), max_bytes=16)

    def test_image_magic_must_match_declared_type(self):
        with self.assertRaises(HTTPException):
            products._validate_image_content(b"<script>alert(1)</script>", "image/png")
        with self.assertRaises(HTTPException):
            products._validate_image_filename("payload.svg", "image/png")
        with self.assertRaises(HTTPException):
            products._validate_image_filename("payload.exe", "image/png")
        self.assertEqual(
            ".png",
            products._validate_image_content(b"\x89PNG\r\n\x1a\n" + b"0" * 32, "image/png"),
        )

    def test_production_rejects_default_or_short_secret(self):
        with self.assertRaises(RuntimeError):
            validate_runtime_security("production", "change-this-secret-before-production")
        with self.assertRaises(RuntimeError):
            validate_runtime_security("production", "short")
        validate_runtime_security("production", "A-secure-random-secret-value-with-40-chars")

    def test_csp_disallows_objects_and_external_default_sources(self):
        policy = build_content_security_policy(is_https=False)
        self.assertIn("default-src 'self'", policy)
        self.assertIn("object-src 'none'", policy)
        self.assertIn("frame-ancestors 'none'", policy)
        self.assertNotIn("upgrade-insecure-requests", policy)
        self.assertIn("upgrade-insecure-requests", build_content_security_policy(is_https=True))


if __name__ == "__main__":
    unittest.main()
