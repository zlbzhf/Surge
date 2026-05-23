# Surge

A Surge 5 daily-driver configuration for mainland China usage.

## Files

- `Surge.conf` — main profile.
- `Surge-SukkaW-Blackmatrix7.conf` — same profile with an explicit descriptive filename.

## Design

- Framework/UI style: Rabbit-Spec-inspired Surge groups.
- Main rules: SukkaW (`https://ruleset.skk.moe/List/...`).
- Supplemental single-app rules: blackmatrix7 for YouTube, Netflix, Disney+, Spotify, TikTok, PayPal, and GitHub.
- Risky adblock/MITM/URL-REGEX rules are kept commented by default.
- Default safety choices include `allow-wifi-access = false` and `udp-policy-not-supported-behaviour = reject`.

## Rule-source intent

- SukkaW handles the core split: direct/domestic/global, AI, Telegram, Apple, Microsoft, CDN, downloads, LAN, China IP, and region-based streaming fallback.
- blackmatrix7 handles services that benefit from separate policy control because of region libraries, IP reputation, account risk, or residential-IP needs.

## Before use

Replace the placeholder subscription in `[Proxy Group]`:

```ini
✈️ 我的节点 = select, policy-path=你的订阅地址, ...
```

Then choose policies for sensitive groups such as `AIGC`, `TikTok`, `Netflix`, `PayPal`, and `GitHub`.
