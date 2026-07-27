"""Authentication, MFA, refresh rotation, revocation, and account security."""
from __future__ import annotations

from datetime import datetime, timedelta
from functools import lru_cache
import hmac
import json
import ssl
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import jwt
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.audit import log_action
from api.schemas import (
    AuthActionResponse,
    FirebaseLoginRequest,
    LoginRequest,
    LoginResponse,
    MfaDisableRequest,
    MfaEnableRequest,
    MfaEnableResponse,
    MfaRecoveryCodesResponse,
    MfaSetupRequest,
    MfaSetupResponse,
    MfaVerifyRequest,
    PasswordChangeRequest,
    ProfileUpdate,
    TokenResponse,
    UserOut,
)
from core.config import env, env_bool, env_int
from core.database import get_db
from core.request_security import client_ip
from core.security import (
    consume_recovery_code,
    create_access_token,
    create_mfa_token,
    create_refresh_token,
    decode_token,
    decrypt_mfa_secret,
    encrypt_mfa_secret,
    generate_recovery_codes,
    generate_totp_secret,
    get_current_user,
    hash_password,
    hash_refresh_jti,
    provisioning_uri,
    security_hash,
    validate_password_strength,
    verify_password,
    verify_totp,
)
from models.auth_security import AuthRateLimitAttempt
from models.user import User

router = APIRouter()
FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
REFRESH_COOKIE = "proerp_refresh"
CSRF_COOKIE = "proerp_csrf"
LOGIN_WINDOW_MINUTES = env_int("LOGIN_RATE_WINDOW_MINUTES", 15)
LOGIN_MAX_ATTEMPTS = env_int("LOGIN_RATE_MAX_ATTEMPTS", 8)
MFA_MAX_ATTEMPTS = env_int("MFA_RATE_MAX_ATTEMPTS", 8)
REFRESH_MAX_ATTEMPTS = env_int("REFRESH_RATE_MAX_ATTEMPTS", 20)


def _permissions(value: str | None) -> list[str]:
    if not value:
        return []
    if value == "all":
        return ["all"]
    return [permission.strip() for permission in value.split(",") if permission.strip()]


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name or "",
        email=user.email or "",
        role_id=user.role_id,
        role_name=user.role.name if user.role else None,
        role_description=user.role.description or "" if user.role else "",
        permissions=_permissions(user.role.permissions) if user.role else [],
        is_active=user.is_active,
        mfa_enabled=bool(getattr(user, "mfa_enabled", False)),
    )


def _attempt_key(raw_key: str) -> str:
    return security_hash(raw_key.strip().lower(), "auth-rate-limit")


def _enforce_rate_limit(db: Session, scope: str, raw_key: str, maximum: int, window_minutes: int = LOGIN_WINDOW_MINUTES) -> None:
    cutoff = datetime.utcnow() - timedelta(minutes=window_minutes)
    key_hash = _attempt_key(raw_key)
    db.query(AuthRateLimitAttempt).filter(AuthRateLimitAttempt.attempted_at < cutoff).delete(synchronize_session=False)
    attempts = db.query(func.count(AuthRateLimitAttempt.id)).filter(
        AuthRateLimitAttempt.scope == scope,
        AuthRateLimitAttempt.key_hash == key_hash,
        AuthRateLimitAttempt.attempted_at >= cutoff,
    ).scalar() or 0
    if attempts >= maximum:
        raise HTTPException(status_code=429, detail="Trop de tentatives. Reessayez plus tard")


def _register_failure(db: Session, scope: str, raw_key: str) -> None:
    db.add(AuthRateLimitAttempt(scope=scope, key_hash=_attempt_key(raw_key), attempted_at=datetime.utcnow()))


def _clear_failures(db: Session, scope: str, raw_key: str) -> None:
    db.query(AuthRateLimitAttempt).filter(
        AuthRateLimitAttempt.scope == scope,
        AuthRateLimitAttempt.key_hash == _attempt_key(raw_key),
    ).delete(synchronize_session=False)


def _login_key(request: Request, identity: str) -> str:
    return f"{client_ip(request)}:{identity.strip().lower()}"


def _cookie_secure() -> bool:
    environment = env("APP_ENV", "development").strip().lower()
    return env_bool("COOKIE_SECURE", environment in {"production", "prod"})


def _cookie_samesite() -> str:
    value = env("COOKIE_SAMESITE", "strict").strip().lower()
    if value not in {"strict", "lax", "none"}:
        raise RuntimeError("COOKIE_SAMESITE must be strict, lax, or none")
    if value == "none" and not _cookie_secure():
        raise RuntimeError("COOKIE_SECURE must be true when COOKIE_SAMESITE=none")
    return value


def _set_session_cookies(response: Response, refresh_token: str, csrf_token: str) -> None:
    max_age = env_int("REFRESH_TOKEN_EXPIRE_DAYS", 7) * 86400
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=max_age,
        httponly=True,
        secure=_cookie_secure(),
        samesite=_cookie_samesite(),
        path="/api/auth",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=_cookie_secure(),
        samesite=_cookie_samesite(),
        path="/",
    )


def _clear_session_cookies(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _issue_session(db: Session, user: User, response: Response, auth_method: str, *, mfa_verified: bool) -> TokenResponse:
    version = int(getattr(user, "session_version", 1) or 1)
    refresh_token, csrf_token, refresh_jti = create_refresh_token(user.id, version, auth_method, mfa_verified)
    user.refresh_jti_hash = hash_refresh_jti(refresh_jti)
    access_token = create_access_token({
        "sub": str(user.id),
        "username": user.username,
        "sv": version,
        "auth_method": auth_method,
        "mfa": bool(mfa_verified),
    })
    _set_session_cookies(response, refresh_token, csrf_token)
    return TokenResponse(access_token=access_token, user=_user_out(user), csrf_token=csrf_token)


def _mfa_challenge(user: User, auth_method: str) -> LoginResponse:
    token = create_mfa_token(
        user.id,
        user.username,
        int(getattr(user, "session_version", 1) or 1),
        auth_method,
    )
    return LoginResponse(mfa_required=True, mfa_token=token)


def _verify_refresh_request(request: Request, csrf_header: str) -> dict:
    refresh_token = request.cookies.get(REFRESH_COOKIE, "")
    csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Session de renouvellement absente")
    payload = decode_token(refresh_token)
    if payload.get("token_use") != "refresh":
        raise HTTPException(status_code=401, detail="Session de renouvellement invalide")
    expected_csrf = str(payload.get("csrf") or "")
    if not expected_csrf or not csrf_cookie or not csrf_header:
        raise HTTPException(status_code=403, detail="Protection CSRF requise")
    if not hmac.compare_digest(expected_csrf, csrf_cookie) or not hmac.compare_digest(expected_csrf, csrf_header):
        raise HTTPException(status_code=403, detail="Protection CSRF invalide")
    return payload


def _validate_refresh_user(db: Session, payload: dict) -> User:
    try:
        user_id = int(payload.get("sub", 0))
        token_version = int(payload.get("sv", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Session de renouvellement invalide")
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user or token_version != int(user.session_version or 1):
        raise HTTPException(status_code=401, detail="Session expiree ou revoquee")
    if not hmac.compare_digest(user.refresh_jti_hash or "", hash_refresh_jti(str(payload.get("jti") or ""))):
        raise HTTPException(status_code=401, detail="Session de renouvellement deja utilisee ou revoquee")
    return user


@lru_cache(maxsize=1)
def _firebase_certs() -> dict:
    context = ssl.create_default_context()
    with urllib.request.urlopen(FIREBASE_CERTS_URL, timeout=8, context=context) as response:
        return json.loads(response.read().decode("utf-8"))


def _verify_firebase_token(id_token: str) -> dict:
    project_id = env("FIREBASE_PROJECT_ID", "app-erp-622bc")
    if not project_id:
        raise HTTPException(status_code=500, detail="Firebase project non configure")
    try:
        header = jwt.get_unverified_header(id_token)
        key_id = header.get("kid")
        cert = _firebase_certs().get(key_id)
        if not cert:
            _firebase_certs.cache_clear()
            cert = _firebase_certs().get(key_id)
        if not cert:
            raise HTTPException(status_code=401, detail="Certificat Firebase introuvable")
        claims = jwt.decode(
            id_token,
            cert,
            algorithms=["RS256"],
            audience=project_id,
            issuer=f"https://securetoken.google.com/{project_id}",
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token Firebase invalide")
    email = str(claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Email Firebase introuvable")
    return claims


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    key = _login_key(request, body.username)
    _enforce_rate_limit(db, "login", key, LOGIN_MAX_ATTEMPTS)
    user = db.query(User).filter(User.username == body.username, User.is_active == True).first()
    if not user or not verify_password(body.password, user.password_hash):
        _register_failure(db, "login", key)
        log_action(db, user, "login_failed", "auth", body.username, "Tentative de connexion echouee", after={"username": body.username}, request=request)
        db.commit()
        raise HTTPException(status_code=401, detail="Identifiants invalides")
    if user.mfa_enabled:
        log_action(db, user, "mfa_required", "auth", user.id, "Deuxieme facteur requis", request=request)
        db.commit()
        return _mfa_challenge(user, "local")
    _clear_failures(db, "login", key)
    user.last_login = datetime.utcnow()
    result = _issue_session(db, user, response, "local", mfa_verified=False)
    log_action(db, user, "login_success", "auth", user.id, "Connexion locale reussie", request=request)
    db.commit()
    return LoginResponse(access_token=result.access_token, user=result.user, csrf_token=result.csrf_token)


@router.post("/login/mfa", response_model=TokenResponse)
def login_mfa(body: MfaVerifyRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    payload = decode_token(body.mfa_token)
    if payload.get("token_use") != "mfa":
        raise HTTPException(status_code=401, detail="Challenge MFA invalide")
    try:
        user_id = int(payload.get("sub", 0))
        token_version = int(payload.get("sv", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Challenge MFA invalide")
    key = _login_key(request, str(user_id))
    _enforce_rate_limit(db, "mfa", key, MFA_MAX_ATTEMPTS)
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user or not user.mfa_enabled or token_version != int(user.session_version or 1):
        raise HTTPException(status_code=401, detail="Challenge MFA expire ou invalide")
    try:
        totp_valid = verify_totp(decrypt_mfa_secret(user.mfa_secret or ""), body.code)
    except ValueError:
        totp_valid = False
    recovery_valid = False
    remaining_codes = user.mfa_recovery_codes or ""
    if not totp_valid:
        recovery_valid, remaining_codes = consume_recovery_code(user.mfa_recovery_codes or "", body.code)
    if not totp_valid and not recovery_valid:
        _register_failure(db, "mfa", key)
        log_action(db, user, "mfa_failed", "auth", user.id, "Code MFA invalide", request=request)
        db.commit()
        raise HTTPException(status_code=401, detail="Code MFA ou code de recuperation invalide")
    if recovery_valid:
        user.mfa_recovery_codes = remaining_codes
        log_action(db, user, "mfa_recovery_used", "auth", user.id, "Code de recuperation MFA utilise", request=request)
    _clear_failures(db, "mfa", key)
    _clear_failures(db, "login", _login_key(request, user.username))
    user.last_login = datetime.utcnow()
    auth_method = str(payload.get("auth_method") or "local")
    result = _issue_session(db, user, response, auth_method, mfa_verified=True)
    log_action(db, user, "login_success", f"{auth_method}_auth", user.id, "Connexion MFA reussie", request=request)
    db.commit()
    return result


@router.post("/firebase-login", response_model=LoginResponse)
def firebase_login(body: FirebaseLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    key = _login_key(request, "firebase")
    _enforce_rate_limit(db, "firebase", key, LOGIN_MAX_ATTEMPTS)
    try:
        claims = _verify_firebase_token(body.id_token)
    except HTTPException:
        _register_failure(db, "firebase", key)
        db.commit()
        raise
    email = str(claims.get("email") or "").strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email, User.is_active == True).first()
    if not user:
        _register_failure(db, "firebase", key)
        log_action(db, None, "login_failed", "firebase_auth", email, "Compte Firebase sans utilisateur Maktaba Print actif", after={"email": email}, request=request)
        db.commit()
        raise HTTPException(status_code=403, detail="Compte Firebase valide, mais aucun utilisateur Maktaba Print actif avec cet email")
    if user.mfa_enabled:
        log_action(db, user, "mfa_required", "firebase_auth", user.id, "Deuxieme facteur requis apres Firebase", request=request)
        db.commit()
        return _mfa_challenge(user, "firebase")
    _clear_failures(db, "firebase", key)
    user.last_login = datetime.utcnow()
    result = _issue_session(db, user, response, "firebase", mfa_verified=False)
    log_action(db, user, "login_success", "firebase_auth", user.id, "Connexion Firebase reussie", request=request)
    db.commit()
    return LoginResponse(access_token=result.access_token, user=result.user, csrf_token=result.csrf_token)


@router.post("/refresh", response_model=TokenResponse)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    key = _login_key(request, "refresh")
    _enforce_rate_limit(db, "refresh", key, REFRESH_MAX_ATTEMPTS)
    try:
        payload = _verify_refresh_request(request, request.headers.get("x-csrf-token", ""))
        user = _validate_refresh_user(db, payload)
    except HTTPException:
        _register_failure(db, "refresh", key)
        db.commit()
        raise
    _clear_failures(db, "refresh", key)
    result = _issue_session(
        db,
        user,
        response,
        str(payload.get("auth_method") or "local"),
        mfa_verified=bool(payload.get("mfa", False)),
    )
    db.commit()
    return result


@router.get("/csrf")
def csrf_token(request: Request):
    token = request.cookies.get(CSRF_COOKIE, "")
    if not token:
        raise HTTPException(status_code=401, detail="Session de renouvellement absente")
    return {"csrf_token": token}


@router.post("/logout", response_model=AuthActionResponse)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        payload = _verify_refresh_request(request, request.headers.get("x-csrf-token", ""))
        user = _validate_refresh_user(db, payload)
        user.session_version = int(user.session_version or 1) + 1
        user.refresh_jti_hash = ""
        log_action(db, user, "logout", "auth", user.id, "Session revoquee cote serveur", request=request)
        db.commit()
    finally:
        _clear_session_cookies(response)
    return AuthActionResponse(message="Session fermee")


@router.get("/me", response_model=UserOut)
def me(current_user=Depends(get_current_user)):
    return _user_out(current_user)


@router.put("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    user = db.query(User).filter(User.id == current_user.id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouve")
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(user, key, value or "")
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/change-password", response_model=AuthActionResponse)
def change_password(body: PasswordChangeRequest, request: Request, response: Response, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    user = db.query(User).filter(User.id == current_user.id, User.is_active == True).first()
    if not user or not verify_password(body.current_password, user.password_hash):
        log_action(db, user, "password_change_failed", "auth", getattr(user, "id", ""), "Mot de passe actuel invalide", request=request)
        db.commit()
        raise HTTPException(status_code=401, detail="Mot de passe actuel invalide")
    validate_password_strength(body.new_password, user.username)
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit etre different")
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = datetime.utcnow()
    user.session_version = int(user.session_version or 1) + 1
    user.refresh_jti_hash = ""
    log_action(db, user, "password_changed", "auth", user.id, "Mot de passe modifie; sessions revoquees", request=request)
    db.commit()
    _clear_session_cookies(response)
    return AuthActionResponse(message="Mot de passe modifie. Reconnexion requise")


@router.post("/mfa/setup", response_model=MfaSetupResponse)
def setup_mfa(body: MfaSetupRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    user = db.query(User).filter(User.id == current_user.id, User.is_active == True).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mot de passe actuel invalide")
    try:
        secret = decrypt_mfa_secret(user.mfa_secret or "") or generate_totp_secret()
    except ValueError:
        raise HTTPException(status_code=500, detail="Configuration MFA indisponible")
    user.mfa_secret = encrypt_mfa_secret(secret)
    log_action(db, user, "mfa_setup", "auth", user.id, "Configuration MFA preparee", request=request)
    db.commit()
    return MfaSetupResponse(secret=secret, otpauth_uri=provisioning_uri(secret, user.username))


@router.post("/mfa/enable", response_model=MfaEnableResponse)
def enable_mfa(body: MfaEnableRequest, request: Request, response: Response, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    user = db.query(User).filter(User.id == current_user.id, User.is_active == True).first()
    if not user or not user.mfa_secret:
        raise HTTPException(status_code=400, detail="Initialisez MFA avant activation")
    try:
        secret = decrypt_mfa_secret(user.mfa_secret)
    except ValueError:
        raise HTTPException(status_code=500, detail="Configuration MFA indisponible")
    if not verify_totp(secret, body.code):
        log_action(db, user, "mfa_failed", "auth", user.id, "Activation MFA refusee", request=request)
        db.commit()
        raise HTTPException(status_code=400, detail="Code MFA invalide")
    recovery_codes, recovery_hashes = generate_recovery_codes()
    user.mfa_enabled = True
    user.mfa_recovery_codes = recovery_hashes
    user.session_version = int(user.session_version or 1) + 1
    result = _issue_session(db, user, response, "local", mfa_verified=True)
    log_action(db, user, "mfa_enabled", "auth", user.id, "MFA active; codes de recuperation generes", request=request)
    db.commit()
    db.refresh(user)
    return MfaEnableResponse(
        user=_user_out(user),
        recovery_codes=recovery_codes,
        access_token=result.access_token,
        csrf_token=result.csrf_token,
    )


@router.post("/mfa/recovery-codes", response_model=MfaRecoveryCodesResponse)
def regenerate_recovery_codes(body: MfaDisableRequest, request: Request, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    user = db.query(User).filter(User.id == current_user.id, User.is_active == True).first()
    if not user or not user.mfa_enabled or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Verification du compte invalide")
    try:
        valid = verify_totp(decrypt_mfa_secret(user.mfa_secret or ""), body.code)
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail="Code MFA invalide")
    recovery_codes, recovery_hashes = generate_recovery_codes()
    user.mfa_recovery_codes = recovery_hashes
    log_action(db, user, "mfa_recovery_regenerated", "auth", user.id, "Codes de recuperation MFA regeneres", request=request)
    db.commit()
    return MfaRecoveryCodesResponse(recovery_codes=recovery_codes)


@router.post("/mfa/disable", response_model=TokenResponse)
def disable_mfa(body: MfaDisableRequest, request: Request, response: Response, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    user = db.query(User).filter(User.id == current_user.id, User.is_active == True).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mot de passe invalide")
    try:
        totp_valid = user.mfa_enabled and verify_totp(decrypt_mfa_secret(user.mfa_secret or ""), body.code)
    except ValueError:
        totp_valid = False
    recovery_valid, _ = consume_recovery_code(user.mfa_recovery_codes or "", body.code)
    if user.mfa_enabled and not totp_valid and not recovery_valid:
        log_action(db, user, "mfa_failed", "auth", user.id, "Desactivation MFA refusee", request=request)
        db.commit()
        raise HTTPException(status_code=400, detail="Code MFA ou code de recuperation invalide")
    user.mfa_enabled = False
    user.mfa_secret = ""
    user.mfa_recovery_codes = ""
    user.session_version = int(user.session_version or 1) + 1
    result = _issue_session(db, user, response, "local", mfa_verified=False)
    log_action(db, user, "mfa_disabled", "auth", user.id, "MFA desactive", request=request)
    db.commit()
    db.refresh(user)
    return result
