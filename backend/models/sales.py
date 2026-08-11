"""models/sales.py"""
from sqlalchemy import Boolean, Column, Integer, String, Numeric, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        Index("ix_sale_datetime", "date_time"),
        Index("ix_sale_client",   "client_id"),
        Index("ix_sale_doctype",  "doc_type"),
        Index("ix_sale_status",   "status"),
    )
    id           = Column(Integer, primary_key=True)
    number       = Column(String(50), unique=True)
    doc_type     = Column(String(20), default="invoice")  # invoice|quote|delivery|credit_note
    status       = Column(String(20), default="draft")    # draft|confirmed|partially_paid|paid|cancelled
    client_id    = Column(Integer, ForeignKey("clients.id"))
    date_time    = Column(DateTime, default=datetime.now)
    due_date     = Column(DateTime)
    notes        = Column(Text, default="")
    discount     = Column(Numeric(7, 4), default=0)
    discount_amount = Column(Numeric(18, 2), nullable=False, default=0)
    subtotal     = Column(Numeric(18, 2), default=0)
    tax_amount   = Column(Numeric(18, 2), default=0)
    total_amount = Column(Numeric(18, 2), default=0)
    paid_amount  = Column(Numeric(18, 2), default=0)
    payment_mode = Column(String(30), default="Espèce")
    created_by   = Column(Integer, ForeignKey("users.id"))
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    parent_id    = Column(Integer, ForeignKey("sales.id"), nullable=True)
    version      = Column(Integer, nullable=False, default=1)
    currency_code = Column(String(3), nullable=False, default="MAD")
    price_tax_mode = Column(String(10), nullable=False, default="exclusive")
    rounding_scope = Column(String(10), nullable=False, default="line")
    tax_breakdown_json = Column(Text, nullable=False, default="[]")

    client  = relationship("Client", back_populates="sales")
    items   = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])

    @property
    def balance_due(self):
        return max((self.total_amount or 0) - (self.paid_amount or 0), 0)

    @property
    def is_paid(self):
        return self.paid_amount >= self.total_amount and (self.total_amount or 0) > 0


class SaleItem(Base):
    __tablename__ = "sale_items"
    id             = Column(Integer, primary_key=True)
    sale_id        = Column(Integer, ForeignKey("sales.id"))
    product_id     = Column(Integer, ForeignKey("products.id"))
    description    = Column(Text, default="")
    quantity       = Column(Numeric(18, 4), default=1)
    sale_unit      = Column(String(20), nullable=False, default="")
    conversion_factor = Column(Numeric(18, 4), nullable=False, default=1)
    base_quantity  = Column(Numeric(18, 4), nullable=False, default=0)
    unit_price     = Column(Numeric(18, 4), default=0)
    catalog_unit_price = Column(Numeric(18, 4), default=0)
    price_overridden = Column(Boolean, nullable=False, default=False)
    price_override_reason = Column(Text, default="")
    purchase_price = Column(Numeric(18, 4), default=0)
    discount       = Column(Numeric(7, 4), default=0)
    tax_rate       = Column(Numeric(7, 4), default=20)
    discount_amount = Column(Numeric(18, 2), nullable=False, default=0)
    line_total     = Column(Numeric(18, 2), default=0)
    tax_amount     = Column(Numeric(18, 2), nullable=False, default=0)
    total_amount   = Column(Numeric(18, 2), nullable=False, default=0)
    sale    = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sale_items")

    def compute_total(self):
        from decimal import Decimal
        base = (self.quantity or Decimal("1")) * (self.unit_price or Decimal("0"))
        self.line_total = base * (Decimal("1") - (self.discount or Decimal("0")) / Decimal("100"))
        return self.line_total
