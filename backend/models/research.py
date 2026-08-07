"""Additive persistence model for the isolated school research module."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from core.database import Base


class ResearchRequest(Base):
    __tablename__ = "research_requests"
    __table_args__ = (
        Index("ix_research_request_status", "status"),
        Index("ix_research_request_created", "created_at"),
        Index("ix_research_request_delivery", "requested_delivery_at"),
        Index("ix_research_request_customer", "customer_id"),
    )

    id = Column(Integer, primary_key=True)
    reference = Column(String(40), unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    student_first_name = Column(String(100), default="")
    contact_info = Column(String(180), default="")
    topic = Column(String(300), nullable=False)
    subject = Column(String(120), default="")
    academic_level = Column(String(40), nullable=False)
    custom_academic_level = Column(String(100), default="")
    language = Column(String(5), nullable=False)
    language_level = Column(String(30), nullable=False, default="simple")
    target_pages = Column(Integer, nullable=False, default=3)
    page_count_mode = Column(String(20), nullable=False, default="approximate")
    include_cover = Column(Boolean, nullable=False, default=True)
    include_toc = Column(Boolean, nullable=False, default=False)
    include_introduction = Column(Boolean, nullable=False, default=True)
    include_conclusion = Column(Boolean, nullable=False, default=True)
    include_images = Column(Boolean, nullable=False, default=False)
    requested_image_count = Column(Integer, nullable=False, default=0)
    image_type = Column(String(40), default="educational")
    include_references = Column(Boolean, nullable=False, default=True)
    country_context = Column(String(100), default="Morocco")
    teacher_instructions = Column(Text, default="")
    internal_notes = Column(Text, default="")
    requested_delivery_at = Column(DateTime, nullable=True)
    output_format = Column(String(20), nullable=False, default="pdf")
    print_color_mode = Column(String(20), nullable=False, default="bw")
    print_copies = Column(Integer, nullable=False, default=1)
    binding_preference = Column(String(30), nullable=False, default="none")
    status = Column(String(30), nullable=False, default="DRAFT")
    estimated_price = Column(Numeric(18, 2), nullable=False, default=0)
    final_price = Column(Numeric(18, 2), nullable=True)
    estimated_pages = Column(Numeric(8, 2), nullable=False, default=0)
    actual_pages = Column(Integer, nullable=True)
    total_words = Column(Integer, nullable=False, default=0)
    pos_ticket_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    invoice_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    approved_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    outline = relationship("ResearchOutline", back_populates="request", uselist=False, cascade="all, delete-orphan")
    sections = relationship("ResearchSection", back_populates="request", cascade="all, delete-orphan", order_by="ResearchSection.order_index")
    sources = relationship("ResearchSource", back_populates="request", cascade="all, delete-orphan")
    assets = relationship("ResearchAsset", back_populates="request", cascade="all, delete-orphan")
    outputs = relationship("ResearchOutput", back_populates="request", cascade="all, delete-orphan")
    status_history = relationship("ResearchStatusHistory", back_populates="request", cascade="all, delete-orphan")


class ResearchOutline(Base):
    __tablename__ = "research_outlines"
    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("research_requests.id", ondelete="CASCADE"), unique=True, nullable=False)
    title = Column(String(350), nullable=False)
    objective = Column(Text, default="")
    content_json = Column(Text, nullable=False, default="{}")
    version = Column(Integer, nullable=False, default=1)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    request = relationship("ResearchRequest", back_populates="outline")


class ResearchSection(Base):
    __tablename__ = "research_sections"
    __table_args__ = (
        UniqueConstraint("request_id", "order_index", name="uq_research_section_order"),
        Index("ix_research_section_request", "request_id"),
    )
    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("research_requests.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, nullable=False)
    title = Column(String(300), nullable=False)
    objective = Column(Text, default="")
    content = Column(Text, default="")
    summary = Column(Text, default="")
    target_words = Column(Integer, nullable=False, default=300)
    actual_words = Column(Integer, nullable=False, default=0)
    status = Column(String(30), nullable=False, default="PENDING")
    suggested_image_query = Column(String(300), nullable=True)
    generation_metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    request = relationship("ResearchRequest", back_populates="sections")
    versions = relationship("ResearchSectionVersion", back_populates="section", cascade="all, delete-orphan")


class ResearchSectionVersion(Base):
    __tablename__ = "research_section_versions"
    __table_args__ = (UniqueConstraint("section_id", "version_number", name="uq_research_section_version"),)
    id = Column(Integer, primary_key=True)
    section_id = Column(Integer, ForeignKey("research_sections.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False)
    title = Column(String(300), nullable=False)
    content = Column(Text, nullable=False, default="")
    change_reason = Column(String(160), nullable=False, default="manual_save")
    generation_metadata_json = Column(Text, nullable=False, default="{}")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    section = relationship("ResearchSection", back_populates="versions")


class ResearchSource(Base):
    __tablename__ = "research_sources"
    __table_args__ = (Index("ix_research_source_request", "request_id"),)
    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("research_requests.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(300), nullable=False)
    author = Column(String(200), default="")
    publisher = Column(String(200), default="")
    url = Column(String(1000), default="")
    publication_date = Column(String(40), default="")
    access_date = Column(DateTime, nullable=True)
    source_type = Column(String(30), nullable=False, default="manual")
    verification_status = Column(String(20), nullable=False, default="PENDING")
    notes = Column(Text, default="")
    used_sections_json = Column(Text, nullable=False, default="[]")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    request = relationship("ResearchRequest", back_populates="sources")


class ResearchAsset(Base):
    __tablename__ = "research_assets"
    __table_args__ = (Index("ix_research_asset_request", "request_id"),)
    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("research_requests.id", ondelete="CASCADE"), nullable=False)
    section_id = Column(Integer, ForeignKey("research_sections.id", ondelete="SET NULL"), nullable=True)
    storage_key = Column(String(500), nullable=False)
    original_file_name = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    file_size = Column(Integer, nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    caption = Column(String(500), default="")
    alt_text = Column(String(500), default="")
    source_url = Column(String(1000), default="")
    license_info = Column(String(500), default="")
    approval_status = Column(String(20), nullable=False, default="PENDING")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    request = relationship("ResearchRequest", back_populates="assets")


class ResearchOutput(Base):
    __tablename__ = "research_outputs"
    __table_args__ = (Index("ix_research_output_request", "request_id"),)
    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("research_requests.id", ondelete="CASCADE"), nullable=False)
    file_type = Column(String(10), nullable=False)
    storage_key = Column(String(500), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    page_count = Column(Integer, nullable=True)
    file_size = Column(Integer, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    request = relationship("ResearchRequest", back_populates="outputs")


class ResearchStatusHistory(Base):
    __tablename__ = "research_status_history"
    __table_args__ = (Index("ix_research_history_request", "request_id", "created_at"),)
    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("research_requests.id", ondelete="CASCADE"), nullable=False)
    previous_status = Column(String(30), nullable=True)
    new_status = Column(String(30), nullable=False)
    comment = Column(String(500), default="")
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    request = relationship("ResearchRequest", back_populates="status_history")


class ResearchAIUsage(Base):
    __tablename__ = "research_ai_usage"
    __table_args__ = (Index("ix_research_ai_usage_created", "created_at"), Index("ix_research_ai_usage_request", "request_id"))
    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("research_requests.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    provider = Column(String(40), nullable=False)
    model = Column(String(100), nullable=False)
    operation_type = Column(String(40), nullable=False)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    estimated_cost = Column(Numeric(18, 6), nullable=False, default=0)
    duration_ms = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False)
    error_code = Column(String(80), default="")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ResearchSetting(Base):
    __tablename__ = "research_settings"
    key = Column(String(100), primary_key=True)
    value_json = Column(Text, nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
