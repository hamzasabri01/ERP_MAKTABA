"""models/client.py"""
from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class Client(Base):
    __tablename__ = "clients"
    id             = Column(Integer, primary_key=True)
    code           = Column(String(50), unique=True)
    name           = Column(String(200), nullable=False)
    phone          = Column(String(50), default="")
    email          = Column(String(200), default="")
    address        = Column(Text, default="")
    city           = Column(String(100), default="")
    tax_id         = Column(String(100), default="")
    ice            = Column(String(100), default="")
    payment_terms  = Column(Integer, default=30)
    credit_limit   = Column(Numeric(18, 2), default=0)
    credit_balance = Column(Numeric(18, 2), default=0)
    notes          = Column(Text, default="")
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    sales          = relationship("Sale", back_populates="client")

    @property
    def total_sales(self):
        return sum((s.total_amount or 0) for s in self.sales if s.status in ("confirmed", "partially_paid", "paid"))
