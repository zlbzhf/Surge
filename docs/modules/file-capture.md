# 文件捕获 / AIA 文件捕获

这个 optional module 用来在 Surge 浏览流量时识别可下载文件，尤其是产品页里的图片、PDF、Office 文档、压缩包和媒体文件。它不进入主 `Surge.conf` 默认启用。

## 模块 URL

通用版：

```text
https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/file-capture.sgmodule
```

AIA 专用版：

```text
https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/aia-file-capture.sgmodule
```

脚本：

```text
https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/scripts/file-capture.js?v=20260602-file-capture-v2
```

## 适用场景

- 浏览网页或 App 时记录图片、PDF、Office、压缩包、音视频文件 URL。
- 把最近捕获结果放到 Surge 面板里查看。
- 通过导出面板复制 CSV 文本，继续做产品资料索引。
- 浏览 AIA 友邦页面时，把随机 PDF/图片 URL 尽量关联到产品名和资料类型。

## 安全边界

- 通用 `file-capture.sgmodule` 不追加 `[MITM] hostname`。
- 主捕获脚本使用 `requires-body=false,max-size=0`，只看 URL 和响应头，不读取图片/PDF/二进制 body。
- 脚本不修改 HTTP 响应；异常时失败开放，原响应继续返回。
- 记录里默认 `QUERY=redact`，会脱敏 `token`、`sign`、`key`、`session` 等查询参数。
- 记录有数量上限并按 URL/类型/大小去重。
- 不要把 MITM 改成 `hostname=*`。

## AIA 专用版

`aia-file-capture.sgmodule` 会追加窄域 MITM：

```ini
hostname = %APPEND% www.aia.com.cn, cws.aia.com.cn, nav.aia.com.cn
```

它做两件事：

1. **文件响应捕获**
   - 对 AIA 三个域的图片/PDF/Office/压缩包响应，只读取 URL 和响应头。
   - 如果近期已浏览产品页/API，会把文件关联到最近产品上下文。

2. **产品上下文捕获**
   - 只对 AIA 的非文件页面/API 读取最多 1MB 文本 body。
   - 用于识别产品名、产品代码、产品状态、产品组。
   - 如果 API 内出现公开披露资料字段，会自动补全官网 PDF URL。

支持的 AIA 资料字段：

- `productItem` → 产品条款
- `ratesTable` → 费率表
- `cashValueTable` → 现金价值全表
- `productInstruction` → 产品说明书/产品说明
- `followUpService` → 停售时间、停售原因及后续服务措施

## 面板

模块会添加两个面板：

- `文件捕获` / `AIA 文件捕获`：显示最近捕获和分类数量。
- `文件捕获导出` / `AIA 文件捕获导出`：输出 CSV 文本，字段包括：
  - `ts`
  - `productName`
  - `materialType`
  - `kind`
  - `filename`
  - `size`
  - `host`
  - `url`
  - `source`

## 参数

通用版主要参数：

- `保留数量`：默认 120，最多 800。
- `通知`：默认 0；设为 1 后捕获文件时发系统通知。
- `最小字节`：默认 0；可设为 10240 忽略小图标。
- `类型`：默认 `image|pdf|archive|video|audio|office|binary`。
- `查询参数`：默认 `redact`，也可用 `strip` 或 `keep`。

AIA 专用版额外参数：

- `上下文数量`：默认 60。
- `上下文通知`：默认 0。
- `抓取页面链接`：默认 1，从 AIA HTML/API 文本中提取显式文件链接。

## 非目标

- 不做文件下载器。
- 不保存 Cookie、请求头、账号信息或响应正文。
- 不解析 PDF/图片内容。
- 不绕过登录、权限或付费限制。
- 不进入主 `Surge.conf` 默认启用。
