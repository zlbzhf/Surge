# BilibiliSponsorBlock 空降助手（optional module）

这是一个给 Surge 5 使用的 **B 站小电视空降助手**模块。它参考 Sparkle 的 Bilibili protobuf 拦截方式，只保留 SponsorBlock/bsbsb 空降点注入能力，不混入 B 站去广告、皮肤、直播、搜索、评论区或账号相关改写。

- 模块：`modules/bilibili-bsbsb.sgmodule`
- 脚本：`modules/scripts/bilibili-bsbsb.airborne.js`
- Chronos 响应脚本：窄范围复用 `kokoryh/Sparkle` 的 `bilibili.protobuf.response.js`，只匹配 `ViewProgress` 用于自动跳能力
- 导入 URL：`https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule`

## 定位

- **不进主 Surge.conf**：它需要 MITM 和脚本，属于可选增强，不是公开主配置默认能力。
- **只处理空降助手**：拦截 Bilibili App 弹幕分段接口，查询 `bsbsb.top` 的片段数据，再注入可点击空降弹幕；同时窄范围拦截 `ViewProgress` 响应，把 Bilibili Chronos 指向 Sparkle 维护的可自动跳版本。
- **失败开放**：bsbsb API 失败、超时、Cloudflare 拦截或返回空数据时，保留原始 B 站响应，不影响播放。

## 默认行为

默认参数偏保守：

```text
类别 = sponsor|selfpromo|interaction
动作类型 = skip
片头片尾 = 0
高能点 = 0
开头汇总弹幕 = 1
汇总弹幕毫秒 = 800
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
- **开头汇总弹幕**默认开启：只在第一个弹幕分段开头（默认 800ms）插入一条普通、非点击的汇总弹幕，用来提示本视频将自动跳过几段、约多少时长以及是否有高能点。
- **系统通知**默认关闭：如需 Surge 系统弹窗，把“系统通知=1”；通知带“通知冷却”（默认 30 分钟），避免同一视频反复弹出。
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

- **开头汇总弹幕**：默认开启。脚本会在第一个 `DmSegMobile` 弹幕分段中追加一条普通顶部弹幕，默认 800ms 出现，例如“小电视空降：自动跳过 2 段 / 1 分 12 秒，高能点 1 个，类型：广告/高能”。这条弹幕 `action` 为空，不可点击，也不会使用 `空指部已就位`，因此不会干扰 Chronos 自动跳逻辑。
- **系统通知**：默认关闭。只有把模块参数“系统通知=1”后，脚本才会调用 Surge 的 `$notification.post` 发系统通知；通知内容与汇总弹幕一致，但默认静音、自动消失。
- **通知冷却**：默认 30 分钟。脚本按 `videoId + cid + 摘要签名` 写入 `$persistentStore`，同一视频同一批片段在冷却期内不会反复通知；把“通知冷却分钟=0”可关闭冷却限制。
- **失败开放**：汇总弹幕或通知逻辑异常时只写 debug 日志，不影响原始 B 站弹幕响应和空降弹幕注入。

## MITM 范围

模块只追加两个必要 hostname，分别用于 `DmSegMobile` 注入和 `ViewProgress` Chronos 替换：

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
6. 如果开头汇总弹幕不出现：
   - 确认“开头汇总弹幕=1”。
   - 从视频开头重新进入，汇总只注入第一个弹幕分段。
   - 确认当前视频确实有 bsbsb 片段数据；没有片段时不会生成汇总。

## 可调参数建议

- **只要稳**：保持默认。
- **更激进跳过**：开启“片头片尾=1”。
- **想看高能点**：开启“高能点=1”。
- **不想看到开头汇总**：把“开头汇总弹幕=0”。
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