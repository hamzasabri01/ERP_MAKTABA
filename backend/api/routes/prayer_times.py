"""Prayer times for the local Berrechid store and Windows media focus controls."""
from __future__ import annotations

import json
import logging
import subprocess
import threading
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user

router = APIRouter()

TIMEZONE = ZoneInfo("Africa/Casablanca")
LATITUDE = 33.26553
LONGITUDE = -7.58754
METHOD = 21  # Morocco calculation method in AlAdhan.
PRAYERS = ("Fajr", "Dhuhr", "Asr", "Maghrib", "Isha")
CACHE_FILE = Path(__file__).resolve().parents[2] / ".runtime" / "prayer_times_cache.json"
_media_lock = threading.Lock()
_media_paused_by_app = False
logger = logging.getLogger(__name__)


def _clean_time(value: object) -> str:
    text = str(value or "").split(" ", 1)[0].strip()
    if len(text) != 5 or text[2] != ":":
        raise ValueError("invalid prayer time")
    hour, minute = text.split(":")
    if not (hour.isdigit() and minute.isdigit() and 0 <= int(hour) <= 23 and 0 <= int(minute) <= 59):
        raise ValueError("invalid prayer time")
    return f"{int(hour):02d}:{int(minute):02d}"


def _read_cache(day: str) -> dict | None:
    try:
        payload = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        return payload if payload.get("date") == day else None
    except (OSError, ValueError, TypeError):
        return None


def _write_cache(payload: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = CACHE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(CACHE_FILE)


def _fetch_today(now: datetime) -> dict:
    day = now.strftime("%d-%m-%Y")
    query = urllib.parse.urlencode({
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "method": METHOD,
        "school": 0,
    })
    url = f"https://api.aladhan.com/v1/timings/{day}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "Library-Sabri/1.0"})
    with urllib.request.urlopen(request, timeout=10) as response:
        external = json.loads(response.read().decode("utf-8"))
    if int(external.get("code") or 0) != 200:
        raise ValueError("prayer time provider returned an invalid response")
    data = external.get("data") or {}
    timings = data.get("timings") or {}
    selected = {name: _clean_time(timings.get(name)) for name in PRAYERS}
    payload = {
        "date": now.date().isoformat(),
        "city": "Berrechid",
        "city_ar": "برشيد",
        "timezone": "Africa/Casablanca",
        "calculation_method": "Morocco",
        "method_id": METHOD,
        "coordinates": {"latitude": LATITUDE, "longitude": LONGITUDE},
        "timings": selected,
        "hijri": (data.get("date") or {}).get("hijri", {}).get("date", ""),
        "fetched_at": now.isoformat(),
        "source": "AlAdhan API",
        "cached": False,
    }
    _write_cache(payload)
    return payload


@router.get("/today")
def today(user=Depends(get_current_user)):
    now = datetime.now(TIMEZONE)
    cached = _read_cache(now.date().isoformat())
    if cached:
        return {**cached, "cached": True, "server_now": now.isoformat()}
    try:
        payload = _fetch_today(now)
    except Exception as exc:
        logger.warning("Prayer times refresh failed: %s", exc)
        payload = _read_cache(now.date().isoformat())
        if not payload:
            raise HTTPException(status_code=503, detail="مواقيت الصلاة غير متاحة مؤقتاً ولا توجد نسخة محفوظة لهذا اليوم")
        payload = {**payload, "cached": True}
    return {**payload, "server_now": now.isoformat()}


def _send_media_play_pause() -> None:
    # Uses the standard Windows media key: compatible with Chrome/YouTube,
    # Spotify and most desktop media players, without installing a driver.
    script = (
        "$sig='[DllImport(\"user32.dll\")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo);';"
        "$t=Add-Type -MemberDefinition $sig -Name NativeMediaKeys -Namespace LibrarySabri -PassThru;"
        "$t::keybd_event(0xB3,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 60;"
        "$t::keybd_event(0xB3,0,2,[UIntPtr]::Zero)"
    )
    subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
        check=True,
        timeout=5,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


@router.post("/media/{action}")
def control_media(action: str, user=Depends(get_current_user)):
    global _media_paused_by_app
    if action not in {"pause", "resume"}:
        raise HTTPException(status_code=400, detail="Action média invalide")
    with _media_lock:
        if action == "pause" and not _media_paused_by_app:
            try:
                _send_media_play_pause()
                _media_paused_by_app = True
            except Exception as exc:
                raise HTTPException(status_code=503, detail="Impossible de suspendre les médias Windows") from exc
        elif action == "resume" and _media_paused_by_app:
            try:
                _send_media_play_pause()
            finally:
                _media_paused_by_app = False
    return {"ok": True, "action": action, "managed_pause": _media_paused_by_app}
