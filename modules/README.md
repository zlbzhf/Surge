# Optional Modules

这个目录放不进入主 `Surge.conf` 的可选 Surge 模块。原则：主配置保持规则分流与低风险安全默认，MITM / Rewrite / Script 类能力按需单独导入。

## 当前模块

- `bilibili-bsbsb.sgmodule` — BilibiliSponsorBlock 空降助手；仅为 B 站 App 注入 bsbsb.top 空降点，不包含 B 站去广告或账号相关改写。
- `file-capture.sgmodule` — 通用文件捕获面板；默认不追加 MITM，只用响应 URL/headers 识别图片、PDF、Office、压缩包和媒体文件；可选接入归档 webhook 保存文件。
- `aia-file-capture.sgmodule` — AIA 友邦文件捕获；窄域 MITM `www.aia.com.cn, cws.aia.com.cn, nav.aia.com.cn`，把产品上下文和 PDF/图片资料关联起来，并可发给归档服务按产品整理。

## 使用方式

在 Surge 中导入 raw 模块 URL：

```text
https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/bilibili-bsbsb.sgmodule
https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/file-capture.sgmodule
https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/aia-file-capture.sgmodule
```

详细说明见：

- `docs/modules/bilibili-bsbsb.md`
- `docs/modules/file-capture.md`

## 安全边界

- optional module 不代表默认推荐所有人启用。
- 启用 MITM 前确认 hostname 范围和脚本来源。
- 不要把 Cookie、账号 token、支付/订单接口脚本放入公开主配置。
- 主配置 `Surge.conf` 不引用本目录模块，避免远程更新时强制启用高风险能力。

## License / attribution

`bilibili-bsbsb` 脚本派生自 `kokoryh/Sparkle`，数据/API 来自 `hanydd/BilibiliSponsorBlock` / `bsbsb.top`，按 `GPL-3.0-or-later` 标注。

`file-capture` / `aia-file-capture` 为本仓库原创脚本，按仓库默认许可发布。