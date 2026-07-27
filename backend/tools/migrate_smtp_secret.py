"""Move the legacy SMTP password from JSON settings to backend/.env safely.

The secret value is never written to stdout. Running the script repeatedly is
safe: an existing non-empty SMTP_PASSWORD environment entry is preserved.
"""
from __future__ import annotations

import json
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
SETTINGS_FILE = BASE_DIR / "company_settings.json"
ENV_FILE = BASE_DIR / ".env"


def _quoted_env(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\r", "").replace("\n", "")
    return f'"{escaped}"'


def _replace_env_value(content: str, key: str, value: str) -> tuple[str, bool]:
    lines = content.splitlines()
    prefix = f"{key}="
    for index, line in enumerate(lines):
        if line.strip().startswith(prefix):
            existing = line.split("=", 1)[1].strip().strip('"').strip("'")
            if existing:
                return content, False
            lines[index] = f"{key}={_quoted_env(value)}"
            return "\n".join(lines).rstrip() + "\n", True
    lines.append(f"{key}={_quoted_env(value)}")
    return "\n".join(lines).rstrip() + "\n", True


def migrate(settings_file: Path = SETTINGS_FILE, env_file: Path = ENV_FILE) -> str:
    if not settings_file.exists():
        return "settings_missing"
    try:
        settings = json.loads(settings_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "settings_invalid"
    if not isinstance(settings, dict):
        return "settings_invalid"

    secret = str(settings.get("smtp_password") or "")
    if not secret:
        settings.pop("smtp_password", None)
        return "no_legacy_secret"

    current_env = env_file.read_text(encoding="utf-8") if env_file.exists() else ""
    next_env, changed = _replace_env_value(current_env, "SMTP_PASSWORD", secret)
    if changed:
        env_tmp = env_file.with_suffix(env_file.suffix + ".tmp")
        env_tmp.write_text(next_env, encoding="utf-8")
        os.replace(env_tmp, env_file)

    settings.pop("smtp_password", None)
    settings_tmp = settings_file.with_suffix(settings_file.suffix + ".tmp")
    settings_tmp.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(settings_tmp, settings_file)
    return "migrated" if changed else "environment_already_configured"


if __name__ == "__main__":
    print(f"SMTP_SECRET_MIGRATION={migrate()}")
