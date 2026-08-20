"""Short-lived, local-only bridge between a phone camera and the POS."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import os
import re
import socket
import subprocess
import sys
import time
from threading import Event, Lock, Thread
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
_TUNNEL_OUT = Path(__file__).resolve().parents[3] / ".runtime" / "scanner-tunnel.out.log"
_TUNNEL_PID = Path(__file__).resolve().parents[3] / ".runtime" / "scanner-tunnel.pid"
_ROOT = Path(__file__).resolve().parents[3]
_CLOUDFLARED = _ROOT / "tools" / "cloudflared.exe"
_SESSION_STORE = Path(__file__).resolve().parents[3] / ".runtime" / "mobile-scanner-sessions.json"
_tunnel_lock = Lock()
_tunnel_stop = Event()
_tunnel_supervisor: Thread | None = None
_TUNNEL_FATAL_MARKERS = (
    "unauthorized: tunnel not found",
    "failed to request quick tunnel",
    "failed to create quick tunnel",
    "register tunnel error",
    "connection terminated",
)


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


def _read_public_scanner_url() -> str:
    """Return only the URL advertised by the current cloudflared process."""
    try:
        content = _TUNNEL_LOG.read_text(encoding="utf-8", errors="ignore")
        matches = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", content, flags=re.IGNORECASE)
        return matches[-1].rstrip("/") if matches else ""
    except OSError:
        return ""


def _cloudflared_path() -> Path | None:
    """Find cloudflared even when Windows PATH is not available to Task Scheduler."""
    candidates: list[Path] = []
    configured = os.environ.get("CLOUDFLARED_PATH", "").strip().strip('"')
    if configured:
        candidates.append(Path(configured))
    candidates.extend([
        _ROOT / "tools" / "cloudflared.exe",
        Path(__file__).resolve().parents[2] / "tools" / "cloudflared.exe",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "cloudflared" / "cloudflared.exe",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Cloudflare" / "cloudflared.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages" / "Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe" / "cloudflared.exe",
    ])
    for candidate in candidates:
        try:
            if candidate and candidate.is_file():
                return candidate
        except OSError:
            continue
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if not directory:
            continue
        candidate = Path(directory) / ("cloudflared.exe" if sys.platform == "win32" else "cloudflared")
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def _scanner_tunnel_target() -> str:
    configured = os.environ.get("SCANNER_TUNNEL_TARGET", "").strip()
    if configured:
        return configured.rstrip("/")
    port = os.environ.get("LIBRARY_SABRI_PORT", "").strip() or os.environ.get("PORT", "").strip() or "8015"
    if not port.isdigit():
        port = "8015"
    return f"http://127.0.0.1:{port}"


def _tunnel_process_alive() -> bool:
    try:
        pid = int(_TUNNEL_PID.read_text(encoding="ascii").strip())
        if pid <= 0:
            return False
        if sys.platform == "win32":
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=4,
                check=False,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            return result.returncode == 0 and f'"{pid}"' in result.stdout
        os.kill(pid, 0)
        return True
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def _tunnel_log_tail() -> str:
    try:
        # The end of the log is enough and avoids loading an ever-growing file.
        with _TUNNEL_LOG.open("rb") as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(max(0, size - 16_384), os.SEEK_SET)
            return stream.read().decode("utf-8", errors="ignore").lower()
    except OSError:
        return ""


def _tunnel_has_fatal_error() -> bool:
    tail = _tunnel_log_tail()
    last_registered = tail.rfind("registered tunnel connection")
    last_fatal = max((tail.rfind(marker) for marker in _TUNNEL_FATAL_MARKERS), default=-1)
    # An old transient error must not invalidate a later successful connection.
    return last_fatal > last_registered


def _tunnel_registered() -> bool:
    tail = _tunnel_log_tail()
    last_registered = tail.rfind("registered tunnel connection")
    last_fatal = max((tail.rfind(marker) for marker in _TUNNEL_FATAL_MARKERS), default=-1)
    return last_registered >= 0 and last_registered > last_fatal


def _public_scanner_url(timeout: float = 3.0) -> str:
    """Return a URL only when both its connector and public health endpoint work."""
    if not _tunnel_process_alive() or _tunnel_has_fatal_error():
        return ""
    url = _read_public_scanner_url()
    if not url:
        return ""
    try:
        with urlopen(f"{url}/health", timeout=timeout) as response:
            return url if response.status == 200 else ""
    except (OSError, URLError, TimeoutError):
        # Windows/ISP DNS can take a while to learn a brand-new Quick Tunnel.
        # Cloudflare's own registration line is authoritative during that gap.
        return url if _tunnel_registered() else ""


def _stop_managed_tunnel() -> None:
    """Stop only the connector previously launched by this application."""
    try:
        pid = int(_TUNNEL_PID.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        else:
            os.kill(pid, 15)
    except (OSError, subprocess.SubprocessError):
        pass
    _TUNNEL_PID.unlink(missing_ok=True)


def _restart_tunnel() -> bool:
    """Create a fresh Quick Tunnel and wait briefly for its public URL."""
    cloudflared = _cloudflared_path()
    if not cloudflared:
        return False
    with _tunnel_lock:
        existing = _public_scanner_url()
        if existing:
            return True
        _stop_managed_tunnel()
        _TUNNEL_LOG.parent.mkdir(parents=True, exist_ok=True)
        _TUNNEL_LOG.write_text("", encoding="utf-8")
        _TUNNEL_OUT.write_text("", encoding="utf-8")
        try:
            with _TUNNEL_OUT.open("ab") as stdout, _TUNNEL_LOG.open("ab") as stderr:
                creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
                process = subprocess.Popen(
                    [
                        str(cloudflared), "tunnel", "--protocol", "http2",
                        "--url", _scanner_tunnel_target(), "--no-autoupdate",
                    ],
                    stdout=stdout,
                    stderr=stderr,
                    creationflags=creationflags,
                )
            _TUNNEL_PID.write_text(str(process.pid), encoding="ascii")
        except OSError:
            return False
        # Quick Tunnels normally need a few seconds, but DNS can be slower just
        # after Windows resumes or the network reconnects.
        deadline = time.monotonic() + 32
        while time.monotonic() < deadline:
            if process.poll() is not None:
                return False
            url = _read_public_scanner_url()
            if url and _tunnel_registered():
                return True
            if url:
                try:
                    with urlopen(f"{url}/health", timeout=3) as response:
                        if response.status == 200:
                            return True
                except (OSError, URLError, TimeoutError):
                    pass
            if _tunnel_has_fatal_error():
                _stop_managed_tunnel()
                return False
            time.sleep(0.6)
        return False


def _available_public_scanner_url() -> str:
    url = _public_scanner_url()
    if url:
        return url
    _restart_tunnel()
    return _public_scanner_url()


def _tunnel_status_payload(start_if_missing: bool = False) -> dict:
    cloudflared = _cloudflared_path()
    public_url = _public_scanner_url(timeout=2)
    if start_if_missing and cloudflared and not public_url:
        _restart_tunnel()
        public_url = _public_scanner_url(timeout=2)
    return {
        "cloudflared_available": bool(cloudflared),
        "cloudflared_path": str(cloudflared) if cloudflared else "",
        "target": _scanner_tunnel_target(),
        "running": _tunnel_process_alive(),
        "registered": _tunnel_registered(),
        "public_url": public_url,
        "ready": bool(public_url),
    }


def _tunnel_supervisor_loop() -> None:
    """Replace expired Quick Tunnels without waiting for a scanner click."""
    failures = 0
    while not _tunnel_stop.is_set():
        if not _public_scanner_url(timeout=2):
            healthy = _restart_tunnel()
            failures = 0 if healthy else min(failures + 1, 6)
        else:
            failures = 0
        # Retry quickly after a network outage, then progressively back off.
        delay = 45 if failures == 0 else min(30 * (2 ** (failures - 1)), 300)
        _tunnel_stop.wait(delay)


def start_tunnel_supervisor() -> None:
    global _tunnel_supervisor
    if not _cloudflared_path() or (_tunnel_supervisor and _tunnel_supervisor.is_alive()):
        return
    _tunnel_stop.clear()
    _tunnel_supervisor = Thread(
        target=_tunnel_supervisor_loop,
        name="mobile-scanner-tunnel-supervisor",
        daemon=True,
    )
    _tunnel_supervisor.start()


def stop_tunnel_supervisor() -> None:
    _tunnel_stop.set()


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
        "public_url": _available_public_scanner_url(),
    }


@router.get("/status")
def mobile_scanner_status():
    return {"active_sessions": len(_sessions), **_tunnel_status_payload(start_if_missing=False)}


@router.get("/tunnel/status")
def tunnel_status():
    return _tunnel_status_payload(start_if_missing=False)


@router.get("/tunnel")
def ensure_tunnel():
    return _tunnel_status_payload(start_if_missing=True)


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
