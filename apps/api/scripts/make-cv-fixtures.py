#!/usr/bin/env python3
"""Genere les fixtures de test d'import de CV : `cv-demo.pdf`, `cv-demo.docx`,
`not-a-cv.txt`. Aucune dependance ajoutee : uniquement la bibliotheque standard
Python (pas de reportlab/python-docx) — le PDF est ecrit objet par objet (flux
de contenu Helvetica encode en WinAnsi pour les accents francais), le DOCX est
un zip minimal ([Content_Types].xml, _rels/.rels, word/document.xml) construit
avec `zipfile`.

Usage : `python3 apps/api/scripts/make-cv-fixtures.py`
"""

from __future__ import annotations

import zipfile
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"

# Contenu partage (memes informations) entre le PDF et le DOCX : personnage
# fictif « Camille Demo », 2 experiences, 1 formation, 4 competences, 2 langues.
CV_LINES = [
    "Camille Démo",
    "Développeuse full-stack — Metz",
    "",
    "Expériences",
    "Développeuse full-stack, Acme Corp (2022 - présent)",
    "Conception et maintenance d'API REST et d'interfaces web.",
    "Développeuse junior, Beta SARL (2019 - 2022)",
    "Développement front-end React et tests automatisés.",
    "",
    "Formation",
    "Master informatique, Université de Lorraine (2017 - 2019)",
    "",
    "Compétences",
    "TypeScript, React, Node.js, PostgreSQL",
    "",
    "Langues",
    "Français (natif), Anglais (B2)",
]


# ---------------------------------------------------------------------------
# PDF — objets ecrits a la main, flux de contenu Helvetica/WinAnsi
# ---------------------------------------------------------------------------


def pdf_escape(text: str) -> bytes:
    """Encode en WinAnsi (cp1252 — memes codets que /Encoding /WinAnsiEncoding
    pour les caracteres utilises ici) puis echappe les caracteres speciaux
    d'une chaine litterale PDF (parentheses, antislash)."""
    raw = text.encode("cp1252")
    escaped = bytearray()
    for byte in raw:
        if byte in (0x28, 0x29, 0x5C):  # ( ) \
            escaped.append(0x5C)
        escaped.append(byte)
    return bytes(escaped)


def build_content_stream(lines: list[str]) -> bytes:
    commands = [b"BT", b"/F1 11 Tf", b"14 TL", b"50 760 Td"]
    for index, line in enumerate(lines):
        if index > 0:
            commands.append(b"T*")
        commands.append(b"(" + pdf_escape(line) + b") Tj")
    commands.append(b"ET")
    return b"\n".join(commands) + b"\n"


def build_pdf(lines: list[str]) -> bytes:
    content_stream = build_content_stream(lines)

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length "
        + str(len(content_stream)).encode("ascii")
        + b" >>\nstream\n"
        + content_stream
        + b"endstream",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode("ascii")
        out += body
        out += b"\nendobj\n"

    xref_offset = len(out)
    object_count = len(objects) + 1  # + l'entree libre 0
    out += f"xref\n0 {object_count}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode("ascii")
    out += b"trailer\n"
    out += f"<< /Size {object_count} /Root 1 0 R >>\n".encode("ascii")
    out += b"startxref\n"
    out += f"{xref_offset}\n".encode("ascii")
    out += b"%%EOF"
    return bytes(out)


# ---------------------------------------------------------------------------
# DOCX — zip minimal (Content_Types, rels, document.xml)
# ---------------------------------------------------------------------------


def xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


CONTENT_TYPES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

RELS_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def build_document_xml(lines: list[str]) -> str:
    paragraphs = "\n".join(
        f"    <w:p><w:r><w:t xml:space=\"preserve\">{xml_escape(line)}</w:t></w:r></w:p>"
        for line in lines
        if line != ""
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
{paragraphs}
    <w:sectPr/>
  </w:body>
</w:document>
"""


def build_docx(lines: list[str]) -> bytes:
    import io

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES_XML)
        archive.writestr("_rels/.rels", RELS_XML)
        archive.writestr("word/document.xml", build_document_xml(lines))
    return buffer.getvalue()


NOT_A_CV_TXT = (
    "Ceci n'est pas un CV : juste un fichier texte quelconque, utilise pour verifier\n"
    "que l'import de CV refuse tout type de fichier autre que PDF ou DOCX.\n"
)


def main() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    pdf_path = FIXTURES_DIR / "cv-demo.pdf"
    pdf_path.write_bytes(build_pdf(CV_LINES))
    print(f"Ecrit : {pdf_path} ({pdf_path.stat().st_size} octets)")

    docx_path = FIXTURES_DIR / "cv-demo.docx"
    docx_path.write_bytes(build_docx(CV_LINES))
    print(f"Ecrit : {docx_path} ({docx_path.stat().st_size} octets)")

    txt_path = FIXTURES_DIR / "not-a-cv.txt"
    txt_path.write_text(NOT_A_CV_TXT, encoding="utf-8")
    print(f"Ecrit : {txt_path} ({txt_path.stat().st_size} octets)")


if __name__ == "__main__":
    main()
