"""models/user.py"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class Role(Base):
    __tablename__ = "roles"
    id          = Column(Integer, primary_key=True)
    name        = Column(String(50), unique=True, nullable=False)
    description = Column(String(300), default="")
    permissions = Column(String(1000), default="")
    users       = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"
    id            = Column(Integer, primary_key=True)
    username      = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    full_name     = Column(String(200), default="")
    email         = Column(String(200), default="")
    role_id       = Column(Integer, ForeignKey("roles.id"))
    is_active     = Column(Boolean, default=True)
    mfa_enabled   = Column(Boolean, default=False)
    mfa_secret    = Column(String(512), default="")
    mfa_recovery_codes = Column(Text, default="")
    session_version = Column(Integer, nullable=False, default=1)
    refresh_jti_hash = Column(String(64), default="")
    password_changed_at = Column(DateTime)
    avatar_path   = Column(String(300), default="")
    created_at    = Column(DateTime, default=datetime.utcnow)
    last_login    = Column(DateTime)
    role          = relationship("Role", back_populates="users")
