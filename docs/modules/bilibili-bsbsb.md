# BilibiliSponsorBlock 空降助手（optional module）

这是一个给 Surge 5 使用的 **B 站小电视空降助手**模块。它参考 Sparkle 的 Bilibili protobuf 拦截方式，只保留 SponsorBlock/bsbsb 空降点注入能力，不混入 B 站去广告、皮肤、直播、搜索、评论区或账号相关改写。

- 模块：`modules/bilibili-bsbsb.sgmodule`
- 脚本：`modules/scripts/bilibili-bsbsb.airborne.js`
- 导入 URL：`https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule`

## 定位

- **不进主 Surge.conf**：它需要 MITM 和脚本，属于可选增强，不是公开主配置默认能力。
- **只处理空降助手**：拦截 Bilibili App 弹幕分段接口，查询 `bsbsb.top` 的片段数据，再注入可点击空降弹幕。
- **失败开放**：bsbsb API 失败、超时、Cloudflare 拦截或返回空数据时，保留原始 B 站响应，不影响播放。

## 默认行为

默认参数偏保守：

```text
类别 = sponsor|selfpromo|interaction
动作类型 = skip
片头片尾 = 0
高能点 = 0
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
- 片段太短会被过滤，相邻/重叠片段会被合并，避免弹幕列表被污染。

## MITM 范围

模块只追加两个必要 hostname：

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

## 可调参数建议

- **只要稳**：保持默认。
- **更激进跳过**：开启“片头片尾=1”。
- **想看高能点**：开启“高能点=1”。
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