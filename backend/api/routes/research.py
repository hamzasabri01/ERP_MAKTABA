"""Isolated REST endpoints for School Research Assistant."""
from __future__ import annotations

import json
import logging
import ssl
import time as sleep_time
import time
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import certifi
try:
    import truststore
except ImportError:  # pragma: no cover
    truststore = None

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from api.research_schemas import (
    ExportRegister, OutlineUpdate, PaginatedResearchRequests, ResearchRequestCreate, ResearchRequestSummary,
    ResearchRequestUpdate, RestoreVersionInput, RewriteInput, SectionUpdate, SourceCreate, SourceVerify,
)
from core.config import env, env_bool, env_int
from core.database import get_db
from core.security import require_permission
from models.research import (
    ResearchAIUsage, ResearchAsset, ResearchOutline, ResearchRequest, ResearchSection, ResearchSectionVersion,
    ResearchOutput, ResearchSource, ResearchStatusHistory,
)
from services.research_ai import OutlineInput, SectionInput, WikimediaResearchProvider, call_with_retry, get_research_ai_provider
from services.research_workflow import (
    InvalidResearchTransition, ResearchPriceInput, ResearchStatus, basic_quality_report,
    calculate_estimated_price, count_words, estimate_pages, validate_transition,
)
from services.research_pos import ensure_research_service
from services.research_docx import build_research_docx
from services.research_pdf import build_research_pdf
from services.research_web import WikimediaResearchClient

logger = logging.getLogger(__name__)

router = APIRouter()
ASSET_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def _storage_root() -> Path:
    configured = env("RESEARCH_STORAGE_PATH", "").strip()
    root = Path(configured) if configured else Path(__file__).resolve().parents[2] / "data" / "research"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _read_image(upload: UploadFile) -> tuple[bytes, str]:
    mime = (upload.content_type or "").lower()
    if mime not in ASSET_TYPES:
        raise HTTPException(400, "Format image invalide. Utilisez JPG, PNG ou WebP")
    maximum = max(100_000, env_int("RESEARCH_MAX_ASSET_BYTES", 5 * 1024 * 1024))
    data = upload.file.read(maximum + 1)
    if not data or len(data) > maximum:
        raise HTTPException(400, "Image vide ou trop volumineuse")
    signatures = {
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    }
    if not signatures[mime]:
        raise HTTPException(400, "Le contenu du fichier ne correspond pas à son format")
    return data, ASSET_TYPES[mime]


def _sync_web_sources(db: Session, item: ResearchRequest, provider, user_id: int) -> None:
    """Persist every web source used by a provider, without silently approving it."""
    existing = {source.url for source in item.sources if source.url}
    for page in getattr(provider, "sources", {}).values():
        if not page.url or page.url in existing:
            continue
        db.add(ResearchSource(
            request_id=item.id, title=page.title[:300], publisher="Wikipedia / Wikimedia",
            url=page.url[:1000], access_date=datetime.utcnow(), source_type="web",
            verification_status="PENDING", notes="Source découverte automatiquement; validation humaine requise.",
            used_sections_json="[]", created_by=user_id,
        ))
        existing.add(page.url)


def _download_wikimedia_asset(url: str, mime_type: str) -> tuple[bytes, str]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith("wikimedia.org"):
        raise ValueError("Domaine image non autorisé")
    maximum = max(100_000, env_int("RESEARCH_MAX_ASSET_BYTES", 5 * 1024 * 1024))
    context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT) if truststore else ssl.create_default_context(cafile=certifi.where())
    data = b""
    last_error = None
    for attempt in range(3):
        request = Request(url, headers={
            "User-Agent": "LibrarySabriResearch/1.0 (educational local application)",
            "Accept": "image/jpeg,image/png,image/webp", "Accept-Encoding": "identity",
            "Referer": "https://commons.wikimedia.org/",
        })
        try:
            with urlopen(request, timeout=max(5, env_int("RESEARCH_WEB_TIMEOUT_SECONDS", 15)), context=context) as response:
                data = response.read(maximum + 1)
            break
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                sleep_time.sleep(1.2 * (attempt + 1))
    if not data and last_error:
        raise last_error
    if not data or len(data) > maximum:
        raise ValueError("Image distante vide ou trop volumineuse")
    extension = ASSET_TYPES.get(mime_type)
    valid = ((mime_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff")) or
             (mime_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n")) or
             (mime_type == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP"))
    if not extension or not valid:
        raise ValueError("Format image distant invalide")
    return data, extension


def _discover_web_assets(db: Session, item: ResearchRequest, user_id: int) -> int:
    if not item.include_images or item.requested_image_count <= 0:
        return 0
    # Manually uploaded images do not satisfy automatic discovery: only assets
    # with a traceable source URL count as web images.
    web_asset_count = sum(1 for asset in item.assets if asset.source_url)
    remaining = max(0, min(item.requested_image_count, env_int("RESEARCH_MAX_IMAGES", 10)) - web_asset_count)
    if not remaining:
        return 0
    client = WikimediaResearchClient(item.language)
    english_client = WikimediaResearchClient("en")
    existing = {asset.source_url for asset in item.assets if asset.source_url}
    folder = _storage_root() / str(item.id)
    folder.mkdir(parents=True, exist_ok=True)
    created = 0
    concepts = WikimediaResearchProvider._concept_queries(item.topic, item.language)
    translated_concepts = []
    for concept in concepts[1:] or concepts:
        translated = english_client._query_in_output_language(concept)
        if translated.casefold() != concept.casefold():
            translated_concepts.append(translated)
    queries = []
    if len(translated_concepts) >= 2:
        queries.extend([
            f"{translated_concepts[0]} fair play",
            " ".join(translated_concepts[:2]),
        ])
    queries.extend([*translated_concepts, *concepts[1:], item.topic])
    unique_queries = []
    for query in queries:
        if query and query.casefold() not in {value.casefold() for value in unique_queries}:
            unique_queries.append(query)

    for query in unique_queries:
        if remaining <= 0:
            break
        try:
            candidates = client.search_images(query, remaining + 4)
        except Exception:
            try:
                candidates = english_client.search_images(query, remaining + 4)
            except Exception:
                continue
        query_tokens = WikimediaResearchProvider._tokens(query)
        candidates = sorted(
            candidates,
            key=lambda image: len(query_tokens & WikimediaResearchProvider._tokens(f"{image.title} {image.caption}")),
            reverse=True,
        )
        created_for_query = 0
        for image in candidates:
            if image.source_url in existing or remaining <= 0:
                continue
            if created_for_query >= 2:
                break
            if query_tokens and not (query_tokens & WikimediaResearchProvider._tokens(f"{image.title} {image.caption}")):
                continue
            try:
                data, extension = _download_wikimedia_asset(image.url, image.mime_type)
            except Exception:
                continue
            path = (folder / f"web-{uuid4().hex}{extension}").resolve()
            path.write_bytes(data)
            db.add(ResearchAsset(
                request_id=item.id, storage_key=str(path.relative_to(_storage_root())),
                original_file_name=Path(image.title or f"image{extension}").name[:255],
                mime_type=image.mime_type, file_size=len(data), caption=(image.caption or image.title)[:500],
                alt_text=image.title[:500], source_url=image.source_url[:1000],
                license_info=f"{image.license_name} — {image.author}"[:500], approval_status="PENDING", created_by=user_id,
            ))
            existing.add(image.source_url)
            remaining -= 1
            created += 1
            created_for_query += 1
    return created


def _enabled() -> bool:
    return env_bool("RESEARCH_MODULE_ENABLED", False)


def _guard_enabled() -> None:
    if not _enabled():
        raise HTTPException(404, "Module indisponible")


def _get_request(db: Session, request_id: int, *, details: bool = False) -> ResearchRequest:
    query = db.query(ResearchRequest)
    if details:
        query = query.options(
            selectinload(ResearchRequest.outline), selectinload(ResearchRequest.sections).selectinload(ResearchSection.versions),
            selectinload(ResearchRequest.sources), selectinload(ResearchRequest.assets),
            selectinload(ResearchRequest.outputs), selectinload(ResearchRequest.status_history),
        )
    item = query.filter(ResearchRequest.id == request_id).first()
    if not item:
        raise HTTPException(404, "Demande de recherche introuvable")
    return item


def _set_status(db: Session, item: ResearchRequest, status: ResearchStatus, user_id: int, comment: str = "") -> None:
    try:
        validate_transition(item.status, status.value)
    except InvalidResearchTransition as exc:
        raise HTTPException(409, "Transition de statut non autorisée") from exc
    previous = item.status
    item.status = status.value
    db.add(ResearchStatusHistory(
        request_id=item.id, previous_status=previous, new_status=status.value,
        comment=comment, changed_by=user_id,
    ))


def _save_version(db: Session, section: ResearchSection, user_id: int, reason: str) -> ResearchSectionVersion:
    latest = db.query(func.max(ResearchSectionVersion.version_number)).filter(ResearchSectionVersion.section_id == section.id).scalar() or 0
    version = ResearchSectionVersion(
        section_id=section.id, version_number=int(latest) + 1, title=section.title,
        content=section.content or "", change_reason=reason, created_by=user_id,
        generation_metadata_json=section.generation_metadata_json or "{}",
    )
    db.add(version)
    # Some actions create two versions in the same transaction (before/after rewrite).
    # Flush now so the next MAX(version_number) sees this reserved version number.
    db.flush()
    return version


def _serialize(item: ResearchRequest, *, details: bool = False) -> dict:
    data = {
        "id": item.id, "reference": item.reference, "customer_id": item.customer_id,
        "student_first_name": item.student_first_name, "contact_info": item.contact_info,
        "topic": item.topic, "subject": item.subject, "academic_level": item.academic_level,
        "custom_academic_level": item.custom_academic_level, "language": item.language,
        "language_level": item.language_level, "target_pages": item.target_pages,
        "page_count_mode": item.page_count_mode, "include_cover": item.include_cover,
        "include_toc": item.include_toc, "include_introduction": item.include_introduction,
        "include_conclusion": item.include_conclusion, "include_images": item.include_images,
        "requested_image_count": item.requested_image_count, "include_references": item.include_references,
        "country_context": item.country_context, "teacher_instructions": item.teacher_instructions,
        "internal_notes": item.internal_notes, "requested_delivery_at": item.requested_delivery_at,
        "output_format": item.output_format, "print_color_mode": item.print_color_mode,
        "print_copies": item.print_copies, "binding_preference": item.binding_preference,
        "status": item.status, "estimated_price": float(item.estimated_price or 0),
        "final_price": float(item.final_price) if item.final_price is not None else None,
        "estimated_pages": float(item.estimated_pages or 0), "actual_pages": item.actual_pages,
        "total_words": item.total_words, "pos_ticket_id": item.pos_ticket_id, "invoice_id": item.invoice_id,
        "assigned_to": item.assigned_to, "created_by": item.created_by, "updated_by": item.updated_by,
        "approved_by": item.approved_by, "created_at": item.created_at, "updated_at": item.updated_at,
        "approved_at": item.approved_at, "completed_at": item.completed_at,
    }
    if details:
        data["outline"] = None if not item.outline else {
            "id": item.outline.id, "title": item.outline.title, "objective": item.outline.objective,
            "version": item.outline.version, "approved_at": item.outline.approved_at,
            **json.loads(item.outline.content_json or "{}"),
        }
        data["sections"] = [{
            "id": section.id, "order": section.order_index, "title": section.title,
            "objective": section.objective, "content": section.content, "summary": section.summary,
            "target_words": section.target_words, "actual_words": section.actual_words,
            "status": section.status, "suggested_image_query": section.suggested_image_query,
            "versions": [{"id": version.id, "version_number": version.version_number, "change_reason": version.change_reason, "created_at": version.created_at} for version in section.versions],
        } for section in item.sections]
        data["sources"] = [{
            "id": source.id, "title": source.title, "author": source.author, "publisher": source.publisher,
            "url": source.url, "source_type": source.source_type, "verification_status": source.verification_status,
            "notes": source.notes,
        } for source in item.sources]
        data["assets"] = [{
            "id": asset.id, "section_id": asset.section_id, "original_file_name": asset.original_file_name,
            "mime_type": asset.mime_type, "file_size": asset.file_size, "caption": asset.caption,
            "alt_text": asset.alt_text, "source_url": asset.source_url, "license_info": asset.license_info,
            "approval_status": asset.approval_status, "download_url": f"/research/assets/{asset.id}/download",
        } for asset in item.assets]
        data["status_history"] = [{
            "previous_status": history.previous_status, "new_status": history.new_status,
            "comment": history.comment, "changed_by": history.changed_by, "created_at": history.created_at,
        } for history in item.status_history]
    return data


@router.get("/config")
def module_config():
    return {
        "enabled": _enabled(), "provider": env("RESEARCH_AI_PROVIDER", "mock"),
        "max_pages": env_int("RESEARCH_MAX_PAGES", 20), "max_images": env_int("RESEARCH_MAX_IMAGES", 10),
        "supported_languages": ["ar", "fr", "en"],
    }


@router.get("/requests", response_model=PaginatedResearchRequests)
def list_requests(
    search: str = Query(default="", max_length=120), status: str | None = Query(default=None, max_length=30),
    language: str | None = Query(default=None, max_length=5), page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db),
    user=Depends(require_permission("research.view")),
):
    _guard_enabled()
    query = db.query(ResearchRequest)
    if search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(or_(ResearchRequest.reference.ilike(term), ResearchRequest.topic.ilike(term), ResearchRequest.subject.ilike(term)))
    if status:
        query = query.filter(ResearchRequest.status == status)
    if language:
        query = query.filter(ResearchRequest.language == language)
    total = query.count()
    items = query.order_by(ResearchRequest.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResearchRequests(items=[ResearchRequestSummary.model_validate(item) for item in items], total=total, page=page, page_size=page_size)


@router.post("/requests", status_code=201)
def create_request(body: ResearchRequestCreate, db: Session = Depends(get_db), user=Depends(require_permission("research.create"))):
    _guard_enabled()
    now = datetime.utcnow()
    sequence = (db.query(func.max(ResearchRequest.id)).scalar() or 0) + 1
    data = body.model_dump()
    urgent = bool(body.requested_delivery_at and body.requested_delivery_at.date() <= now.date())
    price = calculate_estimated_price(ResearchPriceInput(
        target_pages=body.target_pages, requested_images=body.requested_image_count,
        include_references=body.include_references, bw_pages=body.target_pages if body.print_color_mode == "bw" else 0,
        color_pages=body.target_pages if body.print_color_mode == "color" else 0,
        binding=body.binding_preference != "none", urgent=urgent,
    ))
    item = ResearchRequest(
        **data, reference=f"RES-{now:%Y%m%d}-{sequence:05d}", status=ResearchStatus.DRAFT.value,
        estimated_price=price, created_by=user.id, updated_by=user.id,
    )
    db.add(item)
    db.flush()
    db.add(ResearchStatusHistory(request_id=item.id, previous_status=None, new_status=item.status, comment="Request created", changed_by=user.id))
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.get("/requests/{request_id}")
def get_request(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.view"))):
    _guard_enabled()
    return _serialize(_get_request(db, request_id, details=True), details=True)


@router.patch("/requests/{request_id}")
def update_request(request_id: int, body: ResearchRequestUpdate, db: Session = Depends(get_db), user=Depends(require_permission("research.edit"))):
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status not in {ResearchStatus.DRAFT, ResearchStatus.OUTLINE_READY, ResearchStatus.REVIEW_REQUIRED}:
        raise HTTPException(409, "Cette demande ne peut plus être modifiée à cette étape")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    item.updated_by = user.id
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.post("/requests/{request_id}/generate-outline")
def generate_outline(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.generate"))):
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status not in {ResearchStatus.DRAFT, ResearchStatus.OUTLINE_READY, ResearchStatus.REVIEW_REQUIRED, ResearchStatus.APPROVED, ResearchStatus.EXPORTED, ResearchStatus.FAILED}:
        raise HTTPException(409, "Le plan ne peut pas être généré à cette étape")
    if item.status in {ResearchStatus.REVIEW_REQUIRED, ResearchStatus.APPROVED, ResearchStatus.EXPORTED}:
        item.approved_by = None
        item.approved_at = None
    _set_status(db, item, ResearchStatus.OUTLINE_PENDING, user.id, "Outline generation started")
    provider = get_research_ai_provider()
    started = time.perf_counter()
    try:
        result = call_with_retry(lambda: provider.generate_outline(OutlineInput(
            topic=item.topic, subject=item.subject, academic_level=item.custom_academic_level or item.academic_level,
            language=item.language, language_level=item.language_level, target_pages=item.target_pages,
            include_introduction=item.include_introduction, include_conclusion=item.include_conclusion,
            include_images=item.include_images,
        )))
        payload = result.model_dump()
        if item.outline:
            item.outline.title = result.title
            item.outline.objective = result.objective
            item.outline.content_json = json.dumps(payload, ensure_ascii=False)
            item.outline.version += 1
        else:
            item.outline = ResearchOutline(title=result.title, objective=result.objective, content_json=json.dumps(payload, ensure_ascii=False))
        # Rebuilding replaces obsolete automatic suggestions, never manual records.
        db.query(ResearchSource).filter(
            ResearchSource.request_id == item.id, ResearchSource.source_type == "web",
        ).delete(synchronize_session=False)
        db.flush()
        _sync_web_sources(db, item, provider, user.id)
        _discover_web_assets(db, item, user.id)
        _set_status(db, item, ResearchStatus.OUTLINE_READY, user.id, "Outline generated")
        operation_status, error_code = "SUCCESS", ""
    except Exception as exc:
        logger.exception("Research outline generation failed for request %s", item.id)
        operation_status, error_code = "FAILED", getattr(exc, "code", "RESEARCH_AI_ERROR")
        if item.status == ResearchStatus.OUTLINE_PENDING:
            _set_status(db, item, ResearchStatus.FAILED, user.id, "Outline generation failed")
        db.add(ResearchAIUsage(request_id=item.id, user_id=user.id, provider=provider.name, model=provider.model, operation_type="OUTLINE_GENERATION", status=operation_status, error_code=error_code, duration_ms=int((time.perf_counter() - started) * 1000)))
        db.commit()
        raise HTTPException(503, "Impossible de générer le plan actuellement. Réessayez plus tard.") from exc
    db.add(ResearchAIUsage(request_id=item.id, user_id=user.id, provider=provider.name, model=provider.model, operation_type="OUTLINE_GENERATION", status=operation_status, error_code=error_code, duration_ms=int((time.perf_counter() - started) * 1000)))
    db.commit()
    return _serialize(_get_request(db, item.id, details=True), details=True)


@router.patch("/requests/{request_id}/outline")
def update_outline(request_id: int, body: OutlineUpdate, db: Session = Depends(get_db), user=Depends(require_permission("research.edit"))):
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status != ResearchStatus.OUTLINE_READY or not item.outline:
        raise HTTPException(409, "Le plan n'est pas modifiable à cette étape")
    payload = body.model_dump()
    item.outline.title, item.outline.objective = body.title, body.objective
    item.outline.content_json = json.dumps(payload, ensure_ascii=False)
    item.outline.version += 1
    item.updated_by = user.id
    db.commit()
    return _serialize(_get_request(db, item.id, details=True), details=True)


@router.post("/requests/{request_id}/approve-outline")
def approve_outline(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.approve"))):
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status != ResearchStatus.OUTLINE_READY or not item.outline:
        raise HTTPException(409, "Un plan prêt est requis")
    content = json.loads(item.outline.content_json)
    if not content.get("sections"):
        raise HTTPException(422, "Le plan doit contenir au moins une section")
    try:
        # SQLite checks the unique (request_id, order_index) constraint immediately.
        # Flush deletions before inserting the replacement outline sections.
        for previous_section in list(item.sections):
            db.delete(previous_section)
        db.flush()
        for section in content["sections"]:
            db.add(ResearchSection(
                request_id=item.id, order_index=section["order"], title=section["title"],
                objective=section.get("objective", ""), target_words=section["target_words"],
                suggested_image_query=section.get("suggested_image_query"),
            ))
        item.outline.approved_by, item.outline.approved_at = user.id, datetime.utcnow()
        _set_status(db, item, ResearchStatus.OUTLINE_APPROVED, user.id, "Outline approved")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, "Impossible de remplacer les anciennes sections. Réessayez.") from exc
    return _serialize(_get_request(db, item.id, details=True), details=True)


@router.post("/requests/{request_id}/generate-sections")
def generate_sections(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.generate"))):
    _guard_enabled()
    item = _get_request(db, request_id, details=True)
    if item.status not in {ResearchStatus.OUTLINE_APPROVED, ResearchStatus.REVIEW_REQUIRED, ResearchStatus.FAILED}:
        raise HTTPException(409, "Le plan doit être approuvé avant la génération")
    _set_status(db, item, ResearchStatus.GENERATING, user.id, "Section generation started")
    provider = get_research_ai_provider()
    try:
        for section in item.sections:
            if section.status == "READY" and section.content.strip():
                continue
            started = time.perf_counter()
            result = call_with_retry(lambda section=section: provider.generate_section(SectionInput(
                topic=item.topic, title=section.title, objective=section.objective,
                academic_level=item.custom_academic_level or item.academic_level, language=item.language,
                language_level=item.language_level, target_words=section.target_words,
                country_context=item.country_context,
            )))
            section.content, section.summary = result.content, result.summary
            section.actual_words, section.status = count_words(result.content), "READY"
            section.generation_metadata_json = json.dumps({"provider": provider.name, "model": provider.model, "warnings": result.warnings})
            _save_version(db, section, user.id, "generation")
            db.add(ResearchAIUsage(request_id=item.id, user_id=user.id, provider=provider.name, model=provider.model, operation_type="SECTION_GENERATION", status="SUCCESS", duration_ms=int((time.perf_counter() - started) * 1000)))
        _sync_web_sources(db, item, provider, user.id)
        item.total_words = sum(section.actual_words for section in item.sections)
        item.estimated_pages = estimate_pages(item.total_words, item.language, item.requested_image_count, item.include_cover, item.include_toc)
        _set_status(db, item, ResearchStatus.REVIEW_REQUIRED, user.id, "Sections generated; human review required")
        db.commit()
    except Exception as exc:
        db.rollback()
        item = _get_request(db, request_id)
        if item.status in {ResearchStatus.OUTLINE_APPROVED, ResearchStatus.REVIEW_REQUIRED, ResearchStatus.GENERATING}:
            previous = item.status
            item.status = ResearchStatus.FAILED.value
            db.add(ResearchStatusHistory(request_id=item.id, previous_status=previous, new_status=ResearchStatus.FAILED.value, comment="Section generation failed", changed_by=user.id))
            db.commit()
        raise HTTPException(503, "تعذر إنشاء الأقسام حالياً. لم يتم فقدان التعديلات المحفوظة.") from exc
    return _serialize(_get_request(db, item.id, details=True), details=True)


@router.patch("/sections/{section_id}")
def update_section(section_id: int, body: SectionUpdate, db: Session = Depends(get_db), user=Depends(require_permission("research.edit"))):
    _guard_enabled()
    section = db.query(ResearchSection).filter(ResearchSection.id == section_id).first()
    if not section:
        raise HTTPException(404, "Section introuvable")
    if section.request.status not in {ResearchStatus.REVIEW_REQUIRED, ResearchStatus.GENERATING}:
        raise HTTPException(409, "Section non modifiable à cette étape")
    if section.content or section.title:
        _save_version(db, section, user.id, f"before_{body.change_reason}")
    for key, value in body.model_dump(exclude_unset=True, exclude={"change_reason"}).items():
        setattr(section, key, value)
    section.actual_words = count_words(section.content)
    section.status = "READY"
    request = section.request
    request.total_words = sum(count_words(item.content) for item in request.sections)
    request.estimated_pages = estimate_pages(request.total_words, request.language, request.requested_image_count, request.include_cover, request.include_toc)
    request.updated_by = user.id
    db.commit()
    return {"ok": True, "section": {"id": section.id, "title": section.title, "content": section.content, "actual_words": section.actual_words}}


@router.post("/sections/{section_id}/rewrite")
def rewrite_section(section_id: int, body: RewriteInput, db: Session = Depends(get_db), user=Depends(require_permission("research.generate"))):
    _guard_enabled()
    section = db.query(ResearchSection).filter(ResearchSection.id == section_id).first()
    if not section:
        raise HTTPException(404, "Section introuvable")
    if section.request.status != ResearchStatus.REVIEW_REQUIRED:
        raise HTTPException(409, "La réécriture exige l'étape de révision")
    _save_version(db, section, user.id, f"before_{body.action}")
    provider = get_research_ai_provider()
    result = call_with_retry(lambda: provider.rewrite_section(SectionInput(
        topic=section.request.topic, title=section.title, objective=section.objective,
        academic_level=section.request.custom_academic_level or section.request.academic_level,
        language=section.request.language, language_level=section.request.language_level,
        target_words=section.target_words, action=body.action, existing_content=section.content,
        country_context=section.request.country_context,
    )))
    section.content, section.summary, section.actual_words = result.content, result.summary, count_words(result.content)
    _save_version(db, section, user.id, body.action)
    db.commit()
    return {"ok": True, "content": section.content, "actual_words": section.actual_words}


@router.post("/sections/{section_id}/restore")
def restore_section(section_id: int, body: RestoreVersionInput, db: Session = Depends(get_db), user=Depends(require_permission("research.edit"))):
    _guard_enabled()
    section = db.query(ResearchSection).filter(ResearchSection.id == section_id).first()
    version = db.query(ResearchSectionVersion).filter(ResearchSectionVersion.id == body.version_id, ResearchSectionVersion.section_id == section_id).first()
    if not section or not version:
        raise HTTPException(404, "Version introuvable")
    _save_version(db, section, user.id, "before_restore")
    section.title, section.content = version.title, version.content
    section.actual_words = count_words(section.content)
    db.commit()
    return {"ok": True, "content": section.content}


@router.post("/requests/{request_id}/quality-check")
def quality_check(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.edit"))):
    _guard_enabled()
    item = _get_request(db, request_id, details=True)
    if item.status != ResearchStatus.REVIEW_REQUIRED:
        raise HTTPException(409, "Le contrôle qualité exige l'étape de révision")
    verified = sum(1 for source in item.sources if source.verification_status == "VERIFIED")
    return basic_quality_report(language=item.language, topic=item.topic, sections=[section.content for section in item.sections], include_references=item.include_references, verified_source_count=verified, target_pages=item.target_pages, estimated_pages_value=Decimal(item.estimated_pages or 0))


@router.post("/requests/{request_id}/approve")
def approve_request(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.approve"))):
    _guard_enabled()
    item = _get_request(db, request_id, details=True)
    if item.status != ResearchStatus.REVIEW_REQUIRED or not item.sections or any(not section.content.strip() for section in item.sections):
        raise HTTPException(409, "Toutes les sections doivent être révisées avant approbation")
    if item.include_references and not any(source.verification_status == "VERIFIED" for source in item.sources):
        raise HTTPException(409, "Une source vérifiée est requise")
    if item.include_images:
        approved_assets = sum(1 for asset in item.assets if asset.approval_status == "APPROVED")
        if approved_assets < item.requested_image_count:
            raise HTTPException(409, "Toutes les images demandées doivent être ajoutées et approuvées")
    for section in item.sections:
        _save_version(db, section, user.id, "final_approval")
    item.approved_by, item.approved_at = user.id, datetime.utcnow()
    _set_status(db, item, ResearchStatus.APPROVED, user.id, "Human approval completed")
    db.commit()
    return _serialize(item)


@router.post("/requests/{request_id}/register-export")
def register_export(request_id: int, body: ExportRegister, db: Session = Depends(get_db), user=Depends(require_permission("research.export"))):
    """Record a reviewed client-side export without accepting untrusted file paths."""
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status not in {ResearchStatus.APPROVED, ResearchStatus.EXPORTED}:
        raise HTTPException(409, "Seule une recherche approuvée peut être exportée")
    _set_status(db, item, ResearchStatus.EXPORTING, user.id, f"{body.file_type.upper()} export started")
    latest = db.query(func.max(ResearchOutput.version)).filter(ResearchOutput.request_id == item.id, ResearchOutput.file_type == body.file_type).scalar() or 0
    output = ResearchOutput(
        request_id=item.id, file_type=body.file_type,
        storage_key=f"client-download:{item.reference}:{body.file_type}:v{int(latest) + 1}",
        version=int(latest) + 1, page_count=body.page_count, file_size=body.file_size, created_by=user.id,
    )
    db.add(output)
    if body.page_count:
        item.actual_pages = body.page_count
    _set_status(db, item, ResearchStatus.EXPORTED, user.id, f"{body.file_type.upper()} export completed")
    db.commit()
    return {"ok": True, "output_id": output.id, "version": output.version, "status": item.status}


@router.post("/requests/{request_id}/mark-printed")
def mark_printed(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.print"))):
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status not in {ResearchStatus.EXPORTED, ResearchStatus.PRINTED, ResearchStatus.COMPLETED}:
        raise HTTPException(409, "Un document exporté et approuvé est requis avant impression")
    if item.status == ResearchStatus.COMPLETED:
        db.add(ResearchStatusHistory(request_id=item.id, previous_status=item.status, new_status=item.status, comment="Completed document reprinted", changed_by=user.id))
    else:
        _set_status(db, item, ResearchStatus.PRINTED, user.id, "Print dialog opened by employee")
    db.commit()
    return {"ok": True, "status": item.status}


@router.post("/requests/{request_id}/prepare-pos")
def prepare_pos(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.create"))):
    """Expose an approved request as the existing manual-price ERP service."""
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status not in {ResearchStatus.APPROVED, ResearchStatus.EXPORTED, ResearchStatus.PRINTED, ResearchStatus.COMPLETED}:
        raise HTTPException(409, "La demande doit être approuvée avant son ajout au POS")
    try:
        service = ensure_research_service(db)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(409, "Impossible de préparer le service POS") from exc
    return {
        "product_id": service.id, "code": service.code, "name": service.name,
        "pricing_mode": service.pricing_mode, "suggested_price": float(item.final_price or item.estimated_price or 0),
        "request_reference": item.reference,
    }


@router.post("/requests/{request_id}/export-pdf")
def export_pdf(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.export"))):
    _guard_enabled()
    item = _get_request(db, request_id, details=True)
    if item.status not in {ResearchStatus.APPROVED, ResearchStatus.EXPORTED}:
        raise HTTPException(409, "Seule une recherche approuvée peut être exportée")
    _set_status(db, item, ResearchStatus.EXPORTING, user.id, "Server PDF export started")
    try:
        content, page_count = build_research_pdf(item, _storage_root())
        folder = _storage_root() / str(item.id) / "outputs"
        folder.mkdir(parents=True, exist_ok=True)
        latest = db.query(func.max(ResearchOutput.version)).filter(
            ResearchOutput.request_id == item.id, ResearchOutput.file_type == "pdf",
        ).scalar() or 0
        version = int(latest) + 1
        path = (folder / f"{item.reference}-v{version}.pdf").resolve()
        path.write_bytes(content)
        db.add(ResearchOutput(
            request_id=item.id, file_type="pdf", storage_key=str(path.relative_to(_storage_root())),
            version=version, page_count=page_count, file_size=len(content), created_by=user.id,
        ))
        _set_status(db, item, ResearchStatus.EXPORTED, user.id, "Server PDF export completed")
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, "Impossible de préparer le PDF arabe. Réessayez.") from exc
    return FileResponse(path, media_type="application/pdf", filename=f"{item.reference}.pdf")


@router.post("/requests/{request_id}/export-docx")
def export_docx(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.export"))):
    _guard_enabled()
    item = _get_request(db, request_id, details=True)
    if item.status not in {ResearchStatus.APPROVED, ResearchStatus.EXPORTED}:
        raise HTTPException(409, "Seule une recherche approuvée peut être exportée")
    _set_status(db, item, ResearchStatus.EXPORTING, user.id, "DOCX export started")
    try:
        content = build_research_docx(item)
        folder = _storage_root() / str(item.id) / "outputs"
        folder.mkdir(parents=True, exist_ok=True)
        latest = db.query(func.max(ResearchOutput.version)).filter(ResearchOutput.request_id == item.id, ResearchOutput.file_type == "docx").scalar() or 0
        version = int(latest) + 1
        path = (folder / f"{item.reference}-v{version}.docx").resolve()
        path.write_bytes(content)
        output = ResearchOutput(
            request_id=item.id, file_type="docx", storage_key=str(path.relative_to(_storage_root())),
            version=version, file_size=len(content), created_by=user.id,
        )
        db.add(output)
        _set_status(db, item, ResearchStatus.EXPORTED, user.id, "DOCX export completed")
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, "Impossible de préparer le document DOCX") from exc
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{item.reference}.docx",
    )


@router.post("/requests/{request_id}/sources", status_code=201)
def create_source(request_id: int, body: SourceCreate, db: Session = Depends(get_db), user=Depends(require_permission("research.edit"))):
    _guard_enabled()
    _get_request(db, request_id)
    source = ResearchSource(
        request_id=request_id, created_by=user.id, verification_status="PENDING",
        used_sections_json=json.dumps(body.used_section_ids), **body.model_dump(exclude={"used_section_ids"}),
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return {"id": source.id, "verification_status": source.verification_status}


@router.post("/sources/{source_id}/verify")
def verify_source(source_id: int, body: SourceVerify, db: Session = Depends(get_db), user=Depends(require_permission("research.approve"))):
    _guard_enabled()
    source = db.query(ResearchSource).filter(ResearchSource.id == source_id).first()
    if not source:
        raise HTTPException(404, "Source introuvable")
    source.verification_status = body.status
    if body.notes is not None:
        source.notes = body.notes
    db.commit()
    return {"ok": True, "verification_status": source.verification_status}


@router.post("/requests/{request_id}/assets", status_code=201)
def upload_asset(
    request_id: int, image: UploadFile = File(...), section_id: int | None = Form(default=None),
    caption: str = Form(default="", max_length=500), alt_text: str = Form(default="", max_length=500),
    license_info: str = Form(default="", max_length=500), db: Session = Depends(get_db),
    user=Depends(require_permission("research.edit")),
):
    _guard_enabled()
    item = _get_request(db, request_id)
    if item.status in {ResearchStatus.COMPLETED, ResearchStatus.CANCELLED}:
        raise HTTPException(409, "Cette demande n'accepte plus de nouvelles images")
    if section_id and not db.query(ResearchSection.id).filter(ResearchSection.id == section_id, ResearchSection.request_id == request_id).first():
        raise HTTPException(422, "La section ne fait pas partie de cette demande")
    data, extension = _read_image(image)
    folder = _storage_root() / str(request_id)
    folder.mkdir(parents=True, exist_ok=True)
    file_name = f"asset-{uuid4().hex}{extension}"
    path = (folder / file_name).resolve()
    if folder.resolve() not in path.parents:
        raise HTTPException(400, "Chemin de stockage invalide")
    path.write_bytes(data)
    try:
        asset = ResearchAsset(
            request_id=request_id, section_id=section_id, storage_key=str(path.relative_to(_storage_root())),
            original_file_name=Path(image.filename or "image").name[:255], mime_type=image.content_type.lower(),
            file_size=len(data), caption=caption, alt_text=alt_text, license_info=license_info,
            approval_status="PENDING", created_by=user.id,
        )
        db.add(asset)
        db.commit()
        db.refresh(asset)
    except Exception:
        path.unlink(missing_ok=True)
        db.rollback()
        raise
    return {"id": asset.id, "approval_status": asset.approval_status}


@router.post("/requests/{request_id}/discover-images")
def discover_images(request_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.generate"))):
    _guard_enabled()
    item = _get_request(db, request_id, details=True)
    try:
        created = _discover_web_assets(db, item, user.id)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(503, "La recherche d'images est temporairement indisponible. Réessayez dans un moment.") from exc
    if not created:
        raise HTTPException(404, "Aucune nouvelle image pertinente et réutilisable n'a été trouvée.")
    return {"created": created, "approval_status": "PENDING"}


@router.post("/assets/{asset_id}/approve")
def approve_asset(asset_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.approve"))):
    _guard_enabled()
    asset = db.query(ResearchAsset).filter(ResearchAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Image introuvable")
    asset.approval_status = "APPROVED"
    db.commit()
    return {"ok": True, "approval_status": asset.approval_status}


@router.get("/assets/{asset_id}/download")
def download_asset(asset_id: int, db: Session = Depends(get_db), user=Depends(require_permission("research.view"))):
    _guard_enabled()
    asset = db.query(ResearchAsset).filter(ResearchAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Image introuvable")
    root = _storage_root()
    path = (root / asset.storage_key).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(404, "Fichier image introuvable")
    return FileResponse(path, media_type=asset.mime_type, filename=asset.original_file_name)


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user=Depends(require_permission("research.view"))):
    _guard_enabled()
    grouped = dict(db.query(ResearchRequest.status, func.count(ResearchRequest.id)).group_by(ResearchRequest.status).all())
    return {
        "total": sum(grouped.values()), "by_status": grouped,
        "waiting_review": grouped.get(ResearchStatus.REVIEW_REQUIRED.value, 0),
        "completed": grouped.get(ResearchStatus.COMPLETED.value, 0),
        "estimated_revenue": float(db.query(func.coalesce(func.sum(ResearchRequest.estimated_price), 0)).scalar() or 0),
    }
