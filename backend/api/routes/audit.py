from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from api.schemas import AuditLogOut
from api.audit import compute_log_hash
from core.database import get_db
from core.security import get_current_user
from models.audit import AuditLog
from models.user import User

router = APIRouter()


def _to_out(row: AuditLog) -> AuditLogOut:
    creator = getattr(row, "creator", None)
    return AuditLogOut(
        id=row.id,
        action=row.action,
        entity=row.entity,
        entity_id=row.entity_id or "",
        summary=row.summary or "",
        before_data=row.before_data or "",
        after_data=row.after_data or "",
        ip_address=row.ip_address or "",
        user_agent=row.user_agent or "",
        previous_hash=row.previous_hash or "",
        log_hash=row.log_hash or "",
        created_by=row.created_by,
        created_by_name=(creator.full_name or creator.username) if creator else "",
        created_at=row.created_at,
    )


@router.get("", response_model=List[AuditLogOut])
def list_audit_logs(
    entity: Optional[str] = None,
    entity_id: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(AuditLog).options(joinedload(AuditLog.creator))
    if entity:
        q = q.filter(AuditLog.entity == entity)
    if entity_id:
        q = q.filter(AuditLog.entity_id == str(entity_id))
    if action:
        q = q.filter(AuditLog.action == action)
    if user_id:
        q = q.filter(AuditLog.created_by == user_id)
    rows = q.order_by(AuditLog.created_at.desc()).offset(skip).limit(min(limit, 500)).all()
    return [_to_out(row) for row in rows]


@router.get("/integrity")
def verify_audit_integrity(
    limit: int = 5000,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).limit(min(limit, 20000)).all()
    broken = []
    previous_hash = ""
    legacy_count = 0
    for row in rows:
        if not row.log_hash:
            legacy_count += 1
            previous_hash = ""
            continue
        expected = compute_log_hash(row, previous_hash)
        if row.previous_hash != previous_hash or row.log_hash != expected:
            broken.append({
                "id": row.id,
                "action": row.action,
                "entity": row.entity,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "reason": "hash_mismatch",
            })
        previous_hash = row.log_hash or ""
    return {
        "ok": len(broken) == 0,
        "checked": len(rows),
        "legacy_count": legacy_count,
        "broken_count": len(broken),
        "broken": broken[:50],
        "last_hash": previous_hash,
    }
