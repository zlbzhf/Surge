# 设计说明

本项目目标不是收集最多规则，而是维护一份适合中国大陆日常使用、可验证、可扩展的 Surge 5 配置。

## 核心原则

1. **主干规则保持少源、清晰、可维护**
   - 主干使用 SukkaW：`https://ruleset.skk.moe/List/...`
   - 单 App 精细控制使用 blackmatrix7，但由本仓库生成器拆分后再引用。

2. **遵循 SukkaW 的全局规则顺序**
   - `domainset`
   - `non_ip`
   - `ip`
   - `FINAL`

   这样可以减少过早 DNS 解析，降低 DNS 污染、误匹配和性能问题。

3. **独立 App 策略组必须有功能理由**

   不为了细分而细分。只有满足以下场景才独立：

   - 不同地区内容库不同：Netflix、Disney+、Hulu、Prime Video 等。
   - 对 IP 类型/质量敏感：TikTok、AIGC、PayPal 等。
   - 账号风控需要稳定出口：PayPal、Google、GitHub 等。
   - 开发/下载工作流明显受影响：GitHub、GitLab、Docker、HuggingFace 等。

4. **默认安全，不默认启用高风险增强**
   - 默认不启用 MITM。
   - 默认不启用 Rewrite/URL-REGEX。
   - 广告、隐私、恶意域名增强默认注释保留。
   - 局域网代理、HTTP API 面板默认关闭。
   - UDP 不支持时默认 `reject`，避免直接泄漏。

5. **公开主配置与私有节点分离**

   `Surge.conf` 是公开、可自动更新的主配置，只保存规则架构和策略组。真实节点和订阅信息通过本地外部策略文件 `proxies.txt` 提供：

   ```ini
   ✈️ 我的节点 = select, policy-path=proxies.txt, ...
   ```

   这样同步远程主配置时，不会覆盖用户本地的节点配置。

## 当前规则来源分工

### SukkaW

负责主干分流：

- direct / domestic / global
- ai / apple_intelligence
- telegram
- apple / microsoft
- cdn / download / game-download
- neteasemusic
- lan / china_ip
- stream_* 地区流媒体兜底
- reject / phishing / privacy 规则以注释形式保留

### blackmatrix7

负责有明确独立策略价值的 App：

- PayPal
- GitHub
- YouTube
- Netflix
- Disney+
- Spotify
- TikTok

上游 blackmatrix7 列表是 mixed Surge list，可能同时包含 `DOMAIN-SUFFIX`、`USER-AGENT`、`PROCESS-NAME`、`IP-CIDR` 等规则。为了保留 SukkaW 的全局顺序，本项目使用 `scripts/generate.py` 自动拆分为：

```text
rules/blackmatrix7/<App>.non_ip.list
rules/blackmatrix7/<App>.ip.list
```

然后在配置里分别放入 non_ip 区域和 ip 区域。

## BiliBili 例外

BiliBili 不直接按 YouTube/Netflix 的方式单独前置大规则。

原因：

- 国内 B 站主站、API、CDN 更适合走 `domestic -> DIRECT`。
- BiliBili International / Bstar 等才适合进入流媒体策略。
- 广告和统计端点由 reject 规则按需处理。

因此本项目默认保留 SukkaW 的分布式处理，不引入完整大而全 BiliBili 单 App 规则。

## 生成与校验

```bash
python3 scripts/generate.py
python3 scripts/generate.py --check
python3 scripts/validate.py
```

`generate.py` 负责：

- 读取 `sources/rules.yaml`。
- 拉取 blackmatrix7 上游规则。
- 拆分 non_ip / ip。
- 更新唯一主配置 `Surge.conf`。

`validate.py` 负责：

- 校验策略组引用是否存在。
- 校验规则顺序是否回退。
- 校验活跃规则 URL 是否可达。
- 校验同仓库 raw URL 是否能映射到本地文件。
- 防止提交订阅链接、MITM CA、代理凭据等敏感内容。
- 防止默认启用高风险开关。

## 后续扩展方向

优先级从高到低：

1. 完善生成器和校验器。
2. 建立 Sub-Store 节点治理规范。
3. 增加可选 profile，例如 Developer、Media、Lite。
4. 增加 optional modules 文档，不默认启用高风险模块。
5. 只有在有实际功能需求时，才新增更多独立 App 规则。
