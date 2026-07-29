"""models/purchase.py"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = (
        Index("ix_purchase_datetime", "date_time"),
        Index("ix_purchase_supplier", "supplier_id"),
    )
    id            = Column(Integer, primary_key=True)
    number        = Column(String(50), unique=True)
    doc_type      = Column(String(20), default="order")   # order|receipt
    status        = Column(String(20), default="draft")   # draft|confirmed|partially_received|received|partially_paid|paid|cancelled
    supplier_id   = Column(Integer, ForeignKey("suppliers.id"))
    date_time     = Column(DateTime, default=datetime.now)
    expected_date = Column(DateTime)
    notes         = Column(Text, default="")
    discount      = Column(Numeric(7, 4), nullable=False, default=0)
    discount_amount = Column(Numeric(18, 2), nullable=False, default=0)
    subtotal      = Column(Numeric(18, 2), default=0)
    tax_amount    = Column(Numeric(18, 2), default=0)
    total_amount  = Column(Numeric(18, 2), default=0)
    paid_amount   = Column(Numeric(18, 2), default=0)
    is_paid       = Column(Integer, default=0)
    created_by    = Column(Integer, ForeignKey("users.id"))
    created_at    = Column(DateTime, default=datetime.utcnow)
    version       = Column(Integer, nullable=False, default=1)
    currency_code = Column(String(3), nullable=False, default="MAD")
    price_tax_mode = Column(String(10), nullable=False, default="exclusive")
    rounding_scope = Column(String(10), nullable=False, default="line")
    tax_breakdown_json = Column(Text, nullable=False, default="[]")

    supplier  = relationship("Supplier", back_populates="purchases")
    items     = relationship("PurchaseItem", back_populates="purchase", cascade="all, delete-orphan")
    creator   = relationship("User", foreign_keys=[created_by])

    @property
    def remaining_amount(self):
        return max((self.total_amount or 0) - (self.paid_amount or 0), 0)

    @property
    def payment_status(self):
        if self.remaining_amount <= 0:
            return "paid"
        if (self.paid_amount or 0) > 0:
            return "partial"
        return "unpaid"


class PurchaseItem(Base):
    __tablename__ = "purchase_items"
    id          = Column(Integer, primary_key=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"))
    product_id  = Column(Integer, ForeignKey("products.id"))
    description = Column(Text, default="")
    quantity    = Column(Numeric(18, 4), default=1)
    purchase_unit = Column(String(20), default="")
    conversion_factor = Column(Numeric(18, 4), nullable=False, default=1)
    base_quantity = Column(Numeric(18, 4), nullable=False, default=0)
    unit_price  = Column(Numeric(18, 4), default=0)
    discount    = Column(Numeric(7, 4), nullable=False, default=0)
    tax_rate    = Column(Numeric(7, 4), default=20)
    discount_amount = Column(Numeric(18, 2), nullable=False, default=0)
    line_total  = Column(Numeric(18, 2), default=0)
    tax_amount  = Column(Numeric(18, 2), nullable=False, default=0)
    total_amount = Column(Numeric(18, 2), nullable=False, default=0)
    received_quantity = Column(Numeric(18, 4), nullable=False, default=0)
    received_base_quantity = Column(Numeric(18, 4), nullable=False, default=0)
    purchase    = relationship("Purchase", back_populates="items")
    product     = relationship("Product", back_populates="purchase_items")
