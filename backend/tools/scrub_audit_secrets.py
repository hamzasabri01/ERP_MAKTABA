"""Redact secrets in historical audit JSON and rebuild the integrity chain."""
from __future__ import annotations

import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from api.audit import compute_log_hash
from core.database import SessionLocal
from core.settings_store import redact_sensitive
from models.audit import AuditLog


def _scrub_json(raw: str) -> str:
    if not raw:
        return ""
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw
    return json.dumps(redact_sensitive(payload), ensure_ascii=False)


def scrub_audit_logs(db) -> tuple[int, int]:
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).all()
    previous_hash = ""
    changed = 0
    for row in rows:
        before_data = _scrub_json(row.before_data or "")
        after_data = _scrub_json(row.after_data or "")
        if before_data != (row.before_data or "") or after_data != (row.after_data or ""):
            changed += 1
        row.before_data = before_data
        row.after_data = after_data
        row.previous_hash = previous_hash
        row.log_hash = compute_log_hash(row, previous_hash)
        previous_hash = row.log_hash
    db.commit()
    return len(rows), changed


if __name__ == "__main__":
    session = SessionLocal()
    try:
        total, changed = scrub_audit_logs(session)
        print(f"AUDIT_ROWS_SCANNED={total}")
        print(f"AUDIT_ROWS_REDACTED={changed}")
        print("AUDIT_CHAIN_REBUILT=True")
    finally:
        session.close()
