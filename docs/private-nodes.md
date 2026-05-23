# 私有节点配置

本仓库的 `Surge.conf` 是公开、可自动更新的主配置。真实机场订阅、节点地址、密码、Snell PSK、token 等私有信息不应写进公开配置。

为避免每次同步 `https://raw.githubusercontent.com/zlbzhf/Surge/main/Surge.conf` 时覆盖你的节点，本项目把节点层独立成 Surge 外部策略文件：

```ini
✈️ 我的节点 = select, policy-path=proxies.txt, update-interval=0, no-alert=0, hidden=0, include-all-proxies=0
```

Surge 官方支持 `policy-path` 从本地文件或 URL 导入外部策略。`proxies.txt` 只在你的设备本地维护，更新远程 `Surge.conf` 不会覆盖它。

## 你需要做什么

### 方案 A：本地 `proxies.txt`，推荐给公开主配置

在 Surge 中准备一个名为：

```text
proxies.txt
```

的外部策略文件，里面放你的节点定义。格式和 `[Proxy]` 段里的节点定义一样，例如：

```ini
# 示例，勿照抄真实信息到公开仓库
香港 01 = ss, example.com, 8388, encrypt-method=aes-128-gcm, password=example
美国 01 = trojan, example.com, 443, password=example, sni=example.com
```

也可以使用你的机场提供的 Surge 节点订阅内容。如果订阅是完整 Surge profile，Surge 也可以把其中 `[Proxy]` 节点作为外部策略导入。

优点：

- `Surge.conf` 可以持续从 GitHub 更新。
- 私有节点不进入公开仓库。
- 不会再因为更新主配置而把 `✈️ 我的节点` 恢复成默认占位。

注意：

- `proxies.txt` 是你的私有文件，不提交到 GitHub。
- 如果你在多设备使用，需要自己通过 iCloud、Sub-Store、私有网盘或其他方式同步这个文件。

### 方案 B：Sub-Store 生成稳定节点源

如果你使用 Sub-Store，可以让 Sub-Store 输出 Surge 节点列表，然后用它作为节点治理层：

- 合并多个机场。
- 节点去重。
- 重命名地区。
- 标记家宽、原生、低倍率、Netflix、AIGC、TikTok 等能力。
- 输出稳定的 Surge 节点列表。

为了避免把 Sub-Store URL 写进公开仓库，建议让 Sub-Store 结果落到本地 `proxies.txt`，或使用你的私有配置/私有仓库保存 URL。

### 方案 C：私有 fork / 私有仓库

如果你强烈希望 `policy-path` 直接写 URL，可以在私有仓库或私有分支里维护一份个人配置：

```ini
✈️ 我的节点 = select, policy-path=https://your-private-subscription-url, ...
```

但不要把这个 URL 放进公开的 `zlbzhf/Surge` 主分支。

## 为什么不要直接编辑远程主配置

如果你直接导入：

```text
https://raw.githubusercontent.com/zlbzhf/Surge/main/Surge.conf
```

它就是一个远程托管配置。Surge 同步更新时会重新拉取整个文件，所以你在这个 profile 里手动改过的：

```ini
✈️ 我的节点 = select, policy-path=你的真实订阅地址, ...
```

会被远程版本覆盖。

正确做法是：

```text
主配置：公开、可更新、只放规则和策略框架
私有节点：本地 proxies.txt / Sub-Store / 私有仓库维护
```

## 导入地址

主配置仍然只使用：

```text
https://raw.githubusercontent.com/zlbzhf/Surge/main/Surge.conf
```

节点文件由你在本地维护，不通过公开仓库分发。
