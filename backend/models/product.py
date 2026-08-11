"""models/product.py"""
from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from core.database import Base


class Category(Base):
    __tablename__ = "categories"
    id          = Column(Integer, primary_key=True)
    name        = Column(String(100), unique=True, nullable=False)
    description = Column(Text, default="")
    products    = relationship("Product", back_populates="category")


class Supplier(Base):
    __tablename__ = "suppliers"
    id             = Column(Integer, primary_key=True)
    code           = Column(String(50), unique=True)
    company_name   = Column(String(200), nullable=False)
    contact_person = Column(String(200), default="")
    phone          = Column(String(50), default="")
    email          = Column(String(200), default="")
    address        = Column(Text, default="")
    city           = Column(String(100), default="")
    tax_id         = Column(String(100), default="")
    ice            = Column(String(100), default="")
    notes          = Column(Text, default="")
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    products       = relationship("Product", back_populates="supplier")
    purchases      = relationship("Purchase", back_populates="supplier")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        Index("ix_prod_code",    "code"),
        Index("ix_prod_name",    "name"),
        Index("ix_prod_active",  "is_active"),
    )
    id             = Column(Integer, primary_key=True)
    code           = Column(String(50), unique=True)
    name           = Column(String(200), nullable=False)
    category_id    = Column(Integer, ForeignKey("categories.id"))
    supplier_id    = Column(Integer, ForeignKey("suppliers.id"))
    description    = Column(Text, default="")
    purchase_price = Column(Numeric(18, 4), default=0)
    sale_price     = Column(Numeric(18, 4), default=0)
    stock_quantity = Column(Numeric(18, 4), default=0)
    min_stock      = Column(Numeric(18, 4), default=5)
    barcode        = Column(String(100), default="")
    image_path     = Column(String(300))
    unit           = Column(String(20), default="pcs")
    purchase_unit  = Column(String(20), default="pcs")
    purchase_to_base_factor = Column(Numeric(18, 4), nullable=False, default=1)
    allow_fractional_sale = Column(Boolean, nullable=False, default=False)
    sale_unit      = Column(String(20), default="")
    sale_to_base_factor = Column(Numeric(18, 4), nullable=False, default=1)
    sale_unit_price = Column(Numeric(18, 4), nullable=False, default=0)
    tax_rate       = Column(Numeric(7, 4), default=20)
    tva_enabled    = Column(Integer, default=1)
    product_type   = Column(String(20), default="product")  # "product" | "service"
    pricing_mode   = Column(String(20), default="fixed")    # fixed | editable | manual
    is_active      = Column(Integer, default=1)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    category        = relationship("Category", back_populates="products")
    supplier        = relationship("Supplier", back_populates="products")
    sale_items      = relationship("SaleItem", back_populates="product")
    purchase_items  = relationship("PurchaseItem", back_populates="product")
    stock_movements = relationship("StockMovement", back_populates="product")
    bundle_components = relationship(
        "ProductBundleComponent",
        foreign_keys="ProductBundleComponent.bundle_product_id",
        back_populates="bundle",
        cascade="all, delete-orphan",
    )

    @property
    def is_low_stock(self):
        return self.product_type == "product" and self.stock_quantity <= self.min_stock

    @property
    def stock_value(self):
        return (self.stock_quantity or 0) * (self.purchase_price or 0)

    @property
    def margin_pct(self):
        if self.purchase_price and self.purchase_price > 0:
            return ((self.sale_price - self.purchase_price) / self.purchase_price) * 100
        return 0.0


class ProductBundleComponent(Base):
    __tablename__ = "product_bundle_components"
    __table_args__ = (
        UniqueConstraint("bundle_product_id", "component_product_id", name="uq_bundle_component"),
        Index("ix_bundle_component_product", "component_product_id"),
    )

    id = Column(Integer, primary_key=True)
    bundle_product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    component_product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Numeric(18, 4), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    bundle = relationship("Product", foreign_keys=[bundle_product_id], back_populates="bundle_components")
    component = relationship("Product", foreign_keys=[component_product_id])
