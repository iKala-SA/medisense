"""Plain text out of an uploaded knowledge file, so it can be de-identified before RAG indexing.

RAG Engine would parse the original itself, but then the raw PHI is what gets chunked and
embedded. We index the extracted, de-identified text instead and keep the original only in the
(CMEK) upload bucket. Layout, tables-as-grids and images are lost; text order is kept.
Image-only (scanned) PDFs yield no text and are rejected rather than indexed unchecked.

Text is NFKC-normalised: PDF fonts often map 身/生/日 to Kangxi radical lookalikes (⾝ ⽣ ⽇), which
hides context words like 身分證 / 生日 from Sensitive Data Protection and lets IDs and birth
dates slip through (seen 2026-10-26 with a Chrome-printed PDF).
"""
import io
import json
import unicodedata
from html.parser import HTMLParser


class NoTextError(ValueError):
    """The file cannot be turned into text (corrupt, encrypted, or image-only)."""


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in ("p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "big5", "cp950"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_text(data: bytes, suffix: str) -> str:
    try:
        text = _extract(data, suffix)
    except Exception as exc:
        raise NoTextError(f"cannot read {suffix} file: {exc}") from exc
    text = unicodedata.normalize("NFKC", text)
    if not text.strip():
        raise NoTextError("no extractable text (scanned / image-only file?)")
    return text


def _extract(data: bytes, suffix: str) -> str:
    if suffix == ".pdf":
        from pypdf import PdfReader

        text = "\n\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
    elif suffix == ".docx":
        from docx import Document

        doc = Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        for t in doc.tables:
            parts.extend(" | ".join(c.text for c in row.cells) for row in t.rows)
        text = "\n".join(parts)
    elif suffix == ".pptx":
        from pptx import Presentation

        slides = []
        for i, slide in enumerate(Presentation(io.BytesIO(data)).slides, 1):
            lines = [sh.text_frame.text for sh in slide.shapes if sh.has_text_frame]
            slides.append(f"# Slide {i}\n" + "\n".join(lines))
        text = "\n\n".join(slides)
    elif suffix == ".html":
        p = _HTMLText()
        p.feed(_decode(data))
        text = "".join(p.parts)
    elif suffix == ".json":
        raw = _decode(data)
        try:
            text = json.dumps(json.loads(raw), ensure_ascii=False, indent=1)
        except json.JSONDecodeError:
            text = raw
    else:  # .txt .md .csv
        text = _decode(data)
    return text
