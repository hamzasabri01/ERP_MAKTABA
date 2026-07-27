"""Persistent authentication throttling shared by all API workers."""
from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, String

from core.database import Base


class AuthRateLimitAttempt(Base):
    __tablename__ = "auth_rate_limit_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scope = Column(String(32), nullable=False)
    key_hash = Column(String(64), nullable=False)
    attempted_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_auth_rate_scope_key_time", "scope", "key_hash", "attempted_at"),
    )
