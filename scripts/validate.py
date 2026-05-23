#!/usr/bin/env python3
"""Validate generated Surge profiles in this repository.

Checks are intentionally practical for a public daily-driver config:
- active remote rule URLs resolve, while same-repo raw URLs map to local files;
- rule policy targets exist as proxy groups or Surge built-ins;
- rule ordering preserves domainset -> non_ip -> ip -> FINAL;
- generated blackmatrix7 split rules are referenced instead of mixed upstream lists;
- high-risk public-profile settings and obvious secrets are not active.
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[0]
sys.path.insert(0, str(SCRIPT_DIR))

from generate import load_sources  # noqa: E402

CONFIG_FILES = [ROOT / "Surge.conf"]
BUILTIN_POLICIES = {"DIRECT", "REJECT", "REJECT-DROP", "REJECT-NO-DROP"}
BLACKMATRIX7_MIXED_PREFIX = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/"


@dataclass
class Issue:
    path: Path
    line: int
    message: str
    level: str = "error"

    def format(self) -> str:
        rel = self.path.relative_to(ROOT) if self.path.is_absolute() and self.path.is_relative_to(ROOT) else self.path
        return f"::{self.level} file={rel},line={self.line}::{self.message}"


def section(text: str, name: str) -> tuple[int, list[str]]:
    lines = text.splitlines()
    start = None
    for idx, line in enumerate(lines):
        if line.strip() == f"[{name}]":
            start = idx + 1
            break
    if start is None:
        return 0, []
    end = len(lines)
    for idx in range(start, len(lines)):
        if lines[idx].strip().startswith("[") and lines[idx].strip().endswith("]"):
            end = idx
            break
    return start + 1, lines[start:end]


def active(line: str) -> bool:
    stripped = line.strip()
    return bool(stripped) and not stripped.startswith("#")


def parse_groups(text: str) -> set[str]:
    _, lines = section(text, "Proxy Group")
    groups: set[str] = set()
    for line in lines:
        if not active(line) or "=" not in line:
            continue
        groups.add(line.split("=", 1)[0].strip())
    return groups


def parse_rules(path: Path) -> list[tuple[int, str, list[str]]]:
    text = path.read_text(encoding="utf-8")
    start_line, lines = section(text, "Rule")
    parsed = []
    for offset, line in enumerate(lines):
        if not active(line):
            continue
        stripped = line.strip()
        parts = [p.strip() for p in stripped.split(",")]
        parsed.append((start_line + offset, stripped, parts))
    return parsed


def rule_url(parts: list[str]) -> str | None:
    if len(parts) < 2:
        return None
    if parts[0] in {"RULE-SET", "DOMAIN-SET"} and parts[1].startswith("http"):
        return parts[1]
    return None


def rule_policy(parts: list[str]) -> str | None:
    if not parts:
        return None
    if parts[0] == "FINAL" and len(parts) >= 2:
        return parts[1]
    if parts[0] in {"RULE-SET", "DOMAIN-SET"} and len(parts) >= 3:
        return parts[2]
    return None


def classify_rule(parts: list[str]) -> int | None:
    """Return ordering rank: domainset=1, non_ip=2, ip=3, final=4."""
    if not parts:
        return None
    kind = parts[0]
    if kind == "FINAL":
        return 4
    if kind == "DOMAIN-SET":
        return 1
    if kind != "RULE-SET" or len(parts) < 2:
        return None
    source = parts[1]
    if source == "LAN":
        return 3
    if "/List/domainset/" in source:
        return 1
    if "/List/non_ip/" in source or source.endswith(".non_ip.list"):
        return 2
    if "/List/ip/" in source or source.endswith(".ip.list"):
        return 3
    return 2


def local_path_for_url(url: str) -> Path | None:
    sources = load_sources()
    prefix = sources.local_raw_base.rstrip("/") + "/"
    if url.startswith(prefix):
        rel = url[len(prefix) :]
        return ROOT / rel
    return None


def check_urls(path: Path, rules: list[tuple[int, str, list[str]]], skip_network: bool) -> list[Issue]:
    issues: list[Issue] = []
    seen: set[str] = set()
    for line_no, _line, parts in rules:
        url = rule_url(parts)
        if not url or url in seen:
            continue
        seen.add(url)
        local = local_path_for_url(url)
        if local is not None:
            if not local.exists():
                issues.append(Issue(path, line_no, f"same-repo rule URL maps to missing file: {local.relative_to(ROOT)}"))
            elif local.stat().st_size == 0:
                issues.append(Issue(path, line_no, f"same-repo rule file is empty: {local.relative_to(ROOT)}"))
            continue
        if skip_network:
            continue
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "zlbzhf/Surge validator", "Range": "bytes=0-0"},
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                if resp.status >= 400:
                    issues.append(Issue(path, line_no, f"URL returned HTTP {resp.status}: {url}"))
                else:
                    resp.read(1)
        except Exception as exc:  # noqa: BLE001
            issues.append(Issue(path, line_no, f"URL check failed: {url} ({type(exc).__name__}: {str(exc)[:120]})"))
    return issues


def check_policies(path: Path, text: str, rules: list[tuple[int, str, list[str]]]) -> list[Issue]:
    groups = parse_groups(text)
    valid = groups | BUILTIN_POLICIES
    issues: list[Issue] = []
    for line_no, _line, parts in rules:
        policy = rule_policy(parts)
        if policy and policy not in valid:
            issues.append(Issue(path, line_no, f"rule targets missing policy group: {policy}"))
    return issues


def check_order(path: Path, rules: list[tuple[int, str, list[str]]]) -> list[Issue]:
    issues: list[Issue] = []
    max_rank = 0
    for line_no, line, parts in rules:
        rank = classify_rule(parts)
        if rank is None:
            continue
        if rank < max_rank:
            issues.append(Issue(path, line_no, f"rule order regression after later-stage rules: {line}"))
        max_rank = max(max_rank, rank)
    if rules and rules[-1][2][0] != "FINAL":
        issues.append(Issue(path, rules[-1][0], "last active rule should be FINAL"))
    return issues


def check_blackmatrix7_split(path: Path, text: str, rules: list[tuple[int, str, list[str]]]) -> list[Issue]:
    sources = load_sources()
    issues: list[Issue] = []
    active_text = "\n".join(line for _, line, _ in rules)

    for line_no, _line, parts in rules:
        url = rule_url(parts)
        if url and url.startswith(BLACKMATRIX7_MIXED_PREFIX):
            issues.append(Issue(path, line_no, "active config should not reference mixed upstream blackmatrix7 list; use generated split local list"))

    for app in sources.apps:
        non_ip_url = f"{sources.local_raw_base}/rules/blackmatrix7/{app.name}.non_ip.list"
        if non_ip_url not in active_text:
            issues.append(Issue(path, 1, f"missing generated non_ip rule reference for {app.name}"))
        ip_file = ROOT / "rules" / "blackmatrix7" / f"{app.name}.ip.list"
        ip_url = f"{sources.local_raw_base}/rules/blackmatrix7/{app.name}.ip.list"
        if ip_file.exists() and ip_url not in active_text:
            issues.append(Issue(path, 1, f"missing generated ip rule reference for {app.name}"))
    return issues


def check_security(path: Path, text: str) -> list[Issue]:
    issues: list[Issue] = []
    secret_patterns = [
        (re.compile(r"\bpolicy-path\s*=\s*https?://", re.I), "active subscription URL must not be committed"),
        (re.compile(r"^(server|password|psk|username)\s*=\s*[^,\s#]+", re.I), "possible proxy credential in public config"),
        (re.compile(r"\bca-p12\s*=", re.I), "MITM CA material must not be committed"),
        (re.compile(r"\bca-passphrase\s*=", re.I), "MITM CA passphrase must not be committed"),
    ]
    risky_patterns = [
        (re.compile(r"^allow-wifi-access\s*=\s*true\b", re.I), "allow-wifi-access should stay false in public daily profile"),
        (re.compile(r"^http-api-web-dashboard\s*=\s*true\b", re.I), "HTTP API dashboard should not be enabled by default"),
        (re.compile(r"^(http|socks5)-listen\s*=\s*0\.0\.0\.0", re.I), "listener bound to 0.0.0.0 is unsafe for public default"),
        (re.compile(r"^external-controller-access\s*=", re.I), "external controller access should not be active in public default"),
        (re.compile(r"^udp-policy-not-supported-behaviour\s*=\s*direct\b", re.I), "UDP unsupported fallback DIRECT may leak traffic; use reject"),
        (re.compile(r"^skip-server-cert-verify\s*=\s*true\b", re.I), "skip-server-cert-verify=true is unsafe as a default"),
    ]
    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not active(line):
            continue
        for pattern, message in risky_patterns:
            if pattern.search(line):
                issues.append(Issue(path, line_no, message))
        for pattern, message in secret_patterns:
            if pattern.search(line) and "你的订阅地址" not in line:
                issues.append(Issue(path, line_no, message))
    return issues


def validate(skip_network: bool = False) -> int:
    issues: list[Issue] = []
    for path in CONFIG_FILES:
        text = path.read_text(encoding="utf-8")
        rules = parse_rules(path)
        issues.extend(check_policies(path, text, rules))
        issues.extend(check_order(path, rules))
        issues.extend(check_blackmatrix7_split(path, text, rules))
        issues.extend(check_security(path, text))
        issues.extend(check_urls(path, rules, skip_network=skip_network))

    if issues:
        for issue in issues:
            print(issue.format(), file=sys.stderr)
        print(f"validation failed: {len(issues)} issue(s)", file=sys.stderr)
        return 1

    print("validation passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-network", action="store_true", help="skip remote URL reachability checks")
    args = parser.parse_args()
    return validate(skip_network=args.skip_network)


if __name__ == "__main__":
    raise SystemExit(main())
