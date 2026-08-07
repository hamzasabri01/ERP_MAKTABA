"""Pure domain rules for the school research module."""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from enum import StrEnum

from core.config import env_int


class ResearchStatus(StrEnum):
    DRAFT = "DRAFT"
    OUTLINE_PENDING = "OUTLINE_PENDING"
    OUTLINE_READY = "OUTLINE_READY"
    OUTLINE_APPROVED = "OUTLINE_APPROVED"
    GENERATING = "GENERATING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    APPROVED = "APPROVED"
    EXPORTING = "EXPORTING"
    EXPORTED = "EXPORTED"
    PRINTED = "PRINTED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


ALLOWED_TRANSITIONS: dict[ResearchStatus, set[ResearchStatus]] = {
    ResearchStatus.DRAFT: {ResearchStatus.OUTLINE_PENDING, ResearchStatus.CANCELLED},
    ResearchStatus.OUTLINE_PENDING: {ResearchStatus.OUTLINE_READY, ResearchStatus.FAILED, ResearchStatus.CANCELLED},
    ResearchStatus.OUTLINE_READY: {ResearchStatus.OUTLINE_PENDING, ResearchStatus.OUTLINE_APPROVED, ResearchStatus.CANCELLED},
    ResearchStatus.OUTLINE_APPROVED: {ResearchStatus.GENERATING, ResearchStatus.CANCELLED},
    ResearchStatus.GENERATING: {ResearchStatus.REVIEW_REQUIRED, ResearchStatus.FAILED},
    ResearchStatus.REVIEW_REQUIRED: {ResearchStatus.OUTLINE_PENDING, ResearchStatus.GENERATING, ResearchStatus.APPROVED, ResearchStatus.CANCELLED},
    ResearchStatus.APPROVED: {ResearchStatus.OUTLINE_PENDING, ResearchStatus.EXPORTING, ResearchStatus.CANCELLED},
    ResearchStatus.EXPORTING: {ResearchStatus.EXPORTED, ResearchStatus.FAILED},
    ResearchStatus.EXPORTED: {ResearchStatus.OUTLINE_PENDING, ResearchStatus.PRINTED, ResearchStatus.COMPLETED, ResearchStatus.EXPORTING},
    ResearchStatus.PRINTED: {ResearchStatus.COMPLETED, ResearchStatus.PRINTED},
    ResearchStatus.FAILED: {ResearchStatus.OUTLINE_PENDING, ResearchStatus.GENERATING, ResearchStatus.EXPORTING, ResearchStatus.CANCELLED},
    ResearchStatus.COMPLETED: set(),
    ResearchStatus.CANCELLED: set(),
}


class InvalidResearchTransition(ValueError):
    pass


def validate_transition(current: str, target: str) -> tuple[ResearchStatus, ResearchStatus]:
    try:
        current_status = ResearchStatus(current)
        target_status = ResearchStatus(target)
    except ValueError as exc:
        raise InvalidResearchTransition("Unknown research status") from exc
    if target_status not in ALLOWED_TRANSITIONS[current_status]:
        raise InvalidResearchTransition(f"Transition {current_status} -> {target_status} is not allowed")
    return current_status, target_status


def count_words(text: str) -> int:
    return len(re.findall(r"[\w\u0600-\u06ff]+", text or "", flags=re.UNICODE))


def words_per_page(language: str) -> int:
    defaults = {"ar": 300, "fr": 380, "en": 400}
    key = language if language in defaults else "fr"
    return max(100, env_int(f"RESEARCH_WORDS_PER_PAGE_{key.upper()}", defaults[key]))


def estimate_pages(total_words: int, language: str, image_count: int = 0, include_cover: bool = False, include_toc: bool = False) -> Decimal:
    content_pages = Decimal(max(0, total_words)) / Decimal(words_per_page(language))
    image_space = Decimal(max(0, image_count)) * Decimal("0.25")
    fixed_pages = int(bool(include_cover)) + int(bool(include_toc))
    return (content_pages + image_space + fixed_pages).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class ResearchPriceInput:
    target_pages: int
    requested_images: int = 0
    include_references: bool = True
    color_pages: int = 0
    bw_pages: int = 0
    binding: bool = False
    urgent: bool = False


def calculate_estimated_price(value: ResearchPriceInput) -> Decimal:
    total = Decimal(env_int("RESEARCH_PRICE_BASE_MAD", 10))
    total += Decimal(value.target_pages) * Decimal(env_int("RESEARCH_PRICE_PER_PAGE_MAD", 3))
    total += Decimal(value.requested_images) * Decimal(env_int("RESEARCH_PRICE_PER_IMAGE_MAD", 1))
    if value.include_references:
        total += Decimal(env_int("RESEARCH_PRICE_REFERENCES_MAD", 2))
    total += Decimal(value.bw_pages) * Decimal(str(env_int("RESEARCH_PRICE_PRINT_BW_CENTIMES", 50))) / 100
    total += Decimal(value.color_pages) * Decimal(str(env_int("RESEARCH_PRICE_PRINT_COLOR_CENTIMES", 200))) / 100
    if value.binding:
        total += Decimal(env_int("RESEARCH_PRICE_BINDING_MAD", 5))
    if value.urgent:
        total *= Decimal("1.25")
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def target_word_distribution(target_pages: int, language: str, section_count: int) -> list[int]:
    count = max(1, section_count)
    total = max(200, target_pages * words_per_page(language))
    base, remainder = divmod(total, count)
    return [base + (1 if index < remainder else 0) for index in range(count)]


def basic_quality_report(*, language: str, topic: str, sections: list[str], include_references: bool, verified_source_count: int, target_pages: int, estimated_pages_value: Decimal) -> dict:
    checks: list[dict] = []
    actions: list[str] = []

    def add(code: str, passed: bool, message: str) -> None:
        checks.append({"code": code, "status": "PASS" if passed else "FAIL", "message": message})
        if not passed:
            actions.append(message)

    combined = "\n".join(sections).strip()
    add("CONTENT_PRESENT", bool(combined), "Research content is required")
    add("TOPIC_RELEVANCE", topic.casefold() in combined.casefold() if topic and combined else False, "Review topic relevance manually")
    add("STRUCTURE", len([item for item in sections if item.strip()]) >= 2, "At least two completed sections are recommended")
    add("REFERENCES", not include_references or verified_source_count > 0, "Add at least one verified source")
    tolerance = max(1, int(target_pages * 0.25))
    pages_ok = abs(float(estimated_pages_value) - target_pages) <= tolerance
    add("PAGE_COUNT", pages_ok, "Adjust content length to approach the requested page count")
    score = round((sum(1 for item in checks if item["status"] == "PASS") / len(checks)) * 100) if checks else 0
    return {
        "overall_score": score,
        "passed": score >= 80 and not actions,
        "checks": checks,
        "required_actions": actions,
        "warnings": ["Human review remains mandatory before approval"],
        "language": language,
    }
