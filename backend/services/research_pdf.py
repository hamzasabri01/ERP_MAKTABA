"""Print-ready PDF generation with native Arabic shaping and RTL layout."""
from __future__ import annotations

from html import escape
from io import BytesIO
from pathlib import Path
import re

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer


BLUE = colors.HexColor("#1769E0")
NAVY = colors.HexColor("#143149")
MUTED = colors.HexColor("#5B7180")


def _font_paths() -> tuple[Path, Path, Path]:
    root = Path(__file__).resolve().parents[2]
    folder = root / "frontend" / "public" / "fonts" / "amiri"
    body = root / "frontend" / "public" / "fonts" / "noto-sans-arabic" / "NotoSansArabic.ttf"
    return body, folder / "Amiri-Regular.ttf", folder / "Amiri-Bold.ttf"


def _register_fonts() -> None:
    body, regular, bold = _font_paths()
    if "NotoArabic" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("NotoArabic", str(body)))
    if "Amiri" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("Amiri", str(regular)))
    if "Amiri-Bold" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("Amiri-Bold", str(bold)))


def _rtl(value: str) -> str:
    return get_display(arabic_reshaper.reshape(str(value or "")), base_dir="R")


def _text(value: str, rtl: bool) -> str:
    clean = " ".join(str(value or "").split())
    return escape(_rtl(clean) if rtl else clean)


def _paragraph_text(value: str, rtl: bool, max_width: float = 448, font_size: float = 11.5) -> str:
    """Shape RTL one visual line at a time, after logical wrapping.

    Shaping a complete Arabic paragraph before ReportLab wraps it reverses the
    visual order of the resulting lines and displaces punctuation. Wrapping the
    logical words first preserves sentence order and keeps symbols attached.
    """
    clean = " ".join(str(value or "").split())
    if not rtl:
        return escape(clean)
    # Parenthesised/quoted expressions are indivisible tokens. Numbers also stay
    # attached to their following unit/noun (e.g. "11 لاعباً").
    grouped = re.findall(r"\([^()]*\)|«[^»]*»|“[^”]*”|\S+", clean)
    words = []
    for group in grouped:
        # A short expression can safely stay on one line. A long quote must be
        # wrapped by us, otherwise ReportLab reverses its internally-created lines.
        if len(group) <= 34 or not ((group[0], group[-1]) in {("(", ")"), ("«", "»"), ("“", "”")}):
            words.append(group)
            continue
        inner = group[1:-1].split()
        if inner:
            inner[0] = group[0] + inner[0]
            inner[-1] = inner[-1] + group[-1]
            words.extend(inner)
    tokens, index = [], 0
    while index < len(words):
        token = words[index]
        if re.fullmatch(r"[0-9٠-٩]+(?:[.,،][0-9٠-٩]+)?", token.rstrip("،,.;؛:")) and index + 1 < len(words):
            token = token + "\u00a0" + words[index + 1]
            index += 1
        tokens.append(token)
        index += 1

    lines, current = [], []
    for word in tokens:
        candidate = " ".join([*current, word])
        visual = _rtl(candidate)
        if current and pdfmetrics.stringWidth(visual, "NotoArabic", font_size) > max_width:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    # Avoid a visually weak orphan line when a few words can fit on it.
    if len(lines) > 1 and len(lines[-1]) < 24:
        previous = lines[-2].split()
        tail = lines[-1].split()
        while len(previous) > 2 and len(" ".join(tail)) < 38:
            tail.insert(0, previous.pop())
        lines[-2], lines[-1] = " ".join(previous), " ".join(tail)
    return "<br/>".join(escape(_rtl(line)) for line in lines)


def _research_paragraphs(value: str, target_words: int = 92) -> list[str]:
    """Split dense source text at sentence boundaries into readable paragraphs."""
    clean = " ".join(str(value or "").split())
    sentences = [item.strip() for item in re.split(r"(?<=[.!؟])\s+", clean) if item.strip()]
    if len(clean.split()) <= target_words or len(sentences) < 2:
        return [clean]
    result, current, words = [], [], 0
    for sentence in sentences:
        sentence_words = len(sentence.split())
        if current and words + sentence_words > target_words:
            result.append(" ".join(current))
            current, words = [], 0
        current.append(sentence)
        words += sentence_words
    if current:
        result.append(" ".join(current))
    return result


def _is_generated_lead(value: str) -> bool:
    clean = " ".join(str(value or "").split()).casefold()
    markers = (
        "يعالج هذا المحور", "وتعرض الفقرات التالية",
        "cette partie étudie", "elle rassemble les éléments essentiels",
        "this section examines", "brings together key information",
    )
    return any(marker in clean for marker in markers)


def _is_reference_heading(value: str) -> bool:
    clean = " ".join(str(value or "").casefold().split())
    return clean in {
        "المصادر", "المراجع", "المراجع والمصادر",
        "sources", "références", "references", "bibliographie", "bibliography",
    }


def build_research_pdf(request, storage_root: Path) -> tuple[bytes, int]:
    _register_fonts()
    rtl = request.language == "ar"
    output = BytesIO()
    page_counter = {"count": 0}

    def decorate(canvas, document):
        page_counter["count"] += 1
        canvas.saveState()
        canvas.setStrokeColor(BLUE); canvas.setLineWidth(.7)
        canvas.line(18 * mm, A4[1] - 12 * mm, A4[0] - 18 * mm, A4[1] - 12 * mm)
        canvas.setFont("Amiri", 9); canvas.setFillColor(MUTED)
        canvas.drawCentredString(A4[0] / 2, 9 * mm, str(document.page))
        canvas.restoreState()

    document = SimpleDocTemplate(
        output, pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm,
        topMargin=20 * mm, bottomMargin=18 * mm,
        title=request.topic, author="LIBRARY SABRI",
    )
    base = getSampleStyleSheet()
    normal = ParagraphStyle("ArabicNormal", parent=base["BodyText"], fontName="NotoArabic", fontSize=11.5,
                            leading=19, textColor=NAVY, alignment=TA_RIGHT if rtl else TA_LEFT,
                            spaceAfter=4 * mm, wordWrap="RTL" if rtl else None)
    heading = ParagraphStyle("ArabicHeading", parent=normal, fontName="Amiri-Bold", fontSize=19,
                             leading=28, textColor=BLUE, spaceBefore=4 * mm, spaceAfter=4 * mm,
                             keepWithNext=True)
    title = ParagraphStyle("ArabicTitle", parent=heading, fontName="Amiri-Bold", fontSize=25, leading=36,
                           alignment=TA_CENTER, spaceBefore=8 * mm, spaceAfter=10 * mm)
    centered = ParagraphStyle("Centered", parent=normal, alignment=TA_CENTER, textColor=MUTED)
    caption = ParagraphStyle("Caption", parent=centered, fontSize=9, leading=13, spaceAfter=3 * mm)
    source_style = ParagraphStyle("Source", parent=normal, fontSize=10, leading=15, spaceAfter=2 * mm)

    story = []
    if request.include_cover:
        title.spaceBefore = 6 * mm
        story.append(Paragraph(_text(request.topic, rtl), title))
    else:
        # The research topic is always the first, centred element. Internal
        # shop/request metadata stays out of the student's paper.
        story.append(Paragraph(_text(request.topic, rtl), title))

    content_sections = [section for section in request.sections if not _is_reference_heading(section.title)]
    if request.include_toc and content_sections:
        story.append(Paragraph(_text("المحتويات" if rtl else "Table des matières", rtl), heading))
        for index, section in enumerate(content_sections, 1):
            story.append(Paragraph(_text(f"{index}. {section.title}", rtl), normal))
        story.append(Spacer(1, 5 * mm))

    approved_assets = []
    seen_asset_names = set()
    for asset in request.assets:
        if asset.approval_status != "APPROVED":
            continue
        normalized_name = re.sub(
            r"\s*(?:\(cropped\)|cropped|copy|نسخة)\s*|\.[a-z0-9]{2,5}$",
            "", asset.original_file_name.casefold(), flags=re.I,
        ).strip(" _-()")
        if normalized_name in seen_asset_names:
            continue
        seen_asset_names.add(normalized_name)
        approved_assets.append(asset)
    used_asset_ids: set[int] = set()
    for index, section in enumerate(content_sections, 1):
        story.append(Paragraph(_text(f"{index}. {section.title}", rtl), heading))
        paragraphs = [part.strip() for part in (section.content or "").split("\n\n") if part.strip()]
        for part in paragraphs:
            if _is_generated_lead(part):
                continue
            if part.startswith("### "):
                story.append(Paragraph(_text(part[4:], rtl), ParagraphStyle(
                    f"Subheading-{section.id}-{len(story)}", parent=normal,
                    fontName="Amiri-Bold", fontSize=15, leading=22,
                    textColor=NAVY, spaceBefore=3 * mm, spaceAfter=2 * mm,
                    keepWithNext=True,
                )))
            else:
                for research_paragraph in _research_paragraphs(part):
                    story.append(Paragraph(_paragraph_text(research_paragraph, rtl, font_size=normal.fontSize), normal))

        matched = [asset for asset in approved_assets if asset.section_id == section.id]
        if not matched:
            matched = [asset for asset in approved_assets if asset.id not in used_asset_ids][:1]
        for asset in matched:
            path = (storage_root / asset.storage_key).resolve()
            if storage_root.resolve() not in path.parents or not path.is_file():
                continue
            try:
                picture = Image(str(path))
                # Keep illustrations inside the current content flow; oversized
                # images used to jump to a nearly empty page before the next title.
                ratio = min(145 * mm / picture.imageWidth, 55 * mm / picture.imageHeight, 1)
                picture.drawWidth = picture.imageWidth * ratio
                picture.drawHeight = picture.imageHeight * ratio
                picture.hAlign = "CENTER"
                story.append(Spacer(1, 2 * mm)); story.append(picture)
                story.append(Spacer(1, 3 * mm))
                used_asset_ids.add(asset.id)
            except Exception:
                continue

    if request.include_references and request.sources:
        story.append(Paragraph(_text("المراجع والمصادر" if rtl else "Références et sources", rtl), heading))
        for index, source in enumerate(request.sources, 1):
            if source.url:
                label = _text(f"{index}. {source.title}", rtl)
                story.append(Paragraph(f'<link href="{escape(source.url, quote=True)}" color="#1769E0">{label}</link>', source_style))
            else:
                story.append(Paragraph(_text(f"{index}. {source.title}", rtl), source_style))

    document.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return output.getvalue(), page_counter["count"]
