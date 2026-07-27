from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from api.routes import auth
from api.schemas import FirebaseLoginRequest, PasswordChangeRequest
from core.database import Base
from core.request_security import client_ip
from core.security import (
    consume_recovery_code,
    create_refresh_token,
    decode_token,
    decrypt_mfa_secret,
    encrypt_mfa_secret,
    generate_recovery_codes,
    hash_password,
    hash_refresh_jti,
    validate_access_session,
    verify_password,
)
from migrations.phase2_auth_sessions import downgrade, upgrade
from models.audit import AuditLog
from models.auth_security import AuthRateLimitAttempt
from models.user import Role, User


def request_with_headers(headers: list[tuple[bytes, bytes]] | None = None, client: str = "127.0.0.1") -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers or [], "client": (client, 1234)})


class Phase2AuthTests(unittest.TestCase):
    def test_mfa_secret_encryption_round_trip(self):
        plain = "JBSWY3DPEHPK3PXP"
        encrypted = encrypt_mfa_secret(plain)
        self.assertTrue(encrypted.startswith("enc:v1:"))
        self.assertNotIn(plain, encrypted)
        self.assertEqual(plain, decrypt_mfa_secret(encrypted))

    def test_recovery_code_is_hash_only_and_single_use(self):
        codes, stored = generate_recovery_codes(2)
        self.assertNotIn(codes[0], stored)
        valid, remaining = consume_recovery_code(stored, codes[0])
        reused, _ = consume_recovery_code(remaining, codes[0])
        self.assertTrue(valid)
        self.assertFalse(reused)

    def test_session_version_revokes_old_access_token(self):
        with self.assertRaises(HTTPException):
            validate_access_session({"token_use": "access", "sv": 1}, SimpleNamespace(session_version=2))
        validate_access_session({"token_use": "access", "sv": 2}, SimpleNamespace(session_version=2))

    def test_refresh_rotation_rejects_previous_token(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        db = sessions()
        user = User(username="refresh-user", password_hash="unused", is_active=True, session_version=1)
        db.add(user)
        db.commit()
        old_token, _, old_jti = create_refresh_token(user.id, 1, "local", False)
        user.refresh_jti_hash = hash_refresh_jti(old_jti)
        db.commit()
        auth._validate_refresh_user(db, decode_token(old_token))
        _, _, new_jti = create_refresh_token(user.id, 1, "local", False)
        user.refresh_jti_hash = hash_refresh_jti(new_jti)
        db.commit()
        with self.assertRaises(HTTPException):
            auth._validate_refresh_user(db, decode_token(old_token))
        db.close()

    def test_password_change_requires_current_and_revokes_session(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        db = sessions()
        role = Role(name="admin-password", permissions="all")
        user = User(
            username="password-user",
            password_hash=hash_password("Current-Password-901"),
            is_active=True,
            session_version=1,
            role=role,
        )
        db.add(user)
        db.commit()
        with self.assertRaises(HTTPException) as raised:
            auth.change_password(
                PasswordChangeRequest(current_password="wrong", new_password="New-Password-902"),
                request_with_headers(), Response(), db, user,
            )
        self.assertEqual(401, raised.exception.status_code)
        self.assertTrue(verify_password("Current-Password-901", user.password_hash))
        result = auth.change_password(
            PasswordChangeRequest(current_password="Current-Password-901", new_password="New-Password-902"),
            request_with_headers(), Response(), db, user,
        )
        self.assertTrue(result.ok)
        self.assertTrue(verify_password("New-Password-902", user.password_hash))
        self.assertEqual(2, user.session_version)
        with self.assertRaises(HTTPException):
            validate_access_session({"token_use": "access", "sv": 1}, user)
        db.close()

    def test_forwarded_ip_requires_explicit_trusted_proxy(self):
        request = request_with_headers([(b"x-forwarded-for", b"203.0.113.7")])
        with patch.dict(os.environ, {"TRUST_PROXY_HEADERS": "false"}):
            self.assertEqual("127.0.0.1", client_ip(request))
        with patch.dict(os.environ, {"TRUST_PROXY_HEADERS": "true", "TRUSTED_PROXY_IPS": "127.0.0.1"}):
            self.assertEqual("203.0.113.7", client_ip(request))

    def test_csrf_bootstrap_and_cross_site_cookie_guard(self):
        request = request_with_headers([(b"cookie", b"proerp_csrf=csrf-probe")])
        self.assertEqual("csrf-probe", auth.csrf_token(request)["csrf_token"])
        with patch.dict(os.environ, {"COOKIE_SAMESITE": "none", "COOKIE_SECURE": "false"}):
            with self.assertRaises(RuntimeError):
                auth._cookie_samesite()
        with patch.dict(os.environ, {"COOKIE_SAMESITE": "none", "COOKIE_SECURE": "true"}):
            self.assertEqual("none", auth._cookie_samesite())

    def test_rate_limit_is_persistent_between_sessions(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        first = sessions()
        auth._register_failure(first, "login", "127.0.0.1:user")
        first.commit()
        first.close()
        second = sessions()
        with self.assertRaises(HTTPException) as raised:
            auth._enforce_rate_limit(second, "login", "127.0.0.1:user", 1)
        second.close()
        self.assertEqual(429, raised.exception.status_code)

    def test_firebase_login_obeys_existing_mfa_policy(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        db = sessions()
        role = Role(name="admin", permissions="all")
        user = User(
            username="firebase-user",
            password_hash="unused",
            email="firebase@example.test",
            is_active=True,
            mfa_enabled=True,
            mfa_secret=encrypt_mfa_secret("JBSWY3DPEHPK3PXP"),
            session_version=1,
            role=role,
        )
        db.add(user)
        db.commit()
        with patch.object(auth, "_verify_firebase_token", return_value={"email": user.email}):
            result = auth.firebase_login(
                FirebaseLoginRequest(id_token="mock"),
                request_with_headers(),
                Response(),
                db,
            )
        db.close()
        self.assertTrue(result.mfa_required)
        payload = decode_token(result.mfa_token)
        self.assertEqual("mfa", payload["token_use"])
        self.assertEqual("firebase", payload["auth_method"])

    def test_migration_upgrade_and_downgrade_preserve_mfa_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "auth.db"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, mfa_secret VARCHAR(64), mfa_enabled BOOLEAN)")
            db.execute("INSERT INTO users(id, mfa_secret, mfa_enabled) VALUES (1, ?, 1)", ("JBSWY3DPEHPK3PXP",))
            db.commit()
            db.close()

            result = upgrade(path)
            db = sqlite3.connect(path)
            encrypted = db.execute("SELECT mfa_secret FROM users WHERE id=1").fetchone()[0]
            columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
            db.close()
            self.assertEqual("upgraded", result["status"])
            self.assertNotEqual("JBSWY3DPEHPK3PXP", encrypted)
            self.assertEqual("JBSWY3DPEHPK3PXP", decrypt_mfa_secret(encrypted))
            self.assertIn("session_version", columns)

            downgrade(path)
            db = sqlite3.connect(path)
            restored = db.execute("SELECT mfa_secret FROM users WHERE id=1").fetchone()[0]
            columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
            db.close()
            self.assertEqual("JBSWY3DPEHPK3PXP", restored)
            self.assertNotIn("session_version", columns)


if __name__ == "__main__":
    unittest.main()
