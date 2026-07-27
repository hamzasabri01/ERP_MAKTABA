from __future__ import annotations

import html
import re
import struct
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SOURCE = DOCS / "PFE-rapport-complet.md"
OUTPUT = DOCS / "PFE-ProERP-complet-avec-captures.docx"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"


MOJIBAKE_FIXES = {
    "cybersÃ©curite": "cybersécurité",
    "cybersÃ©curitÃ©": "cybersécurité",
    "donnÃ©es": "données",
    "sÃ©curite": "sécurité",
    "sÃ©curitÃ©": "sécurité",
    "mecanismes": "mécanismes",
    "integrite": "intégrité",
    "Integrite": "Intégrité",
    "deployee": "déployée",
    "deployer": "déployer",
    "deploiement": "déploiement",
    "Deploiement": "Déploiement",
    "chiffree": "chiffrée",
    "chiffre": "chiffré",
    "Chiffre": "Chiffré",
    "securise": "sécurisé",
    "Securise": "Sécurisé",
    "securiser": "sécuriser",
    "Securite": "Sécurité",
    "securite": "sécurité",
    "ecran": "écran",
    "operationnel": "opérationnel",
    "operationnelle": "opérationnelle",
    "reussie": "réussie",
    "echouee": "échouée",
    "echouees": "échouées",
    "entrees": "entrées",
    "necessaires": "nécessaires",
    "cout": "coût",
    "faible cout": "faible coût",
    "controle": "contrôle",
    "Controle": "Contrôle",
    "phenomene": "phénomène",
    "Creer": "Créer",
    "cree": "créée",
    "creee": "créée",
    "Restauration": "Restauration",
    "donnees": "données",
    "Donnees": "Données",
    "Parametres": "Paramètres",
    "Resume": "Résumé",
    "Mots cles": "Mots clés",
    "Cahier des charges": "Cahier des charges",
    "Realisation": "Réalisation",
    "Resultats": "Résultats",
    "Systeme": "Système",
    "systeme": "système",
}


def fix_text(text: str) -> str:
    for bad, good in MOJIBAKE_FIXES.items():
        text = text.replace(bad, good)
    return text


def esc(text: str) -> str:
    return html.escape(fix_text(text), quote=False)


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return 1200, 675
    return struct.unpack(">II", data[16:24])


def twips(inches: float) -> int:
    return int(inches * 1440)


def emu(inches: float) -> int:
    return int(inches * 914400)


class DocxBuilder:
    def __init__(self):
        self.body: list[str] = []
        self.rels: list[tuple[str, str, str]] = []
        self.images: list[tuple[Path, str]] = []

    def paragraph(self, text: str = "", style: str | None = None, bold: bool = False, italic: bool = False):
        ppr = f"<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>" if style else ""
        rpr = ""
        if bold or italic:
            rpr = "<w:rPr>" + ("<w:b/>" if bold else "") + ("<w:i/>" if italic else "") + "</w:rPr>"
        self.body.append(f"<w:p>{ppr}<w:r>{rpr}<w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r></w:p>")

    def code(self, text: str):
        runs = "".join(
            f"<w:r><w:rPr><w:rStyle w:val=\"CodeChar\"/></w:rPr><w:t xml:space=\"preserve\">{esc(line)}</w:t></w:r><w:r><w:br/></w:r>"
            for line in text.rstrip("\n").splitlines()
        )
        self.body.append(f"<w:p><w:pPr><w:pStyle w:val=\"CodeBlock\"/></w:pPr>{runs}</w:p>")

    def page_break(self):
        self.body.append("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>")

    def image(self, path: Path, alt: str):
        if not path.exists():
            self.paragraph(f"[Image introuvable: {path}]", italic=True)
            return
        rid = f"rId{len(self.rels) + 1}"
        name = f"image{len(self.images) + 1}.png"
        self.rels.append((rid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", f"media/{name}"))
        self.images.append((path, name))
        width_px, height_px = png_size(path)
        width_in = 6.35
        height_in = max(1.0, min(4.2, width_in * height_px / max(width_px, 1)))
        cx, cy = emu(width_in), emu(height_in)
        self.paragraph(alt, style="Caption")
        drawing = f"""
        <w:p>
          <w:pPr><w:jc w:val="center"/></w:pPr>
          <w:r>
            <w:drawing>
              <wp:inline distT="0" distB="0" distL="0" distR="0">
                <wp:extent cx="{cx}" cy="{cy}"/>
                <wp:docPr id="{len(self.images)}" name="{esc(alt)}"/>
                <a:graphic xmlns:a="{A_NS}">
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic xmlns:pic="{PIC_NS}">
                      <pic:nvPicPr><pic:cNvPr id="0" name="{esc(path.name)}"/><pic:cNvPicPr/></pic:nvPicPr>
                      <pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
                      <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
        """
        self.body.append(drawing)

    def table(self, rows: list[list[str]]):
        xml_rows = []
        for i, row in enumerate(rows):
            cells = []
            for cell in row:
                bold = "<w:rPr><w:b/></w:rPr>" if i == 0 else ""
                shade = "<w:shd w:fill=\"EAF1FF\"/>" if i == 0 else ""
                cells.append(
                    f"<w:tc><w:tcPr><w:tcW w:w=\"0\" w:type=\"auto\"/>{shade}</w:tcPr>"
                    f"<w:p><w:r>{bold}<w:t>{esc(cell.strip())}</w:t></w:r></w:p></w:tc>"
                )
            xml_rows.append(f"<w:tr>{''.join(cells)}</w:tr>")
        self.body.append(
            "<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/><w:tblW w:w=\"0\" w:type=\"auto\"/></w:tblPr>"
            + "".join(xml_rows)
            + "</w:tbl>"
        )

    def document_xml(self) -> str:
        sect = f"""
        <w:sectPr>
          <w:pgSz w:w="{twips(8.27)}" w:h="{twips(11.69)}"/>
          <w:pgMar w:top="{twips(0.7)}" w:right="{twips(0.65)}" w:bottom="{twips(0.7)}" w:left="{twips(0.75)}" w:header="{twips(0.3)}" w:footer="{twips(0.3)}" w:gutter="0"/>
        </w:sectPr>
        """
        return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}" xmlns:wp="{WP_NS}" xmlns:a="{A_NS}" xmlns:pic="{PIC_NS}">
  <w:body>{''.join(self.body)}{sect}</w:body>
</w:document>"""


def parse_markdown(builder: DocxBuilder, markdown: str):
    lines = markdown.splitlines()
    i = 0
    in_code = False
    code_lines: list[str] = []
    while i < len(lines):
        line = lines[i]

        if line.startswith("```"):
            if in_code:
                builder.code("\n".join(code_lines))
                code_lines = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue

        if in_code:
            code_lines.append(line)
            i += 1
            continue

        if not line.strip():
            builder.paragraph("")
            i += 1
            continue

        if line.strip() == "---":
            builder.paragraph("")
            i += 1
            continue

        img_match = re.match(r"!\[(.*?)\]\((.*?)\)", line.strip())
        if img_match:
            alt, rel = img_match.groups()
            builder.image((DOCS / rel).resolve(), alt)
            i += 1
            continue

        if line.startswith("|") and i + 1 < len(lines) and lines[i + 1].startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                if re.match(r"^\|\s*-+", lines[i]):
                    i += 1
                    continue
                rows.append([cell.strip() for cell in lines[i].strip("|").split("|")])
                i += 1
            if rows:
                builder.table(rows)
            continue

        if line.startswith("# "):
            builder.paragraph(line[2:].strip(), style="Title")
        elif line.startswith("## "):
            builder.paragraph(line[3:].strip(), style="Heading1")
        elif line.startswith("### "):
            builder.paragraph(line[4:].strip(), style="Heading2")
        elif line.startswith("#### "):
            builder.paragraph(line[5:].strip(), style="Heading3")
        elif line.startswith("- "):
            builder.paragraph("• " + line[2:].strip(), style="ListParagraph")
        elif re.match(r"^\d+\.\s+", line):
            builder.paragraph(line.strip(), style="ListParagraph")
        elif line.startswith("> "):
            builder.paragraph(line[2:].strip(), style="Quote")
        else:
            builder.paragraph(line.strip())
        i += 1


def styles_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:qFormat/><w:pPr><w:spacing w:after="220"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="1E3A8A"/><w:sz w:val="34"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:qFormat/><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:qFormat/><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:qFormat/><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:pPr><w:spacing w:before="160" w:after="80"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="475569"/><w:sz w:val="20"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="420" w:hanging="180"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="420"/><w:spacing w:before="100" w:after="100"/></w:pPr><w:rPr><w:i/><w:color w:val="475569"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:pPr><w:shd w:fill="F1F5F9"/><w:spacing w:before="120" w:after="120"/></w:pPr></w:style>
  <w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>"""


def write_docx(builder: DocxBuilder):
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    rel_entries = [
        '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    ]
    rel_entries.extend(
        f'<Relationship Id="{rid}" Type="{typ}" Target="{target}"/>'
        for rid, typ, target in builder.rels
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(rel_entries)
        + "</Relationships>"
    )

    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("word/document.xml", builder.document_xml())
        zf.writestr("word/styles.xml", styles_xml())
        zf.writestr("word/_rels/document.xml.rels", doc_rels)
        for path, name in builder.images:
            zf.write(path, f"word/media/{name}")


def main():
    builder = DocxBuilder()
    builder.paragraph("Projet de Fin d'Etudes", style="Title")
    builder.paragraph("Conception et mise en place d'un ERP sécurisé sur infrastructure virtualisée avec audit trail et sauvegarde cloud chiffrée", style="Heading1")
    builder.paragraph("Licence: Cybersecurity and Cloud Computing", style="Heading2")
    builder.paragraph("Application support: ProERP Web", style="Heading2")
    builder.paragraph("Document généré automatiquement avec captures d'écran intégrées.", italic=True)
    builder.page_break()
    parse_markdown(builder, SOURCE.read_text(encoding="utf-8"))
    write_docx(builder)
    print(OUTPUT)


if __name__ == "__main__":
    main()
