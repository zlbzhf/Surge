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

参考：

- BiliUniverse/Enhanced

可用于：

- BiliBili App UI 调整
- 功能增强
- 广告/推荐位处理

建议：

- 不改变主配置的 BiliBili 分流逻辑。
- 国内 B 站主站仍优先 DIRECT。
- 增强模块仅在用户明确需要时启用。

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
  adblock-optional.md
  apple-irongo-optional.md
  bilibili-optional.md
  app-rewrite-optional.md
```

当前阶段先用文档记录原则，不直接托管高风险模块。

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
