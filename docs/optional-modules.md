# Optional Modules 原则

主配置默认保持低风险。所有需要 MITM、Rewrite、脚本、Cookie、登录态或大规模 App 去广告的能力，都应作为 optional modules，而不是直接进入 `Surge.conf`。

## 风险分级

### Low

通常是纯规则，不需要 MITM，不解密 HTTPS。

示例：

- 域名广告规则
- 恶意域名/钓鱼域名规则
- 简单分流规则

处理建议：

- 可以在主配置中注释保留。
- 默认不一定启用，移动端谨慎开启大规则。

### Medium

可能涉及 Rewrite 或特定 App 行为修改，但不处理敏感登录态。

示例：

- 某些 App 开屏广告去除
- 非敏感接口重写
- 简单脚本面板

处理建议：

- 不进入主配置默认启用。
- 单独放在 optional 文档或模块说明中。

### High

涉及 MITM、证书信任、Cookie、账号状态、登录接口、支付接口或大范围 hostname。

示例：

- Cookie 获取脚本
- 需要 MITM 的 App 解锁
- 大范围 `hostname = *`
- `skip-server-cert-verify = true`
- 账号权益类脚本

处理建议：

- 不放入主配置。
- 不默认启用。
- 必须明确风险和适用场景。

## 值得参考的项目类型

### Apple 高级功能

参考：

- VirgilClyne/iRingo

可用于：

- Apple Maps
- Apple News
- Apple TV
- Apple Weather
- Siri
- Apple Intelligence 相关体验

建议：

- 只作为 Apple 高级功能 optional。
- 不要默认集成到主配置。

### App 去广告与重写

参考：

- app2smile/rules
- Maasea/sgmodule
- chxm1023/Rewrite
- NobyDa/Script
- ddgksf2013/Scripts
- fmz200/wool_scripts

可用于：

- App 开屏广告
- 信息流广告
- 脚本面板
- App 功能增强

建议：

- 只做 optional。
- 每个模块单独说明 hostname、MITM、潜在副作用。

### BiliBili 增强

当前仓库托管：

- `modules/bilibili-bsbsb.sgmodule` — BilibiliSponsorBlock 空降助手。

参考：

- BiliUniverse/Enhanced
- kokoryh/Sparkle
- hanydd/BilibiliSponsorBlock / bsbsb.top

可用于：

- BiliBili App UI 调整
- 功能增强
- 广告/推荐位处理
- 空降助手/高能点提示

建议：

- 不改变主配置的 BiliBili 分流逻辑。
- 国内 B 站主站仍优先 DIRECT。
- 增强模块仅在用户明确需要时启用。
- BilibiliSponsorBlock 空降助手只做 bsbsb.top 片段注入，不混入去广告、直播、皮肤或账号相关改写。
- BilibiliSponsorBlock 模块 MITM 范围必须保持最小化：`grpc.biliapi.net, app.bilibili.com`。

### 文件捕获与资料索引

当前仓库托管：

- `modules/file-capture.sgmodule` — 通用文件捕获面板；默认不追加 MITM，不读取二进制 body。
- `modules/aia-file-capture.sgmodule` — AIA 友邦文件捕获；仅对 `www.aia.com.cn, cws.aia.com.cn, nav.aia.com.cn` 做窄域 MITM，用于关联产品名、图片和 PDF 资料。

可用于：

- 浏览网页或 App 时临时记录图片、PDF、Office、压缩包、媒体文件 URL。
- 通过 Surge 面板导出 CSV，继续整理产品资料索引。
- 对 AIA 产品页/API 做窄域上下文关联，补全公开披露资料 URL。

建议：

- 通用模块默认不附带 MITM hostname；只在需要的网站上单独开启。
- AIA 专用模块只保留 `www/cws/nav.aia.com.cn` 三个 hostname，不扩大到 `hostname=*`。
- 捕获脚本不保存 Cookie、请求头、账号信息或响应正文。

### 中文广告增强

参考：

- privacy-protection-tools/anti-AD

可用于：

- 中文广告域名增强
- DNS/Surge 广告拦截补充

建议：

- 可作为注释块或单独 profile。
- 不和多个大型 reject 列表同时默认启用。

## optional modules 仓库组织建议

未来可以新增：

```text
modules/
  README.md
  bilibili-bsbsb.sgmodule
  scripts/
    bilibili-bsbsb.airborne.js
  LICENSES/
    GPL-3.0.txt

docs/modules/
  bilibili-bsbsb.md
  bilibili-bsbsb-sparkle.patch
```

高风险模块可以托管，但必须单独文档化风险、hostname、脚本来源、协议和校验规则；不得进入主 `Surge.conf` 默认启用。

## 主配置禁止项

以下内容不应进入公开主配置：

- 明文订阅链接
- 代理节点密码、Snell PSK、账号密码
- MITM CA 文件或 passphrase
- 大范围 MITM hostname
- `skip-server-cert-verify = true`
- 默认开启 HTTP API 或外部控制器
- 默认监听 `0.0.0.0`
- 默认把 UDP 不支持回退到 DIRECT

这些项目可以作为个人私有配置的一部分，但不适合作为公开仓库默认配置。
