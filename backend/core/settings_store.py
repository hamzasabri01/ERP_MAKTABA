"""Centralized settings persistence with strict secret separation."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from core.config import BASE_DIR, env


SETTINGS_FILE = BASE_DIR / "company_settings.json"
SENSITIVE_FIELD_NAMES = {
    "password",
    "password_hash",
    "smtp_password",
    "secret",
    "secret_key",
    "mfa_secret",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "authorization",
    "passphrase",
    "api_key",
    "apikey",
}
SENSITIVE_KEY_PARTS = ("password", "secret", "token", "passphrase", "authorization", "api_key", "apikey")


def is_sensitive_key(key: Any) -> bool:
    normalized = str(key or "").strip().lower().replace("-", "_")
    return normalized in SENSITIVE_FIELD_NAMES or any(part in normalized for part in SENSITIVE_KEY_PARTS)


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if is_sensitive_key(key) else redact_sensitive(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_sensitive(item) for item in value)
    return value


def _read_raw(path: Path = SETTINGS_FILE) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def get_smtp_password(raw: dict | None = None) -> str:
    configured = env("SMTP_PASSWORD", "")
    if configured:
        return configured
    # Transitional fallback for old installations. The migration tool removes
    # this field after copying it to backend/.env without printing the value.
    source = _read_raw() if raw is None else raw
    legacy = source.get("smtp_password", "")
    return str(legacy or "")


def sanitize_for_storage(data: dict) -> dict:
    return {
        key: value
        for key, value in data.items()
        if not is_sensitive_key(key) and key != "smtp_password_configured"
    }


def public_settings(data: dict) -> dict:
    raw = dict(data or {})
    configured = bool(get_smtp_password(raw))
    public = sanitize_for_storage(raw)
    public["smtp_password_configured"] = configured
    return public


def load_settings(defaults: dict | None = None, *, include_secrets: bool = False, path: Path = SETTINGS_FILE) -> dict:
    raw = _read_raw(path)
    merged = {**(defaults or {}), **raw}
    if include_secrets:
        internal = sanitize_for_storage(merged)
        internal["smtp_password"] = get_smtp_password(raw)
        return internal
    return public_settings(merged)


def save_settings(data: dict, path: Path = SETTINGS_FILE) -> dict:
    safe = sanitize_for_storage(dict(data or {}))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(safe, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)
    return public_settings(safe)
