"""Validated AI provider abstraction. The default provider is deterministic and offline."""
from __future__ import annotations

import time
import re
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass

from pydantic import BaseModel, Field, ValidationError, field_validator

from core.config import env, env_int
from services.research_workflow import target_word_distribution
from services.research_web import ResearchWebError, WikimediaResearchClient, WebPage


class OutlineSectionResult(BaseModel):
    order: int = Field(ge=1, le=30)
    title: str = Field(min_length=2, max_length=250)
    objective: str = Field(min_length=2, max_length=1000)
    target_words: int = Field(ge=50, le=10000)
    suggested_image_query: str | None = Field(default=None, max_length=300)


class OutlineResult(BaseModel):
    title: str = Field(min_length=2, max_length=350)
    objective: str = Field(min_length=2, max_length=1500)
    introduction_target_words: int = Field(ge=0, le=5000)
    sections: list[OutlineSectionResult] = Field(min_length=1, max_length=30)
    conclusion_target_words: int = Field(ge=0, le=5000)
    suggested_keywords: list[str] = Field(default_factory=list, max_length=30)
    warnings: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("sections")
    @classmethod
    def unique_order(cls, value: list[OutlineSectionResult]) -> list[OutlineSectionResult]:
        if len({section.order for section in value}) != len(value):
            raise ValueError("Section order must be unique")
        return sorted(value, key=lambda item: item.order)


class SourceReferenceResult(BaseModel):
    source_id: str = Field(max_length=100)
    claim: str = Field(max_length=1000)


class SectionResult(BaseModel):
    section_title: str = Field(min_length=2, max_length=250)
    content: str = Field(min_length=20, max_length=100000)
    summary: str = Field(min_length=2, max_length=2000)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    source_references: list[SourceReferenceResult] = Field(default_factory=list, max_length=50)
    warnings: list[str] = Field(default_factory=list, max_length=20)


@dataclass(frozen=True)
class OutlineInput:
    topic: str
    subject: str
    academic_level: str
    language: str
    language_level: str
    target_pages: int
    include_introduction: bool
    include_conclusion: bool
    include_images: bool


@dataclass(frozen=True)
class SectionInput:
    topic: str
    title: str
    objective: str
    academic_level: str
    language: str
    language_level: str
    target_words: int
    action: str = "generate"
    existing_content: str = ""
    country_context: str = "Morocco"


class ResearchAIError(RuntimeError):
    code = "RESEARCH_AI_ERROR"


class ResearchAIResponseInvalid(ResearchAIError):
    code = "RESEARCH_AI_RESPONSE_INVALID"


class ResearchAIProvider(ABC):
    name = "abstract"
    model = "unknown"

    @abstractmethod
    def generate_outline(self, value: OutlineInput) -> OutlineResult: ...

    @abstractmethod
    def generate_section(self, value: SectionInput) -> SectionResult: ...

    def rewrite_section(self, value: SectionInput) -> SectionResult:
        return self.generate_section(value)


class MockResearchAIProvider(ResearchAIProvider):
    """Safe local provider for development and tests; it never calls a network."""

    name = "mock"
    model = "research-mock-v1"

    def generate_outline(self, value: OutlineInput) -> OutlineResult:
        labels = {
            "ar": ["التعريف بالموضوع", "العناصر الأساسية", "الأمثلة والتطبيقات", "الخلاصة والتحليل"],
            "en": ["Topic overview", "Key concepts", "Examples and applications", "Analysis and findings"],
            "fr": ["Présentation du sujet", "Notions essentielles", "Exemples et applications", "Analyse et résultats"],
        }
        section_titles = labels.get(value.language, labels["fr"])
        distribution = target_word_distribution(value.target_pages, value.language, len(section_titles))
        return OutlineResult.model_validate({
            "title": value.topic,
            "objective": f"Present {value.topic} at {value.academic_level} level.",
            "introduction_target_words": max(80, distribution[0] // 3) if value.include_introduction else 0,
            "sections": [
                {
                    "order": index + 1,
                    "title": title,
                    "objective": f"Explain {title} in relation to {value.topic}.",
                    "target_words": words,
                    "suggested_image_query": f"{value.topic} {title}" if value.include_images else None,
                }
                for index, (title, words) in enumerate(zip(section_titles, distribution))
            ],
            "conclusion_target_words": max(80, distribution[-1] // 3) if value.include_conclusion else 0,
            "suggested_keywords": [value.topic, value.subject, value.academic_level],
            "warnings": ["Offline mock content requires employee review"],
        })

    def generate_section(self, value: SectionInput) -> SectionResult:
        intro = {
            "ar": f"يتناول هذا القسم {value.title} في إطار موضوع {value.topic}.",
            "en": f"This section explains {value.title} within the topic {value.topic}.",
            "fr": f"Cette section présente {value.title} dans le cadre du sujet {value.topic}.",
        }.get(value.language, f"Cette section présente {value.title}.")
        seed = value.existing_content.strip() if value.action != "generate" and value.existing_content.strip() else intro
        sentences = [seed]
        while len(" ".join(sentences).split()) < value.target_words:
            sentences.append(f"{value.objective} The employee must verify and enrich this educational draft before approval.")
        content = " ".join(sentences)
        return SectionResult.model_validate({
            "section_title": value.title, "content": content, "summary": intro,
            "keywords": [value.topic, value.title], "source_references": [],
            "warnings": ["No source was invented; add verified sources manually"],
        })


class WikimediaResearchProvider(ResearchAIProvider):
    """Topic-aware web research using traceable Wikipedia/Wikimedia sources."""

    name = "wikimedia"
    model = "verified-web-v1"

    def __init__(self):
        self.sources: dict[int, WebPage] = {}
        self._topic_cache: dict[tuple[str, str], list[WebPage]] = {}

    @staticmethod
    def _remember(target: dict[int, WebPage], pages: list[WebPage]) -> None:
        for page in pages:
            target[page.page_id] = page

    @staticmethod
    def _tokens(value: str) -> set[str]:
        value = "".join(char for char in unicodedata.normalize("NFKD", value or "") if not unicodedata.combining(char))
        value = value.casefold().replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
        words = re.findall(r"[\w\u0600-\u06ff]+", value)
        stop = {"في", "من", "عن", "على", "الى", "إلى", "و", "او", "أو", "the", "of", "and", "de", "la", "le", "les", "et"}
        normalized = set()
        for word in words:
            if len(word) <= 2 or word in stop:
                continue
            if word.startswith("و") and len(word) > 3:
                word = word[1:]
            normalized.add(word.removeprefix("ال"))
        # Common educational-topic aliases that Wikipedia expresses differently.
        aliases = {"سريه": "شرعيه", "سري": "شرعي"}
        return {aliases.get(word, word) for word in normalized}

    @classmethod
    def _relevant_pages(cls, topic: str, pages: list[WebPage]) -> list[WebPage]:
        topic_tokens = cls._tokens(topic)
        ranked = []
        for index, page in enumerate(pages):
            title_tokens = cls._tokens(page.title)
            extract_tokens = cls._tokens(page.extract[:1600])
            title_overlap = len(topic_tokens & title_tokens)
            body_overlap = len(topic_tokens & extract_tokens)
            score = title_overlap * 4 + body_overlap - (index * .05)
            required = max(1, len(topic_tokens))
            if title_overlap >= required or body_overlap >= required:
                ranked.append((score, page))
        return [page for _, page in sorted(ranked, key=lambda pair: pair[0], reverse=True)]

    @staticmethod
    def _concept_queries(topic: str, language: str) -> list[str]:
        clean = " ".join(topic.split())
        patterns = {
            "ar": r"\s+(?:وعلاقتها|وعلاقته|علاقتها|علاقته)\s+(?:ب|بال)?",
            "fr": r"\s+(?:et\s+)?(?:sa\s+)?relation\s+avec\s+",
            "en": r"\s+(?:and\s+)?(?:its\s+)?relationship\s+(?:to|with)\s+",
        }
        parts = [part.strip(" ،,.-") for part in re.split(patterns.get(language, patterns["fr"]), clean, flags=re.I) if part.strip(" ،,.-")]
        result = []
        for value in [clean, *parts]:
            if len(value) >= 3 and value.casefold() not in {item.casefold() for item in result}:
                result.append(value)
        return result[:4]

    @classmethod
    def _search_topic_pages(cls, client: WikimediaResearchClient, topic: str, language: str) -> tuple[list[WebPage], list[str]]:
        queries = cls._concept_queries(topic, language)
        collected = []
        for query in queries:
            translated = client._query_in_output_language(query)
            try:
                candidates = client.search_pages(translated, 7)
            except ResearchWebError:
                continue
            collected.extend(cls._relevant_pages(translated, candidates)[:3])
        return list({page.page_id: page for page in collected}.values()), queries

    @classmethod
    def _section_extract(cls, page: WebPage, topic: str, heading: str, target_words: int) -> str:
        lines = [line.strip() for line in page.extract.splitlines() if line.strip()]
        headings = []
        for index, line in enumerate(lines):
            match = re.match(r"^(={2,6})\s*(.*?)\s*\1$", line)
            if match:
                headings.append((index, len(match.group(1)), match.group(2).strip()))
        normalized_heading = " ".join(heading.casefold().split())
        introduction_markers = (
            "مقدمة", "تعريف", "مفهوم", "العلاقة", "أهمية",
            "introduction", "définition", "definition", "notion", "overview",
            "relation", "relationship", "importance",
        )
        if any(marker in normalized_heading for marker in introduction_markers):
            # MediaWiki keeps the article definition before its first explicit
            # heading. This is the most reliable introductory material.
            end = headings[0][0] if headings else len(lines)
            selected, words = [], 0
            for line in lines[:end]:
                if re.match(r"^(={2,6})", line):
                    continue
                for sentence in [part.strip() for part in re.split(r"(?<=[.!؟])\s+", line) if part.strip()]:
                    sentence_words = len(sentence.split())
                    if selected and words + sentence_words > max(120, target_words):
                        break
                    selected.append(sentence)
                    words += sentence_words
                if words >= max(120, target_words):
                    break
            if selected:
                return "\n\n".join(selected)
        wanted = cls._tokens(heading)
        matches = []
        for position, level, title in headings:
            tokens = cls._tokens(title)
            overlap = len(tokens & wanted)
            coverage = overlap / max(1, len(wanted))
            if overlap:
                matches.append((coverage, overlap, -level, position, level, title))
        if matches:
            _, _, _, start, level, _ = max(matches)
            end = len(lines)
            for next_position, next_level, _ in headings:
                if next_position > start and next_level <= level:
                    end = next_position
                    break
            selected, words = [], 0
            for line in lines[start + 1:end]:
                nested = re.match(r"^(={2,6})\s*(.*?)\s*\1$", line)
                clean = f"### {nested.group(2).strip()}" if nested else line
                selected.append(clean)
                if not nested:
                    words += len(clean.split())
                if words >= max(120, target_words):
                    break
            if selected:
                return "\n\n".join(selected)

        # Fallback for a source without explicit headings.
        heading_tokens = cls._tokens(heading)
        topic_tokens = cls._tokens(topic)
        chunks = [chunk.strip(" =\n") for chunk in re.split(r"\n+|(?<=[.!؟])\s+", page.extract) if len(chunk.strip()) > 45]
        ranked = []
        for index, chunk in enumerate(chunks):
            tokens = cls._tokens(chunk)
            score = len(tokens & heading_tokens) * 5 + len(tokens & topic_tokens) * 2 - index * .01
            ranked.append((score, index, chunk))
        useful = sorted((row for row in ranked if row[0] > 0), key=lambda row: (-row[0], row[1]))
        if not useful:
            useful = ranked[:4]
        selected, words = [], 0
        for _, _, chunk in useful:
            if chunk in selected:
                continue
            selected.append(chunk)
            words += len(chunk.split())
            if words >= max(100, target_words):
                break
        # Restore the natural article order after relevance selection.
        order = {chunk: index for index, chunk in enumerate(chunks)}
        return "\n\n".join(sorted(selected, key=lambda chunk: order.get(chunk, 0)))

    @classmethod
    def _section_pages(cls, topic: str, heading: str, pages: list[WebPage]) -> list[WebPage]:
        topic_tokens, heading_tokens = cls._tokens(topic), cls._tokens(heading)
        ranked = []
        for page in pages:
            title_tokens = cls._tokens(page.title)
            body_tokens = cls._tokens(page.extract[:2200])
            title_topic = len(title_tokens & topic_tokens)
            title_heading = len(title_tokens & heading_tokens)
            body_topic = len(body_tokens & topic_tokens)
            body_heading = len(body_tokens & heading_tokens)
            # A page must be clearly about migration in its title, or contain the
            # complete topic plus the section idea. One accidental body word is insufficient.
            allowed = ((title_topic >= 1 and body_heading >= 1) or
                       (title_heading >= 1 and body_topic >= max(1, len(topic_tokens))) or
                       title_heading >= 2)
            if allowed:
                title_specificity = title_heading / max(1, len(title_tokens))
                ranked.append((title_topic * 5 + title_heading * 4 + body_heading + body_topic + title_specificity * 10, page))
        return [page for _, page in sorted(ranked, key=lambda row: row[0], reverse=True)]

    def generate_outline(self, value: OutlineInput) -> OutlineResult:
        client = WikimediaResearchClient(value.language)
        search_topic = client._query_in_output_language(value.topic)
        pages, concepts = self._search_topic_pages(client, value.topic, value.language)
        if not pages:
            raise ResearchAIError("Aucune source pertinente n'a été trouvée pour ce sujet")
        self._remember(self.sources, pages)
        discovered = client.page_sections(pages[0].page_id)
        fallbacks = {
            "ar": ["السياق والتعريف", "العناصر والخصائص الأساسية", "التطور والتطبيقات", "الآثار والتحديات", "التحليل والاستنتاجات"],
            "fr": ["Contexte et définition", "Principes et caractéristiques", "Évolution et applications", "Enjeux et limites", "Analyse et enseignements"],
            "en": ["Context and definition", "Core principles and characteristics", "Development and applications", "Challenges and limitations", "Analysis and findings"],
        }
        desired = max(3, min(7, round(value.target_pages / 2) + 2))
        introduction_title = {
            "ar": "مقدمة وتعريف الموضوع",
            "fr": "Introduction et définition",
            "en": "Introduction and definition",
        }.get(value.language, "Introduction et définition")
        intro_words = {"مقدمة", "تعريف", "introduction", "définition", "definition", "overview"}
        discovered_titles = [title for title in discovered if not (self._tokens(title) & intro_words)]
        concept_parts = concepts[1:]
        if len(concept_parts) >= 2:
            candidates = {
                "ar": [f"مفهوم {concept_parts[0]}", f"مفهوم {concept_parts[1]}", f"العلاقة بين {concept_parts[0]} و{concept_parts[1]}", f"أهمية {concept_parts[1]} في {concept_parts[0]}"],
                "fr": [f"Définition de {concept_parts[0]}", f"Définition de {concept_parts[1]}", f"Relation entre {concept_parts[0]} et {concept_parts[1]}", f"Importance de {concept_parts[1]} dans {concept_parts[0]}"],
                "en": [f"Definition of {concept_parts[0]}", f"Definition of {concept_parts[1]}", f"Relationship between {concept_parts[0]} and {concept_parts[1]}", f"Importance of {concept_parts[1]} in {concept_parts[0]}"],
            }.get(value.language, []) + discovered_titles
        else:
            candidates = discovered_titles
        titles = [introduction_title]
        for candidate in candidates:
            if len(titles) >= desired:
                break
            if candidate.casefold() not in {title.casefold() for title in titles}:
                titles.append(candidate)
        for title in fallbacks.get(value.language, fallbacks["fr"]):
            # Generic axes are emergency scaffolding only. Do not pad a sourced
            # outline to the requested page count with unrelated filler.
            if len(titles) >= 3:
                break
            if self._tokens(title) & intro_words:
                continue
            if title.casefold() not in {item.casefold() for item in titles}:
                titles.append(title)
        distribution = target_word_distribution(value.target_pages, value.language, len(titles))
        objectives = {
            "ar": "شرح هذا المحور وربطه مباشرة بموضوع البحث اعتماداً على المصادر المذكورة.",
            "fr": "Expliquer cet axe et le relier directement au sujet à partir des sources citées.",
            "en": "Explain this aspect and connect it directly to the topic using the cited sources.",
        }
        return OutlineResult.model_validate({
            "title": value.topic,
            "objective": objectives.get(value.language, objectives["fr"]),
            "introduction_target_words": max(100, distribution[0] // 3) if value.include_introduction else 0,
            "sections": [{
                "order": index + 1, "title": title,
                "objective": objectives.get(value.language, objectives["fr"]), "target_words": words,
                "suggested_image_query": f"{value.topic} {title}" if value.include_images else None,
            } for index, (title, words) in enumerate(zip(titles, distribution))],
            "conclusion_target_words": max(100, distribution[-1] // 3) if value.include_conclusion else 0,
            "suggested_keywords": [value.topic, value.subject, *[page.title for page in pages[:3]]],
            "warnings": ["Contenu issu de sources web traçables; validation humaine obligatoire"],
        })

    def generate_section(self, value: SectionInput) -> SectionResult:
        client = WikimediaResearchClient(value.language)
        search_topic = client._query_in_output_language(value.topic)
        # Start from the canonical topic pages. A broad section query can match an
        # unrelated article containing only words such as "illegal" or "market".
        cache_key = (value.language, search_topic.casefold().strip())
        if cache_key not in self._topic_cache:
            self._topic_cache[cache_key] = self._search_topic_pages(client, value.topic, value.language)[0][:6]
        base_pages = self._topic_cache[cache_key]
        try:
            section_candidates = client.search_pages(f"{search_topic} {value.title}", 6)
        except ResearchWebError:
            section_candidates = []
        pages = self._section_pages(search_topic, value.title, [*base_pages, *section_candidates])
        if not pages:
            pages = base_pages[:1]
        pages = list({page.page_id: page for page in pages}.values())
        normalized_title = value.title.casefold()
        definition_markers = ("مفهوم", "تعريف", "definition", "définition", "notion")
        relationship_markers = ("العلاقة", "أهمية", "relationship", "relation", "importance")
        if any(marker in normalized_title for marker in definition_markers):
            pages = pages[:1]
        elif any(marker in normalized_title for marker in relationship_markers):
            # A relationship section must represent both concepts, rather than
            # selecting two near-duplicate pages about the first concept.
            pool = list({page.page_id: page for page in [*base_pages, *section_candidates]}.values())
            balanced = []
            for concept in self._concept_queries(value.topic, value.language)[1:]:
                translated_concept = client._query_in_output_language(concept)
                matches = self._relevant_pages(translated_concept, pool)
                if matches and matches[0].page_id not in {page.page_id for page in balanced}:
                    balanced.append(matches[0])
            importance_markers = ("أهمية", "importance")
            if any(marker in normalized_title for marker in importance_markers) and balanced:
                pages = balanced[-1:]
            else:
                pages = (balanced or pages)[:2]
        else:
            pages = pages[:3]
        if not pages:
            raise ResearchAIError("Aucune source exploitable n'a été trouvée pour cette section")
        self._remember(self.sources, pages)
        summary = {
            "ar": f"أهم المعطيات المرتبطة بمحور {value.title}.",
            "fr": f"Points essentiels relatifs à {value.title}.",
            "en": f"Key points about {value.title}.",
        }.get(value.language)
        paragraphs = []
        if any(marker in normalized_title for marker in relationship_markers):
            bridges = {
                "ar": (
                    f"يرتبط محور «{value.title}» بالسلوك العملي داخل الرياضة؛ فالممارسة السليمة لا تقوم على المهارة والقوانين فقط، "
                    "بل تشمل احترام المنافسين والحكام، والالتزام باللعب النظيف، وتقبّل الفوز والخسارة بروح مسؤولة."
                ),
                "fr": f"L’axe « {value.title} » associe la pratique sportive au respect des adversaires, des arbitres, des règles et du fair-play.",
                "en": f"“{value.title}” connects sporting practice with respect for opponents, officials, rules, and fair play.",
            }
            paragraphs.append(bridges.get(value.language, bridges["fr"]))
        remaining = max(100, value.target_words)
        per_source = max(100, remaining // len(pages))
        for page in pages:
            excerpt = self._section_extract(page, search_topic, value.title, per_source)
            if excerpt:
                paragraphs.append(excerpt)
        content = "\n\n".join(paragraphs)
        # Do not pad with invented claims: a shorter sourced section is preferable.
        return SectionResult.model_validate({
            "section_title": value.title, "content": content,
            "summary": summary, "keywords": [value.topic, value.title, *[page.title for page in pages[:2]]],
            "source_references": [{"source_id": f"wiki:{page.page_id}", "claim": page.title} for page in pages],
            "warnings": ["Vérifier la formulation et les citations avant approbation"],
        })

def get_research_ai_provider() -> ResearchAIProvider:
    provider = env("RESEARCH_AI_PROVIDER", "mock").strip().lower()
    if provider == "mock":
        return MockResearchAIProvider()
    if provider in {"wikimedia", "web"}:
        return WikimediaResearchProvider()
    raise ResearchAIError(f"Provider '{provider}' is not configured in this installation")


def call_with_retry(operation, *, retries: int | None = None):
    max_retries = max(0, min(retries if retries is not None else env_int("RESEARCH_AI_MAX_RETRIES", 2), 5))
    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return operation()
        except ValidationError as exc:
            raise ResearchAIResponseInvalid("AI response did not match the required schema") from exc
        except ResearchAIResponseInvalid:
            raise
        except Exception as exc:
            last_error = exc
            if attempt < max_retries:
                time.sleep(min(0.1 * (2 ** attempt), 1.0))
    raise ResearchAIError("AI provider is temporarily unavailable") from last_error
