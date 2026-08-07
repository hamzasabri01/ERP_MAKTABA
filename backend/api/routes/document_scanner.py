"""Safe, temporary extraction of image archives for the document scanner."""
from __future__ import annotations

import base64
import io
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from core.security import get_current_user


router = APIRouter()

MAX_ARCHIVE_BYTES = 150 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 80 * 1024 * 1024
MAX_IMAGES = 12
ARCHIVE_SUFFIXES = {".zip", ".cbz", ".rar", ".7z", ".tar"}
IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _safe_member_name(raw_name: str) -> str | None:
    normalized = raw_name.replace("\\", "/").strip()
    path = PurePosixPath(normalized)
    if not normalized or normalized.startswith(("/", "-")) or ".." in path.parts:
        return None
    return normalized


def _natural_key(name: str) -> tuple:
    import re
    return tuple(int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", name))


def _encode_images(entries) -> dict:
    images = []
    ignored = 0
    total = 0
    for raw_name, read_bytes in sorted(entries, key=lambda item: _natural_key(item[0])):
        name = _safe_member_name(raw_name)
        suffix = Path(name or "").suffix.lower()
        mime = IMAGE_TYPES.get(suffix)
        if not name or not mime:
            ignored += 1
            continue
        if len(images) >= MAX_IMAGES:
            ignored += 1
            continue
        try:
            payload = read_bytes()
        except (OSError, RuntimeError, subprocess.SubprocessError, zipfile.BadZipFile):
            ignored += 1
            continue
        if not payload or len(payload) > MAX_IMAGE_BYTES or total + len(payload) > MAX_TOTAL_IMAGE_BYTES:
            ignored += 1
            continue
        total += len(payload)
        images.append({
            "name": Path(name).name,
            "type": mime,
            "content": base64.b64encode(payload).decode("ascii"),
        })
    if not images:
        raise HTTPException(status_code=422, detail="L’archive ne contient aucune image JPG, PNG ou WebP valide.")
    return {"images": images, "ignored": ignored, "total": len(images)}


def _zip_entries(payload: bytes):
    archive = zipfile.ZipFile(io.BytesIO(payload))
    entries = []
    for info in archive.infolist():
        if info.is_dir() or info.file_size > MAX_IMAGE_BYTES:
            continue
        entries.append((info.filename, lambda current=info: archive.read(current)))
    return archive, entries


def _libarchive_entries(path: Path):
    try:
        listing = subprocess.run(
            ["tar", "-tf", str(path)], capture_output=True, text=True,
            timeout=30, check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(status_code=422, detail="Extraction RAR/7Z indisponible sur cet ordinateur.") from exc
    if listing.returncode != 0:
        raise HTTPException(status_code=422, detail="Archive illisible, endommagée ou protégée par mot de passe.")
    entries = []
    for raw_name in listing.stdout.splitlines():
        name = _safe_member_name(raw_name)
        if not name or Path(name).suffix.lower() not in IMAGE_TYPES:
            continue

        def read_member(member=name):
            result = subprocess.run(
                ["tar", "-xOf", str(path), member], capture_output=True,
                timeout=30, check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode != 0:
                raise RuntimeError("archive member extraction failed")
            return result.stdout

        entries.append((name, read_member))
    return entries


@router.post("/extract-archive")
async def extract_archive(archive: UploadFile = File(...), user=Depends(get_current_user)):
    del user
    suffix = Path(archive.filename or "").suffix.lower()
    if suffix not in ARCHIVE_SUFFIXES:
        raise HTTPException(status_code=422, detail="Format accepté : ZIP, RAR, 7Z, TAR ou CBZ.")
    payload = await archive.read(MAX_ARCHIVE_BYTES + 1)
    await archive.close()
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise HTTPException(status_code=413, detail="Archive trop volumineuse. Maximum 150 MB.")
    if not payload:
        raise HTTPException(status_code=422, detail="Archive vide.")

    if suffix in {".zip", ".cbz"}:
        try:
            opened, entries = _zip_entries(payload)
            try:
                return _encode_images(entries)
            finally:
                opened.close()
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=422, detail="Fichier ZIP illisible ou endommagé.") from exc

    with tempfile.TemporaryDirectory(prefix="maktaba-scan-") as temporary:
        archive_path = Path(temporary) / f"archive{suffix}"
        archive_path.write_bytes(payload)
        return _encode_images(_libarchive_entries(archive_path))
