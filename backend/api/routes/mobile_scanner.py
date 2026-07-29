"""Short-lived, local-only bridge between a phone camera and the POS."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import re
import socket
from threading import Lock
from urllib.request import urlopen
from urllib.error import URLError
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core.security import get_current_user


router = APIRouter()
_TTL = timedelta(hours=4)
_sessions: dict[str, dict] = {}
_lock = Lock()
_TUNNEL_LOG = Path(__file__).resolve().parents[3] / ".runtime" / "scanner-tunnel.err.log"
_SESSION_STORE = Path(__file__).resolve().parents[3] / ".runtime" / "mobile-scanner-sessions.json"


class ScanIn(BaseModel):
    barcode: str = Field(min_length=1, max_length=120)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_expired() -> None:
    limit = _now()
    for token in [key for key, value in _sessions.items() if value["expires_at"] <= limit]:
        _sessions.pop(token, None)


def _save_sessions_locked() -> None:
    _SESSION_STORE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        token: {
            **{key: value for key, value in session.items() if key not in {"events", "created_at", "expires_at"}},
            "created_at": session["created_at"].isoformat(),
            "expires_at": session["expires_at"].isoformat(),
            "events": list(session["events"]),
        }
        for token, session in _sessions.items()
    }
    temporary = _SESSION_STORE.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(_SESSION_STORE)


def _load_sessions() -> None:
    try:
        payload = json.loads(_SESSION_STORE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    for token, session in payload.items():
        try:
            session["created_at"] = datetime.fromisoformat(session["created_at"])
            session["expires_at"] = datetime.fromisoformat(session["expires_at"])
            session["events"] = deque(session.get("events", []), maxlen=100)
            if session["expires_at"] > _now():
                _sessions[token] = session
        except (KeyError, TypeError, ValueError):
            continue


def _session(token: str) -> dict:
    with _lock:
        _clean_expired()
        session = _sessions.get(token)
        if not session:
            raise HTTPException(status_code=404, detail="Session scanner expirée ou introuvable")
        return session


def _lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return str(sock.getsockname()[0])
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"
    finally:
        sock.close()


def _public_scanner_url() -> str:
    try:
        content = _TUNNEL_LOG.read_text(encoding="utf-8", errors="ignore")
        matches = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", content, flags=re.IGNORECASE)
        url = matches[-1].rstrip("/") if matches else ""
        if not url:
            return ""
        with urlopen(f"{url}/health", timeout=4) as response:
            return url if response.status == 200 else ""
    except (OSError, URLError, TimeoutError):
        return ""


@router.post("/sessions")
def create_session(request: Request, user=Depends(get_current_user)):
    token = uuid4().hex
    expires_at = _now() + _TTL
    with _lock:
        _clean_expired()
        _sessions[token] = {
            "user_id": user.id,
            "created_at": _now(),
            "expires_at": expires_at,
            "events": deque(maxlen=100),
            "sequence": 0,
            "connected": False,
        }
        _save_sessions_locked()
    return {
        "token": token,
        "expires_at": expires_at.isoformat(),
        "lan_ip": _lan_ip(),
        "request_port": request.url.port,
        "public_url": _public_scanner_url(),
    }


@router.get("/sessions/{token}")
def scanner_status(token: str):
    session = _session(token)
    with _lock:
        session["connected"] = True
        session["expires_at"] = _now() + _TTL
        _save_sessions_locked()
    return {"active": True, "expires_at": session["expires_at"].isoformat()}


@router.post("/sessions/{token}/scan")
def submit_scan(token: str, body: ScanIn):
    session = _session(token)
    barcode = body.barcode.strip()
    if not barcode:
        raise HTTPException(status_code=422, detail="Code-barres vide")
    with _lock:
        session["sequence"] += 1
        event = {
            "id": session["sequence"],
            "barcode": barcode,
            "scanned_at": _now().isoformat(),
        }
        session["events"].append(event)
        session["connected"] = True
        session["expires_at"] = _now() + _TTL
        _save_sessions_locked()
    return {"accepted": True, "event": event}


@router.get("/sessions/{token}/events")
def poll_events(token: str, after: int = 0, user=Depends(get_current_user)):
    session = _session(token)
    if session["user_id"] != user.id:
        raise HTTPException(status_code=403, detail="Cette session scanner appartient à un autre utilisateur")
    with _lock:
        events = [event for event in session["events"] if event["id"] > after]
        return {"events": events, "connected": session["connected"]}


@router.delete("/sessions/{token}")
def close_session(token: str, user=Depends(get_current_user)):
    session = _session(token)
    if session["user_id"] != user.id:
        raise HTTPException(status_code=403, detail="Accès refusé")
    with _lock:
        _sessions.pop(token, None)
        _save_sessions_locked()
    return {"closed": True}


_load_sessions()
