"""models/cash.py"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Text, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class CashSession(Base):
    __tablename__ = "cash_sessions"
    __table_args__ = (
        Index("uq_cash_single_open", "status", unique=True, sqlite_where=text("status = 'open'")),
        Index("ix_cash_session_status", "status"),
    )
    id               = Column(Integer, primary_key=True, autoincrement=True)
    opened_by        = Column(Integer, ForeignKey("users.id"))
    opened_at        = Column(DateTime, default=datetime.now)
    closed_at        = Column(DateTime)
    opening_balance  = Column(Numeric(18, 2), default=0)
    closing_balance  = Column(Numeric(18, 2))
    expected_balance = Column(Numeric(18, 2))
    difference       = Column(Numeric(18, 2))
    status           = Column(String(20), default="open")
    notes            = Column(Text, default="")
    version           = Column(Integer, nullable=False, default=1)
    closed_by         = Column(Integer, ForeignKey("users.id"))
    difference_reason = Column(Text, default="")
    approved_by       = Column(Integer, ForeignKey("users.id"))
    approved_at       = Column(DateTime)
    transactions     = relationship("CashTransaction", back_populates="session", cascade="all, delete-orphan")
    opener           = relationship("User", foreign_keys=[opened_by])
    closer           = relationship("User", foreign_keys=[closed_by])
    approver         = relationship("User", foreign_keys=[approved_by])


class CashTransaction(Base):
    __tablename__ = "cash_transactions"
    __table_args__ = (
        UniqueConstraint("operation_key", name="uq_cash_transaction_operation"),
        UniqueConstraint("reverses_transaction_id", name="uq_cash_transaction_reversal"),
        UniqueConstraint("payment_id", name="uq_cash_transaction_payment"),
        Index("ix_cash_transaction_session", "session_id"),
        Index("ix_cash_transaction_payment", "payment_id"),
    )
    id          = Column(Integer, primary_key=True, autoincrement=True)
    session_id  = Column(Integer, ForeignKey("cash_sessions.id"))
    direction   = Column(String(10), default="in")
    amount      = Column(Numeric(18, 2), default=0)
    source      = Column(String(30), default="manual")
    reference   = Column(String(100), default="")
    description = Column(Text, default="")
    created_at  = Column(DateTime, default=datetime.now)
    created_by  = Column(Integer, ForeignKey("users.id"))
    payment_id  = Column(Integer, ForeignKey("payments.id"))
    kind        = Column(String(20), nullable=False, default="movement")
    reverses_transaction_id = Column(Integer, ForeignKey("cash_transactions.id"))
    operation_key = Column(String(180))
    session     = relationship("CashSession", back_populates="transactions")
    payment     = relationship("Payment", foreign_keys=[payment_id], back_populates="cash_transaction")
    reversed_transaction = relationship("CashTransaction", remote_side=[id], foreign_keys=[reverses_transaction_id])
    creator     = relationship("User", foreign_keys=[created_by])
