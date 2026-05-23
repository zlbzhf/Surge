#!/usr/bin/env python3
"""Validate generated Surge profiles in this repository.

Checks are intentionally practical for a public daily-driver config:
- active remote rule URLs resolve, while same-repo raw URLs map to local files;
- rule policy targets exist as proxy groups or Surge built-ins;
- proxy groups do not reference missing or stale/unused policy groups;
- rule ordering preserves domainset -> non_ip -> ip -> FINAL;
- generated blackmatrix7 split rules are referenced instead of mixed upstream lists;
- optional modules stay minimal, documented, and do not broaden MITM/script scope;
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
BSBSB_MODULE = ROOT / "modules" / "bilibili-bsbsb.sgmodule"
BSBSB_SCRIPT = ROOT / "modules" / "scripts" / "bilibili-bsbsb.airborne.js"
BSBSB_DOC = ROOT / "docs" / "modules" / "bilibili-bsbsb.md"
BSBSB_PATCH = ROOT / "docs" / "modules" / "bilibili-bsbsb-sparkle.patch"
GPL_LICENSE = ROOT / "modules" / "LICENSES" / "GPL-3.0.txt"
BSBSB_SCRIPT_URL = "https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/scripts/bilibili-bsbsb.airborne.js"
BSBSB_CHRONOS_SCRIPT_URL = "https://raw.githubusercontent.com/kokoryh/Sparkle/refs/heads/master/dist/bilibili.protobuf.response.js"
FORBIDDEN_ACTIVE_GROUPS = {
    "BiliBili": "BiliBili should stay handled by SukkaW domestic/stream rules, not as an independent active policy group",
}


@dataclass
class Issue:
    path: Path
    line: int
    message: str
    level: str = "error"

    def format(self) -> str:
        rel = self.path.relative_to(ROOT) if self.path.is_absolute() and self.path.is_relative_to(ROOT) else self.path
        return f"::{self.level} file={rel},line={self.line}::{self.message}"


@dataclass(frozen=True)
class GroupDef:
    name: str
    line: int
    rhs: str


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


def parse_group_definitions(text: str) -> dict[str, GroupDef]:
    start_line, lines = section(text, "Proxy Group")
    groups: dict[str, GroupDef] = {}
    for offset, line in enumerate(lines):
        if not active(line) or "=" not in line:
            continue
        name, rhs = line.split("=", 1)
        name = name.strip()
        groups[name] = GroupDef(name=name, line=start_line + offset, rhs=rhs.strip())
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


def group_references(group: GroupDef) -> list[tuple[str, str]]:
    """Return policy-group references inside a Proxy Group RHS.

    Surge group lines are comma separated. The first field is the group type
    (`select`, `smart`, etc.). Later bare fields are policy members; most
    `key=value` fields are parameters, except `include-other-group`, which is a
    policy-group reference.
    """
    parts = [part.strip() for part in group.rhs.split(",")]
    refs: list[tuple[str, str]] = []
    for token in parts[1:]:
        if not token:
            continue
        if "=" in token:
            key, value = token.split("=", 1)
            if key.strip() == "include-other-group":
                refs.append((value.strip(), "include-other-group"))
            continue
        refs.append((token, "member"))
    return refs


def check_group_graph(path: Path, text: str, rules: list[tuple[int, str, list[str]]]) -> list[Issue]:
    groups = parse_group_definitions(text)
    valid = set(groups) | BUILTIN_POLICIES
    referenced: set[str] = set()
    issues: list[Issue] = []

    for line_no, _line, parts in rules:
        policy = rule_policy(parts)
        if policy in groups:
            referenced.add(policy)
        elif policy and policy not in valid:
            issues.append(Issue(path, line_no, f"rule targets missing policy group: {policy}"))

    for group in groups.values():
        for ref, kind in group_references(group):
            if ref in groups:
                referenced.add(ref)
            elif ref not in BUILTIN_POLICIES:
                issues.append(Issue(path, group.line, f"proxy group {group.name} references missing {kind}: {ref}"))

    for name, message in FORBIDDEN_ACTIVE_GROUPS.items():
        if name in groups:
            issues.append(Issue(path, groups[name].line, message))

    for group in groups.values():
        if group.name not in referenced:
            issues.append(Issue(path, group.line, f"policy group is not referenced by any active rule or proxy group: {group.name}"))

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


def check_bsbsb_module() -> list[Issue]:
    """Validate the optional BilibiliSponsorBlock Surge module stays minimal and safe."""
    issues: list[Issue] = []
    required_files = [BSBSB_MODULE, BSBSB_SCRIPT, BSBSB_DOC, BSBSB_PATCH, GPL_LICENSE]
    for path in required_files:
        if not path.exists():
            issues.append(Issue(path, 1, "missing BilibiliSponsorBlock optional module artifact"))
    if issues:
        return issues

    module_text = BSBSB_MODULE.read_text(encoding="utf-8")
    module_script_text = module_text.split("[Script]", 1)[1].split("[MITM]", 1)[0]
    script_text = BSBSB_SCRIPT.read_text(encoding="utf-8")
    script_search_text = re.sub(
        r"\\u([0-9A-Fa-f]{4})",
        lambda match: chr(int(match.group(1), 16)),
        script_text,
    ).replace(r"\xB7", "·")
    doc_text = BSBSB_DOC.read_text(encoding="utf-8")

    module_checks = [
        ("#!name=BilibiliSponsorBlock 空降助手", "module should have a stable human-readable name"),
        ("DOMAIN,bsbsb.top,{{{API策略}}}", "bsbsb.top should be routed by the configurable API policy"),
        (BSBSB_SCRIPT_URL, "module should reference the same-repo airborne script URL"),
        ("bilibili-bsbsb.airborne.js?v=20260523-sparkle-chronos-1", "module should cache-bust the airborne script URL after restoring Sparkle Chronos auto-seek"),
        ("DmSegMobile", "module should hook the Bilibili danmaku segment endpoint"),
        ("bilibili.bsbsb.chronos = type=http-response", "module should restore the known-working Sparkle ViewProgress Chronos hook for auto-seek"),
        ("bilibili.protobuf.response.js", "auto-seek should use Sparkle's official response script rather than local ViewProgress rewriting"),
        ("kokoryh/Sparkle", "auto-seek response hook should point at Sparkle's official repository"),
        (BSBSB_SCRIPT_URL, "module should use the same-repo script for danmaku injection"),
        ("grpc.biliapi.net, app.bilibili.com", "MITM scope should stay limited to the two required Bilibili hosts"),
        ("汇总弹幕:1", "summary danmaku should stay enabled by default while restoring Sparkle Chronos auto-seek"),
        ("系统通知:0", "system notification should stay opt-in and disabled by default"),
        ("通知冷却分钟:30", "system notification should have a default cooldown"),
        ("汇总弹幕毫秒:3000", "summary danmaku should have a conservative configurable display time"),
        ("summaryDanmaku", "module should pass summaryDanmaku argument to the script"),
        ("systemNotification", "module should pass systemNotification argument to the script"),
        ("notificationCooldownMinutes", "module should pass notification cooldown argument to the script"),
        ("summaryDanmakuMs", "module should pass summary danmaku timing argument to the script"),
    ]
    for needle, message in module_checks:
        if needle not in module_text:
            issues.append(Issue(BSBSB_MODULE, 1, message))
    forbidden_module_needles = [
        ('argument="{\\\\"', "Surge passes module argument backslashes literally; do not shell/INI-escape JSON quotes inside argument"),
        ("hostname = *", "module must not MITM all hostnames"),
        ("api.bilibili.com", "bsbsb-only module should not MITM broad Bilibili REST hosts"),
        ("api.live.bilibili.com", "bsbsb-only module should not touch live APIs"),
        ("line3-h5-mobile-api.biligame.com", "bsbsb-only module should not touch Biligame APIs"),
        ("skip-server-cert-verify", "module must not disable certificate verification"),
        ("自动跳:#", "auto-seek should follow the known-working Sparkle hook and not reintroduce a disabled-but-installed parameter gate"),
        ('"sponsorBlock":"{{{自动跳}}}"', "auto-seek response-hook argument should follow the main helper switch, not a disabled-by-default hook gate"),
        ("20260523-request-only-2", "module should not keep the old request-only cache-bust after restoring Sparkle Chronos"),
        ("uiObservation", "stable module must not expose UI observation while restoring Sparkle Chronos"),
        ("UI观测", "stable module must not expose UI observation while restoring Sparkle Chronos"),
        ("DM\\/DmView", "stable default module must not intercept DmView; even parse/rewrap can hide the Bilibili danmaku layer"),
        ("DM/DmView", "stable default module must not intercept DmView; even parse/rewrap can hide the Bilibili danmaku layer"),
    ]
    for needle, message in forbidden_module_needles:
        if needle in module_script_text:
            issues.append(Issue(BSBSB_MODULE, 1, message))
    script_lines = [line for line in module_script_text.splitlines() if line.strip() and not line.strip().startswith("#")]
    chronos_lines = [line for line in script_lines if line.startswith("bilibili.bsbsb.chronos")]
    if len(chronos_lines) != 1:
        issues.append(Issue(BSBSB_MODULE, 1, "module should have exactly one Chronos response hook"))
    elif BSBSB_SCRIPT_URL in chronos_lines[0] or "bilibili-bsbsb.airborne.js" in chronos_lines[0]:
        issues.append(Issue(BSBSB_MODULE, 1, "Chronos response hook must use Sparkle's official response script, not the local airborne script"))

    script_checks = [
        ("parseSurgeArgument", "script should tolerate older backslash-escaped Surge argument JSON instead of repeatedly logging JSON parse errors"),
        ("countRawSegments", "script should log raw and parsed bsbsb segment counts for field debugging"),
        ("shouldIncludeSummaryDanmaku", "script should inject summary on the first segment or the segment containing the first actionable marker"),
        ("bsbsb.top/api/skipSegments", "script should fetch BilibiliSponsorBlock skipSegments API"),
        ("categories=", "script should support multi-category queries instead of sponsor-only mode"),
        ("User-Agent", "script should set a browser-like User-Agent for bsbsb Cloudflare compatibility"),
        ("x-ext-version", "script should send the BilibiliSponsorBlock version header"),
        ("$persistentStore", "script should cache bsbsb responses in Surge persistent storage"),
        ("mergeGap", "script should merge near-overlapping segments"),
        ("minDuration", "script should filter very short segments"),
        ("poi_highlight", "script should expose optional highlight/POI support"),
        ("createSummaryDanmaku", "script should inject an intro summary danmaku"),
        ("summarizeSegments", "script should summarize skip/poi segment counts"),
        ("summaryDanmaku: toBoolean(argument.summaryDanmaku)", "script should default summary danmaku off unless the module explicitly enables it"),
        ("summaryDanmakuMs", "script should support configurable summary danmaku timing"),
        ("chooseSummaryProgressMs", "script should delay summary danmaku when an opening skip would jump past it"),
        ("maybeNotifySummary", "script should support optional system notification with cooldown"),
        ("notificationCooldownMinutes", "script should rate-limit system notifications"),
        ("ctx2.notify(", "script should use Surge notification API only behind the opt-in notification gate"),
        ("return []", "script should fail open when bsbsb lookup fails"),
        ("SPDX-License-Identifier: GPL-3.0-or-later", "script should keep GPL SPDX license marker"),
        ("kokoryh/Sparkle", "script should retain Sparkle attribution"),
        ("hanydd/BilibiliSponsorBlock", "script should retain BilibiliSponsorBlock attribution"),
    ]
    for needle, message in script_checks:
        if needle not in script_text:
            issues.append(Issue(BSBSB_SCRIPT, 1, message))
    forbidden_script_needles = [
        ("voteOnSponsorTime", "script must not vote using user identity"),
        ("viewedVideoSponsorTime", "script must not report viewing activity"),
        ("userID", "script must not embed or request a private bsbsb user ID"),
        ("category=sponsor", "script should not hard-code sponsor-only mode"),
        ("summaryDanmaku: argument.summaryDanmaku === void 0 ? true", "summary danmaku must not silently default on after field reports showed it can hide the Bilibili danmaku layer"),
        ("injectExperimentalCommandDm", "DmView CommandDm injection broke the Bilibili danmaku layer in field testing; keep this experiment disabled/removed"),
        ("commandDmExperiment", "module must not expose the broken DmView CommandDm injection experiment"),
        ("DmView:commandDmExperiment", "script must not run the broken DmView CommandDm injection experiment"),
        ("handleDmViewReply", "MVP airborne script must not keep local DmView parsing/rewrap handlers"),
        ("handleViewProgressReply", "MVP airborne script must not keep local ViewProgress/Chronos response rewriting"),
        ("handleChronos", "auto-seek should stay in Sparkle's official response script, not local airborne.js"),
        ("handleViewReply", "bsbsb-only MVP script must not keep Bilibili View ad/panel cleanup handlers"),
        ("handleMainListReply", "bsbsb-only MVP script must not keep comment/reply cleanup handlers"),
        ('router.post("v1.DM/DmView"', "MVP airborne router should only handle DmSegMobile"),
        ('router.post("view.v1.View/ViewProgress"', "MVP airborne router should not handle local ViewProgress"),
        ('router.post("viewunite.v1.View/ViewProgress"', "MVP airborne router should not handle local ViewProgress"),
        ('router.post("viewunite.v1.View/View"', "MVP airborne router should not handle Bilibili View cleanup"),
        ('router.post("v1.Reply/MainList"', "MVP airborne router should not handle reply/comment cleanup"),
        ("uiObservation", "MVP airborne script must not keep local UI observation toggles"),
        ("purifyComment", "MVP airborne script must not keep comment purification toggles"),
        ("displayUpList", "MVP airborne script must not keep unrelated Sparkle display options"),
        ("app/viewunite/v1/view.ts", "MVP airborne script must not keep unrelated View protobuf enums"),
        ("ModuleType", "MVP airborne script must not keep unrelated View module enums"),
        ("RelateCardType", "MVP airborne script must not keep unrelated related-card enums"),
    ]
    for needle, message in forbidden_script_needles:
        if needle in script_text:
            issues.append(Issue(BSBSB_SCRIPT, 1, message))

    if "空指部已就位 ·" in script_search_text:
        issues.append(
            Issue(
                BSBSB_SCRIPT,
                1,
                "skip danmaku content must stay exactly '空指部已就位' so Bilibili Chronos can auto-seek",
            )
        )
    exact_skip_needles = (
        'segment.actionType === "skip" ? "空指部已就位"',
        "segment.actionType === 'skip' ? '空指部已就位'",
    )
    if not any(needle in script_search_text for needle in exact_skip_needles):
        issues.append(
            Issue(
                BSBSB_SCRIPT,
                1,
                "script should explicitly keep skip content as exact '空指部已就位' and put category metadata elsewhere",
            )
        )
    if "categoryLabel" not in script_text:
        issues.append(Issue(BSBSB_SCRIPT, 1, "script should keep category label metadata in extra JSON / POI display text"))
    if "message.elems.unshift(...createSummaryDanmaku" not in script_text:
        issues.append(Issue(BSBSB_SCRIPT, 1, "summary danmaku lines should be prepended before normal danmaku elems so they are not dropped by list order/limits"))
    summary_field_needles = [
        ('String(900000 + index)', "summary danmaku lines should use small numeric ids like known-working airborne danmaku"),
        ("idStr: summaryId", "summary danmaku idStr should stay numeric, not a custom label"),
        ("attr: 1310724", "summary danmaku should reuse the known-visible airborne attr"),
        ('extra: ""', "summary danmaku should avoid custom extra metadata that may be filtered by the client"),
        ("chooseSummaryProgressMs(segments, options, segmentIndex, dmSegRequest)", "script should calculate summary danmaku timing from the actual DmSegMobile playback start when available"),
        ("getDmSegRequestPlaybackStartMs", "script should read DmSegMobile ps/pe to avoid always showing summary at a fixed third second"),
        ("SUMMARY_DANMAKU_FONTSIZE = 25", "summary danmaku should use a smaller mobile-friendly font size instead of the large airborne skip font"),
        ("summary.lines.map", "summary danmaku should render one top-card line per summary row to mimic multiline display"),
        ("空降助手提示", "summary danmaku should include a short title line"),
        ("将为您自动跳过", "skip summary lines should clearly say they will be auto-skipped"),
        ("可手动空降", "POI summary lines should clearly say they are manual jumps"),
        ("action: `airborne:${progress}`", "summary danmaku should use a self-target airborne action so Bilibili shows it through the same visible path as working airborne prompts"),
    ]
    for needle, message in summary_field_needles:
        if needle not in script_text:
            issues.append(Issue(BSBSB_SCRIPT, 1, message))
    if "summary.lines.map" not in script_text:
        issues.append(Issue(BSBSB_SCRIPT, 1, "summary danmaku content must stay distinct from exact skip trigger text so it does not auto-seek"))

    doc_checks = [
        ("MITM", "docs should disclose MITM requirement"),
        ("bsbsb.top", "docs should name the external API/data source"),
        ("sponsor|selfpromo|interaction", "docs should document the default category set"),
        ("不进主 Surge.conf", "docs should state this remains optional, not default"),
        ("自动跳", "docs should document the Bilibili Chronos auto-seek behavior"),
        ("精确文案", "docs should document the exact content constraint for auto-seek"),
        ("空指部已就位", "docs should document the exact skip danmaku content"),
        ("开头汇总弹幕", "docs should document the intro summary danmaku feature"),
        ("系统通知", "docs should document optional system notifications"),
        ("Sparkle 官方", "docs should explain that auto-seek uses Sparkle's official ViewProgress response script"),
        ("不匹配 `DM/DmView`", "docs should state the stable module still avoids DmView response rewriting"),
        ("默认开启", "docs should document that summary danmaku is enabled by default in the Sparkle Chronos build"),
        ("默认关闭", "docs should state system notification is disabled by default"),
        ("通知冷却", "docs should document notification cooldown behavior"),
        ("GPL-3.0-or-later", "docs should preserve GPL license attribution"),
        ("kokoryh/Sparkle", "docs should attribute Sparkle"),
        ("hanydd/BilibiliSponsorBlock", "docs should attribute BilibiliSponsorBlock"),
    ]
    for needle, message in doc_checks:
        if needle not in doc_text:
            issues.append(Issue(BSBSB_DOC, 1, message))

    return issues


def validate(skip_network: bool = False) -> int:
    issues: list[Issue] = []
    for path in CONFIG_FILES:
        text = path.read_text(encoding="utf-8")
        rules = parse_rules(path)
        issues.extend(check_group_graph(path, text, rules))
        issues.extend(check_order(path, rules))
        issues.extend(check_blackmatrix7_split(path, text, rules))
        issues.extend(check_security(path, text))
        issues.extend(check_urls(path, rules, skip_network=skip_network))
    issues.extend(check_bsbsb_module())

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
