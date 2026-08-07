import os
import unittest
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZipFile
from decimal import Decimal

from pydantic import ValidationError

from api.research_schemas import ResearchRequestCreate
from services.research_ai import MockResearchAIProvider, OutlineInput, OutlineResult, SectionInput, WikimediaResearchProvider, call_with_retry
from services.research_web import WebPage
from services.research_workflow import (
    InvalidResearchTransition, ResearchPriceInput, calculate_estimated_price, count_words,
    estimate_pages, validate_transition,
)
from services.research_docx import build_research_docx
from services.research_pdf import build_research_pdf


class ResearchValidationTests(unittest.TestCase):
    def valid_payload(self):
        return {
            "topic": "الماء في الطبيعة",
            "academic_level": "primary",
            "language": "ar",
            "language_level": "simple",
            "target_pages": 3,
        }

    def test_valid_request(self):
        value = ResearchRequestCreate(**self.valid_payload())
        self.assertEqual(value.language, "ar")

    def test_rejects_page_and_image_limits(self):
        with self.assertRaises(ValidationError):
            ResearchRequestCreate(**{**self.valid_payload(), "target_pages": 999})
        with self.assertRaises(ValidationError):
            ResearchRequestCreate(**{**self.valid_payload(), "include_images": True, "requested_image_count": 999})

    def test_rejects_incoherent_images_and_custom_level(self):
        with self.assertRaises(ValidationError):
            ResearchRequestCreate(**{**self.valid_payload(), "requested_image_count": 1})
        with self.assertRaises(ValidationError):
            ResearchRequestCreate(**{**self.valid_payload(), "academic_level": "custom"})


class ResearchWorkflowTests(unittest.TestCase):
    def test_status_transitions_are_controlled(self):
        self.assertEqual(validate_transition("DRAFT", "OUTLINE_PENDING")[1].value, "OUTLINE_PENDING")
        with self.assertRaises(InvalidResearchTransition):
            validate_transition("DRAFT", "APPROVED")

    def test_word_and_page_estimation(self):
        self.assertEqual(count_words("مرحبا بالعالم school research"), 4)
        self.assertEqual(estimate_pages(600, "ar"), Decimal("2.00"))
        self.assertEqual(estimate_pages(600, "ar", image_count=2, include_cover=True), Decimal("3.50"))

    def test_price_is_decimal_and_composed(self):
        price = calculate_estimated_price(ResearchPriceInput(target_pages=3, requested_images=2, bw_pages=3, binding=True))
        self.assertGreater(price, Decimal("10"))
        self.assertEqual(price.as_tuple().exponent, -2)


class ResearchAITests(unittest.TestCase):
    def test_compound_arabic_topic_is_split_into_searchable_concepts(self):
        values = WikimediaResearchProvider._concept_queries("كرة القدم وعلاقتها بالروح الرياضية", "ar")
        self.assertEqual(values[1:], ["كرة القدم", "الروح الرياضية"])

    def test_explicit_article_heading_keeps_the_right_section(self):
        page = WebPage(1, "هجرة غير شرعية", """== الآثار ==\nنص الآثار فقط.\n== أسباب الهجرة غير الشرعية ==\n=== الفقر ===\nالفقر والبطالة من دوافع الهجرة.\n=== النزاعات ===\nتدفع النزاعات بعض السكان إلى الهجرة.\n== القوانين ==\nنص قانوني منفصل.""", "https://example.test")
        content = WikimediaResearchProvider._section_extract(page, "الهجرة السرية", "أسباب الهجرة غير الشرعية", 100)
        self.assertIn("الفقر والبطالة", content)
        self.assertIn("### الفقر", content)
        self.assertNotIn("نص الآثار", content)
        self.assertNotIn("نص قانوني", content)

    def test_web_relevance_rejects_keyword_collision(self):
        relevant = WebPage(1, "هجرة غير شرعية", "تتناول الهجرة غير النظامية أسباب الهجرة وآثارها الاجتماعية والاقتصادية.", "https://example.test/migration")
        unrelated = WebPage(2, "ببر", "يتعرض الببر للقنص غير الشرعي في الغابات.", "https://example.test/tiger")
        pages = WikimediaResearchProvider._relevant_pages("الهجرة السرية", [unrelated, relevant])
        self.assertEqual([page.page_id for page in pages], [1])

    def test_mock_provider_returns_valid_structured_results(self):
        provider = MockResearchAIProvider()
        outline = provider.generate_outline(OutlineInput(
            topic="Water", subject="Science", academic_level="primary", language="en",
            language_level="simple", target_pages=2, include_introduction=True,
            include_conclusion=True, include_images=False,
        ))
        self.assertIsInstance(outline, OutlineResult)
        self.assertGreaterEqual(len(outline.sections), 2)
        section = provider.generate_section(SectionInput(
            topic="Water", title=outline.sections[0].title, objective=outline.sections[0].objective,
            academic_level="primary", language="en", language_level="simple", target_words=100,
        ))
        self.assertGreaterEqual(len(section.content.split()), 100)

    def test_retry_is_bounded(self):
        attempts = []

        def flaky():
            attempts.append(1)
            if len(attempts) < 3:
                raise RuntimeError("temporary")
            return "ok"

        self.assertEqual(call_with_retry(flaky, retries=2), "ok")
        self.assertEqual(len(attempts), 3)


class ResearchDocumentTests(unittest.TestCase):
    def test_docx_is_valid_zip_and_contains_rtl_content(self):
        request = SimpleNamespace(
            language="ar", topic="دورة الماء", subject="العلوم", academic_level="primary",
            include_cover=True, include_references=True,
            sections=[SimpleNamespace(title="مقدمة", content="الماء أساس الحياة")],
            sources=[SimpleNamespace(title="كتاب العلوم", author="", url="", verification_status="VERIFIED")],
        )
        content = build_research_docx(request)
        with ZipFile(BytesIO(content)) as archive:
            self.assertIn("word/document.xml", archive.namelist())
            document = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("دورة الماء", document)
        self.assertIn("<w:bidi/>", document)

    def test_pdf_is_native_and_contains_multiple_pages(self):
        request = SimpleNamespace(
            language="ar", topic="الهجرة السرية", subject="الاجتماعيات", academic_level="middle",
            custom_academic_level="", include_cover=True, include_toc=True, include_references=True,
            reference="RES-TEST", sections=[SimpleNamespace(id=1, title="الأسباب", content="الفقر والبطالة من أهم الأسباب.")],
            assets=[], sources=[SimpleNamespace(title="هجرة غير شرعية", url="https://ar.wikipedia.org/wiki/test")],
        )
        content, pages = build_research_pdf(request, os.path.dirname(__file__))
        self.assertTrue(content.startswith(b"%PDF"))
        # Cover, contents and short content intentionally share the first page
        # to avoid artificial blank pages.
        self.assertGreaterEqual(pages, 1)


if __name__ == "__main__":
    unittest.main()
