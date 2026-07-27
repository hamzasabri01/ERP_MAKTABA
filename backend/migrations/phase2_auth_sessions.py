"""Phase 2 authentication/session migration, reversible for SQLite.

Upgrade adds revocation and recovery fields, the persistent rate-limit table,
and encrypts existing MFA secrets without changing MFA state or passwords.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.database import DB_PATH
from core.security import decrypt_mfa_secret, encrypt_mfa_secret

MIGRATION_ID = "20260715_phase2_auth_sessions"
USER_COLUMNS = {
    "mfa_recovery_codes": "TEXT DEFAULT ''",
    "session_version": "INTEGER NOT NULL DEFAULT 1",
    "refresh_jti_hash": "VARCHAR(64) DEFAULT ''",
    "password_changed_at": "DATETIME",
}


def _columns(db: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def upgrade(db_path: Path = DB_PATH) -> dict:
    db = sqlite3.connect(db_path, timeout=30)
    encrypted = 0
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
        existing = _columns(db, "users")
        for name, ddl in USER_COLUMNS.items():
            if name not in existing:
                db.execute(f"ALTER TABLE users ADD COLUMN {name} {ddl}")
        db.execute("""
            CREATE TABLE IF NOT EXISTS auth_rate_limit_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope VARCHAR(32) NOT NULL,
                key_hash VARCHAR(64) NOT NULL,
                attempted_at DATETIME NOT NULL
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS ix_auth_rate_scope_key_time ON auth_rate_limit_attempts(scope, key_hash, attempted_at)")
        rows = db.execute("SELECT id, mfa_secret FROM users WHERE COALESCE(mfa_secret, '') <> ''").fetchall()
        for user_id, stored_secret in rows:
            secured = encrypt_mfa_secret(stored_secret)
            if secured != stored_secret:
                db.execute("UPDATE users SET mfa_secret=? WHERE id=?", (secured, user_id))
                encrypted += 1
        db.execute("UPDATE users SET session_version=1 WHERE session_version IS NULL OR session_version < 1")
        db.execute("INSERT OR REPLACE INTO schema_migrations(id, applied_at) VALUES (?, CURRENT_TIMESTAMP)", (MIGRATION_ID,))
        db.commit()
        return {"encrypted_mfa_secrets": encrypted, "status": "upgraded"}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def downgrade(db_path: Path = DB_PATH) -> dict:
    db = sqlite3.connect(db_path, timeout=30)
    decrypted = 0
    try:
        db.execute("BEGIN IMMEDIATE")
        rows = db.execute("SELECT id, mfa_secret FROM users WHERE COALESCE(mfa_secret, '') <> ''").fetchall()
        for user_id, stored_secret in rows:
            plain = decrypt_mfa_secret(stored_secret)
            if plain != stored_secret:
                db.execute("UPDATE users SET mfa_secret=? WHERE id=?", (plain, user_id))
                decrypted += 1
        db.execute("DROP TABLE IF EXISTS auth_rate_limit_attempts")
        existing = _columns(db, "users")
        for name in reversed(list(USER_COLUMNS)):
            if name in existing:
                db.execute(f"ALTER TABLE users DROP COLUMN {name}")
        if "schema_migrations" in {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
            db.execute("DELETE FROM schema_migrations WHERE id=?", (MIGRATION_ID,))
        db.commit()
        return {"decrypted_mfa_secrets": decrypted, "status": "downgraded"}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("upgrade", "downgrade"))
    parser.add_argument("--database", type=Path, default=DB_PATH)
    args = parser.parse_args()
    result = upgrade(args.database) if args.action == "upgrade" else downgrade(args.database)
    print(f"PHASE2_MIGRATION_STATUS={result['status']}")
    print(f"PHASE2_MFA_ROWS_TRANSFORMED={result.get('encrypted_mfa_secrets', result.get('decrypted_mfa_secrets', 0))}")
