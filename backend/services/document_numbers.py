"""Transactional document numbering with permanent allocations and gap reasons."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re
import sqlite3
import time
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from core.settings_store import load_settings
from models.document_sequence import DocumentNumberAllocation

DEFAULT_COMPANY_KEY = "default"
MAX_ALLOCATION_RETRIES = 5
PREFIX_PATTERN = re.compile(r"^[A-Z0-9_]{1,12}$")
NUMBER_PATTERN = re.compile(r"^(.*)-(\d{4})-(\d+)$")

DEFAULT_PREFIXES = {
    ("sale", "invoice"): "FAC",
    ("sale", "quote"): "DEV",
    ("sale", "delivery"): "BL",
    ("sale", "credit_note"): "AV",
    ("purchase", "order"): "BC",
    ("purchase", "receipt"): "BR",
}

SETTING_PREFIXES = {
    ("sale", "invoice"): "invoice_prefix",
    ("sale", "quote"): "quote_prefix",
    ("sale", "delivery"): "delivery_prefix",
    ("sale", "credit_note"): "credit_note_prefix",
    ("purchase", "order"): "po_prefix",
    ("purchase", "receipt"): "purchase_receipt_prefix",
}


@dataclass(frozen=True)
class NumberAllocation:
    allocation_id: int
    sequence_id: int
    document_number: str
    serial_number: int
    fiscal_year: int
    prefix: str
    company_key: str
    domain: str
    document_type: str


def _clean_scope(domain: str, document_type: str, company_key: str) -> tuple[str, str, str]:
    clean_domain = str(domain or "").strip().lower()
    clean_type = str(document_type or "").strip().lower()
    clean_company = str(company_key or DEFAULT_COMPANY_KEY).strip().lower()
    if clean_domain not in {"sale", "purchase"}:
        raise HTTPException(500, "Domaine de sequence documentaire invalide")
    if not clean_type or len(clean_type) > 30:
        raise HTTPException(400, "Type de document invalide")
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", clean_company):
        raise HTTPException(500, "Cle societe de sequence invalide")
    return clean_domain, clean_type, clean_company


def document_prefix(domain: str, document_type: str, settings: dict | None = None) -> str:
    scope = (str(domain or "").lower(), str(document_type or "").lower())
    settings = settings or load_settings()
    setting_name = SETTING_PREFIXES.get(scope)
    prefix = settings.get(setting_name) if setting_name else None
    normalized = str(prefix or DEFAULT_PREFIXES.get(scope, "DOC")).strip().upper()
    if not PREFIX_PATTERN.fullmatch(normalized):
        raise HTTPException(500, "Prefixe documentaire invalide dans les parametres")
    return normalized


def _document_year(value: Any = None) -> int:
    if isinstance(value, datetime):
        return value.year
    if value:
        try:
            return datetime.fromisoformat(str(value)).year
        except (TypeError, ValueError):
            pass
    return datetime.now().year


def _existing_max_serial(cursor, domain: str, document_type: str, fiscal_year: int) -> int:
    table = "sales" if domain == "sale" else "purchases"
    rows = cursor.execute(
        f"SELECT number, date_time FROM {table} WHERE doc_type = ?",
        (document_type,),
    ).fetchall()
    maximum = 0
    for number, date_time in rows:
        match = NUMBER_PATTERN.match(str(number or ""))
        year = int(match.group(2)) if match else _document_year(date_time)
        if year == fiscal_year and match:
            maximum = max(maximum, int(match.group(3)))
    return maximum


def reserve_document_number(
    db: Session,
    domain: str,
    document_type: str,
    *,
    document_date: Any = None,
    created_by: int | None = None,
    company_key: str = DEFAULT_COMPANY_KEY,
    prefix: str | None = None,
) -> NumberAllocation:
    """Reserve and commit a number before the document write, so it is never reused."""
    clean_domain, clean_type, clean_company = _clean_scope(domain, document_type, company_key)
    fiscal_year = _document_year(document_date)
    clean_prefix = str(prefix or document_prefix(clean_domain, clean_type)).strip().upper()
    if not PREFIX_PATTERN.fullmatch(clean_prefix):
        raise HTTPException(400, "Prefixe documentaire invalide")

    bind = db.get_bind()
    if bind.dialect.name != "sqlite":
        raise HTTPException(500, "Le generateur de numeros doit etre adapte au moteur de base de donnees")

    last_error: Exception | None = None
    for attempt in range(MAX_ALLOCATION_RETRIES):
        raw = bind.raw_connection()
        try:
            cursor = raw.cursor()
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("BEGIN IMMEDIATE")
            row = cursor.execute(
                """
                SELECT id, next_value
                FROM document_sequences
                WHERE company_key=? AND domain=? AND document_type=? AND fiscal_year=?
                """,
                (clean_company, clean_domain, clean_type, fiscal_year),
            ).fetchone()
            now = datetime.utcnow().isoformat(sep=" ")
            if row is None:
                serial = _existing_max_serial(cursor, clean_domain, clean_type, fiscal_year) + 1
                cursor.execute(
                    """
                    INSERT INTO document_sequences(
                        company_key, domain, document_type, fiscal_year,
                        next_value, last_value, created_at, updated_at
                    ) VALUES(?,?,?,?,?,?,?,?)
                    """,
                    (clean_company, clean_domain, clean_type, fiscal_year, serial + 1, serial, now, now),
                )
                sequence_id = int(cursor.lastrowid)
            else:
                sequence_id = int(row[0])
                serial = int(row[1])
                cursor.execute(
                    """
                    UPDATE document_sequences
                    SET next_value=?, last_value=?, updated_at=?
                    WHERE id=?
                    """,
                    (serial + 1, serial, now, sequence_id),
                )

            number_prefix = clean_prefix if clean_company == DEFAULT_COMPANY_KEY else f"{clean_prefix}-{clean_company.upper()}"
            document_number = f"{number_prefix}-{fiscal_year}-{serial:05d}"
            cursor.execute(
                """
                INSERT INTO document_number_allocations(
                    sequence_id, company_key, domain, document_type, fiscal_year,
                    prefix, serial_number, document_number, status, reason,
                    document_id, created_by, allocated_at, committed_at, voided_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    sequence_id,
                    clean_company,
                    clean_domain,
                    clean_type,
                    fiscal_year,
                    clean_prefix,
                    serial,
                    document_number,
                    "reserved",
                    "allocated",
                    None,
                    created_by,
                    now,
                    None,
                    None,
                ),
            )
            allocation_id = int(cursor.lastrowid)
            raw.commit()
            return NumberAllocation(
                allocation_id=allocation_id,
                sequence_id=sequence_id,
                document_number=document_number,
                serial_number=serial,
                fiscal_year=fiscal_year,
                prefix=clean_prefix,
                company_key=clean_company,
                domain=clean_domain,
                document_type=clean_type,
            )
        except sqlite3.OperationalError as exc:
            raw.rollback()
            last_error = exc
            if "locked" not in str(exc).lower() and "busy" not in str(exc).lower():
                break
            time.sleep(0.025 * (attempt + 1))
        except sqlite3.IntegrityError as exc:
            raw.rollback()
            last_error = exc
            break
        finally:
            raw.close()
    raise HTTPException(503, f"Impossible de reserver un numero documentaire: {type(last_error).__name__}")


def commit_number_allocation(db: Session, allocation_id: int, document_id: int) -> None:
    allocation = db.query(DocumentNumberAllocation).filter(DocumentNumberAllocation.id == allocation_id).first()
    if not allocation or allocation.status != "reserved":
        raise HTTPException(409, "Reservation de numero documentaire invalide")
    allocation.status = "committed"
    allocation.reason = "document_created"
    allocation.document_id = document_id
    allocation.committed_at = datetime.utcnow()


def _void_reason(reason: str) -> str:
    clean = str(reason or "document_failed").strip().lower().replace(" ", "_")
    return clean[:120] or "document_failed"


def void_reserved_allocation(db: Session, allocation_id: int, reason: str) -> None:
    """Void a reservation in an independent transaction after a document rollback."""
    bind = db.get_bind()
    raw = bind.raw_connection()
    try:
        cursor = raw.cursor()
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute(
            """
            UPDATE document_number_allocations
            SET status='void', reason=?, voided_at=?
            WHERE id=? AND status='reserved'
            """,
            (_void_reason(reason), datetime.utcnow().isoformat(sep=" "), allocation_id),
        )
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


def void_document_allocation(
    db: Session,
    domain: str,
    document_number: str,
    document_id: int,
    reason: str,
) -> bool:
    allocation = db.query(DocumentNumberAllocation).filter(
        DocumentNumberAllocation.domain == domain,
        DocumentNumberAllocation.document_number == document_number,
        DocumentNumberAllocation.document_id == document_id,
    ).first()
    if not allocation:
        return False
    allocation.status = "void"
    allocation.reason = _void_reason(reason)
    allocation.voided_at = datetime.utcnow()
    return True
