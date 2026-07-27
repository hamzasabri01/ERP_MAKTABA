"""Database backup and restore endpoints."""
from __future__ import annotations

import os
import base64
import hashlib
import json
import shutil
import sqlite3
import stat
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from fastapi.responses import FileResponse
from cryptography.fernet import Fernet, InvalidToken

from core.config import BASE_DIR, env_int
from core.database import DB_PATH, engine, get_db
from core.security import get_current_user
from core.settings_store import save_settings
from api.audit import log_action
from sqlalchemy.orm import Session

router = APIRouter()

BACKUP_DIR = BASE_DIR / "backups"
SETTINGS_FILE = BASE_DIR / "company_settings.json"
UPLOADS_DIR = BASE_DIR / "uploads"
MAX_BACKUPS = 30
ENC_MAGIC = b"PROERP-ENC-v1\n"
MAX_RESTORE_BYTES = env_int("MAX_RESTORE_BYTES", 512 * 1024 * 1024)
MAX_ARCHIVE_MEMBERS = env_int("MAX_ARCHIVE_MEMBERS", 10000)
MAX_UNCOMPRESSED_BYTES = env_int("MAX_UNCOMPRESSED_BYTES", 2 * 1024 * 1024 * 1024)
MAX_MEMBER_BYTES = env_int("MAX_BACKUP_MEMBER_BYTES", 1024 * 1024 * 1024)
MAX_COMPRESSION_RATIO = 200
ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
REQUIRED_DATABASE_TABLES = {"users", "roles", "products", "sales", "sale_items"}


class EncryptedBackupRequest(BaseModel):
    passphrase: str


class EncryptedRestoreRequest(BaseModel):
    name: str
    passphrase: str


def _ensure_dir() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _safe_backup_name() -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"proerp-backup-{stamp}.zip"


def _safe_encrypted_backup_name() -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"proerp-backup-{stamp}.erpenc"


def _backup_path(name: str) -> Path:
    if not (name.endswith(".zip") or name.endswith(".erpenc")) or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Nom de sauvegarde invalide")
    path = (BACKUP_DIR / name).resolve()
    if BACKUP_DIR.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="Nom de sauvegarde invalide")
    return path


def _copy_sqlite_database(destination: Path) -> None:
    source = sqlite3.connect(str(DB_PATH), timeout=30)
    target = sqlite3.connect(str(destination), timeout=30)
    try:
        source.backup(target)
        target.commit()
    finally:
        target.close()
        source.close()


def _copy_upload_limited(source, target, *, max_bytes: int = MAX_RESTORE_BYTES) -> int:
    total = 0
    while True:
        chunk = source.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Fichier de sauvegarde trop volumineux")
        target.write(chunk)
    return total


def _validated_archive_path(info: zipfile.ZipInfo, destination: Path) -> Path:
    name = info.filename
    if not name or "\x00" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: chemin interdit")
    member = PurePosixPath(name)
    if member.is_absolute() or ".." in member.parts:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: chemin interdit")
    mode = info.external_attr >> 16
    if mode and stat.S_ISLNK(mode):
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: liens symboliques interdits")

    is_directory = info.is_dir()
    allowed_root = name in {"proerp.db", "company_settings.json", "metadata.txt"}
    allowed_upload = member.parts and member.parts[0] == "uploads"
    if not allowed_root and not allowed_upload:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: contenu non autorise")
    if allowed_upload and not is_directory and member.suffix.lower() not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: type de fichier upload interdit")
    if info.file_size > MAX_MEMBER_BYTES:
        raise HTTPException(status_code=413, detail="Sauvegarde invalide: membre trop volumineux")
    if info.compress_size > 0 and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: taux de compression suspect")

    resolved = (destination / Path(*member.parts)).resolve()
    root = destination.resolve()
    if resolved != root and root not in resolved.parents:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: chemin interdit")
    return resolved


def _safe_extract_backup(zf: zipfile.ZipFile, destination: Path) -> Path:
    members = zf.infolist()
    if not members or len(members) > MAX_ARCHIVE_MEMBERS:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: nombre de fichiers interdit")
    if sum(info.file_size for info in members) > MAX_UNCOMPRESSED_BYTES:
        raise HTTPException(status_code=413, detail="Sauvegarde decompressee trop volumineuse")
    if sum(1 for info in members if info.filename == "proerp.db") != 1:
        raise HTTPException(status_code=400, detail="Sauvegarde invalide: proerp.db manquant ou duplique")

    destination.mkdir(parents=True, exist_ok=True)
    validated = [(info, _validated_archive_path(info, destination)) for info in members]
    for info, target in validated:
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info, "r") as source, target.open("wb") as output:
            _copy_upload_limited(source, output, max_bytes=MAX_MEMBER_BYTES)
    return destination


def _validate_restored_database(path: Path) -> None:
    connection = None
    try:
        connection = sqlite3.connect(str(path))
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
    except sqlite3.Error:
        raise HTTPException(status_code=400, detail="Base de donnees invalide")
    finally:
        if connection is not None:
            connection.close()
    if not integrity or integrity[0] != "ok" or not REQUIRED_DATABASE_TABLES.issubset(tables):
        raise HTTPException(status_code=400, detail="Base de donnees invalide")


def _restore_optional_files(extracted: Path) -> None:
    settings_restore = extracted / "company_settings.json"
    if settings_restore.exists():
        try:
            payload = json.loads(settings_restore.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise HTTPException(status_code=400, detail="Parametres de sauvegarde invalides")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Parametres de sauvegarde invalides")
        save_settings(payload, path=SETTINGS_FILE)

    uploads_restore = extracted / "uploads"
    if uploads_restore.exists():
        if UPLOADS_DIR.exists():
            shutil.rmtree(UPLOADS_DIR)
        shutil.copytree(uploads_restore, UPLOADS_DIR)
    else:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _prune_old_backups() -> None:
    backups = sorted(list(BACKUP_DIR.glob("proerp-backup-*.zip")) + list(BACKUP_DIR.glob("proerp-backup-*.erpenc")), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in backups[MAX_BACKUPS:]:
        try:
            old.unlink()
        except OSError:
            pass


def create_backup(reason: str = "manual") -> Path:
    _ensure_dir()
    target = BACKUP_DIR / _safe_backup_name()
    db_copy = BACKUP_DIR / f".tmp-proerp-{uuid4().hex}.db"
    try:
        _copy_sqlite_database(db_copy)
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(db_copy, "proerp.db")
            if SETTINGS_FILE.exists():
                zf.write(SETTINGS_FILE, "company_settings.json")
            if UPLOADS_DIR.exists():
                for file in UPLOADS_DIR.rglob("*"):
                    if file.is_file():
                        zf.write(file, Path("uploads") / file.relative_to(UPLOADS_DIR))
            zf.writestr("metadata.txt", f"created_at={datetime.now().isoformat()}\nreason={reason}\n")
    finally:
        try:
            db_copy.unlink(missing_ok=True)
        except OSError:
            pass
    _prune_old_backups()
    return target


def _derive_fernet(passphrase: str, salt: bytes) -> Fernet:
    if not passphrase or len(passphrase) < 8:
        raise HTTPException(status_code=400, detail="Passphrase requise: 8 caracteres minimum")
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, 240000, dklen=32)
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt_file(source: Path, target: Path, passphrase: str) -> None:
    salt = os.urandom(16)
    token = _derive_fernet(passphrase, salt).encrypt(source.read_bytes())
    target.write_bytes(ENC_MAGIC + salt + token)


def _decrypt_file(source: Path, target: Path, passphrase: str) -> None:
    if source.stat().st_size > MAX_RESTORE_BYTES * 2:
        raise HTTPException(status_code=413, detail="Sauvegarde chiffree trop volumineuse")
    raw = source.read_bytes()
    if not raw.startswith(ENC_MAGIC) or len(raw) <= len(ENC_MAGIC) + 16:
        raise HTTPException(status_code=400, detail="Sauvegarde chiffree invalide")
    salt = raw[len(ENC_MAGIC):len(ENC_MAGIC) + 16]
    token = raw[len(ENC_MAGIC) + 16:]
    try:
        target.write_bytes(_derive_fernet(passphrase, salt).decrypt(token))
    except InvalidToken:
        raise HTTPException(status_code=400, detail="Passphrase incorrecte ou sauvegarde alteree")


def create_encrypted_backup(passphrase: str, reason: str = "manual-encrypted") -> Path:
    plain = create_backup(reason)
    target = BACKUP_DIR / _safe_encrypted_backup_name()
    try:
        _encrypt_file(plain, target, passphrase)
    finally:
        try:
            plain.unlink(missing_ok=True)
        except OSError:
            pass
    _prune_old_backups()
    return target


def create_startup_backup_if_needed() -> None:
    _ensure_dir()
    today = datetime.now().strftime("%Y%m%d")
    if not any(path.name.startswith(f"proerp-backup-{today}") for path in BACKUP_DIR.glob("proerp-backup-*.zip")):
        create_backup("startup")


def _backup_info(path: Path) -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "size": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "encrypted": path.suffix == ".erpenc",
        "contains_sensitive_data": True,
        "security_warning": "" if path.suffix == ".erpenc" else "Archive non chiffree: stockage local protege uniquement",
    }


@router.get("")
def list_backups(user=Depends(get_current_user)):
    _ensure_dir()
    backups = sorted(list(BACKUP_DIR.glob("proerp-backup-*.zip")) + list(BACKUP_DIR.glob("proerp-backup-*.erpenc")), key=lambda p: p.stat().st_mtime, reverse=True)
    return {
        "items": [_backup_info(path) for path in backups],
        "database_path": str(DB_PATH),
        "backup_dir": str(BACKUP_DIR),
        "max_backups": MAX_BACKUPS,
    }


@router.post("")
def make_backup(db: Session = Depends(get_db), user=Depends(get_current_user)):
    path = create_backup(f"manual:user:{getattr(user, 'id', '')}")
    log_action(db, user, "create", "backup", path.name, "Sauvegarde creee", after=_backup_info(path))
    db.commit()
    return {"ok": True, "backup": _backup_info(path)}


@router.post("/encrypted")
def make_encrypted_backup(body: EncryptedBackupRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    path = create_encrypted_backup(body.passphrase, f"manual-encrypted:user:{getattr(user, 'id', '')}")
    log_action(db, user, "create", "encrypted_backup", path.name, "Sauvegarde chiffree creee", after=_backup_info(path))
    db.commit()
    return {"ok": True, "backup": _backup_info(path)}


@router.get("/{name}/download")
def download_backup(name: str, user=Depends(get_current_user)):
    path = _backup_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sauvegarde introuvable")
    media_type = "application/octet-stream" if path.suffix == ".erpenc" else "application/zip"
    return FileResponse(path, filename=path.name, media_type=media_type)


@router.delete("/{name}")
def delete_backup(name: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    path = _backup_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sauvegarde introuvable")
    info = _backup_info(path)
    path.unlink()
    log_action(db, user, "delete", "backup", name, "Sauvegarde supprimee", before=info)
    db.commit()
    return {"ok": True}


@router.post("/restore")
async def restore_backup(file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Le fichier doit etre une sauvegarde .zip")

    _ensure_dir()
    tmp = BACKUP_DIR / f".tmp-restore-{uuid4().hex}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        archive = tmp / "restore.zip"
        with archive.open("wb") as fh:
            _copy_upload_limited(file.file, fh)

        try:
            with zipfile.ZipFile(archive) as zf:
                extracted = _safe_extract_backup(zf, tmp / "extract")
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Sauvegarde invalide")

        db_restore = extracted / "proerp.db"
        _validate_restored_database(db_restore)

        safety_backup = create_backup(f"before-restore:user:{getattr(user, 'id', '')}")
        log_action(db, user, "restore", "backup", file.filename, "Restauration demandee", after={"safety_backup": safety_backup.name})
        db.commit()
        db.close()
        engine.dispose()
        shutil.copy2(db_restore, DB_PATH)
        _restore_optional_files(extracted)
    finally:
        try:
            shutil.rmtree(tmp)
        except OSError:
            pass

    return {"ok": True, "safety_backup": _backup_info(safety_backup)}


@router.post("/restore-encrypted")
def restore_encrypted_backup(body: EncryptedRestoreRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    path = _backup_path(body.name)
    if not path.exists() or path.suffix != ".erpenc":
        raise HTTPException(status_code=404, detail="Sauvegarde chiffree introuvable")

    _ensure_dir()
    tmp = BACKUP_DIR / f".tmp-restore-encrypted-{uuid4().hex}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        archive = tmp / "restore.zip"
        _decrypt_file(path, archive, body.passphrase)
        if archive.stat().st_size > MAX_RESTORE_BYTES:
            raise HTTPException(status_code=413, detail="Sauvegarde dechiffree trop volumineuse")
        with zipfile.ZipFile(archive) as zf:
            extracted = _safe_extract_backup(zf, tmp / "extract")

        db_restore = extracted / "proerp.db"
        _validate_restored_database(db_restore)

        safety_backup = create_backup(f"before-encrypted-restore:user:{getattr(user, 'id', '')}")
        log_action(db, user, "restore", "encrypted_backup", path.name, "Restauration chiffree demandee", after={"safety_backup": safety_backup.name})
        db.commit()
        db.close()
        engine.dispose()
        shutil.copy2(db_restore, DB_PATH)
        _restore_optional_files(extracted)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Sauvegarde dechiffree invalide")
    finally:
        try:
            shutil.rmtree(tmp)
        except OSError:
            pass

    return {"ok": True, "safety_backup": _backup_info(safety_backup)}
