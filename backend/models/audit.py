from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    action = Column(String(40), nullable=False)
    entity = Column(String(80), nullable=False)
    entity_id = Column(String(80), default="")
    summary = Column(String(300), default="")
    before_data = Column(Text, default="")
    after_data = Column(Text, default="")
    ip_address = Column(String(80), default="")
    user_agent = Column(String(300), default="")
    previous_hash = Column(String(128), default="")
    log_hash = Column(String(128), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    creator = relationship("User", foreign_keys=[created_by])
