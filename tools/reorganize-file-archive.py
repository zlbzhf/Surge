#!/usr/bin/env python3
"""Reorganize an existing Surge File Archive tree.

Default mode is dry-run. Use --apply to move/delete files and rebuild indexes.
It preserves one file per SHA256, prefers records with product/material context,
and renames files to <产品名>_<资料类型>_<短hash>.<扩展名>.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SERVER_PATH = HERE / "file-archive-server.py"
spec = importlib.util.spec_from_file_location("file_archive_server", SERVER_PATH)
assert spec and spec.loader
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)  # type: ignore[union-attr]

GENERIC_PRODUCTS = {"", "未关联产品"}
GENERIC_MATERIALS = {"", "文件", "image", "pdf", "图片", "资料", "待确认"}
INDEX_NAMES = {"index.csv", "index.jsonl"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_records(root: Path) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    jsonl = root / "index.jsonl"
    if not jsonl.exists():
        return out
    with jsonl.open(encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            sha = str(rec.get("sha256") or "")
            if sha:
                out.setdefault(sha, []).append(rec)
    return out


def iter_archive_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.name in INDEX_NAMES or path.name.startswith("."):
            continue
        if any(part == "_pending" for part in path.relative_to(root).parts):
            continue
        yield path


def record_score(rec: dict[str, Any]) -> tuple[int, int, int, int]:
    product = str(rec.get("product_name") or rec.get("productName") or "")
    material = str(rec.get("material_type") or rec.get("materialType") or "")
    source = str(rec.get("source") or "")
    return (
        1 if product not in GENERIC_PRODUCTS else 0,
        1 if material not in GENERIC_MATERIALS else 0,
        1 if source in {"aia-api", "embedded", "product-page", "response"} else 0,
        len(product) + len(material),
    )


def best_record(records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        return {}
    return sorted(records, key=record_score, reverse=True)[0]


def detect(path: Path) -> dict[str, Any]:
    head = path.read_bytes()[:1024 * 1024]
    return server.detect_magic(head, "", path.name)


def planned_record(root: Path, sha: str, paths: list[Path], records: list[dict[str, Any]]) -> dict[str, Any]:
    rec = best_record(records).copy()
    source_path = paths[0]
    detected = detect(source_path)
    product = server.sanitize_name(rec.get("product_name") or rec.get("productName"), "未关联产品")
    raw_material = server.sanitize_name(rec.get("material_type") or rec.get("materialType") or rec.get("kind"), "文件")
    final_kind = detected.get("kind") or rec.get("kind") or raw_material
    confidence = str(rec.get("classification_confidence") or "")
    reason = str(rec.get("classification_reason") or "")
    material = "待确认PDF资料" if final_kind == "pdf" and raw_material in GENERIC_MATERIALS else raw_material
    if final_kind == "image":
        item = {
            "materialType": raw_material,
            "filename": rec.get("filename") or source_path.name,
            "url": rec.get("source_url") or "",
            "sourceUrl": rec.get("source_url") or "",
            "pageTitle": rec.get("page_title") or "",
            "size": source_path.stat().st_size,
        }
        material, confidence, reason = server.infer_image_material(item, source_path.name, str(rec.get("source_url") or ""), detected, raw_material)
        material = server.sanitize_name(material, "待确认图片资料")
    ext = str(detected.get("ext") or source_path.suffix.lstrip(".") or "bin")
    filename = server.readable_filename(product, material, sha, ext)
    relative_path = (Path(product) / material / filename).as_posix()
    return {
        "archived_at": rec.get("archived_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "product_name": product,
        "material_type": material,
        "kind": final_kind,
        "filename": filename,
        "size": source_path.stat().st_size,
        "sha256": sha,
        "relative_path": relative_path,
        "source_url": rec.get("source_url") or "",
        "source": rec.get("source") or "reorganize",
        "action": "reorganized",
        "original_filename": rec.get("original_filename") or source_path.name,
        "detected_extension": ext,
        "classification_confidence": confidence,
        "classification_reason": reason,
        "from_paths": [p.relative_to(root).as_posix() for p in paths],
    }


def build_plan(root: Path) -> list[dict[str, Any]]:
    records = load_records(root)
    by_hash: dict[str, list[Path]] = {}
    for path in iter_archive_files(root):
        sha = sha256_file(path)
        by_hash.setdefault(sha, []).append(path)
    plan = []
    for sha, paths in sorted(by_hash.items(), key=lambda kv: kv[0]):
        paths = sorted(paths, key=lambda p: ("未关联产品" in p.parts, len(str(p))))
        plan.append(planned_record(root, sha, paths, records.get(sha, [])))
    return plan


def apply_plan(root: Path, plan: list[dict[str, Any]]) -> None:
    backup = root / f"_backup_indexes_{time.strftime('%Y%m%d-%H%M%S')}"
    backup.mkdir(exist_ok=True)
    for name in INDEX_NAMES:
        src = root / name
        if src.exists():
            shutil.copy2(src, backup / name)
    for rec in plan:
        src_paths = [root / p for p in rec.pop("from_paths")]
        existing_src = next((p for p in src_paths if p.exists()), None)
        if not existing_src:
            continue
        target = root / rec["relative_path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.resolve() != existing_src.resolve():
                existing_src.unlink(missing_ok=True)
        else:
            shutil.move(str(existing_src), target)
        for duplicate in src_paths:
            if duplicate.exists() and duplicate.resolve() != target.resolve():
                duplicate.unlink(missing_ok=True)
    # Remove empty folders except backup.
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        p = Path(dirpath)
        if p == root or p == backup:
            continue
        if p.name.startswith("_backup_indexes_"):
            continue
        try:
            if not any(p.iterdir()):
                p.rmdir()
        except OSError:
            pass
    csv_path = root / "index.csv"
    jsonl_path = root / "index.jsonl"
    fields = server.INDEX_FIELDS
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for rec in plan:
            writer.writerow(rec)
    with jsonl_path.open("w", encoding="utf-8") as f:
        for rec in plan:
            f.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")


def summarize(plan: list[dict[str, Any]]) -> dict[str, Any]:
    products = sorted({r["product_name"] for r in plan})
    materials: dict[str, int] = {}
    actions = {"unique_files": len(plan), "products": len(products)}
    for r in plan:
        materials[r["material_type"]] = materials.get(r["material_type"], 0) + 1
    return {"actions": actions, "materials": materials, "products": products[:20]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="/data/surge-file-archive")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--plan-out", default="")
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    plan = build_plan(root)
    if args.plan_out:
        Path(args.plan_out).write_text(json.dumps({"summary": summarize(plan), "plan": plan}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summarize(plan), ensure_ascii=False, indent=2))
    if args.apply:
        apply_plan(root, plan)
        print("applied")
    else:
        print("dry-run only; pass --apply to modify files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
