"""api/routes/settings.py"""
from fastapi import APIRouter, Depends
from api.audit import log_action
from core.config import BASE_DIR
from core.database import get_db
from core.security import get_current_user
from core.settings_store import load_settings, save_settings, set_smtp_password
from api.schemas import CompanySettings, SmtpPasswordUpdate
from sqlalchemy.orm import Session

router = APIRouter()
SETTINGS_FILE = BASE_DIR / "company_settings.json"
DEFAULTS = CompanySettings().model_dump()

def _load():
    return load_settings(DEFAULTS, path=SETTINGS_FILE)

@router.get("")
def get_settings(user=Depends(get_current_user)):
    return _load()

@router.put("")
def update_settings(body: CompanySettings, db: Session = Depends(get_db), user=Depends(get_current_user)):
    current = _load()
    merged = {**current, **body.model_dump()}
    public = save_settings(merged, path=SETTINGS_FILE)
    log_action(db, user, "update", "settings", "company", "Parametres modifies", before=current, after=merged)
    db.commit()
    return public


@router.put("/smtp-password")
def update_smtp_password(body: SmtpPasswordUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    set_smtp_password(body.password)
    log_action(db, user, "update", "settings", "smtp", "Mot de passe SMTP configure")
    db.commit()
    return {"ok": True, "smtp_password_configured": True}
