"""models/stock.py"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        UniqueConstraint("operation_key", name="uq_stock_movement_operation"),
        UniqueConstraint("reverses_movement_id", name="uq_stock_movement_reversal"),
        Index("ix_stock_source", "source_type", "source_id"),
        Index("ix_stock_warehouse", "warehouse_code"),
    )
    id            = Column(Integer, primary_key=True)
    product_id    = Column(Integer, ForeignKey("products.id"))
    movement_type = Column(String(20), default="in")  # in|out|adjustment|inventory
    quantity      = Column(Numeric(18, 4), default=0)
    before_qty    = Column(Numeric(18, 4), default=0)
    after_qty     = Column(Numeric(18, 4), default=0)
    unit_cost     = Column(Numeric(18, 4), default=0)
    reference     = Column(String(100), default="")
    notes         = Column(Text, default="")
    warehouse_code = Column(String(30), nullable=False, default="MAIN")
    source_type   = Column(String(30), nullable=False, default="legacy")
    source_id     = Column(Integer)
    source_line_id = Column(Integer)
    operation_key = Column(String(180))
    kind          = Column(String(20), nullable=False, default="movement")
    reverses_movement_id = Column(Integer, ForeignKey("stock_movements.id"))
    created_at    = Column(DateTime, default=datetime.utcnow)
    created_by    = Column(Integer, ForeignKey("users.id"))
    product       = relationship("Product", back_populates="stock_movements")
    creator       = relationship("User", foreign_keys=[created_by])
    reversed_movement = relationship("StockMovement", remote_side=[id], foreign_keys=[reverses_movement_id])


class InventorySession(Base):
    __tablename__ = "inventory_sessions"
    __table_args__ = (
        Index("ix_inventory_session_status", "status"),
        Index("ix_inventory_session_created", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    reference = Column(String(100), nullable=False, unique=True)
    status = Column(String(20), nullable=False, default="draft")
    warehouse_code = Column(String(30), nullable=False, default="MAIN")
    notes = Column(Text, default="")
    idempotency_key = Column(String(128), nullable=False, unique=True)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    counted_by = Column(Integer, ForeignKey("users.id"))
    counted_at = Column(DateTime)
    validated_by = Column(Integer, ForeignKey("users.id"))
    validated_at = Column(DateTime)

    lines = relationship("InventoryCountLine", back_populates="session", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])
    counter = relationship("User", foreign_keys=[counted_by])
    validator = relationship("User", foreign_keys=[validated_by])


class InventoryCountLine(Base):
    __tablename__ = "inventory_count_lines"
    __table_args__ = (
        UniqueConstraint("session_id", "product_id", name="uq_inventory_session_product"),
        Index("ix_inventory_line_product", "product_id"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("inventory_sessions.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    expected_qty = Column(Numeric(18, 4), nullable=False)
    counted_qty = Column(Numeric(18, 4))
    difference = Column(Numeric(18, 4))
    movement_id = Column(Integer, ForeignKey("stock_movements.id"))
    counted_by = Column(Integer, ForeignKey("users.id"))
    counted_at = Column(DateTime)

    session = relationship("InventorySession", back_populates="lines")
    product = relationship("Product")
    movement = relationship("StockMovement", foreign_keys=[movement_id])
    counter = relationship("User", foreign_keys=[counted_by])
