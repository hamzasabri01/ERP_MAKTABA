"""Persistent, non-reusable document numbers and their legal gap trail."""
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from core.database import Base


class DocumentSequence(Base):
    __tablename__ = "document_sequences"
    __table_args__ = (
        UniqueConstraint(
            "company_key",
            "domain",
            "document_type",
            "fiscal_year",
            name="uq_document_sequence_scope",
        ),
        Index("ix_document_sequence_scope", "company_key", "domain", "document_type", "fiscal_year"),
    )

    id = Column(Integer, primary_key=True)
    company_key = Column(String(64), nullable=False, default="default")
    domain = Column(String(20), nullable=False)
    document_type = Column(String(30), nullable=False)
    fiscal_year = Column(Integer, nullable=False)
    next_value = Column(Integer, nullable=False, default=1)
    last_value = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    allocations = relationship("DocumentNumberAllocation", back_populates="sequence")


class DocumentNumberAllocation(Base):
    __tablename__ = "document_number_allocations"
    __table_args__ = (
        UniqueConstraint("domain", "document_number", name="uq_document_allocation_number"),
        UniqueConstraint(
            "company_key",
            "domain",
            "document_type",
            "fiscal_year",
            "serial_number",
            name="uq_document_allocation_serial",
        ),
        Index("ix_document_allocation_status", "status"),
        Index("ix_document_allocation_scope", "company_key", "domain", "document_type", "fiscal_year"),
        Index("ix_document_allocation_document", "domain", "document_id"),
    )

    id = Column(Integer, primary_key=True)
    sequence_id = Column(Integer, ForeignKey("document_sequences.id"), nullable=False)
    company_key = Column(String(64), nullable=False, default="default")
    domain = Column(String(20), nullable=False)
    document_type = Column(String(30), nullable=False)
    fiscal_year = Column(Integer, nullable=False)
    prefix = Column(String(20), nullable=False)
    serial_number = Column(Integer)
    document_number = Column(String(80), nullable=False)
    status = Column(String(20), nullable=False, default="reserved")
    reason = Column(String(120), nullable=False, default="allocated")
    document_id = Column(Integer)
    created_by = Column(Integer, ForeignKey("users.id"))
    allocated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    committed_at = Column(DateTime)
    voided_at = Column(DateTime)

    sequence = relationship("DocumentSequence", back_populates="allocations")
    creator = relationship("User", foreign_keys=[created_by])
