from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from core.database import Base


class OperationKey(Base):
    __tablename__ = "operation_keys"
    __table_args__ = (
        UniqueConstraint("scope", "idempotency_key", name="uq_operation_scope_key"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    scope = Column(String(160), nullable=False)
    idempotency_key = Column(String(128), nullable=False)
    request_hash = Column(String(64), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
