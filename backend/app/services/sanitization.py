from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

import bleach
from bleach.css_sanitizer import CSSSanitizer

_ALLOWED_URL_SCHEMES = {"http", "https"}

_TAG_ATTRIBUTES: dict[str, set[str]] = {
    "a": {"href", "target", "rel"},
    "img": {"src", "alt", "width", "height", "loading", "decoding"},
    "button": {"type", "disabled"},
    "input": {"type", "name", "value", "placeholder", "checked", "disabled"},
    "label": {"for"},
}

_GLOBAL_ATTRIBUTES = {"class", "id", "title", "role", "style"}
_ALLOWED_TAGS = [
    "a",
    "article",
    "aside",
    "b",
    "blockquote",
    "br",
    "button",
    "code",
    "div",
    "em",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "img",
    "input",
    "label",
    "li",
    "main",
    "ol",
    "p",
    "section",
    "small",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
]
_SCRIPT_STYLE_BLOCK_RE = re.compile(
    r"<\s*(script|style)\b[^>]*>[\s\S]*?<\s*/\s*\1\s*>",
    flags=re.IGNORECASE,
)
_CSS_SANITIZER = CSSSanitizer(
    allowed_css_properties=[
        "align-items",
        "background",
        "background-color",
        "border",
        "border-bottom",
        "border-color",
        "border-left",
        "border-radius",
        "border-right",
        "border-top",
        "box-shadow",
        "color",
        "display",
        "flex",
        "flex-direction",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "gap",
        "height",
        "justify-content",
        "line-height",
        "margin",
        "margin-bottom",
        "margin-left",
        "margin-right",
        "margin-top",
        "max-height",
        "max-width",
        "min-height",
        "min-width",
        "padding",
        "padding-bottom",
        "padding-left",
        "padding-right",
        "padding-top",
        "text-align",
        "text-decoration",
        "width",
    ]
)


def _allow_attribute(tag: str, name: str, _value: str) -> bool:
    if name in _GLOBAL_ATTRIBUTES:
        return True
    if name.startswith("data-") or name.startswith("aria-"):
        return True
    return name in _TAG_ATTRIBUTES.get(tag, set())


def sanitize_guest_html(value: str | None, *, max_len: int = 20_000) -> str | None:
    if not value:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    clipped = trimmed[:max_len]
    without_script_blocks = _SCRIPT_STYLE_BLOCK_RE.sub("", clipped)
    sanitized = bleach.clean(
        without_script_blocks,
        tags=_ALLOWED_TAGS,
        attributes=_allow_attribute,
        protocols=["http", "https", "mailto", "tel"],
        strip=True,
        strip_comments=True,
        css_sanitizer=_CSS_SANITIZER,
    )
    return sanitized or None


def sanitize_redirect_url(
    value: str | None,
    *,
    allow_relative: bool = True,
    max_len: int = 2048,
) -> str | None:
    if not value:
        return None
    cleaned = value.strip().replace("\n", "").replace("\r", "")
    if not cleaned:
        return None
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    if cleaned.startswith("//") or "\\" in cleaned:
        return None
    if any(ord(char) < 32 for char in cleaned):
        return None

    parsed = urlsplit(cleaned)
    if parsed.scheme:
        scheme = parsed.scheme.lower()
        if scheme not in _ALLOWED_URL_SCHEMES or not parsed.netloc:
            return None
        return urlunsplit((scheme, parsed.netloc, parsed.path, parsed.query, parsed.fragment))

    if not allow_relative:
        return None
    if cleaned.startswith("/"):
        return cleaned
    return None
