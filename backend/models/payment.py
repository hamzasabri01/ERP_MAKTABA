"""models/payment.py"""
from datetime import datetime
from sqlalchemy import Column, DateTime, Numeric, ForeignKey, Integer, String, Text, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from core.database import Base


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("payment_reference", name="uq_payment_reference"),
        UniqueConstraint("operation_key", name="uq_payment_operation"),
        UniqueConstraint("reverses_payment_id", name="uq_payment_reversal"),
        Index("ix_payment_document", "document_type", "document_id"),
        Index("ix_payment_cash_session", "cash_session_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_type = Column(String(30), nullable=False)
    document_id = Column(Integer, nullable=False)
    amount = Column(Numeric(18, 2), default=0)
    payment_mode = Column(String(50), default="Espece")
    reference = Column(String(120), default="")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)
    created_by = Column(Integer, ForeignKey("users.id"))
    kind = Column(String(20), nullable=False, default="payment")
    reverses_payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    idempotency_key = Column(String(128), default="")
    payment_reference = Column(String(80), nullable=False)
    operation_key = Column(String(180))
    cash_session_id = Column(Integer, ForeignKey("cash_sessions.id"))

    cash_session = relationship("CashSession", foreign_keys=[cash_session_id])
    cash_transaction = relationship("CashTransaction", back_populates="payment", uselist=False, foreign_keys="CashTransaction.payment_id")
    reversed_payment = relationship("Payment", remote_side=[id], foreign_keys=[reverses_payment_id])
    creator = relationship("User", foreign_keys=[created_by])
