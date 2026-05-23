# BilibiliSponsorBlock 空降助手（optional module）

这是一个给 Surge 5 使用的 **B 站小电视空降助手**模块。它参考 Sparkle 的 Bilibili protobuf 拦截方式，只保留 SponsorBlock/bsbsb 空降点注入能力，不混入 B 站去广告、皮肤、直播、搜索、评论区或账号相关改写。

- 模块：`modules/bilibili-bsbsb.sgmodule`
- 脚本：`modules/scripts/bilibili-bsbsb.airborne.js`；自动跳使用 Sparkle 官方 `bilibili.protobuf.response.js`
- 当前默认路径包含 `DmSegMobile` 请求脚本和 Sparkle 原版 `ViewProgress` response hook：前者只负责 bsbsb 空降/汇总弹幕注入，后者替换 Chronos 实现自动跳。本地脚本已瘦身为 DmSegMobile-only MVP，不匹配也不保留 `DmView`、本地 `handleChronos` / UI 观测、B 站去广告或评论净化逻辑。
- 导入 URL：`https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule`

## 定位

- **不进主 Surge.conf**：它需要 MITM 和脚本，属于可选增强，不是公开主配置默认能力。
- **只处理空降助手**：默认拦截 Bilibili App 弹幕分段接口，查询 `bsbsb.top` 的片段数据，再注入可点击空降弹幕和开头汇总弹幕；自动跳只额外使用 Sparkle 原版 `ViewProgress` Chronos 脚本。`DmView` 不进入模块。
- **失败开放**：bsbsb API 失败、超时、Cloudflare 拦截或返回空数据时，保留原始 B 站响应，不影响播放。

## 默认行为

默认参数偏保守：

```text
类别 = sponsor|selfpromo|interaction
动作类型 = skip
片头片尾 = 0
高能点 = 0
开头汇总弹幕 = 1
汇总弹幕毫秒 = 3000
系统通知 = 0
通知冷却分钟 = 30
最短片段秒数 = 5
合并间隔秒数 = 1.5
空降提前毫秒 = 2000
最大注入数 = 12
缓存分钟 = 60
API策略 = DIRECT
```

含义：

- 默认只启用广告/自我推广/互动提醒三类，避免把片头片尾等正常内容也默认跳过。
- `intro|outro|padding|music_offtopic` 通过“片头片尾=1”额外启用。
- `poi_highlight` 通过“高能点=1”额外启用；启用后脚本会自动追加 `poi` 动作类型。
- **开头汇总弹幕**默认开启：它走 `DmSegMobile` request 注入路径，使用已验证可见的 `airborne:<progress>` 卡片形态。脚本会优先读取 `DmSegMobile` 请求里的实际播放窗口 `ps` / `pe`，按“当前进入播放位置 + 汇总弹幕毫秒”（默认 3000ms）计算出现时间；如果请求里没有播放窗口，才回退到弹幕分段开头约 3000ms。
- **系统通知**默认关闭：如需 Surge 系统弹窗，把“系统通知=1”；通知带“通知冷却”（默认 30 分钟），避免同一视频反复弹出。
- **自动跳按 Sparkle 原方式恢复**：模块只为自动跳增加 Sparkle 官方 `ViewProgress` response hook，不使用本仓库脚本去解析/重写 `ViewProgress`，也不匹配 `DmView`。
- 片段太短会被过滤，相邻/重叠片段会被合并，避免弹幕列表被污染。

## 自动跳机制

Sparkle 的自动跳依赖 `ViewProgress` 响应脚本替换 Bilibili 下发的 Chronos 运行包。当前模块按之前现场可用的方式恢复自动跳：

- `DmSegMobile` request hook 仍使用本仓库 `bilibili-bsbsb.airborne.js` 注入 `空指部已就位` 空降弹幕和开头汇总弹幕。
- `ViewProgress` response hook 使用 Sparkle 官方 `https://raw.githubusercontent.com/kokoryh/Sparkle/refs/heads/master/dist/bilibili.protobuf.response.js`。
- 不匹配 `DM/DmView`。
- 不使用本地 `handleViewProgressReply` / `handleChronos` / `UI观测` 路径。

Chronos 自动跳识别的特殊空降弹幕是：

```text
content = "空指部已就位"
action = "airborne:<目标毫秒>"
```

因此本模块必须保留这条**精确文案**：`空指部已就位`。Sparkle Chronos 会识别这类空降卡片并自动跳到 `action` 指定的目标毫秒。

当前实现约定：

- `skip` 片段：`content` 固定为 `空指部已就位`，用于显示可点击空降卡片，并为未来单独自动跳实验保留兼容。
- 分类信息：写入 `extra` JSON（`category` / `categoryLabel` / `actionType` / `UUID`），不污染自动跳文案。
- `poi_highlight` 高能点：不使用 `空指部已就位`，显示分类标签并保持手动空降提示，避免被误当作 skip 自动跳。

## 开头汇总弹幕与系统通知

本模块新增两类“进入视频时的整体提示”：

- **开头汇总弹幕**：默认开启。脚本会在第一个 `DmSegMobile` 弹幕分段中追加多条小字号、分行式空降卡片提示，例如：`空降助手提示`、`本视频含 1 段广告，1分14秒，将为您自动跳过`、`本视频含 2 个高能，可手动空降`。每个 skip 类型单独生成一条，`poi_highlight` 单独生成一条，达到类似换行的阅读效果。显示时间不再固定为视频第 3 秒：脚本会优先读取当前 `DmSegMobile` 请求里的 `ps` / `pe` 播放窗口，按“实际进入/请求播放位置 + 汇总弹幕毫秒”计算；例如从 42 秒进入视频且默认 3000ms 时，汇总会在约 45 秒出现。若请求缺少该窗口，则回退到当前弹幕分段开头 + 3000ms。如果视频当前进入位置落在有空降点的片段内，脚本仍会把汇总弹幕顺延到该片段目标后约 1 秒。
- **系统通知**：默认关闭。只有把模块参数“系统通知=1”后，脚本才会调用 Surge 的 `$notification.post` 发系统通知；通知内容与汇总弹幕一致，但默认静音、自动消失。
- **通知冷却**：默认 30 分钟。脚本按 `videoId + cid + 摘要签名` 写入 `$persistentStore`，同一视频同一批片段在冷却期内不会反复通知；把“通知冷却分钟=0”可关闭冷却限制。
- **失败开放**：汇总弹幕或通知逻辑异常时只写 debug 日志，不影响原始 B 站弹幕响应和空降弹幕注入。

## 响应重写与原生卡片 Spike

当前模块只允许一条 `ViewProgress` response hook，用于加载 Sparkle 官方 Chronos 脚本。稳定路径仍不启用 `UI观测`，不匹配 `DmView`，不使用本仓库脚本解析/重写 `ViewProgress`。

`DmView` 原生卡片、`CommandDm` / `ContractCard` / `OperationCard` 注入，均不进入默认模块；后续只能另建单独实验模块验证。

## MITM 范围

模块只追加两个必要 hostname，当前默认路径用于 `DmSegMobile` 注入和 `ViewProgress` Chronos 自动跳；保留 `app.bilibili.com` 是为了兼容 B 站 App 在不同入口下的同名接口。默认不匹配 `DmView`：

```ini
hostname = %APPEND% grpc.biliapi.net, app.bilibili.com
```

不包含：

- `api.bilibili.com`
- `api.live.bilibili.com`
- `line3-h5-mobile-api.biligame.com`
- `hostname = *`

启用前仍需在 Surge 中安装并信任 MITM 证书。由于涉及 HTTPS 解密，建议只在你自己的设备上启用。

## 外部请求与隐私

脚本会向：

```text
https://bsbsb.top/api/skipSegments
```

发起查询，请求参数包括：

- `videoID`
- `cid`
- `categories`
- `actionTypes`

脚本不会调用投票、提交、观看上报类接口，也不需要 Bilibili 登录态或 bsbsb 用户 ID。

bsbsb.top 有 Cloudflare 防护；请求头会显式设置：

- `origin: chrome-extension://eaoelafamejbnggahofapllmfhlhajdd`
- `x-ext-version`
- 浏览器式 `User-Agent`

如果 `DIRECT` 访问不稳定，可在模块参数中把 `API策略` 改为你的代理策略组。

## 使用方式

1. 在 Surge 中导入模块：

   ```text
   https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule
   ```

2. 启用 MITM，并确认设备已信任 Surge 证书。
3. 保持默认参数先测试。
4. 如果空降数据不出现：
   - 把 `API策略` 改为可访问 bsbsb.top 的代理策略。
   - 把 `日志等级` 临时改为 `1` 观察脚本日志。
   - 确认 Bilibili App 请求命中了 `DmSegMobile` 接口。
5. 如果只显示“空指部已就位”但不自动跳：确认 Surge 中已重新导入包含 Sparkle `ViewProgress` response hook 的最新版模块，并确认 `[Script]` 里存在 `bilibili.bsbsb.chronos`，且 `script-path` 指向 `kokoryh/Sparkle/.../bilibili.protobuf.response.js`。
6. 如果 Surge 日志出现 `SyntaxError: JSON Parse error: Unrecognized token '\\'`：
   - 说明模块里的 `argument` JSON 被反斜杠转义了，Surge 会把反斜杠原样传给 `$argument`，导致脚本在 `JSON.parse($argument)` 阶段就失败。
   - 删除旧模块后重新导入最新版；新版 `argument` 写法与 Sparkle 原模块一致，不再把 JSON 内部引号写成 `\\"`；脚本侧也兼容旧版反斜杠转义参数，避免本脚本继续报错。
7. 如果想调整开头汇总弹幕：
   - 默认“开头汇总弹幕=1”；如需排查兼容性，可临时改为 0。
   - 确认“汇总弹幕毫秒”已更新为默认 3000 或更晚；新版会按实际 `DmSegMobile` 的 `ps` / `pe` 播放窗口计算，不再固定出现在视频第 3 秒。
   - 从视频开头重新进入，汇总优先注入第一个弹幕分段；如果首段 bsbsb 查询超时，会在第一个成功拿到有效片段的分段补提示。
   - 确认当前视频确实有 bsbsb 片段数据；没有片段时不会生成汇总。
   - 如果开启后普通弹幕也不显示，立即关回“开头汇总弹幕=0”，这是当前已知的客户端兼容风险。
   - DEBUG 日志会输出 `[SponsorBlock] parsed` 和 `[SponsorBlock] inject`，可看 `rawCount` / `parsedCount` / `segmentIndex` / `includeSummary` / `summaryProgress` 判断是否真正注入。
   - 如果日志里的 `[SponsorBlock] HTTP request timeout` 仍然大约 3 秒就出现，或者成功请求后没有 `[SponsorBlock] parsed` / `[SponsorBlock] inject`，说明 Surge 仍在使用缓存的旧脚本；删除旧模块并重新导入带新版 cache-busting `script-path` 的模块。

## 可调参数建议

- **自动跳 + 汇总提示**：保持默认。
- **更激进跳过**：开启“片头片尾=1”。
- **想看高能点**：开启“高能点=1”。
- **想关闭开头汇总**：把“开头汇总弹幕=0”，普通空降与 Sparkle 自动跳仍保留。
- **想要系统弹窗**：把“系统通知=1”，必要时调整“通知冷却分钟”。
- **空降弹幕太多**：降低“最大注入数”或提高“最短片段秒数”。
- **bsbsb 查询频繁**：提高“缓存分钟”。

## 来源与协议

- Protobuf 拦截与弹幕注入实现参考并派生自 `kokoryh/Sparkle`：GPL-3.0。
- 空降片段数据/API 来自 `hanydd/BilibiliSponsorBlock` / `bsbsb.top`：GPL-3.0。
- 本仓库中的 `modules/scripts/bilibili-bsbsb.airborne.js` 以 `GPL-3.0-or-later` 标注。
- 修改补丁保存在 `docs/modules/bilibili-bsbsb-sparkle.patch`，便于后续追踪与重建。

## 风险等级

- 风险：Medium/High 之间。
- 原因：MITM + WebView 脚本，但 hostname 范围很小，不碰账号、支付、Cookie、登录或广泛 REST API。
- 结论：适合作为 optional module，不适合作为主配置默认启用。