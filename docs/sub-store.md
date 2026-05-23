# Sub-Store 与节点治理建议

Sub-Store 不是规则源，但对这个项目很重要。规则决定“什么流量走哪个策略组”，而 Sub-Store 解决“策略组里有哪些节点、节点名字是否规范、节点能力是否可识别”。

## 为什么需要节点治理

当前配置通过正则自动分组：

```ini
🇭🇰 香港节点 = smart, include-other-group=✈️ 我的节点, policy-regex-filter=(🇭🇰)|(香港)|(Hong)|(HK)
🇺🇸 美国节点 = smart, include-other-group=✈️ 我的节点, policy-regex-filter=(🇺🇸)|(美国)|(States)|(US)
```

如果订阅节点名称混乱，策略组会漏节点或误分组。Sub-Store 可以在进入 Surge 之前完成：

- 多机场合并
- 节点去重
- 节点重命名
- 地区标准化
- 倍率标记
- 家宽/原生/中转标签
- 故障或低质量节点过滤

## 推荐节点命名格式

建议使用稳定、可被正则识别的命名格式：

```text
🇭🇰 香港 01
🇭🇰 香港 低倍率 01
🇺🇸 美国 原生 01
🇺🇸 美国 家宽 01
🇺🇸 美国 Netflix 01
🇯🇵 日本 原生 01
🇸🇬 新加坡 01
🇹🇼 台湾 01
🇰🇷 韩国 01
```

如果机场名称包含英文，也建议统一到中文关键词，而不是直接保留各种混乱格式：

```text
US Residential LA 01  -> 🇺🇸 美国 家宽 LA 01
HK x0.2 01            -> 🇭🇰 香港 低倍率 01
JP Native 02          -> 🇯🇵 日本 原生 02
```

## 推荐能力标签

### 地区标签

```text
香港
美国
日本
新加坡
台湾
韩国
```

### 能力标签

```text
家宽
原生
低倍率
Netflix
Disney
TikTok
AIGC
PayPal
GitHub
```

这些标签可以让 Surge 策略组更有功能意义，而不是只按地区粗分。

## 可选策略组设计

如果后续节点命名稳定，可以增加更细的能力组：

```ini
🇺🇸 美国家宽 = smart, include-other-group=✈️ 我的节点, policy-regex-filter=(美国.*家宽|US.*Residential|Residential.*US)
🇺🇸 美国原生 = smart, include-other-group=✈️ 我的节点, policy-regex-filter=(美国.*原生|US.*Native|Native.*US)
🤖 AI 节点 = smart, include-other-group=✈️ 我的节点, policy-regex-filter=(AIGC|AI|OpenAI|Claude|Gemini)
🎵 TikTok 节点 = smart, include-other-group=✈️ 我的节点, policy-regex-filter=(TikTok|抖音国际|家宽)
📦 低倍率节点 = smart, include-other-group=✈️ 我的节点, policy-regex-filter=(低倍率|0\.1x|0\.2x|0\.5x)
```

## 服务策略建议

### AIGC

优先选择：

```text
AI 可用节点 / 家宽 / 原生 / 稳定美国或日本节点
```

避免频繁切换出口国家。

### TikTok

优先选择：

```text
目标地区家宽 / 原生节点
```

TikTok 对 IP 地区和 IP 质量比较敏感，不建议跟普通 Proxy 混用。

### Netflix / Disney+

优先选择：

```text
明确解锁对应内容库的节点
```

例如美区 Netflix 就固定美国解锁节点，日区就固定日本解锁节点。

### PayPal

优先选择：

```text
账号地区一致、长期稳定、不频繁变化的出口
```

PayPal 的重点不是速度，而是账号风控稳定性。

### Download

适合：

```text
低倍率节点 / DIRECT / 专用下载节点
```

## 不建议做的事

- 不要把所有节点都塞进一个 `Proxy` 组后手动猜。
- 不要频繁改 PayPal、Google、AIGC、TikTok 的出口地区。
- 不要让节点名称完全依赖机场原始格式。
- 不要在公开仓库提交真实订阅链接。

## 本项目建议

当前主配置暂时只保留通用地区组。等节点命名通过 Sub-Store 稳定后，再逐步加入能力策略组，例如：

```text
美国家宽
美国原生
AI 节点
TikTok 节点
低倍率节点
```

这样可以避免策略组先行膨胀，而节点实际无法匹配的问题。
