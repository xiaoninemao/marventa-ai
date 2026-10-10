"""Bounded document-to-copy conversion; no originals or extracted images are stored."""

from __future__ import annotations

import io
import json
import logging
import os
import subprocess
import sys
from html import escape
from pathlib import Path
from threading import BoundedSemaphore
from zipfile import BadZipFile, ZipFile

from app.config import MAX_UPLOAD_SIZE_BYTES
from app.engines.publishing.material_copy import (
    DOCUMENT_CONTENT_TYPES,
    MAX_COPY_CONTENT_BYTES,
    sanitize_copy_html,
)
from app.media_storage import media_exists, read_media_bytes

MAX_PDF_PAGES = 200
MAX_DOCX_ENTRIES = 2000
MAX_DOCX_EXPANDED_BYTES = 20 * 1024 * 1024
PARSE_TIMEOUT_SECONDS = 15
logger = logging.getLogger(__name__)
_PARSER_SLOTS = BoundedSemaphore(2)


def read_material_document(material, *, max_bytes: int = MAX_UPLOAD_SIZE_BYTES) -> str:
    """Read sanitized copy using the same bounded parsing as material previews."""
    if material["content_html"] is not None:
        return sanitize_copy_html(material["content_html"])
    key = material["object_key"]
    if not key or not media_exists(key):
        raise LookupError("Material content not found")
    data = read_media_bytes(key, max_bytes=max_bytes)
    if material["mime_type"] == "text/html":
        try:
            return sanitize_copy_html(data.decode("utf-8-sig"))
        except UnicodeDecodeError as exc:
            raise ValueError("Material content is not UTF-8 text") from exc
    extension = os.path.splitext(key)[1].lower()
    if extension not in DOCUMENT_CONTENT_TYPES:
        extension = {mime: suffix for suffix, mime in DOCUMENT_CONTENT_TYPES.items()}.get(
            material["mime_type"], "",
        )
        if material["mime_type"] == "text/x-markdown":
            extension = ".md"
    return parse_document_copy(data, extension)


def text_to_html(text: str) -> str:
    if any(ord(character) < 32 and character not in "\t\n\r" for character in text):
        raise ValueError("Document contains binary or unsupported control characters")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "<p>" + escape(text).replace("\n", "<br>") + "</p>"


def _decode_text(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Document text must be UTF-8") from exc


def _pdf_html(data: bytes) -> str:
    import fitz

    if not data.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF document")
    fitz.TOOLS.mupdf_display_errors(False)
    fitz.TOOLS.mupdf_display_warnings(False)
    try:
        with fitz.open(stream=data, filetype="pdf") as document:
            if document.needs_pass:
                raise ValueError("Password-protected PDFs are not supported")
            if document.page_count > MAX_PDF_PAGES:
                raise ValueError(f"PDF exceeds {MAX_PDF_PAGES} pages")
            if document.is_repaired:
                raise ValueError("PDF is damaged and requires repair")
            parts: list[str] = []
            size = 0
            for page in document:
                text = page.get_text(sort=True)
                if not text.strip():
                    raise ValueError("PDF contains a page without extractable text; OCR is not supported")
                html = text_to_html(text)
                size += len(html.encode("utf-8"))
                if size > MAX_COPY_CONTENT_BYTES:
                    raise ValueError("Extracted document content is too large")
                parts.append(html)
            if not parts:
                raise ValueError("PDF has no extractable text; OCR is not supported")
            return "".join(parts)
    except (fitz.FileDataError, RuntimeError) as exc:
        raise ValueError("Invalid or corrupted PDF document") from exc


def _docx_html(data: bytes) -> str:
    from docx import Document
    from docx.document import Document as DocumentObject
    from docx.oxml.exceptions import InvalidXmlError
    from docx.table import Table, _Cell
    from docx.text.paragraph import Paragraph
    from docx.text.run import Run
    from lxml.etree import XMLSyntaxError

    try:
        with ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_DOCX_ENTRIES:
                raise ValueError("DOCX contains too many archive entries")
            if sum(entry.file_size for entry in entries) > MAX_DOCX_EXPANDED_BYTES:
                raise ValueError("Expanded DOCX is too large")
            if any(entry.flag_bits & 1 for entry in entries):
                raise ValueError("Encrypted DOCX is not supported")
            if not {"[Content_Types].xml", "word/document.xml"} <= set(archive.namelist()):
                raise ValueError("Invalid DOCX document")
        document = Document(io.BytesIO(data))
        parts: list[str] = []
        size = 0

        def append(html: str) -> None:
            nonlocal size
            size += len(html.encode("utf-8"))
            if size > MAX_COPY_CONTENT_BYTES:
                raise ValueError("Extracted document content is too large")
            parts.append(html)

        def paragraph_html(paragraph: Paragraph) -> str:
            fragments: list[str] = []
            # Hyperlinks contribute visible text, but never external resources.
            for child in paragraph.iter_inner_content():
                for run in [child] if isinstance(child, Run) else child.runs:
                    fragment = escape(run.text).replace("\n", "<br>")
                    for enabled, tag in (
                        (run.bold, "strong"), (run.italic, "em"),
                        (run.underline, "u"), (run.font.strike, "s"),
                    ):
                        if enabled:
                            fragment = f"<{tag}>{fragment}</{tag}>"
                    fragments.append(fragment)
            text = "".join(fragments)
            style = paragraph.style.name if paragraph.style else ""
            if style.startswith("Heading"):
                tag = "h2" if style in {"Heading 1", "Heading 2"} else "h3"
                return f"<{tag}>{text}</{tag}>"
            if style.startswith("List"):
                tag = "ol" if "Number" in style else "ul"
                return f"<{tag}><li>{text}</li></{tag}>"
            return f"<p>{text}</p>"

        def append_blocks(container: DocumentObject | _Cell) -> None:
            for block in container.iter_inner_content():
                if isinstance(block, Paragraph):
                    append(paragraph_html(block))
                elif isinstance(block, Table):
                    for row in block.rows:
                        seen_cells = set()
                        for cell in row.cells:
                            if cell._tc not in seen_cells:
                                seen_cells.add(cell._tc)
                                append_blocks(cell)

        append_blocks(document)
        return "".join(parts).replace("</ol><ol>", "").replace("</ul><ul>", "")
    except (BadZipFile, KeyError, XMLSyntaxError, InvalidXmlError) as exc:
        raise ValueError("Invalid or corrupted DOCX document") from exc


def _convert_document(data: bytes, extension: str) -> str:
    if not data:
        raise ValueError("Document is empty")
    if len(data) > MAX_UPLOAD_SIZE_BYTES:
        raise ValueError("Document file is too large")
    if extension not in DOCUMENT_CONTENT_TYPES:
        raise ValueError("Unsupported document type")
    if extension == ".pdf":
        html = _pdf_html(data)
    elif extension == ".docx":
        html = _docx_html(data)
    else:
        if len(data) > MAX_COPY_CONTENT_BYTES:
            raise ValueError("Document text is too large")
        text = _decode_text(data)
        if extension == ".txt":
            html = text_to_html(text)
        else:
            from markdown_it import MarkdownIt

            text_to_html(text)  # Reject binary masquerading as Markdown.
            renderer = MarkdownIt("commonmark", {"html": False, "maxNesting": 32})
            renderer.enable(["table", "strikethrough"])
            renderer.renderer.rules["fence"] = lambda tokens, index, *_: text_to_html(tokens[index].content)
            renderer.renderer.rules["code_block"] = renderer.renderer.rules["fence"]
            renderer.renderer.rules["image"] = lambda tokens, index, *_: escape(tokens[index].content)
            for tag in ("table", "thead", "tbody", "tr", "link"):
                renderer.renderer.rules[f"{tag}_open"] = lambda *_: ""
                renderer.renderer.rules[f"{tag}_close"] = lambda *_: ""
            for tag in ("th", "td"):
                renderer.renderer.rules[f"{tag}_open"] = lambda *_: "<p>"
                renderer.renderer.rules[f"{tag}_close"] = lambda *_: "</p>"
            html = renderer.render(text)
            for source, target in (("h1", "h2"), ("h4", "h3"), ("h5", "h3"), ("h6", "h3")):
                html = html.replace(f"<{source}>", f"<{target}>").replace(
                    f"</{source}>", f"</{target}>",
                )
    try:
        return sanitize_copy_html(html)
    except ValueError as exc:
        raise ValueError(f"Document could not produce editable content: {exc}") from exc


def parse_document_copy(data: bytes, extension: str) -> str:
    """Run untrusted parsers outside the API process with a hard wall-clock limit."""
    extension = extension.lower()
    if extension not in DOCUMENT_CONTENT_TYPES:
        raise ValueError("Unsupported document type")
    if len(data) > MAX_UPLOAD_SIZE_BYTES:
        raise ValueError("Document file is too large")
    if not _PARSER_SLOTS.acquire(timeout=PARSE_TIMEOUT_SECONDS):
        raise ValueError("Document parser is busy; retry the upload")
    try:
        try:
            result = subprocess.run(
                [sys.executable, "-m", "app.engines.publishing.document_copy", extension],
                input=data, capture_output=True, timeout=PARSE_TIMEOUT_SECONDS,
                cwd=Path(__file__).resolve().parents[3], check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ValueError("Document parsing exceeded the processing time limit") from exc
    finally:
        _PARSER_SLOTS.release()
    if result.returncode:
        logger.warning("Document parser failed: exit=%s", result.returncode)
        raise ValueError("Document parsing failed: corrupted document or processing limit exceeded")
    payload = json.loads(result.stdout)
    if "error" in payload:
        raise ValueError(payload["error"])
    return sanitize_copy_html(payload["content"])


def _worker() -> None:
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (PARSE_TIMEOUT_SECONDS, PARSE_TIMEOUT_SECONDS))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    try:
        content = _convert_document(
            sys.stdin.buffer.read(MAX_UPLOAD_SIZE_BYTES + 1), sys.argv[1],
        )
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
    else:
        print(json.dumps({"content": content}))


if __name__ == "__main__":
    _worker()
