# BilibiliSponsorBlock 空降助手（Surge optional module）

这是一个给 Surge 5 使用的 **B 站小电视空降助手 / BilibiliSponsorBlock** 可选模块。它基于 `bsbsb.top` 的片段数据，在 Bilibili App 弹幕分段接口中注入“空降”提示，并通过 Sparkle 官方 Chronos response hook 恢复自动跳过能力。

当前稳定版的原则是：**只做 SponsorBlock 空降助手，不做 B 站综合净化模块**。

- 模块文件：`modules/bilibili-bsbsb.sgmodule`
- 本地脚本：`modules/scripts/bilibili-bsbsb.airborne.js`
- 导入 URL：`https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule`
- 自动跳脚本：使用 Sparkle 官方 `bilibili.protobuf.response.js`
- 许可证：本地脚本以 `GPL-3.0-or-later` 标注

## 1. 功能定位

本模块只处理 BilibiliSponsorBlock / 小电视空降助手相关能力：

- 查询 `bsbsb.top/api/skipSegments` 的空降片段数据。
- 在 `DmSegMobile` 弹幕分段中注入可点击空降弹幕。
- 对 `skip` 类型片段保留 Sparkle Chronos 可识别的精确文案：`空指部已就位`。
- 默认开启开头汇总弹幕，让进入视频后先看到本视频有哪些跳过片段或高能点。
- 自动跳使用 Sparkle 官方 `ViewProgress` response hook，不在本仓库脚本里自行重写 Chronos。

明确不做：

- 不进主 Surge.conf，它是 optional module。
- 不包含 B 站去广告、皮肤、直播、搜索、评论区、账号、Cookie、支付相关改写。
- 不匹配 `DM/DmView`，不启用本地 `DmView` 原生卡片实验。
- 不保留本地 `handleChronos` / `handleViewProgressReply` / UI 观测路径。
- 不向 bsbsb 提交投票、观看记录或用户身份。

## 2. 当前稳定方案

模块现在由两条脚本组成：

1. **`DmSegMobile` request hook**
   - 使用本仓库 `bilibili-bsbsb.airborne.js`。
   - 只处理弹幕分段请求。
   - 负责查询 bsbsb、注入普通空降弹幕、注入开头汇总弹幕。
   - 本地脚本已瘦身为 `DmSegMobile-only MVP`。

2. **`ViewProgress` response hook**
   - 使用 Sparkle 官方 `https://raw.githubusercontent.com/kokoryh/Sparkle/refs/heads/master/dist/bilibili.protobuf.response.js`。
   - 只用于 Chronos 自动跳。
   - 不使用本仓库脚本解析或重写 `ViewProgress`。

这个方案是目前现场验证后最稳的折中：本地只维护弹幕注入逻辑，自动跳沿用 Sparkle 已验证路径，避免重新引入 `DmView` 或本地 Chronos 改写导致弹幕层消失。

## 3. 默认参数

模块默认参数偏保守：

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
日志等级 = 3
```

参数说明：

- **类别**：默认 `sponsor|selfpromo|interaction`，即广告 / 自我推广 / 互动提醒。
- **动作类型**：默认 `skip`；开启高能点时脚本会自动追加 `poi`。
- **片头片尾**：默认 `0`，不会跳过 `intro|outro|padding|music_offtopic`；设为 `1` 后启用这些更激进类别。
- **高能点**：默认 `0`；设为 `1` 后启用 `poi_highlight`，用于手动空降，不参与自动跳。
- **开头汇总弹幕**：默认开启，在进入视频后显示本视频空降概览。
- **汇总弹幕毫秒**：默认 `3000`；汇总会优先按当前 `DmSegMobile` 请求中的实际播放窗口 `ps` / `pe` 计算，不再固定为视频第 3 秒。
- **系统通知**：默认关闭；设为 `1` 后有片段时发送 Surge 系统通知。
- **通知冷却分钟**：默认 `30`，防止同一视频同一批片段反复弹通知；设为 `0` 可关闭冷却。
- **最短片段秒数**：默认 `5`，过滤过短 skip 片段。
- **合并间隔秒数**：默认 `1.5`，合并相邻或重叠片段。
- **空降提前毫秒**：默认 `2000`；skip 弹幕在片段开始后显示，POI 高能点在目标前显示。
- **最大注入数**：默认 `12`，避免污染弹幕列表。
- **缓存分钟**：默认 `60`，缓存 bsbsb 查询结果；设为 `0` 可关闭缓存。
- **API策略**：`bsbsb.top` 的访问策略。`DIRECT` 不稳定时可改为 `Proxy` 或指定策略组。
- **日志等级**：`1 DEBUG`、`2 INFO`、`3 WARN`、`4 ERROR`、`5 OFF`。

## 4. 自动跳机制

自动跳依赖 Sparkle 的 Chronos 逻辑。模块会在 `ViewProgress` 响应上加载 Sparkle 官方脚本，然后 Chronos 识别弹幕中的特殊空降卡片。

自动跳识别的关键字段是：

```text
content = "空指部已就位"
action = "airborne:<目标毫秒>"
```

因此，`skip` 片段的普通空降弹幕必须保留精确文案：`空指部已就位`。

当前实现约定：

- `skip` 片段：`content` 固定为 `空指部已就位`，`action` 指向跳转目标毫秒。
- 分类信息：放入 `extra` JSON（例如 `category` / `categoryLabel` / `actionType` / `UUID`），不污染自动跳文案。
- `poi_highlight` 高能点：使用高能点提示文本，只做手动空降，避免被 Chronos 当作 skip 自动跳。
- 开头汇总弹幕：不使用 `空指部已就位` 文案，避免误触发自动跳。

## 5. 开头汇总弹幕

开头汇总弹幕默认开启。它的目标是让用户进入视频后先知道：

- 本视频是否包含广告 / 自我推广 / 互动提醒等 skip 片段。
- 大概有多少段、合计多长。
- 是否存在高能点，需要手动空降。

显示形式是多条小字号空降卡片，模拟分行效果，例如：

```text
空降助手提示
本视频含 1 段广告，1分14秒，将为您自动跳过
本视频含 2 个高能，可手动空降
```

实现细节：

- 汇总弹幕走与普通空降弹幕相同的可见路径：`action: airborne:<progress>`。
- 使用已验证可见的字段组合：`attr: 1310724`、数字型 `id/idStr`、`extra: ""`。
- 字号使用较小的 `25`，避免像普通空降弹幕一样占据过大视觉空间。
- 时间优先按 `DmSegMobile` 请求中的 `ps` / `pe` 播放窗口计算：`当前进入播放位置 + 汇总弹幕毫秒`。
- 如果请求没有播放窗口，回退为当前弹幕分段开头 + `3000ms`。
- 如果当前进入位置正好落在会自动跳过的片段内，汇总会顺延到跳过目标后约 1 秒，避免刚显示就被跳走。

如果个别客户端版本上汇总影响普通弹幕显示，可以临时把“开头汇总弹幕=0”。普通空降弹幕与 Sparkle 自动跳仍会保留。

## 6. 系统通知

系统通知默认关闭。把“系统通知=1”后，脚本会在发现空降 / 高能片段时通过 Surge `$notification.post` 发系统通知。

通知行为：

- 内容与汇总弹幕类似。
- 默认带 `通知冷却`，防止同一视频同一批片段反复弹出。
- 冷却 key 基于 `videoId + cid + 摘要签名`。
- 失败时只写 debug 日志，不影响播放和弹幕注入。

## 7. MITM 范围

模块只追加两个必要 hostname：

```ini
hostname = %APPEND% grpc.biliapi.net, app.bilibili.com
```

用途：

- `grpc.biliapi.net`：Bilibili App 常见 gRPC/protobuf 接口域名。
- `app.bilibili.com`：兼容部分入口下的同名接口。

不包含：

- `api.bilibili.com`
- `api.live.bilibili.com`
- `line3-h5-mobile-api.biligame.com`
- `hostname = *`

启用前需要在 Surge 中安装并信任 MITM 证书。由于涉及 HTTPS 解密，建议只在你自己的设备上启用。

## 8. 外部请求与隐私

脚本会向：

```text
https://bsbsb.top/api/skipSegments
```

发起查询，请求参数包括：

- `videoID`
- `cid`
- `categories`
- `actionTypes`

脚本不会：

- 调用投票接口。
- 提交观看记录。
- 使用 Bilibili 登录态。
- 请求或内置 bsbsb 用户 ID。
- 访问账号、Cookie、支付、直播或评论区接口。

为兼容 `bsbsb.top` 的 Cloudflare 防护，请求头会模拟浏览器扩展环境，包括：

- `origin: chrome-extension://eaoelafamejbnggahofapllmfhlhajdd`
- `x-ext-version`
- 浏览器式 `User-Agent`

如果 `DIRECT` 访问不稳定，可在模块参数中把 `API策略` 改为你的代理策略组。

## 9. 使用方式

1. 在 Surge 中导入模块：

   ```text
   https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule
   ```

2. 启用模块。
3. 开启 MITM，并确认设备已安装并信任 Surge 证书。
4. 保持默认参数先测试。
5. 杀掉 Bilibili App 后重新打开，进入一个有 bsbsb 数据的视频。

正常状态应看到：

- 有空降片段的视频会出现 `空指部已就位` 空降弹幕。
- 默认会出现“空降助手提示”开头汇总弹幕。
- skip 片段进入后会按 Sparkle Chronos 逻辑自动跳。
- 没有 bsbsb 数据的视频不应受影响。

## 10. 常见调参建议

- **普通用户**：保持默认即可。
- **想更激进跳过片头片尾**：把“片头片尾=1”。
- **想看高能点**：把“高能点=1”。
- **不想看到开头汇总**：把“开头汇总弹幕=0”。
- **想要系统弹窗**：把“系统通知=1”，必要时调整“通知冷却分钟”。
- **空降弹幕太多**：降低“最大注入数”或提高“最短片段秒数”。
- **bsbsb 查询频繁**：提高“缓存分钟”。
- **bsbsb.top 直连不稳定**：把“API策略”改为可访问 bsbsb.top 的代理策略。
- **排查问题**：把“日志等级”临时改为 `1`，看 Surge 脚本日志；排查完建议改回默认 `3`。

## 11. 故障排查

### 没有任何空降弹幕

检查：

- 当前视频是否确实有 bsbsb 数据。
- Surge 脚本是否命中 `DmSegMobile`。
- `bsbsb.top` 是否可访问；必要时把“API策略”改成代理策略。
- MITM 证书是否已安装并信任。
- 日志等级改为 `1` 后是否出现 `[SponsorBlock] parsed` / `[SponsorBlock] inject`。

### 有“空指部已就位”，但不自动跳

检查：

- 是否重新导入了最新版模块。
- `[Script]` 里是否存在 `bilibili.bsbsb.chronos`。
- `bilibili.bsbsb.chronos` 的 `script-path` 是否指向 `kokoryh/Sparkle/.../bilibili.protobuf.response.js`。
- `ViewProgress` response hook 是否命中。

### Surge 日志出现 JSON Parse error

如果出现类似：

```text
SyntaxError: JSON Parse error: Unrecognized token '\'
```

通常是旧模块的 `argument` JSON 被反斜杠转义，Surge 把反斜杠原样传给 `$argument`。处理方式：

1. 删除旧模块。
2. 重新导入最新版模块。
3. 确认 `argument` 写法不再使用 `\"` 转义内部引号。

脚本侧已经兼容旧版反斜杠参数，但模块文件仍应使用新版写法。

### 开头汇总弹幕没出现

检查：

- “开头汇总弹幕”是否为 `1`。
- 当前视频是否有可汇总的 bsbsb 片段。
- 首个弹幕分段的 bsbsb 查询是否超时；如果超时，脚本会在第一个成功分段补提示。
- 日志中 `includeSummary` / `summaryProgress` 是否符合预期。

### 开头汇总影响普通弹幕层

这是客户端兼容风险。处理方式：

- 临时把“开头汇总弹幕=0”。
- 保留普通空降弹幕和 Sparkle 自动跳。
- 如需继续排查，再打开 `日志等级=1` 提供相关日志。

### Surge 仍在使用旧脚本

表现可能包括：

- 超时仍约 3 秒。
- 成功请求后没有 `[SponsorBlock] parsed` / `[SponsorBlock] inject`。
- 日志中出现旧版已经删除的本地 `DmView` / `Chronos` 路径。

处理方式：

1. 删除旧模块。
2. 重新导入模块。
3. 确认脚本 URL 带当前 cache-busting 参数。
4. 杀掉 Bilibili App 后重新测试。

## 12. 失败开放策略

模块设计为失败开放：

- bsbsb API 失败、超时、Cloudflare 拦截或返回空数据时，保留原始 B 站响应。
- 弹幕解析或注入异常时，尽量不影响原始弹幕分段。
- 汇总弹幕或系统通知异常时，只写日志，不阻断播放。
- 没有片段数据的视频不改变体验。

## 13. 后续优化判断

当前已经验证能正常使用后，暂时不建议继续做大改。主要原因：

- 自动跳已经回到 Sparkle 官方已验证路径。
- 本地脚本已经瘦身到只处理 `DmSegMobile`，减少了误伤弹幕层的风险。
- `DmView` 原生卡片和本地 Chronos 改写此前都有明显兼容风险，不适合回到稳定模块。
- 进一步优化多半是体验微调，而不是实质稳定性提升。

如果未来要继续优化，建议只考虑低风险方向：

- 调整汇总弹幕文案和显示时机。
- 增加更清晰的 DEBUG 日志字段。
- 在单独实验模块中验证 `DmView` 原生卡片，不进入默认模块。
- 跟踪 Sparkle 官方脚本变更，必要时固定版本或同步 patch。

## 14. 来源与协议

- Protobuf 拦截与弹幕注入实现参考并派生自 `kokoryh/Sparkle`：GPL-3.0。
- 空降片段数据/API 来自 `hanydd/BilibiliSponsorBlock` / `bsbsb.top`：GPL-3.0。
- 本仓库中的 `modules/scripts/bilibili-bsbsb.airborne.js` 以 `GPL-3.0-or-later` 标注。
- 修改补丁保存在 `docs/modules/bilibili-bsbsb-sparkle.patch`，便于后续追踪与重建。

## 15. 风险等级

- 风险：Medium/High 之间。
- 原因：需要 MITM 和 WebView 脚本，但 hostname 范围很小，不碰账号、支付、Cookie、登录或广泛 REST API。
- 结论：适合作为 optional module，不适合作为主配置默认启用。
