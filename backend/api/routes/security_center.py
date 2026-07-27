"""Security center endpoints for audit supervision and PFE cybersecurity module."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from api.audit import compute_log_hash
from core.database import get_db
from core.security import get_current_user
from models.audit import AuditLog
from models.user import User, Role

router = APIRouter()


def _risk_level(score: int) -> str:
    if score >= 70:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def _audit_out(row: AuditLog) -> dict:
    creator = getattr(row, "creator", None)
    return {
        "id": row.id,
        "action": row.action,
        "entity": row.entity,
        "entity_id": row.entity_id or "",
        "summary": row.summary or "",
        "ip_address": row.ip_address or "",
        "user_agent": row.user_agent or "",
        "created_by": row.created_by,
        "created_by_name": (creator.full_name or creator.username) if creator else "",
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "log_hash": row.log_hash or "",
    }


def _verify_integrity(db: Session, limit: int = 5000) -> dict:
    rows = db.query(AuditLog).order_by(AuditLog.id.asc()).limit(limit).all()
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
            broken.append(row.id)
        previous_hash = row.log_hash or ""
    return {
        "ok": not broken,
        "checked": len(rows),
        "legacy_count": legacy_count,
        "broken_count": len(broken),
        "last_hash": previous_hash,
    }


@router.get("/overview")
def security_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    day_start = now - timedelta(hours=24)
    week_start = now - timedelta(days=7)

    failed_24h = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action == "login_failed",
        AuditLog.created_at >= day_start,
    ).scalar() or 0
    success_24h = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action == "login_success",
        AuditLog.created_at >= day_start,
    ).scalar() or 0
    sensitive_24h = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action.in_(["delete", "restore", "cancel", "stock_adjustment"]),
        AuditLog.created_at >= day_start,
    ).scalar() or 0
    unique_ips = db.query(func.count(func.distinct(AuditLog.ip_address))).filter(
        AuditLog.created_at >= week_start,
        AuditLog.ip_address != "",
    ).scalar() or 0
    active_users = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0
    mfa_users = db.query(func.count(User.id)).filter(User.is_active == True, User.mfa_enabled == True).scalar() or 0
    roles = db.query(func.count(Role.id)).scalar() or 0
    integrity = _verify_integrity(db)

    score = min(100, int(failed_24h * 10 + sensitive_24h * 8 + (0 if integrity["ok"] else 45)))
    alerts = []
    if failed_24h >= 5:
        alerts.append({"level": "high", "title": "Brute force possible", "message": f"{failed_24h} tentatives echouees dans 24h"})
    if sensitive_24h >= 3:
        alerts.append({"level": "medium", "title": "Activite sensible elevee", "message": f"{sensitive_24h} actions critiques dans 24h"})
    if not integrity["ok"]:
        alerts.append({"level": "high", "title": "Integrite audit compromise", "message": "La chaine hash contient des incoherences"})
    if active_users and mfa_users == 0:
        alerts.append({"level": "medium", "title": "MFA non deploye", "message": "Aucun utilisateur actif n'a active le deuxieme facteur"})
    if not alerts:
        alerts.append({"level": "low", "title": "Etat stable", "message": "Aucun signal critique detecte"})

    recent = db.query(AuditLog).options(joinedload(AuditLog.creator)).order_by(AuditLog.created_at.desc()).limit(12).all()
    failed_recent = db.query(AuditLog).options(joinedload(AuditLog.creator)).filter(
        AuditLog.action == "login_failed",
    ).order_by(AuditLog.created_at.desc()).limit(10).all()

    return {
        "risk_score": score,
        "risk_level": _risk_level(score),
        "metrics": {
            "failed_logins_24h": failed_24h,
            "successful_logins_24h": success_24h,
            "sensitive_actions_24h": sensitive_24h,
            "unique_ips_7d": unique_ips,
            "active_users": active_users,
            "mfa_users": mfa_users,
            "mfa_coverage_pct": round((mfa_users / active_users) * 100, 1) if active_users else 0,
            "roles": roles,
        },
        "integrity": integrity,
        "alerts": alerts,
        "recent_activity": [_audit_out(row) for row in recent],
        "failed_logins": [_audit_out(row) for row in failed_recent],
    }
