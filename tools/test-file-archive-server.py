#!/usr/bin/env python3
"""Behavior tests for the Surge file archive receiver."""
from __future__ import annotations

import hashlib
import http.server
import importlib.util
import json
import shutil
import socketserver
import sys
import tempfile
import threading
import urllib.parse
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SERVER_PATH = HERE / "file-archive-server.py"
spec = importlib.util.spec_from_file_location("file_archive_server", SERVER_PATH)
assert spec and spec.loader
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)  # type: ignore[union-attr]


def make_pdf(text: str) -> bytes:
    """Build a tiny extractable PDF containing ASCII text."""
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]
    stream = f"BT /F1 18 Tf 72 720 Td ({escaped}) Tj ET".encode("ascii")
    objects.append(b"5 0 obj\n<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream\nendobj\n")
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii"))
    return bytes(pdf)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        pass


class ArchiveServerBehaviorTests(unittest.TestCase):
    def test_small_square_image_is_ignored_even_when_context_says_product_clause(self) -> None:
        material, confidence, reason = server.infer_image_material(
            {"materialType": "产品条款", "filename": "avatar.jpg", "size": 120 * 1024},
            "avatar.jpg",
            "https://nav.aia.com.cn/static/avatar.jpg",
            {"kind": "image", "ext": "jpg", "width": 400, "height": 400},
            "产品条款",
        )

        self.assertEqual(material, "忽略小图标")
        self.assertEqual(confidence, "low")
        self.assertIn("small", reason)

    def test_tall_image_is_classified_as_one_picture_not_product_clause(self) -> None:
        material, confidence, reason = server.infer_image_material(
            {"materialType": "产品条款", "filename": "long-image.jpg", "size": 9_500_000},
            "long-image.jpg",
            "https://nav.aia.com.cn/static/showimage.jpg",
            {"kind": "image", "ext": "jpg", "width": 2588, "height": 12985},
            "产品条款",
        )

        self.assertEqual(material, "一图")
        self.assertEqual(confidence, "medium")
        self.assertIn("tall", reason)

    def test_large_landscape_image_is_classified_as_brochure_not_product_clause(self) -> None:
        material, confidence, reason = server.infer_image_material(
            {"materialType": "产品条款", "filename": "page.jpg", "size": 550_000},
            "page.jpg",
            "https://nav.aia.com.cn/static/page.jpg",
            {"kind": "image", "ext": "jpg", "width": 3091, "height": 2316},
            "产品条款",
        )

        self.assertEqual(material, "宣传彩页")
        self.assertEqual(confidence, "medium")
        self.assertIn("large_landscape", reason)

    def test_pdf_clause_text_wins_over_cash_value_mentions(self) -> None:
        material, confidence, reason = server.infer_pdf_material_from_text(
            "请扫描以查询验证条款 友邦测试保险 在本条款中 第七条 保险责任 保证利益的现金价值",
            "产品条款",
        )

        self.assertEqual(material, "产品条款")
        self.assertEqual(confidence, "high")
        self.assertEqual(reason, "pdf_text_product_clause")

    def test_pdf_text_overrides_product_clause_context_after_download(self) -> None:
        if not shutil.which("pdftotext"):
            self.skipTest("pdftotext is required for PDF title refinement")
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source_dir = tmp_path / "source"
            source_dir.mkdir()
            pdf_path = source_dir / "opaque-static.pdf"
            pdf_path.write_bytes(make_pdf("OPERATION RULES OF AIA TEST PRODUCT"))

            source_server = socketserver.TCPServer(("127.0.0.1", 0), lambda *a, **kw: QuietHandler(*a, directory=str(source_dir), **kw))
            port = source_server.server_address[1]
            thread = threading.Thread(target=source_server.serve_forever, daemon=True)
            thread.start()
            try:
                archive_root = tmp_path / "archive"
                config = server.ArchiveConfig(
                    root=archive_root,
                    token="",
                    allowed_suffixes=("127.0.0.1",),
                    allow_private=True,
                    max_bytes=1024 * 1024,
                    timeout=5,
                )
                url = f"http://127.0.0.1:{port}/{urllib.parse.quote(pdf_path.name)}"
                record = server.download_one(
                    {
                        "productName": "友邦测试产品",
                        "materialType": "产品条款",
                        "kind": "pdf",
                        "filename": "opaque-static.pdf",
                        "url": url,
                        "downloadUrl": url,
                        "source": "unit-test",
                    },
                    config,
                )
            finally:
                source_server.shutdown()
                source_server.server_close()

            sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()[:8]
            expected = archive_root / "友邦测试产品" / "营运规则" / f"友邦测试产品_营运规则_{sha}.pdf"
            self.assertEqual(record["material_type"], "营运规则")
            self.assertEqual(record["classification_reason"], "pdf_text_operation_rules")
            self.assertTrue(expected.exists(), expected)

    def test_send_json_suppresses_client_broken_pipe(self) -> None:
        class BrokenWriter:
            def write(self, data: bytes) -> int:
                raise BrokenPipeError("client disconnected")

        class Dummy:
            wfile = BrokenWriter()
            def send_response(self, status: int) -> None: pass
            def send_header(self, key: str, value: str) -> None: pass
            def end_headers(self) -> None: pass

        server.ArchiveHandler.send_json(Dummy(), 200, {"ok": True})


if __name__ == "__main__":
    unittest.main(verbosity=2)
