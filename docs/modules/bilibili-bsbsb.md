# BilibiliSponsorBlock 空降助手（optional module）

这是一个给 Surge 5 使用的 **B 站小电视空降助手**模块。它参考 Sparkle 的 Bilibili protobuf 拦截方式，只保留 SponsorBlock/bsbsb 空降点注入能力，不混入 B 站去广告、皮肤、直播、搜索、评论区或账号相关改写。

- 模块：`modules/bilibili-bsbsb.sgmodule`
- 脚本：`modules/scripts/bilibili-bsbsb.airborne.js`
- Chronos/UI 响应脚本：同一个 `bilibili-bsbsb.airborne.js` 窄范围匹配 `ViewProgress`，保留 Chronos 自动跳补丁；可选匹配 `DmView` / `ViewProgress` 做只读 UI 观测
- 导入 URL：`https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule`

## 定位

- **不进主 Surge.conf**：它需要 MITM 和脚本，属于可选增强，不是公开主配置默认能力。
- **只处理空降助手**：拦截 Bilibili App 弹幕分段接口，查询 `bsbsb.top` 的片段数据，再注入可点击空降弹幕；同时窄范围拦截 `ViewProgress` 响应，把 Bilibili Chronos 指向 Sparkle 维护的可自动跳版本。`UI观测` 开关默认关闭，开启后只读记录 `DmView` / `ViewProgress` 下发的互动弹幕与播放卡片结构，为后续实现原生卡片提示取真实样本。
- **失败开放**：bsbsb API 失败、超时、Cloudflare 拦截或返回空数据时，保留原始 B 站响应，不影响播放。

## 默认行为

默认参数偏保守：

```text
类别 = sponsor|selfpromo|interaction
动作类型 = skip
片头片尾 = 0
高能点 = 0
开头汇总弹幕 = 0
汇总弹幕毫秒 = 3000
系统通知 = 0
通知冷却分钟 = 30
UI观测 = 0
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
- **开头汇总弹幕**默认关闭：现场反馈表明额外注入多条汇总弹幕可能导致 B 站客户端整层弹幕不可见，因此默认不再注入汇总弹幕，只保留普通空降/自动跳弹幕。若手动开启，脚本会优先读取 `DmSegMobile` 请求里的实际播放窗口 `ps` / `pe`，按“当前进入播放位置 + 汇总弹幕毫秒”（默认 3000ms）计算出现时间；如果请求里没有播放窗口，才回退到弹幕分段开头约 3000ms。
- **系统通知**默认关闭：如需 Surge 系统弹窗，把“系统通知=1”；通知带“通知冷却”（默认 30 分钟），避免同一视频反复弹出。
- **UI观测**默认关闭：把“UI观测=1”后，响应脚本会只读记录 `DmView` / `ViewProgress` 里的 `command_dms`、`ContractCard`、`OperationCard`、`attention`、`post_panel` / `post_panel2` 等摘要；它不会注入卡片，也不会上传数据，用于先捕获 B 站真实原生互动卡片样本。
- 片段太短会被过滤，相邻/重叠片段会被合并，避免弹幕列表被污染。

## 自动跳机制

Sparkle 能自动跳过 skip 片段，并不是因为模块自己调用播放器 API，而是依赖两条链路同时生效：

1. `DmSegMobile` 请求脚本注入一条特殊空降弹幕；
2. `ViewProgress` 响应脚本把 Bilibili 下发的 Chronos 运行包替换为 Sparkle 维护的可识别空降助手版本。

如果只注入弹幕、不替换 Chronos，Bilibili App 通常只会显示“空指部已就位”的空降提示，但不会真正自动 seek。

Chronos 自动跳识别的特殊空降弹幕是：

```text
content = "空指部已就位"
action = "airborne:<目标毫秒>"
```

因此本模块对 `skip` 片段必须保留这条**精确文案**：`空指部已就位`。不要在 `content` 后追加“恰饭广告已标记”等分类说明，否则 Chronos 的精确字符串判断会失效，只剩手动点击空降。

当前实现约定：

- `skip` 片段：`content` 固定为 `空指部已就位`，用于触发 Chronos 自动跳。
- 分类信息：写入 `extra` JSON（`category` / `categoryLabel` / `actionType` / `UUID`），不污染自动跳文案。
- `poi_highlight` 高能点：不使用 `空指部已就位`，显示分类标签并保持手动空降提示，避免被误当作 skip 自动跳。

## 开头汇总弹幕与系统通知

本模块新增两类“进入视频时的整体提示”：

- **开头汇总弹幕**：默认关闭。现场日志显示脚本可以正常完成、但客户端弹幕层仍可能被额外汇总弹幕影响而不可见；因此稳定默认值是 `开头汇总弹幕=0`，只注入已验证的普通空降/自动跳弹幕。若手动改为 `1`，脚本会在第一个 `DmSegMobile` 弹幕分段中追加多条小字号、分行式空降卡片提示，例如：`空降助手提示`、`本视频含 1 段广告，1分14秒，将为您自动跳过`、`本视频含 2 个高能，可手动空降`。每个 skip 类型单独生成一条，`poi_highlight` 单独生成一条，达到类似换行的阅读效果。显示时间不再固定为视频第 3 秒：脚本会优先读取当前 `DmSegMobile` 请求里的 `ps` / `pe` 播放窗口，按“实际进入/请求播放位置 + 汇总弹幕毫秒”计算；例如从 42 秒进入视频且默认 3000ms 时，汇总会在约 45 秒出现。若请求缺少该窗口，则回退到当前弹幕分段开头 + 3000ms。如果视频当前进入位置落在会被自动跳过的片段内，脚本仍会把汇总弹幕顺延到该片段目标后约 1 秒，避免自动跳转后被错过。
- **系统通知**：默认关闭。只有把模块参数“系统通知=1”后，脚本才会调用 Surge 的 `$notification.post` 发系统通知；通知内容与汇总弹幕一致，但默认静音、自动消失。
- **通知冷却**：默认 30 分钟。脚本按 `videoId + cid + 摘要签名` 写入 `$persistentStore`，同一视频同一批片段在冷却期内不会反复通知；把“通知冷却分钟=0”可关闭冷却限制。
- **失败开放**：汇总弹幕或通知逻辑异常时只写 debug 日志，不影响原始 B 站弹幕响应和空降弹幕注入。

## UI观测与原生卡片 Spike

这次没有直接猜测 B 站卡片字段，而是先加一个默认关闭的只读观测模式。开启“UI观测=1”后，脚本会在 Surge 日志输出 `[BSBSB:UI]` 摘要，范围包括：

- `DmView`：`special_dms`、`activity_meta`、`command.command_dms`、`post_panel`、`post_panel2`、`qoe` 字节长度。
- `ViewProgress`：`video_guide.contract_card`（ContractCard）、`dm.command_dms`、`dm.cards`（OperationCard）、`dm.attention`、Chronos md5/file 摘要。
- `iPad ViewProgress`：`video_guide` 字节长度与 Chronos 摘要。

这些字段来自 `bilibili-API-collect` 的 `dm.proto` / `viewunite.proto`，也是后续实现 B 站原生互动卡片显示的候选入口。当前版本只观测，不构造或注入 `CommandDm` / `ContractCard` / `OperationCard`，避免破坏播放页 UI。实测发现向 `DmView.command.command_dms` 本地插入构造的 `#ATTENTION#` 会导致客户端弹幕层不可用，因此已禁用该实验路径；后续原生卡片研究必须继续先只读抓样本。日志只输出紧凑摘要和截断文案，不 dump 整个 protobuf body。

## MITM 范围

模块只追加两个必要 hostname，分别用于 `DmSegMobile` 注入、`DmView` UI 观测和 `ViewProgress` Chronos 替换/UI 观测：

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
5. 如果只显示“空指部已就位”但不自动跳：
   - 确认模块已刷新到包含 `bilibili.bsbsb.chronos` 的版本。
   - 确认 Surge 的 HTTP Response 脚本命中了 `ViewProgress` 接口。
   - 重新打开视频，必要时重启 Bilibili App，让新的 Chronos 包重新下发。
6. 如果 Surge 日志出现 `SyntaxError: JSON Parse error: Unrecognized token '\\'`：
   - 说明模块里的 `argument` JSON 被反斜杠转义了，Surge 会把反斜杠原样传给 `$argument`，导致脚本在 `JSON.parse($argument)` 阶段就失败。
   - 删除旧模块后重新导入最新版；新版 `argument` 写法与 Sparkle 原模块一致，不再把 JSON 内部引号写成 `\\"`；脚本侧也兼容旧版反斜杠转义参数，避免本脚本继续报错。
7. 如果想临时测试开头汇总弹幕：
   - 手动把“开头汇总弹幕=1”；默认保持 0，因为额外汇总弹幕在部分客户端会让整层弹幕不可见。
   - 确认“汇总弹幕毫秒”已更新为默认 3000 或更晚；新版会按实际 `DmSegMobile` 的 `ps` / `pe` 播放窗口计算，不再固定出现在视频第 3 秒。
   - 从视频开头重新进入，汇总优先注入第一个弹幕分段；如果首段 bsbsb 查询超时，会在第一个成功拿到有效片段的分段补提示。
   - 确认当前视频确实有 bsbsb 片段数据；没有片段时不会生成汇总。
   - 如果开启后普通弹幕也不显示，立即关回“开头汇总弹幕=0”，这是当前已知的客户端兼容风险。
   - DEBUG 日志会输出 `[SponsorBlock] parsed` 和 `[SponsorBlock] inject`，可看 `rawCount` / `parsedCount` / `segmentIndex` / `includeSummary` / `summaryProgress` 判断是否真正注入。
   - 如果日志里的 `[SponsorBlock] HTTP request timeout` 仍然大约 3 秒就出现，或者成功请求后没有 `[SponsorBlock] parsed` / `[SponsorBlock] inject`，说明 Surge 仍在使用缓存的旧脚本；删除旧模块并重新导入带新版 cache-busting `script-path` 的模块。

## 可调参数建议

- **只要稳**：保持默认。
- **更激进跳过**：开启“片头片尾=1”。
- **想看高能点**：开启“高能点=1”。
- **想测试开头汇总**：手动把“开头汇总弹幕=1”；如果普通弹幕消失，立即关回 0。
- **想要系统弹窗**：把“系统通知=1”，必要时调整“通知冷却分钟”。
- **想抓原生卡片样本**：临时把“UI观测=1”并把“日志等级”调到 `3` 或更低，打开带互动卡片/关注引导/运营卡片的视频后查看 `[BSBSB:UI]` 日志；抓完建议关回 `0`。
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