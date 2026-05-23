# Surge

适合中国大陆日常使用的 Surge 5 配置项目。

核心路线：

```text
SukkaW 主干规则
+
blackmatrix7 单 App 精细控制
+
本仓库生成器拆分 mixed list
+
校验器保证可维护性和公开安全
```

## 文件

- `Surge.conf` — 主配置入口。
- `Surge-SukkaW-Blackmatrix7.conf` — 与主配置同内容，保留描述性文件名。
- `sources/rules.yaml` — 上游规则源定义。
- `scripts/generate.py` — 拉取并拆分 blackmatrix7 mixed list，更新配置。
- `scripts/validate.py` — 校验规则 URL、策略组引用、顺序和安全项。
- `rules/blackmatrix7/` — 生成后的 blackmatrix7 app 规则，分为 `non_ip` / `ip`。
- `docs/design.md` — 项目架构和规则设计说明。
- `docs/sub-store.md` — Sub-Store 节点治理建议。
- `docs/optional-modules.md` — 可选模块和风险分层原则。

## 设计

- 主规则：SukkaW (`https://ruleset.skk.moe/List/...`)。
- 单 App 补充：blackmatrix7。
- 规则顺序：`domainset -> non_ip -> ip -> FINAL`。
- blackmatrix7 mixed list 由本仓库生成器拆分后再引用。
- 高风险 adblock / MITM / URL-REGEX / rewrite 默认不启用。
- 默认安全项包括：
  - `allow-wifi-access = false`
  - `http-api-web-dashboard = false`
  - `udp-policy-not-supported-behaviour = reject`

## 当前独立 App 策略

仅对有明确功能理由的服务独立：

- PayPal — 支付/账号风控，适合固定稳定出口。
- GitHub — 开发工作流和下载稳定性。
- YouTube — 视频服务和 YouTube Music 区域体验。
- Netflix — 地区内容库差异明显。
- Disney+ — 地区内容库差异明显。
- Spotify — 曲库、账号地区和推荐差异。
- TikTok — 对 IP 地区和 IP 质量敏感。

BiliBili 不使用大而全单 App 规则前置，保留 SukkaW 的分布式处理：国内主站直连，国际版/港澳台进入流媒体兜底。

## 使用前必改

替换 `[Proxy Group]` 中的订阅占位符：

```ini
✈️ 我的节点 = select, policy-path=你的订阅地址, ...
```

不要把真实订阅链接提交到公开仓库。

## 生成

```bash
python3 scripts/generate.py
```

检查生成文件是否已同步：

```bash
python3 scripts/generate.py --check
```

## 校验

```bash
python3 scripts/validate.py
```

校验内容包括：

- 活跃规则 URL 可达性。
- 同仓库 raw URL 是否映射到本地生成文件。
- 策略组引用是否存在。
- 规则顺序是否满足 `domainset -> non_ip -> ip -> FINAL`。
- blackmatrix7 是否已拆分为本地 `non_ip` / `ip` 列表。
- 是否误提交订阅链接、MITM CA、代理凭据等敏感内容。
- 是否默认开启高风险网络设置。

## 文档

- [设计说明](docs/design.md)
- [Sub-Store 节点治理建议](docs/sub-store.md)
- [Optional Modules 原则](docs/optional-modules.md)
