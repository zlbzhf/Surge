#!/usr/bin/env python3
"""Surge File Capture archive receiver.

Receives metadata JSON from modules/file-capture.sgmodule or
modules/aia-file-capture.sgmodule, downloads the referenced files server-side,
and stores them under a product/material folder tree.

Only Python stdlib is used so this can run on a small VPS.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import http.server
import ipaddress
import json
import mimetypes
import os
import posixpath
import queue
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.error
import uuid
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

DEFAULT_MAX_BYTES = 80 * 1024 * 1024
DEFAULT_TIMEOUT = 25
INDEX_FIELDS = [
    "archived_at",
    "product_name",
    "material_type",
    "kind",
    "filename",
    "size",
    "sha256",
    "relative_path",
    "source_url",
    "source",
    "action",
    "original_filename",
    "detected_extension",
    "classification_confidence",
    "classification_reason",
]
SAFE_NAME_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff._()（）\-+& ，,、【】\[\]《》]+")
SECRET_QUERY_KEYS = re.compile(
    r"(^|_|-|\.)(token|access_token|auth|authorization|session|sid|password|passwd|pwd|secret|key|api_key|apikey|signature|sign|ticket|code|openid|unionid)(_|-|\.|$)",
    re.I,
)
FILE_EXTENSIONS = {
    "pdf", "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "svg", "bmp", "tiff",
    "mp4", "mov", "m4v", "mkv", "webm", "avi", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus",
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
}
MATERIAL_HINT_RE = re.compile(r"一图|一图读懂|一张图|图解|宣传彩页|彩页|产品条款|保险条款|产品合同|保险合同|合同样本|费率表|现金价值|产品说明书|产品说明|营运规则|运营规则|operation\s+rules|投保须知|停售|后续服务|公开披露|资料", re.I)
TEXT_PAGE_MAX_BYTES = 2 * 1024 * 1024
GENERIC_MATERIALS = {"", "文件", "image", "图片", "待确认", "资料"}
IMAGE_MATERIALS = {"一图", "宣传彩页", "产品彩页"}
SMALL_IMAGE_MAX_DIMENSION = 500
INDEX_LOCK = threading.Lock()
JOB_LOG_NAME = "archive-jobs.jsonl"


@dataclass
class ArchiveConfig:
    root: Path
    token: str
    allowed_suffixes: tuple[str, ...]
    allow_private: bool
    max_bytes: int
    timeout: int
    async_mode: bool = True
    queue_size: int = 1000


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def load_config(args: argparse.Namespace) -> ArchiveConfig:
    root = Path(args.root or os.getenv("FILE_ARCHIVE_ROOT") or "./file-archive").expanduser().resolve()
    token = args.token if args.token is not None else os.getenv("FILE_ARCHIVE_TOKEN", "")
    suffixes_raw = args.allowed_hosts if args.allowed_hosts is not None else os.getenv("FILE_ARCHIVE_ALLOWED_HOST_SUFFIXES", "")
    suffixes = tuple(
        s.strip().lower().lstrip(".")
        for s in suffixes_raw.split(",")
        if s.strip()
    )
    async_mode = env_bool("FILE_ARCHIVE_ASYNC", True)
    if getattr(args, "sync_mode", False):
        async_mode = False
    if getattr(args, "async_mode", False):
        async_mode = True
    return ArchiveConfig(
        root=root,
        token=token,
        allowed_suffixes=suffixes,
        allow_private=bool(args.allow_private) or env_bool("FILE_ARCHIVE_ALLOW_PRIVATE", False),
        max_bytes=args.max_bytes or env_int("FILE_ARCHIVE_MAX_BYTES", DEFAULT_MAX_BYTES),
        timeout=args.timeout or env_int("FILE_ARCHIVE_TIMEOUT", DEFAULT_TIMEOUT),
        async_mode=async_mode,
        queue_size=args.queue_size or env_int("FILE_ARCHIVE_QUEUE_SIZE", 1000),
    )


def sanitize_name(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    if not text:
        text = fallback
    text = urllib.parse.unquote(text).replace("/", "-").replace("\\", "-")
    text = SAFE_NAME_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" ._-")
    return (text or fallback)[:120]


def host_matches_suffix(hostname: str, suffixes: tuple[str, ...]) -> bool:
    host = hostname.lower().rstrip(".")
    if not suffixes:
        return True
    return any(host == suffix or host.endswith("." + suffix) for suffix in suffixes)


def is_public_address(ip_text: str, allow_private: bool) -> bool:
    ip = ipaddress.ip_address(ip_text)
    if allow_private:
        return True
    blocked = (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
    )
    return not blocked


def validate_download_url(raw_url: str, config: ArchiveConfig) -> urllib.parse.ParseResult:
    if not raw_url:
        raise ValueError("missing download URL")
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("only http/https URLs are allowed")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials are rejected")
    if not parsed.hostname:
        raise ValueError("URL hostname is empty")
    if not host_matches_suffix(parsed.hostname, config.allowed_suffixes):
        raise ValueError(f"host not in allowlist: {parsed.hostname}")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"DNS lookup failed: {exc}") from exc
    for info in infos:
        ip_text = str(info[4][0])
        if not is_public_address(ip_text, config.allow_private):
            raise ValueError(f"blocked non-public address: {ip_text}")
    return parsed


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, config: ArchiveConfig) -> None:
        self.config = config
        super().__init__()

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        validate_download_url(newurl, self.config)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def content_disposition_filename(value: str) -> str:
    if not value:
        return ""
    star = re.search(r"filename\*=(?:UTF-8''|)([^;]+)", value, re.I)
    plain = re.search(r'filename="?([^";]+)"?', value, re.I)
    raw = star.group(1) if star else plain.group(1) if plain else ""
    return urllib.parse.unquote(raw.strip().strip('"')) if raw else ""


def guess_extension(content_type: str, current_name: str) -> str:
    ext = Path(current_name).suffix
    if ext:
        return ext
    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) if content_type else ""
    return guessed or ""


def filename_from_item(item: dict[str, Any], response, parsed_url: urllib.parse.ParseResult) -> str:
    cd_name = content_disposition_filename(response.headers.get("Content-Disposition", ""))
    url_name = Path(urllib.parse.unquote(parsed_url.path)).name
    raw = cd_name or str(item.get("filename") or "") or url_name or str(item.get("kind") or "file")
    name = sanitize_name(raw, "file")
    ext = guess_extension(response.headers.get("Content-Type", ""), name)
    if ext and not name.lower().endswith(ext.lower()):
        name = f"{name}{ext}"
    return name[:180]


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(b"\xff\xd8"):
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        while i < len(data) and data[i] == 0xFF:
            i += 1
        if i >= len(data):
            break
        marker = data[i]
        i += 1
        if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if i + 2 > len(data):
            break
        seg_len = struct.unpack(">H", data[i:i + 2])[0]
        if seg_len < 2 or i + seg_len > len(data) + 2:
            break
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height = struct.unpack(">H", data[i + 3:i + 5])[0]
            width = struct.unpack(">H", data[i + 5:i + 7])[0]
            return width, height
        i += seg_len
    return None


def detect_magic(head: bytes, fallback_content_type: str, fallback_name: str) -> dict[str, Any]:
    content_type = (fallback_content_type or "").split(";", 1)[0].strip().lower()
    suffix = Path(fallback_name).suffix.lower().lstrip(".")
    detected = {"ext": suffix, "kind": guess_kind_from_url("x." + suffix) if suffix else "", "width": None, "height": None, "magic": ""}
    if head.startswith(b"%PDF-"):
        detected.update({"ext": "pdf", "kind": "pdf", "magic": "pdf"})
    elif head.startswith(b"\xff\xd8"):
        dims = jpeg_dimensions(head)
        detected.update({"ext": "jpg", "kind": "image", "magic": "jpeg", "width": dims[0] if dims else None, "height": dims[1] if dims else None})
    elif head.startswith(b"\x89PNG\r\n\x1a\n"):
        width = height = None
        if len(head) >= 24:
            width, height = struct.unpack(">II", head[16:24])
        detected.update({"ext": "png", "kind": "image", "magic": "png", "width": width, "height": height})
    elif head.startswith((b"GIF87a", b"GIF89a")):
        width = height = None
        if len(head) >= 10:
            width, height = struct.unpack("<HH", head[6:10])
        detected.update({"ext": "gif", "kind": "image", "magic": "gif", "width": width, "height": height})
    elif head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        detected.update({"ext": "webp", "kind": "image", "magic": "webp"})
    elif head.startswith(b"PK\x03\x04"):
        office_exts = {"docx", "xlsx", "pptx"}
        detected.update({"ext": suffix or "zip", "kind": "office" if suffix in office_exts else "archive", "magic": "zip"})
    elif content_type == "application/pdf":
        detected.update({"ext": "pdf", "kind": "pdf", "magic": "content-type"})
    elif content_type.startswith("image/"):
        ext = content_type.split("/", 1)[1].replace("jpeg", "jpg")
        detected.update({"ext": ext or suffix or "img", "kind": "image", "magic": "content-type"})
    if not detected["ext"]:
        guessed = mimetypes.guess_extension(content_type) if content_type else ""
        detected["ext"] = (guessed or "").lstrip(".") or "bin"
    return detected


def infer_image_material(item: dict[str, Any], original_name: str, raw_url: str, detected: dict[str, Any], current_material: str) -> tuple[str, str, str]:
    text = context_text_for_item(item, original_name, raw_url)
    if re.search(r"一图|一图读懂|一张图|图解|one\s*page|onepage|infographic", text, re.I):
        return "一图", "high", "explicit_one_picture_signal"
    if re.search(r"宣传彩页|产品彩页|彩页|brochure|leaflet|flyer|color\s*page|colorpage|poster", text, re.I):
        return "宣传彩页", "high", "explicit_brochure_signal"
    if current_material in IMAGE_MATERIALS:
        return current_material, "high", "explicit_image_context_material"
    size = int(item.get("size") or 0)
    width = int(detected.get("width") or 0)
    height = int(detected.get("height") or 0)
    if width and height and width <= SMALL_IMAGE_MAX_DIMENSION and height <= SMALL_IMAGE_MAX_DIMENSION:
        return "忽略小图标", "low", "small_square_image"
    if size and size < 80 * 1024:
        return "忽略小图标", "low", "small_generic_image"
    if width >= 700 and height >= width * 3:
        return "一图", "medium", "tall_image_dimension_signal"
    if width >= 1200 and height >= 900 and 0.55 <= (height / width) <= 1.2:
        return "宣传彩页", "medium", "large_landscape_image_dimension_signal"
    if width >= 1200 and height >= 900:
        return "待确认图片资料", "low", "large_document_like_image_without_explicit_label"
    return "待确认图片资料", "low", "generic_image_without_material_label"


def extract_pdf_text(path: Path, max_pages: int = 2) -> str:
    """Extract a small amount of PDF text for material classification."""
    if shutil.which("pdftotext") is None:
        return ""
    try:
        result = subprocess.run(
            ["pdftotext", "-f", "1", "-l", str(max_pages), "-layout", str(path), "-"],
            check=False,
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", "ignore")[:20000]


def infer_pdf_material_from_text(text: str, current_material: str = "") -> tuple[str, str, str]:
    normalized = re.sub(r"\s+", " ", html.unescape(text or "")).strip()
    if not normalized:
        return current_material, "", ""
    title_region = normalized[:3000]
    if re.search(r"OPERATION\s+RULES|Operation\s+rules|营运规则|运营规则", title_region, re.I):
        return "营运规则", "high", "pdf_text_operation_rules"
    if re.search(r"产品说明书|产品说明", title_region):
        return "产品说明书", "high", "pdf_text_product_instruction"
    if re.search(r"费率表|保险费率|premium\s+rate|rate\s+table", title_region, re.I):
        return "费率表", "high", "pdf_text_rate_table"
    if re.search(r"请扫描以查询验证条款|在本条款中|本保险条款|保险条款|产品条款|terms|clause", title_region, re.I):
        return "产品条款", "high", "pdf_text_product_clause"
    if re.search(r"现金价值全表|现金价值表|现金价值.*利益.*表", title_region):
        return "现金价值全表", "high", "pdf_text_cash_value"
    return current_material, "", ""


def infer_pdf_material_from_file(path: Path, current_material: str = "") -> tuple[str, str, str]:
    return infer_pdf_material_from_text(extract_pdf_text(path), current_material)


def readable_filename(product: str, material: str, sha256: str, ext: str) -> str:
    return sanitize_name(f"{product}_{material}_{sha256[:8]}", "file") + f".{ext.lstrip('.') or 'bin'}"


def find_existing_by_hash(root: Path, sha256: str) -> Path | None:
    for path in root.rglob("*"):
        if not path.is_file() or path.name in {"index.csv", "index.jsonl"} or path.name.startswith(".download-"):
            continue
        try:
            if hashlib.sha256(path.read_bytes()).hexdigest() == sha256:
                return path
        except OSError:
            continue
    return None


def should_move_existing(existing: Path, target: Path, product: str, material: str) -> bool:
    if existing == target:
        return False
    rel_parts = existing.parts
    has_unknown = "未关联产品" in rel_parts or "文件" in rel_parts or "image" in rel_parts or "pdf" in rel_parts
    has_better_context = product != "未关联产品" or material not in {"文件", "image", "pdf", "待确认图片资料"}
    return has_unknown and has_better_context


def dedupe_path(path: Path, sha256: str | None = None) -> Path:
    if not path.exists():
        return path
    if sha256:
        try:
            existing_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            if existing_hash == sha256:
                return path
        except OSError:
            pass
    stem = path.stem
    suffix = path.suffix
    for i in range(2, 1000):
        candidate = path.with_name(f"{stem}-{i}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"too many duplicate filenames near {path}")


def redact_url(raw_url: str) -> str:
    parsed = urllib.parse.urlparse(raw_url)
    if not parsed.query:
        return urllib.parse.urlunparse(parsed._replace(fragment=""))
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    safe_pairs = []
    for key, value in pairs[:40]:
        if SECRET_QUERY_KEYS.search(key):
            safe_pairs.append((key, "[REDACTED]"))
        else:
            safe_pairs.append((key, value[:160]))
    query = urllib.parse.urlencode(safe_pairs, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=query, fragment=""))


def is_file_url(raw_url: str) -> bool:
    parsed = urllib.parse.urlparse(raw_url)
    suffix = Path(urllib.parse.unquote(parsed.path)).suffix.lower().lstrip(".")
    return suffix in FILE_EXTENSIONS


def guess_kind_from_url(raw_url: str) -> str:
    ext = Path(urllib.parse.unquote(urllib.parse.urlparse(raw_url).path)).suffix.lower().lstrip(".")
    if ext == "pdf":
        return "pdf"
    if ext in {"jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "svg", "bmp", "tiff"}:
        return "image"
    if ext in {"mp4", "mov", "m4v", "mkv", "webm", "avi"}:
        return "video"
    if ext in {"mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"}:
        return "audio"
    if ext in {"zip", "rar", "7z", "tar", "gz", "bz2", "xz"}:
        return "archive"
    if ext in {"doc", "docx", "xls", "xlsx", "ppt", "pptx"}:
        return "office"
    return "binary" if ext else ""


def infer_material_type(label: str, raw_url: str, fallback: str = "") -> str:
    text = html.unescape(urllib.parse.unquote(f"{label} {raw_url}"))
    if re.search(r"一图|一图读懂|一张图|图解|one\s*page|onepage|infographic", text, re.I):
        return "一图"
    if re.search(r"宣传彩页|彩页|brochure|leaflet|flyer|color\s*page|colorpage|poster", text, re.I):
        return "宣传彩页"
    if re.search(r"产品合同|保险合同|合同样本", text):
        return "产品合同"
    if re.search(r"产品条款|保险条款|条款|terms|clause", text, re.I):
        return "产品条款"
    if re.search(r"营运规则|运营规则|operation\s+rules", text, re.I):
        return "营运规则"
    if re.search(r"费率表|费率|rate", text, re.I):
        return "费率表"
    if "现金价值" in text:
        return "现金价值全表"
    if re.search(r"产品说明书|产品说明|说明书|brochure", text, re.I):
        return "产品说明书/产品说明"
    if "投保须知" in text:
        return "投保须知"
    if re.search(r"停售|后续服务|follow", text, re.I):
        return "停售时间、停售原因及后续服务措施"
    return fallback or "文件"


def iter_context_dicts(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Return bounded, explicit app/SOP context dicts without raw auth/session data."""
    out: list[dict[str, Any]] = [item]
    for key in ("context", "appContext", "app_context", "sopContext", "sop_context", "sourceContext", "source_context", "latestContext", "latest_context"):
        value = item.get(key)
        if isinstance(value, dict):
            out.append(value)
        elif isinstance(value, str) and len(value) <= 8192:
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                out.append(parsed)
    return out[:12]


def first_context_value(item: dict[str, Any], keys: tuple[str, ...]) -> tuple[str, str]:
    for ctx_i, ctx in enumerate(iter_context_dicts(item)):
        for key in keys:
            value = ctx.get(key)
            if value is None:
                continue
            text = html.unescape(str(value)).strip()
            if text:
                source = key if ctx_i == 0 else f"context.{key}"
                return text[:200], source
    return "", ""


def best_product_name(item: dict[str, Any]) -> tuple[str, str]:
    return first_context_value(item, (
        "productName", "product_name", "policyListName", "policy_list_name",
        "policyName", "policy_name", "productTitle", "product_title", "product",
    ))


def best_material_label(item: dict[str, Any]) -> tuple[str, str]:
    label, source = first_context_value(item, (
        "clauseName", "clause_name", "materialType", "material_type",
        "buttonText", "button_text", "linkText", "link_text", "text",
    ))
    if not label:
        return "", ""
    return infer_material_type(label, "", label), source


def context_text_for_item(item: dict[str, Any], original_name: str, raw_url: str) -> str:
    safe_keys = (
        "materialType", "material_type", "clauseName", "clause_name", "filename",
        "sourceUrl", "source_url", "pageTitle", "page_title", "title", "text",
        "eventName", "event_name", "sourcePage", "source_page", "operationType", "operation_type",
        "policyListName", "policyName", "productName", "product_name",
    )
    parts = [original_name, raw_url]
    for ctx in iter_context_dicts(item):
        for key in safe_keys:
            value = ctx.get(key)
            if value:
                parts.append(str(value)[:240])
    return html.unescape(urllib.parse.unquote(" ".join(parts)))


def is_explicit_sop_source(source: str) -> bool:
    return any(part in source.lower() for part in ("clausename", "sop", "context"))


def strip_html_text(body: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", body, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def infer_product_name_from_page(body: str) -> str:
    candidates: list[str] = []
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", body, re.I)
    if title_match:
        candidates.append(re.sub(r"\s*[-_|].*$", "", html.unescape(title_match.group(1))).strip())
    plain = strip_html_text(body)[:30000]
    candidates.extend(re.findall(r"[\u4e00-\u9fffA-Za-z0-9（）()·\-]{2,80}(?:保险|寿险|年金|重疾|医疗|意外|分红)[\u4e00-\u9fffA-Za-z0-9（）()·\-]{0,40}", plain)[:12])
    for value in candidates:
        value = re.sub(r"^(产品名称|名称)[:：]", "", value)
        value = re.sub(r"(宣传彩页|产品条款|产品合同|费率表|现金价值).*$", "", value).strip()
        if re.search(r"保险|寿险|年金|重疾|医疗|意外|分红|友邦", value):
            return value[:120]
    return ""


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict[str, str]] = []
        self._active_href = ""
        self._active_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): v or "" for k, v in attrs}
        raw = attr_map.get("href") or attr_map.get("src") or attr_map.get("data-src") or ""
        if not raw:
            return
        if tag.lower() == "a":
            self._active_href = raw
            self._active_text = []
        else:
            self.links.append({"url": raw, "text": attr_map.get("alt") or attr_map.get("title") or ""})

    def handle_data(self, data: str) -> None:
        if self._active_href:
            self._active_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._active_href:
            self.links.append({"url": self._active_href, "text": " ".join(self._active_text)})
            self._active_href = ""
            self._active_text = []


def resolve_link(base_url: str, raw_link: str) -> str:
    link = html.unescape(str(raw_link or "")).strip()
    if not link or link.startswith(("javascript:", "mailto:", "tel:", "data:")):
        return ""
    return urllib.parse.urljoin(base_url, link)


def extract_links_from_text(body: str, base_url: str) -> list[dict[str, str]]:
    extractor = LinkExtractor()
    try:
        extractor.feed(body)
    except Exception:
        pass
    links = extractor.links[:500]
    for match in re.finditer(r"https?://[^\s\"'<>\\)]+", body):
        links.append({"url": match.group(0), "text": ""})
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for link in links:
        resolved = resolve_link(base_url, link.get("url", ""))
        if not resolved or resolved in seen:
            continue
        seen.add(resolved)
        out.append({"url": resolved, "text": re.sub(r"\s+", " ", html.unescape(link.get("text", ""))).strip()[:160]})
    return out


def fetch_text_page(raw_url: str, config: ArchiveConfig) -> tuple[str, str]:
    parsed = validate_download_url(raw_url, config)
    req = urllib.request.Request(
        raw_url,
        headers={
            "User-Agent": "Surge-File-Archive/1.0 (+https://github.com/zlbzhf/Surge)",
            "Accept": "text/html,application/json,text/plain;q=0.9,*/*;q=0.2",
        },
    )
    opener = urllib.request.build_opener(SafeRedirectHandler(config))
    with opener.open(req, timeout=config.timeout) as response:
        final_url = response.geturl()
        validate_download_url(final_url, config)
        content_type = response.headers.get("Content-Type", "")
        if re.search(r"application/(pdf|zip|octet-stream)|image/|video/|audio/", content_type, re.I):
            raise ValueError(f"not a text page: {content_type}")
        data = response.read(TEXT_PAGE_MAX_BYTES + 1)
        if len(data) > TEXT_PAGE_MAX_BYTES:
            raise ValueError(f"page too large: > {TEXT_PAGE_MAX_BYTES}")
        charset_match = re.search(r"charset=([^;]+)", content_type, re.I)
        charset = charset_match.group(1).strip() if charset_match else "utf-8"
        try:
            return data.decode(charset, errors="replace"), final_url
        except LookupError:
            return data.decode("utf-8", errors="replace"), final_url


def item_is_page(item: dict[str, Any]) -> bool:
    kind = str(item.get("kind") or "").lower()
    content_type = str(item.get("contentType") or item.get("content_type") or "").lower()
    raw_url = str(item.get("downloadUrl") or item.get("download_url") or item.get("url") or "")
    return bool(kind in {"page", "html"} or "text/html" in content_type or (raw_url and not is_file_url(raw_url) and MATERIAL_HINT_RE.search(str(item))))


def build_crawled_file_item(source_item: dict[str, Any], file_url: str, source_page: str, label: str, inherited_material: str) -> dict[str, Any]:
    filename = Path(urllib.parse.unquote(urllib.parse.urlparse(file_url).path)).name or "file"
    material = infer_material_type(label, file_url, inherited_material)
    return {
        "productName": source_item.get("productName") or source_item.get("product_name") or "",
        "productCode": source_item.get("productCode") or source_item.get("product_code") or "",
        "materialType": material,
        "kind": guess_kind_from_url(file_url),
        "filename": filename,
        "url": redact_url(file_url),
        "downloadUrl": file_url,
        "source": "page-crawl",
        "sourceUrl": redact_url(source_page),
    }


def crawl_page_item(item: dict[str, Any], config: ArchiveConfig) -> list[dict[str, Any]]:
    page_url = str(item.get("downloadUrl") or item.get("download_url") or item.get("url") or "")
    body, final_page_url = fetch_text_page(page_url, config)
    if not (item.get("productName") or item.get("product_name")):
        inferred_product = infer_product_name_from_page(body)
        if inferred_product:
            item = dict(item)
            item["productName"] = inferred_product
    inherited_material = str(item.get("materialType") or item.get("material_type") or "")
    saved: list[dict[str, Any]] = []
    seen_files: set[str] = set()
    seen_pages: set[str] = {final_page_url}
    nested_pages: list[tuple[str, str]] = []
    last_error: Exception | None = None

    def download_file(file_url: str, source_page: str, label: str) -> None:
        nonlocal last_error
        if file_url in seen_files:
            return
        seen_files.add(file_url)
        try:
            saved.append(download_one(build_crawled_file_item(item, file_url, source_page, label, inherited_material), config))
        except Exception as exc:
            last_error = exc
            print(f"page crawl download failed: {file_url}: {exc}")

    for link in extract_links_from_text(body, final_page_url)[:120]:
        url = link["url"]
        label = link.get("text", "")
        if is_file_url(url):
            download_file(url, final_page_url, label)
        elif len(nested_pages) < 30 and MATERIAL_HINT_RE.search(f"{label} {url}") and url not in seen_pages:
            seen_pages.add(url)
            nested_pages.append((url, label))

    for nested_url, nested_label in nested_pages:
        try:
            nested_body, nested_final_url = fetch_text_page(nested_url, config)
        except Exception as exc:
            last_error = exc
            print(f"page crawl nested page failed: {nested_url}: {exc}")
            continue
        for link in extract_links_from_text(nested_body, nested_final_url)[:80]:
            if is_file_url(link["url"]):
                download_file(link["url"], nested_final_url, link.get("text") or nested_label)

    if not saved and last_error:
        raise last_error
    if not saved:
        raise ValueError("page crawl found no downloadable file links")
    return saved


def append_indexes(config: ArchiveConfig, record: dict[str, Any]) -> None:
    config.root.mkdir(parents=True, exist_ok=True)
    csv_path = config.root / "index.csv"
    jsonl_path = config.root / "index.jsonl"
    with INDEX_LOCK:
        write_header = not csv_path.exists()
        with csv_path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=INDEX_FIELDS)
            if write_header:
                writer.writeheader()
            writer.writerow({key: record.get(key, "") for key in INDEX_FIELDS})
        with jsonl_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def download_one(item: dict[str, Any], config: ArchiveConfig) -> dict[str, Any]:
    raw_url = str(item.get("downloadUrl") or item.get("download_url") or item.get("url") or "")
    parsed = validate_download_url(raw_url, config)
    req = urllib.request.Request(
        raw_url,
        headers={
            "User-Agent": "Surge-File-Archive/1.0 (+https://github.com/zlbzhf/Surge)",
            "Accept": "*/*",
        },
    )
    opener = urllib.request.build_opener(SafeRedirectHandler(config))
    staging_dir = config.root / "_pending"
    staging_dir.mkdir(parents=True, exist_ok=True)
    with opener.open(req, timeout=config.timeout) as response:
        final_url = response.geturl()
        validate_download_url(final_url, config)
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > config.max_bytes:
            raise ValueError(f"file too large: {content_length} > {config.max_bytes}")
        final_parsed = urllib.parse.urlparse(final_url)
        original_filename = filename_from_item(item, response, final_parsed or parsed)
        temp_fd, temp_name = tempfile.mkstemp(prefix=".download-", dir=str(staging_dir))
        size = 0
        digest = hashlib.sha256()
        head = b""
        try:
            with os.fdopen(temp_fd, "wb") as f:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > config.max_bytes:
                        raise ValueError(f"file too large while streaming: {size} > {config.max_bytes}")
                    if len(head) < 1024 * 1024:
                        head += chunk[: max(0, 1024 * 1024 - len(head))]
                    digest.update(chunk)
                    f.write(chunk)
            sha256 = digest.hexdigest()
            detected = detect_magic(head, response.headers.get("Content-Type", ""), original_filename)
            product_value, product_source = best_product_name(item)
            material_value, material_source = best_material_label(item)
            product = sanitize_name(product_value, "未关联产品")
            raw_material = sanitize_name(material_value or item.get("kind"), "文件")
            final_kind = detected.get("kind") or item.get("kind", "")
            material = "待确认PDF资料" if final_kind == "pdf" and raw_material in GENERIC_MATERIALS else raw_material
            confidence = "high" if material_source and raw_material not in GENERIC_MATERIALS else ""
            reason = f"explicit_context_{material_source}" if confidence else ""
            if final_kind == "pdf":
                pdf_material, pdf_confidence, pdf_reason = infer_pdf_material_from_file(Path(temp_name), material)
                if pdf_reason and pdf_material:
                    material = sanitize_name(pdf_material, material or "待确认PDF资料")
                    confidence = pdf_confidence
                    reason = pdf_reason
            if final_kind == "image":
                image_item = dict(item)
                image_item["size"] = size
                material, confidence, reason = infer_image_material(image_item, original_filename, raw_url, detected, raw_material)
                material = sanitize_name(material, "待确认图片资料")
                if material == "忽略小图标":
                    temp_path = Path(temp_name)
                    temp_path.unlink(missing_ok=True)
                    return {
                        "archived_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "product_name": product,
                        "material_type": material,
                        "kind": final_kind,
                        "filename": original_filename,
                        "size": size,
                        "sha256": sha256,
                        "relative_path": "",
                        "source_url": redact_url(str(item.get("url") or final_url)),
                        "source": item.get("source", ""),
                        "action": "skipped_small_image",
                        "original_filename": original_filename,
                        "detected_extension": detected.get("ext", ""),
                        "classification_confidence": confidence,
                        "classification_reason": reason,
                    }
            target_dir = config.root / product / material
            target_dir.mkdir(parents=True, exist_ok=True)
            filename = readable_filename(product, material, sha256, str(detected.get("ext") or Path(original_filename).suffix.lstrip(".") or "bin"))
            target = target_dir / filename
            existing = find_existing_by_hash(config.root, sha256)
            temp_path = Path(temp_name)
            if existing:
                temp_path.unlink(missing_ok=True)
                if should_move_existing(existing, target, product, material):
                    target = dedupe_path(target, sha256)
                    if target.exists() and target != existing:
                        existing.unlink(missing_ok=True)
                        action = "exists"
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(existing), target)
                        action = "moved"
                else:
                    target = existing
                    action = "exists"
            elif target.exists():
                temp_path.unlink(missing_ok=True)
                action = "exists"
            else:
                shutil.move(temp_name, target)
                action = "saved"
            relative = target.relative_to(config.root).as_posix()
            record = {
                "archived_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "product_name": product,
                "material_type": material,
                "kind": final_kind,
                "filename": target.name,
                "size": size,
                "sha256": sha256,
                "relative_path": relative,
                "source_url": redact_url(str(item.get("url") or final_url)),
                "source": item.get("source", ""),
                "action": action,
                "original_filename": original_filename,
                "detected_extension": detected.get("ext", ""),
                "classification_confidence": confidence,
                "classification_reason": reason,
            }
            append_indexes(config, record)
            return record
        except Exception:
            Path(temp_name).unlink(missing_ok=True)
            raise


def process_items(items: list[Any], config: ArchiveConfig) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    saved: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for item in items[:100]:
        if not isinstance(item, dict):
            continue
        try:
            if item_is_page(item):
                saved.extend(crawl_page_item(item, config))
            else:
                saved.append(download_one(item, config))
        except Exception as exc:  # keep processing the batch
            errors.append({
                "filename": sanitize_name(item.get("filename") or "", ""),
                "host": sanitize_name(item.get("host") or urllib.parse.urlparse(str(item.get("downloadUrl") or item.get("url") or "")).hostname or "", ""),
                "error": str(exc)[:500],
            })
    return saved, errors


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def append_job_event(config: ArchiveConfig, job: dict[str, Any]) -> None:
    config.root.mkdir(parents=True, exist_ok=True)
    event = {
        "job_id": job.get("job_id"),
        "status": job.get("status"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "accepted": job.get("accepted", 0),
        "saved": job.get("saved", 0),
        "error_count": len(job.get("errors") or []),
    }
    with INDEX_LOCK:
        with (config.root / JOB_LOG_NAME).open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


class ArchiveRuntime:
    def __init__(self, config: ArchiveConfig) -> None:
        self.config = config
        self.queue: queue.Queue[tuple[str, list[Any]]] = queue.Queue(maxsize=config.queue_size)
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.worker = threading.Thread(target=self._worker_loop, name="archive-worker", daemon=True)
        self.worker.start()

    def submit(self, items: list[Any]) -> dict[str, Any]:
        job_id = time.strftime("%Y%m%d%H%M%S", time.gmtime()) + "-" + uuid.uuid4().hex[:8]
        job = {
            "job_id": job_id,
            "status": "queued",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "accepted": min(len(items), 100),
            "saved": 0,
            "errors": [],
        }
        with self.lock:
            self.jobs[job_id] = job
        try:
            self.queue.put_nowait((job_id, items[:100]))
        except queue.Full:
            with self.lock:
                self.jobs.pop(job_id, None)
            raise
        append_job_event(self.config, job)
        return dict(job, queue_depth=self.queue.qsize())

    def snapshot(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
            return dict(job) if job else None

    def _update(self, job_id: str, **updates: Any) -> dict[str, Any]:
        with self.lock:
            job = self.jobs.get(job_id, {"job_id": job_id, "created_at": now_iso(), "accepted": 0, "errors": []})
            job.update(updates)
            job["updated_at"] = now_iso()
            self.jobs[job_id] = job
            snapshot = dict(job)
        append_job_event(self.config, snapshot)
        return snapshot

    def _worker_loop(self) -> None:
        while True:
            job_id, items = self.queue.get()
            try:
                self._update(job_id, status="running")
                saved, errors = process_items(items, self.config)
                self._update(
                    job_id,
                    status="completed" if not errors else "completed_with_errors",
                    saved=len(saved),
                    errors=errors,
                )
            except Exception as exc:
                self._update(job_id, status="failed", errors=[{"error": str(exc)[:500]}])
            finally:
                self.queue.task_done()


class ArchiveHandler(http.server.BaseHTTPRequestHandler):
    server_version = "SurgeFileArchive/1.1"
    config: ArchiveConfig
    runtime: ArchiveRuntime | None = None

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {self.address_string()} {format % args}")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # Mobile clients/proxies may disconnect after the server has finished
            # processing. Do not turn that into noisy journalctl tracebacks.
            return

    def is_authorized(self) -> bool:
        if not self.config.token:
            return True
        return self.headers.get("Authorization", "") == f"Bearer {self.config.token}"

    def require_auth(self) -> bool:
        if self.is_authorized():
            return True
        self.send_json(401, {"ok": False, "error": "unauthorized"})
        return False

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in {"/", "/health"}:
            queue_depth = self.runtime.queue.qsize() if self.runtime else 0
            self.send_json(200, {
                "ok": True,
                "service": "surge-file-archive",
                "version": "1.1",
                "async": self.config.async_mode,
                "queue_depth": queue_depth,
            })
            return
        if parsed.path.startswith("/jobs/"):
            if not self.require_auth():
                return
            job_id = parsed.path.rsplit("/", 1)[-1]
            job = self.runtime.snapshot(job_id) if self.runtime else None
            if not job:
                self.send_json(404, {"ok": False, "error": "job not found"})
                return
            self.send_json(200, {"ok": True, "job": job})
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in {"/archive", "/"}:
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        if not self.require_auth():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 2 * 1024 * 1024:
            self.send_json(413, {"ok": False, "error": "invalid payload size"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            self.send_json(400, {"ok": False, "error": f"invalid JSON: {exc}"})
            return
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            self.send_json(400, {"ok": False, "error": "payload.items must be a list"})
            return
        query = urllib.parse.parse_qs(parsed.query)
        sync_requested = (query.get("sync", [""])[0].lower() in {"1", "true", "yes", "on"}) or bool(payload.get("sync"))
        if self.config.async_mode and not sync_requested:
            if not self.runtime:
                self.send_json(503, {"ok": False, "error": "async runtime unavailable"})
                return
            try:
                job = self.runtime.submit(items)
            except queue.Full:
                self.send_json(503, {"ok": False, "error": "archive queue full"})
                return
            self.send_json(202, {
                "ok": True,
                "accepted": job.get("accepted", 0),
                "job_id": job["job_id"],
                "status": job["status"],
                "queue_depth": job.get("queue_depth", 0),
            })
            return
        saved, errors = process_items(items, self.config)
        self.send_json(200 if not errors else 207, {"ok": not errors, "saved": len(saved), "errors": errors, "items": saved})


def run_server(config: ArchiveConfig, host: str, port: int) -> None:
    runtime = ArchiveRuntime(config) if config.async_mode else None
    handler_cls = type("ConfiguredArchiveHandler", (ArchiveHandler,), {"config": config, "runtime": runtime})
    config.root.mkdir(parents=True, exist_ok=True)
    with http.server.ThreadingHTTPServer((host, port), handler_cls) as httpd:
        print(f"Surge file archive server listening on http://{host}:{port}/archive")
        print(f"Archive root: {config.root}")
        print(f"Async archive mode: {'on' if config.async_mode else 'off'}")
        if config.allowed_suffixes:
            print("Allowed host suffixes: " + ", ".join(config.allowed_suffixes))
        if not config.token:
            print("WARNING: FILE_ARCHIVE_TOKEN is empty. Keep the server private or behind auth.")
        httpd.serve_forever()


def run_self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        source_dir = tmp_path / "source"
        source_dir.mkdir()
        sample = source_dir / "友邦测试条款.pdf"
        sample.write_bytes(b"%PDF-1.4\n% surge archive self test\n")
        brochure = source_dir / "宣传彩页.pdf"
        brochure.write_bytes(b"%PDF-1.4\n% brochure\n")
        contract = source_dir / "产品合同.pdf"
        contract.write_bytes(b"%PDF-1.4\n% contract\n")
        async_sample = source_dir / "异步测试条款.pdf"
        async_sample.write_bytes(b"%PDF-1.4\n% async archive self test\n")
        nested_page = source_dir / "contract.html"
        nested_page.write_text('<html><body><a href="%E4%BA%A7%E5%93%81%E5%90%88%E5%90%8C.pdf">下载保险合同</a></body></html>', encoding="utf-8")
        product_page = source_dir / "product.html"
        product_page.write_text('<html><head><title>友邦测试产品</title></head><body><a href="%E5%AE%A3%E4%BC%A0%E5%BD%A9%E9%A1%B5.pdf">宣传彩页</a><a href="contract.html">产品合同</a></body></html>', encoding="utf-8")

        class SourceHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                pass

        source_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **kw: SourceHandler(*a, directory=str(source_dir), **kw))
        source_port = source_server.server_address[1]
        source_thread = threading.Thread(target=source_server.serve_forever, daemon=True)
        source_thread.start()

        archive_root = tmp_path / "archive"
        config = ArchiveConfig(root=archive_root, token="test-token", allowed_suffixes=("127.0.0.1",), allow_private=True, max_bytes=1024 * 1024, timeout=5, async_mode=True)
        runtime = ArchiveRuntime(config)
        handler_cls = type("SelfTestArchiveHandler", (ArchiveHandler,), {"config": config, "runtime": runtime})
        archive_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        archive_port = archive_server.server_address[1]
        archive_thread = threading.Thread(target=archive_server.serve_forever, daemon=True)
        archive_thread.start()

        payload = {
            "schema": "surge-file-capture.archive.v1",
            "items": [
                {
                    "kind": "pdf",
                    "filename": "random-static-key.pdf",
                    "url": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(sample.name)}",
                    "downloadUrl": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(sample.name)}",
                    "source": "self-test-unknown-first",
                },
                {
                    "productName": "友邦测试产品",
                    "materialType": "产品条款",
                    "kind": "pdf",
                    "filename": "友邦测试条款.pdf",
                    "url": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(sample.name)}",
                    "downloadUrl": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(sample.name)}",
                    "source": "self-test",
                },
                {
                    "productName": "友邦测试产品",
                    "materialType": "产品资料页",
                    "kind": "page",
                    "filename": "产品资料页",
                    "url": f"http://127.0.0.1:{source_port}/product.html",
                    "downloadUrl": f"http://127.0.0.1:{source_port}/product.html",
                    "source": "self-test-page",
                },
            ],
        }
        req = urllib.request.Request(
            f"http://127.0.0.1:{archive_port}/archive?sync=1",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer test-token"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
        async_payload = {
            "schema": "surge-file-capture.archive.v1",
            "items": [
                {
                    "productName": "友邦异步测试产品",
                    "kind": "pdf",
                    "filename": "异步测试条款.pdf",
                    "url": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(async_sample.name)}?token=secret-token",
                    "downloadUrl": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(async_sample.name)}",
                    "source": "self-test-async",
                    "sopContext": {"clauseName": "产品条款", "policyListName": "友邦异步测试产品"},
                },
            ],
        }
        async_req = urllib.request.Request(
            f"http://127.0.0.1:{archive_port}/archive",
            data=json.dumps(async_payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer test-token"},
            method="POST",
        )
        with urllib.request.urlopen(async_req, timeout=5) as response:
            assert response.status == 202, response.status
            async_body = json.loads(response.read().decode("utf-8"))
        job_id = async_body["job_id"]
        job_body: dict[str, Any] = {}
        for _ in range(30):
            status_req = urllib.request.Request(
                f"http://127.0.0.1:{archive_port}/jobs/{job_id}",
                headers={"Authorization": "Bearer test-token"},
            )
            with urllib.request.urlopen(status_req, timeout=5) as response:
                job_body = json.loads(response.read().decode("utf-8"))
            if job_body["job"]["status"] in {"completed", "completed_with_errors", "failed"}:
                break
            time.sleep(0.1)
        source_server.shutdown()
        archive_server.shutdown()
        sample_hash = hashlib.sha256(sample.read_bytes()).hexdigest()[:8]
        brochure_hash = hashlib.sha256(brochure.read_bytes()).hexdigest()[:8]
        contract_hash = hashlib.sha256(contract.read_bytes()).hexdigest()[:8]
        async_hash = hashlib.sha256(async_sample.read_bytes()).hexdigest()[:8]
        expected = archive_root / "友邦测试产品" / "产品条款" / f"友邦测试产品_产品条款_{sample_hash}.pdf"
        expected_brochure = archive_root / "友邦测试产品" / "宣传彩页" / f"友邦测试产品_宣传彩页_{brochure_hash}.pdf"
        expected_contract = archive_root / "友邦测试产品" / "产品合同" / f"友邦测试产品_产品合同_{contract_hash}.pdf"
        expected_async = archive_root / "友邦异步测试产品" / "产品条款" / f"友邦异步测试产品_产品条款_{async_hash}.pdf"
        unknown_sample = archive_root / "未关联产品" / "pdf" / f"未关联产品_pdf_{sample_hash}.pdf"
        assert expected.exists(), expected
        assert not unknown_sample.exists(), unknown_sample
        assert expected_brochure.exists(), expected_brochure
        assert expected_contract.exists(), expected_contract
        assert expected_async.exists(), expected_async
        assert job_body["job"]["status"] == "completed", job_body
        assert body["saved"] == 4, body
        assert (archive_root / "index.csv").exists()
        index_text = (archive_root / "index.jsonl").read_text(encoding="utf-8")
        assert "secret-token" not in index_text
        assert "REDACTED" in index_text
        assert (archive_root / JOB_LOG_NAME).exists()
        print("self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser(description="Archive files captured by Surge File Capture modules.")
    parser.add_argument("--host", default=os.getenv("FILE_ARCHIVE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=env_int("FILE_ARCHIVE_PORT", 8765))
    parser.add_argument("--root", default=None, help="Archive root directory. Env: FILE_ARCHIVE_ROOT")
    parser.add_argument("--token", default=None, help="Bearer token. Env: FILE_ARCHIVE_TOKEN")
    parser.add_argument("--allowed-hosts", default=None, help="Comma-separated allowed host suffixes. Env: FILE_ARCHIVE_ALLOWED_HOST_SUFFIXES")
    parser.add_argument("--allow-private", action="store_true", help="Allow private/loopback download URLs. Default blocks them to prevent SSRF.")
    parser.add_argument("--max-bytes", type=int, default=0, help="Per-file max bytes. Env: FILE_ARCHIVE_MAX_BYTES")
    parser.add_argument("--timeout", type=int, default=0, help="Download timeout seconds. Env: FILE_ARCHIVE_TIMEOUT")
    parser.add_argument("--async", dest="async_mode", action="store_true", help="Return 202 quickly and process archive jobs in the background. Env: FILE_ARCHIVE_ASYNC=1")
    parser.add_argument("--sync", dest="sync_mode", action="store_true", help="Process /archive synchronously for compatibility/testing. Env: FILE_ARCHIVE_ASYNC=0")
    parser.add_argument("--queue-size", type=int, default=0, help="Max queued async archive jobs. Env: FILE_ARCHIVE_QUEUE_SIZE")
    parser.add_argument("--self-test", action="store_true", help="Run local integration self-test and exit.")
    args = parser.parse_args()
    if args.self_test:
        run_self_test()
        return
    run_server(load_config(args), args.host, args.port)


if __name__ == "__main__":
    main()
