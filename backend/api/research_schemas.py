"""HTTP validation contracts for the school research module."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.config import env_int


AcademicLevel = Literal["primary", "middle", "high", "university", "custom"]
ResearchLanguage = Literal["ar", "fr", "en"]
LanguageLevel = Literal["very_simple", "simple", "intermediate", "advanced", "academic", "A1", "A2", "B1", "B2", "C1", "C2"]


class ResearchRequestBase(BaseModel):
    customer_id: int | None = Field(default=None, gt=0)
    student_first_name: str = Field(default="", max_length=100)
    contact_info: str = Field(default="", max_length=180)
    topic: str = Field(min_length=3, max_length=300)
    subject: str = Field(default="", max_length=120)
    academic_level: AcademicLevel
    custom_academic_level: str = Field(default="", max_length=100)
    language: ResearchLanguage
    language_level: LanguageLevel = "simple"
    target_pages: int = 3
    page_count_mode: Literal["approximate", "strict"] = "approximate"
    include_cover: bool = True
    include_toc: bool = False
    include_introduction: bool = True
    include_conclusion: bool = True
    include_images: bool = False
    requested_image_count: int = 0
    image_type: str = Field(default="educational", max_length=40)
    include_references: bool = True
    country_context: str = Field(default="Morocco", max_length=100)
    teacher_instructions: str = Field(default="", max_length=5000)
    internal_notes: str = Field(default="", max_length=5000)
    requested_delivery_at: datetime | None = None
    output_format: Literal["pdf", "docx", "both"] = "pdf"
    print_color_mode: Literal["bw", "color", "mixed"] = "bw"
    print_copies: int = Field(default=1, ge=1, le=100)
    binding_preference: Literal["none", "staple", "spiral", "folder"] = "none"

    @field_validator("target_pages")
    @classmethod
    def page_limit(cls, value: int) -> int:
        minimum = max(1, env_int("RESEARCH_MIN_PAGES", 1))
        maximum = max(minimum, env_int("RESEARCH_MAX_PAGES", 20))
        if not minimum <= value <= maximum:
            raise ValueError(f"Target pages must be between {minimum} and {maximum}")
        return value

    @field_validator("requested_image_count")
    @classmethod
    def image_limit(cls, value: int) -> int:
        maximum = max(0, env_int("RESEARCH_MAX_IMAGES", 10))
        if not 0 <= value <= maximum:
            raise ValueError(f"Image count must be between 0 and {maximum}")
        return value

    @model_validator(mode="after")
    def coherent_options(self):
        if self.academic_level == "custom" and not self.custom_academic_level.strip():
            raise ValueError("Custom academic level is required")
        if not self.include_images and self.requested_image_count:
            raise ValueError("Image count must be zero when images are disabled")
        return self


class ResearchRequestCreate(ResearchRequestBase):
    pass


class ResearchRequestUpdate(BaseModel):
    topic: str | None = Field(default=None, min_length=3, max_length=300)
    subject: str | None = Field(default=None, max_length=120)
    internal_notes: str | None = Field(default=None, max_length=5000)
    teacher_instructions: str | None = Field(default=None, max_length=5000)
    requested_delivery_at: datetime | None = None
    assigned_to: int | None = Field(default=None, gt=0)


class OutlineSectionInput(BaseModel):
    order: int = Field(ge=1, le=30)
    title: str = Field(min_length=2, max_length=250)
    objective: str = Field(default="", max_length=1000)
    target_words: int = Field(ge=50, le=10000)
    suggested_image_query: str | None = Field(default=None, max_length=300)


class OutlineUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=350)
    objective: str = Field(default="", max_length=1500)
    introduction_target_words: int = Field(default=0, ge=0, le=5000)
    sections: list[OutlineSectionInput] = Field(min_length=1, max_length=30)
    conclusion_target_words: int = Field(default=0, ge=0, le=5000)
    suggested_keywords: list[str] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=20)


class SectionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=300)
    content: str | None = Field(default=None, max_length=100000)
    objective: str | None = Field(default=None, max_length=3000)
    target_words: int | None = Field(default=None, ge=50, le=10000)
    change_reason: str = Field(default="manual_save", max_length=160)


class RewriteInput(BaseModel):
    action: Literal["regenerate", "simplify", "advance", "shorten", "expand", "correct_language", "add_example", "add_moroccan_context", "remove_repetition"]


class RestoreVersionInput(BaseModel):
    version_id: int = Field(gt=0)


class SourceCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    author: str = Field(default="", max_length=200)
    publisher: str = Field(default="", max_length=200)
    url: str = Field(default="", max_length=1000)
    publication_date: str = Field(default="", max_length=40)
    source_type: Literal["employee_upload", "internal", "web", "ai_suggested", "manual"] = "manual"
    notes: str = Field(default="", max_length=3000)
    used_section_ids: list[int] = Field(default_factory=list, max_length=50)


class SourceVerify(BaseModel):
    status: Literal["VERIFIED", "REJECTED"]
    notes: str | None = Field(default=None, max_length=3000)


class StatusChange(BaseModel):
    status: str = Field(min_length=2, max_length=30)
    comment: str = Field(default="", max_length=500)


class ExportRegister(BaseModel):
    file_type: Literal["pdf", "docx"]
    page_count: int | None = Field(default=None, ge=1, le=500)
    file_size: int | None = Field(default=None, ge=0, le=100_000_000)


class ResearchRequestSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    topic: str
    subject: str
    academic_level: str
    language: str
    target_pages: int
    status: str
    requested_delivery_at: datetime | None
    estimated_price: Decimal
    created_at: datetime


class PaginatedResearchRequests(BaseModel):
    items: list[ResearchRequestSummary]
    total: int
    page: int
    page_size: int
