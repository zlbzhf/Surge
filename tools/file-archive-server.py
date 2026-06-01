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
import http.server
import ipaddress
import json
import mimetypes
import os
import posixpath
import re
import shutil
import socket
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
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
]
SAFE_NAME_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff._()（）\-+& ，,、【】\[\]《》]+")
SECRET_QUERY_KEYS = re.compile(
    r"(^|_|-|\.)(token|access_token|auth|authorization|session|sid|password|passwd|pwd|secret|key|api_key|apikey|signature|sign|ticket|code|openid|unionid)(_|-|\.|$)",
    re.I,
)


@dataclass
class ArchiveConfig:
    root: Path
    token: str
    allowed_suffixes: tuple[str, ...]
    allow_private: bool
    max_bytes: int
    timeout: int


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
    return ArchiveConfig(
        root=root,
        token=token,
        allowed_suffixes=suffixes,
        allow_private=bool(args.allow_private) or env_bool("FILE_ARCHIVE_ALLOW_PRIVATE", False),
        max_bytes=args.max_bytes or env_int("FILE_ARCHIVE_MAX_BYTES", DEFAULT_MAX_BYTES),
        timeout=args.timeout or env_int("FILE_ARCHIVE_TIMEOUT", DEFAULT_TIMEOUT),
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


def append_indexes(config: ArchiveConfig, record: dict[str, Any]) -> None:
    config.root.mkdir(parents=True, exist_ok=True)
    csv_path = config.root / "index.csv"
    jsonl_path = config.root / "index.jsonl"
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
    with opener.open(req, timeout=config.timeout) as response:
        final_url = response.geturl()
        validate_download_url(final_url, config)
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > config.max_bytes:
            raise ValueError(f"file too large: {content_length} > {config.max_bytes}")
        final_parsed = urllib.parse.urlparse(final_url)
        product = sanitize_name(item.get("productName") or item.get("product_name"), "未关联产品")
        material = sanitize_name(item.get("materialType") or item.get("material_type") or item.get("kind"), "文件")
        target_dir = config.root / product / material
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = filename_from_item(item, response, final_parsed or parsed)
        temp_fd, temp_name = tempfile.mkstemp(prefix=".download-", dir=str(target_dir))
        size = 0
        digest = hashlib.sha256()
        try:
            with os.fdopen(temp_fd, "wb") as f:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > config.max_bytes:
                        raise ValueError(f"file too large while streaming: {size} > {config.max_bytes}")
                    digest.update(chunk)
                    f.write(chunk)
            sha256 = digest.hexdigest()
            target = dedupe_path(target_dir / filename, sha256)
            if target.exists():
                Path(temp_name).unlink(missing_ok=True)
                action = "exists"
            else:
                shutil.move(temp_name, target)
                action = "saved"
            relative = target.relative_to(config.root).as_posix()
            record = {
                "archived_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "product_name": product,
                "material_type": material,
                "kind": item.get("kind", ""),
                "filename": target.name,
                "size": size,
                "sha256": sha256,
                "relative_path": relative,
                "source_url": str(item.get("url") or redact_url(final_url)),
                "source": item.get("source", ""),
                "action": action,
            }
            append_indexes(config, record)
            return record
        except Exception:
            Path(temp_name).unlink(missing_ok=True)
            raise


class ArchiveHandler(http.server.BaseHTTPRequestHandler):
    server_version = "SurgeFileArchive/1.0"
    config: ArchiveConfig

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {self.address_string()} {format % args}")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/", "/health"}:
            self.send_json(200, {"ok": True, "service": "surge-file-archive"})
        else:
            self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if urllib.parse.urlparse(self.path).path not in {"/archive", "/"}:
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        if self.config.token:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {self.config.token}":
                self.send_json(401, {"ok": False, "error": "unauthorized"})
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
        saved: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for item in items[:100]:
            if not isinstance(item, dict):
                continue
            try:
                saved.append(download_one(item, self.config))
            except Exception as exc:  # keep processing the batch
                errors.append({
                    "filename": str(item.get("filename") or ""),
                    "host": str(item.get("host") or ""),
                    "error": str(exc),
                })
        self.send_json(200 if not errors else 207, {"ok": not errors, "saved": len(saved), "errors": errors, "items": saved})


def run_server(config: ArchiveConfig, host: str, port: int) -> None:
    handler_cls = type("ConfiguredArchiveHandler", (ArchiveHandler,), {"config": config})
    config.root.mkdir(parents=True, exist_ok=True)
    with http.server.ThreadingHTTPServer((host, port), handler_cls) as httpd:
        print(f"Surge file archive server listening on http://{host}:{port}/archive")
        print(f"Archive root: {config.root}")
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

        class SourceHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                pass

        source_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **kw: SourceHandler(*a, directory=str(source_dir), **kw))
        source_port = source_server.server_address[1]
        source_thread = threading.Thread(target=source_server.serve_forever, daemon=True)
        source_thread.start()

        archive_root = tmp_path / "archive"
        config = ArchiveConfig(root=archive_root, token="test-token", allowed_suffixes=("127.0.0.1",), allow_private=True, max_bytes=1024 * 1024, timeout=5)
        handler_cls = type("SelfTestArchiveHandler", (ArchiveHandler,), {"config": config})
        archive_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        archive_port = archive_server.server_address[1]
        archive_thread = threading.Thread(target=archive_server.serve_forever, daemon=True)
        archive_thread.start()

        payload = {
            "schema": "surge-file-capture.archive.v1",
            "items": [{
                "productName": "友邦测试产品",
                "materialType": "产品条款",
                "kind": "pdf",
                "filename": "友邦测试条款.pdf",
                "url": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(sample.name)}",
                "downloadUrl": f"http://127.0.0.1:{source_port}/{urllib.parse.quote(sample.name)}",
                "source": "self-test",
            }],
        }
        req = urllib.request.Request(
            f"http://127.0.0.1:{archive_port}/archive",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer test-token"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
        source_server.shutdown()
        archive_server.shutdown()
        expected = archive_root / "友邦测试产品" / "产品条款" / "友邦测试条款.pdf"
        assert expected.exists(), expected
        assert body["saved"] == 1, body
        assert (archive_root / "index.csv").exists()
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
    parser.add_argument("--self-test", action="store_true", help="Run local integration self-test and exit.")
    args = parser.parse_args()
    if args.self_test:
        run_self_test()
        return
    run_server(load_config(args), args.host, args.port)


if __name__ == "__main__":
    main()
