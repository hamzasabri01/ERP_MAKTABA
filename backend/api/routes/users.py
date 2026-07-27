"""api/routes/users.py"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from core.database import get_db
from core.security import get_current_user, hash_password, validate_password_strength
from models.user import User, Role
from api.schemas import UserCreate, UserUpdate, UserOut, RoleCreate, RoleUpdate, RoleOut

router = APIRouter()

def _split_permissions(value: str | None) -> list[str]:
    if not value:
        return []
    if value == "all":
        return ["all"]
    return [p.strip() for p in value.split(",") if p.strip()]

def _join_permissions(values: list[str] | None) -> str:
    values = values or []
    if "all" in values:
        return "all"
    return ",".join(values)

def _to_out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        username=u.username,
        full_name=u.full_name or "",
        email=u.email or "",
        role_id=u.role_id,
        role_name=u.role.name if u.role else None,
        role_description=u.role.description or "" if u.role else "",
        permissions=_split_permissions(u.role.permissions) if u.role else [],
        is_active=u.is_active,
        mfa_enabled=bool(getattr(u, "mfa_enabled", False)),
    )

def _role_out(r: Role) -> RoleOut:
    return RoleOut(
        id=r.id,
        name=r.name,
        description=r.description or "",
        permissions=_split_permissions(r.permissions),
        user_count=len(r.users or []),
    )

@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_to_out(u) for u in db.query(User).all()]

@router.get("/roles", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [_role_out(r) for r in db.query(Role).order_by(Role.name).all()]

@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(body: RoleCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    existing = db.query(Role).filter(Role.name == body.name).first()
    if existing:
        raise HTTPException(400, "Nom de role deja utilise")
    role = Role(
        name=body.name,
        description=body.description,
        permissions=_join_permissions(body.permissions),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return _role_out(role)

@router.put("/roles/{rid}", response_model=RoleOut)
def update_role(rid: int, body: RoleUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    role = db.query(Role).filter(Role.id == rid).first()
    if not role:
        raise HTTPException(404, "Role non trouve")
    data = body.model_dump(exclude_none=True)
    if "name" in data:
        duplicate = db.query(Role).filter(Role.name == data["name"], Role.id != rid).first()
        if duplicate:
            raise HTTPException(400, "Nom de role deja utilise")
    if "permissions" in data:
        data["permissions"] = _join_permissions(data["permissions"])
    for key, value in data.items():
        setattr(role, key, value)
    db.commit()
    db.refresh(role)
    return _role_out(role)

@router.delete("/roles/{rid}")
def delete_role(rid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    role = db.query(Role).filter(Role.id == rid).first()
    if not role:
        raise HTTPException(404, "Role non trouve")
    if role.users:
        raise HTTPException(400, "Impossible de supprimer un role affecte a des utilisateurs")
    db.delete(role)
    db.commit()
    return {"ok": True}

@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(400, "Nom d'utilisateur déjà pris")
    validate_password_strength(body.password, body.username)
    u = User(username=body.username, password_hash=hash_password(body.password),
             full_name=body.full_name, email=body.email,
             role_id=body.role_id, is_active=body.is_active)
    db.add(u)
    db.commit()
    db.refresh(u)
    return _to_out(u)

@router.put("/{uid}", response_model=UserOut)
def update_user(uid: int, body: UserUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    u = db.query(User).filter(User.id == uid).first()
    if not u: raise HTTPException(404, "Utilisateur non trouvé")
    data = body.model_dump(exclude_none=True)
    if "password" in data:
        password = data.pop("password")
        validate_password_strength(password, u.username)
        u.password_hash = hash_password(password)
        u.password_changed_at = datetime.utcnow()
        u.session_version = int(getattr(u, "session_version", 1) or 1) + 1
        u.refresh_jti_hash = ""
    for k, v in data.items(): setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return _to_out(u)

@router.delete("/{uid}")
def delete_user(uid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    u = db.query(User).filter(User.id == uid).first()
    if not u: raise HTTPException(404, "Utilisateur non trouvé")
    u.is_active = False
    u.session_version = int(getattr(u, "session_version", 1) or 1) + 1
    u.refresh_jti_hash = ""
    db.commit()
    return {"ok": True}
