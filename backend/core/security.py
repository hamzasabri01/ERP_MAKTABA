"""core/security.py — JWT tokens and password hashing."""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Optional
import base64
import bcrypt
import hmac
import hashlib
import json
import secrets
import struct
import time
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.config import env, env_int

SECRET_KEY = env("SECRET_KEY", "proerp-super-secret-change-in-production-2024")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 15)
REFRESH_TOKEN_EXPIRE_DAYS = env_int("REFRESH_TOKEN_EXPIRE_DAYS", 3650)
MFA_TOKEN_EXPIRE_MINUTES = env_int("MFA_TOKEN_EXPIRE_MINUTES", 5)
MFA_SECRET_PREFIX = "enc:v1:"

bearer_scheme = HTTPBearer()

INSECURE_PRODUCTION_SECRETS = {
    "",
    "change-this-secret-before-production",
    "proerp-super-secret-change-in-production-2024",
}


def validate_runtime_security(app_env: str | None = None, secret_key: str | None = None) -> None:
    environment = (app_env if app_env is not None else env("APP_ENV", "development")).strip().lower()
    configured_secret = secret_key if secret_key is not None else SECRET_KEY
    if environment not in {"production", "prod"}:
        return
    if configured_secret in INSECURE_PRODUCTION_SECRETS or len(configured_secret) < 32:
        raise RuntimeError("Production SECRET_KEY must be a unique random value of at least 32 characters")


def build_content_security_policy(*, is_https: bool) -> str:
    directives = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
    if is_https:
        directives.append("upgrade-insecure-requests")
    return "; ".join(directives)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def validate_password_strength(password: str, username: str = "") -> None:
    if len(password or "") < 8:
        raise HTTPException(status_code=400, detail="Mot de passe trop court: 8 caracteres minimum")
    if username and username.lower() in password.lower():
        raise HTTPException(status_code=400, detail="Le mot de passe ne doit pas contenir le nom utilisateur")
    if not any(ch.isalpha() for ch in password) or not any(ch.isdigit() for ch in password):
        raise HTTPException(status_code=400, detail="Le mot de passe doit contenir au moins une lettre et un chiffre")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode["exp"] = expire
    to_encode.setdefault("token_use", "access")
    to_encode.setdefault("jti", secrets.token_urlsafe(24))
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_mfa_token(user_id: int, username: str, session_version: int, auth_method: str, auth_context: dict | None = None) -> str:
    return create_access_token(
        {
            "sub": str(user_id),
            "username": username,
            "sv": int(session_version or 1),
            "token_use": "mfa",
            "auth_method": auth_method,
            "auth_context": auth_context or {},
        },
        expires_delta=timedelta(minutes=MFA_TOKEN_EXPIRE_MINUTES),
    )


def create_refresh_token(user_id: int, session_version: int, auth_method: str, mfa_verified: bool) -> tuple[str, str, str]:
    csrf_token = secrets.token_urlsafe(32)
    jti = secrets.token_urlsafe(32)
    payload = {
        "sub": str(user_id),
        "sv": int(session_version or 1),
        "token_use": "refresh",
        "csrf": csrf_token,
        "jti": jti,
        "auth_method": auth_method,
        "mfa": bool(mfa_verified),
        "exp": datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM), csrf_token, jti


def security_hash(value: str, purpose: str) -> str:
    return hmac.new(
        SECRET_KEY.encode("utf-8"),
        f"{purpose}:{value}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def hash_refresh_jti(jti: str) -> str:
    return security_hash(jti, "refresh-jti")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("utf-8").rstrip("=")


def _mfa_fernet() -> Fernet:
    digest = hashlib.sha256(f"proerp-mfa-v1:{SECRET_KEY}".encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_mfa_secret(secret: str) -> str:
    value = str(secret or "")
    if not value or value.startswith(MFA_SECRET_PREFIX):
        return value
    encrypted = _mfa_fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return MFA_SECRET_PREFIX + encrypted


def decrypt_mfa_secret(value: str) -> str:
    stored = str(value or "")
    if not stored:
        return ""
    if not stored.startswith(MFA_SECRET_PREFIX):
        return stored
    try:
        return _mfa_fernet().decrypt(stored[len(MFA_SECRET_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError) as exc:
        raise ValueError("MFA secret cannot be decrypted") from exc


def generate_recovery_codes(count: int = 10) -> tuple[list[str], str]:
    codes = [f"{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}" for _ in range(count)]
    hashes = [security_hash(code, "mfa-recovery") for code in codes]
    return codes, json.dumps(hashes)


def consume_recovery_code(stored_hashes: str, code: str) -> tuple[bool, str]:
    try:
        hashes = json.loads(stored_hashes or "[]")
    except json.JSONDecodeError:
        hashes = []
    candidate = security_hash(str(code or "").strip().upper(), "mfa-recovery")
    for index, stored in enumerate(hashes):
        if hmac.compare_digest(str(stored), candidate):
            remaining = hashes[:index] + hashes[index + 1:]
            return True, json.dumps(remaining)
    return False, json.dumps(hashes)


def provisioning_uri(secret: str, username: str, issuer: str = "Maktaba Print") -> str:
    label = f"{issuer}:{username}"
    return f"otpauth://totp/{label}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30"


def _totp(secret: str, counter: int, digits: int = 6) -> str:
    padding = "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode((secret + padding).upper())
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10 ** digits)).zfill(digits)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    if not secret or not code:
        return False
    clean = "".join(ch for ch in str(code) if ch.isdigit())
    if len(clean) != 6:
        return False
    counter = int(time.time() // 30)
    expected_codes = [_totp(secret, counter + offset) for offset in range(-window, window + 1)]
    return any(hmac.compare_digest(clean, expected) for expected in expected_codes)


def validate_access_session(payload: dict, user) -> None:
    try:
        token_version = int(payload.get("sv", 0))
        user_version = int(getattr(user, "session_version", 1) or 1)
    except (TypeError, ValueError):
        token_version = 0
        user_version = 1
    if payload.get("token_use") != "access" or token_version != user_version:
        raise HTTPException(status_code=401, detail="Session expiree ou revoquee")


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    from core.database import SessionLocal
    from models.user import User
    from sqlalchemy.orm import joinedload
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    db = SessionLocal()
    try:
        user = db.query(User).options(joinedload(User.role)).filter(User.id == int(user_id), User.is_active == True).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found or inactive")
        validate_access_session(payload, user)
        return user
    finally:
        db.close()


def get_user_permissions(user) -> set[str]:
    if not user or not user.role or not user.role.permissions:
        return set()
    return {p.strip() for p in user.role.permissions.split(",") if p.strip()}


def user_has_permission(user, permission: str) -> bool:
    permissions = get_user_permissions(user)
    return "all" in permissions or permission in permissions


def require_permission(permission: str):
    def dependency(user=Depends(get_current_user)):
        if not user_has_permission(user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Acces refuse: permission requise",
            )
        return user

    return dependency
