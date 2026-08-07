"""Dependency-free DOCX writer for reviewed research content."""
from __future__ import annotations

from html import escape
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""
ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"""
STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="1769E0"/><w:sz w:val="42"/><w:szCs w:val="42"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="143149"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
</w:styles>"""


def _paragraph(text: str, *, style: str = "Normal", rtl: bool = False, page_break: bool = False) -> str:
    properties = f'<w:pStyle w:val="{style}"/>' + ("<w:bidi/>" if rtl else "")
    run_properties = "<w:rtl/>" if rtl else ""
    break_xml = '<w:br w:type="page"/>' if page_break else ""
    return f'<w:p><w:pPr>{properties}</w:pPr><w:r><w:rPr>{run_properties}</w:rPr>{break_xml}<w:t xml:space="preserve">{escape(str(text or ""))}</w:t></w:r></w:p>'


def build_research_docx(request) -> bytes:
    rtl = request.language == "ar"
    body = []
    body.append(_paragraph(request.topic, style="Title", rtl=rtl))
    body.append(_paragraph(f"{request.subject or ''} — {request.academic_level}", rtl=rtl))
    body.append(_paragraph("LIBRARY SABRI — مــكـتبة صــبــري", rtl=rtl))
    body.append(_paragraph("", rtl=rtl, page_break=bool(request.include_cover)))
    for index, section in enumerate(request.sections, 1):
        body.append(_paragraph(f"{index}. {section.title}", style="Heading1", rtl=rtl))
        for line in (section.content or "").splitlines() or [section.content or ""]:
            body.append(_paragraph(line, rtl=rtl))
    verified_sources = [source for source in request.sources if source.verification_status == "VERIFIED"]
    if request.include_references and verified_sources:
        body.append(_paragraph("المراجع" if rtl else "Références", style="Heading1", rtl=rtl))
        for source in verified_sources:
            label = f"• {source.title}"
            if source.author:
                label += f" — {source.author}"
            if source.url:
                label += f" — {source.url}"
            body.append(_paragraph(label, rtl=rtl))
    disclaimer = {
        "ar": "تم إعداد هذا المحتوى بمساعدة أدوات رقمية، وقد تمت مراجعته داخل المكتبة قبل الطباعة.",
        "en": "This content was prepared with the assistance of digital tools and reviewed by the bookstore before printing.",
        "fr": "Ce contenu a été préparé avec l’aide d’outils numériques et vérifié par la librairie avant impression.",
    }.get(request.language, "Ce contenu a été vérifié par la librairie avant impression.")
    body.append(_paragraph(disclaimer, rtl=rtl))
    section_properties = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
    document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + "".join(body) + section_properties + "</w:body></w:document>"
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", ROOT_RELS)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", STYLES)
        archive.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
    return output.getvalue()
