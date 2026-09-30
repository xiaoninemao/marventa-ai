from html import escape
from html.parser import HTMLParser
from typing import ClassVar
from urllib.parse import urlsplit

MAX_COPY_CONTENT_BYTES = 1024 * 1024
DOCUMENT_CONTENT_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_ALLOWED_TAGS = {
    "p", "h2", "h3", "strong", "em", "s", "u", "ul", "ol", "li",
    "blockquote", "br", "a",
}
_DISCARD_TAGS = {"script", "style", "iframe", "object", "template", "svg", "math"}


def validate_copy_title(title: str) -> str:
    normalized = title.strip()
    if (
        not normalized or len(normalized) > 255
        or "/" in normalized or "\\" in normalized
        or any(ord(character) < 32 for character in normalized)
    ):
        raise ValueError("Copy title is invalid")
    return normalized


def _safe_href(value: str) -> str:
    value = value.strip()
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        return ""
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() in {"http", "https"} and parsed.netloc:
            return value
        if parsed.scheme.lower() == "mailto" and parsed.path:
            return value
    except ValueError:
        pass
    return ""


class _CopyHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.output: list[str] = []
        self.text: list[str] = []
        self.open_tags: list[str] = []
        self.discarded_tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.discarded_tags:
            if tag in _DISCARD_TAGS:
                self.discarded_tags.append(tag)
            return
        if tag in _DISCARD_TAGS:
            self.discarded_tags.append(tag)
            return
        if tag not in _ALLOWED_TAGS:
            return
        if len(self.open_tags) >= 128:
            raise ValueError("Copy HTML nesting is too deep")
        attributes = ""
        if tag == "a":
            href = _safe_href(dict(attrs).get("href") or "")
            if href:
                attributes = f' href="{escape(href, quote=True)}"'
        self.output.append(f"<{tag}{attributes}>")
        if tag != "br":
            self.open_tags.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.discarded_tags:
            if tag in self.discarded_tags:
                while self.discarded_tags.pop() != tag:
                    pass
            return
        if tag not in _ALLOWED_TAGS:
            return
        if tag in self.open_tags:
            while self.open_tags:
                opened = self.open_tags.pop()
                self.output.append(f"</{opened}>")
                if opened == tag:
                    break

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if not self.discarded_tags:
            self.output.append(escape(data))
            self.text.append(data)


def sanitize_copy_html(content: str, *, allow_empty: bool = False) -> str:
    if len(content.encode("utf-8")) > MAX_COPY_CONTENT_BYTES:
        raise ValueError("Copy content is too large")
    if any(ord(character) < 32 and character not in "\t\n\r" for character in content):
        raise ValueError("Copy content contains unsupported control characters")
    parser = _CopyHTMLParser()
    try:
        parser.feed(content)
        parser.close()
    except AssertionError as exc:
        raise ValueError("Copy content contains invalid HTML") from exc
    if not "".join(parser.text).strip():
        if allow_empty:
            return ""
        raise ValueError("Copy content is empty")
    sanitized = "".join(parser.output) + "".join(
        f"</{tag}>" for tag in reversed(parser.open_tags)
    )
    if len(sanitized.encode("utf-8")) > MAX_COPY_CONTENT_BYTES:
        raise ValueError("Copy content is too large")
    return sanitized


def validate_copy_text(content: str) -> str:
    try:
        encoded = content.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError("Copy content contains invalid Unicode") from exc
    if len(encoded) > MAX_COPY_CONTENT_BYTES:
        raise ValueError("Copy content is too large")
    if any(
        (ord(character) < 32 and character not in "\t\n\r")
        or 127 <= ord(character) <= 159
        for character in content
    ):
        raise ValueError("Copy content contains unsupported control characters")
    return content if content.strip() else ""


class _CopyTextParser(HTMLParser):
    _BLOCK_BREAKS: ClassVar[dict[str, int]] = {
        "p": 2, "h1": 2, "h2": 2, "h3": 2, "h4": 2, "h5": 2, "h6": 2,
        "blockquote": 2, "div": 1, "li": 1, "ul": 1, "ol": 1, "pre": 2,
        "section": 2, "article": 2, "tr": 1,
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.output: list[str] = []
        self.discarded_tags: list[str] = []
        self.pending_breaks = 0
        self.trailing_breaks = 0

    def _append(self, text: str) -> None:
        self.output.append(text)
        if text.endswith("\n"):
            count = len(text) - len(text.rstrip("\n"))
            self.trailing_breaks = self.trailing_breaks + count if count == len(text) else count
        elif text:
            self.trailing_breaks = 0

    def _flush_breaks(self) -> None:
        if self.output:
            self._append("\n" * max(0, self.pending_breaks - self.trailing_breaks))
        self.pending_breaks = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.discarded_tags:
            if tag in _DISCARD_TAGS:
                self.discarded_tags.append(tag)
            return
        if tag in _DISCARD_TAGS:
            self.discarded_tags.append(tag)
        elif tag == "br":
            self._flush_breaks()
            self._append("\n")
        elif tag in self._BLOCK_BREAKS:
            self.pending_breaks = max(self.pending_breaks, self._BLOCK_BREAKS[tag])

    def handle_endtag(self, tag: str) -> None:
        if self.discarded_tags:
            if tag in self.discarded_tags:
                while self.discarded_tags.pop() != tag:
                    pass
        elif tag in self._BLOCK_BREAKS:
            self.pending_breaks = max(self.pending_breaks, self._BLOCK_BREAKS[tag])

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.discarded_tags:
            return
        # Ignore source indentation between blocks, not whitespace inside text.
        if self.pending_breaks and not data.strip() and "\n" in data:
            return
        self._flush_breaks()
        self._append(data)


def copy_html_to_text(content: str) -> str:
    parser = _CopyTextParser()
    try:
        parser.feed(content)
        parser.close()
    except AssertionError as exc:
        raise ValueError("Copy content contains invalid HTML") from exc
    return validate_copy_text("".join(parser.output))
