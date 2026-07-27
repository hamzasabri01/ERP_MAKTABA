"""Interactive, local-only recovery for an existing administrator account.

The password is read with getpass and never accepted as a command-line value.
No action occurs without --execute and an exact username confirmation.
"""
from __future__ import annotations

import argparse
from datetime import datetime
from getpass import getpass
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from api.audit import log_action
from api.routes.backups import create_backup
from core.database import SessionLocal
from core.security import hash_password, validate_password_strength
from models.user import User


def recover(username: str, *, reset_mfa: bool, reactivate: bool, execute: bool) -> str:
    if not execute:
        return "dry_run"
    confirmation = input(f"Type the administrator username '{username}' to confirm: ").strip()
    if confirmation != username:
        return "confirmation_failed"
    password = getpass("New administrator password: ")
    repeated = getpass("Repeat new administrator password: ")
    if password != repeated:
        return "password_mismatch"
    validate_password_strength(password, username)

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user or not user.role or "all" not in {value.strip() for value in (user.role.permissions or "").split(",")}:
            return "administrator_not_found"
        create_backup(f"before-admin-recovery:user:{user.id}")
        user.password_hash = hash_password(password)
        user.password_changed_at = datetime.utcnow()
        user.session_version = int(user.session_version or 1) + 1
        user.refresh_jti_hash = ""
        if reactivate:
            user.is_active = True
        if reset_mfa:
            user.mfa_enabled = False
            user.mfa_secret = ""
            user.mfa_recovery_codes = ""
        log_action(
            db,
            None,
            "admin_recovery",
            "user",
            user.id,
            "Recuperation administrateur locale executee",
            after={"username": user.username, "mfa_reset": reset_mfa, "reactivated": reactivate},
        )
        db.commit()
        return "recovered"
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recover an existing ProERP administrator locally")
    parser.add_argument("--username", required=True)
    parser.add_argument("--reset-mfa", action="store_true", help="Explicitly disable MFA when all factors are lost")
    parser.add_argument("--reactivate", action="store_true", help="Explicitly reactivate a disabled administrator")
    parser.add_argument("--execute", action="store_true", help="Required before any data change")
    args = parser.parse_args()
    print(f"ADMIN_RECOVERY_STATUS={recover(args.username, reset_mfa=args.reset_mfa, reactivate=args.reactivate, execute=args.execute)}")
