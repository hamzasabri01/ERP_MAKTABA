from __future__ import annotations

import json
import hashlib
from datetime import date, datetime
from typing import Any

from models.audit import AuditLog
from core.settings_store import redact_sensitive
from core.request_security import client_ip


def _json_default(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _dump(data: Any) -> str:
    if data in (None, ""):
        return ""
    try:
        return json.dumps(redact_sensitive(data), ensure_ascii=False, default=_json_default)
    except TypeError:
        return json.dumps(str(data), ensure_ascii=False)


def _hash_payload(*parts: Any) -> str:
    payload = "|".join(str(part or "") for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _request_meta(request) -> tuple[str, str]:
    if not request:
        return "", ""
    ip = client_ip(request)
    user_agent = request.headers.get("user-agent", "")
    return ip[:80], user_agent[:300]


def log_action(db, user, action: str, entity: str, entity_id: Any = "", summary: str = "", before=None, after=None, request=None) -> None:
    try:
        created_at = datetime.utcnow()
        before_dump = _dump(before)
        after_dump = _dump(after)
        ip_address, user_agent = _request_meta(request)
        previous = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
        previous_hash = previous.log_hash if previous and previous.log_hash else ""
        log_hash = _hash_payload(
            previous_hash, action, entity, entity_id, summary, before_dump, after_dump,
            getattr(user, "id", None), created_at.isoformat(), ip_address, user_agent,
        )
        db.add(AuditLog(
            action=action,
            entity=entity,
            entity_id=str(entity_id or ""),
            summary=summary[:300] if summary else "",
            before_data=before_dump,
            after_data=after_dump,
            ip_address=ip_address,
            user_agent=user_agent,
            previous_hash=previous_hash,
            log_hash=log_hash,
            created_at=created_at,
            created_by=getattr(user, "id", None),
        ))
    except Exception:
        pass


def compute_log_hash(row: AuditLog, previous_hash: str = "") -> str:
    return _hash_payload(
        previous_hash,
        row.action,
        row.entity,
        row.entity_id or "",
        row.summary or "",
        row.before_data or "",
        row.after_data or "",
        row.created_by,
        row.created_at.isoformat() if row.created_at else "",
        row.ip_address or "",
        row.user_agent or "",
    )


def model_snapshot(obj, fields: list[str]) -> dict:
    if not obj:
        return {}
    return {field: getattr(obj, field, None) for field in fields}
