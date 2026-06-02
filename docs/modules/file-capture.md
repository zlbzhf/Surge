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
https://raw.githubusercontent.com/zlbzhf/Surge/main/modules/scripts/file-capture.js
```

## 适用场景

- 浏览网页或 App 时记录图片、PDF、Office、压缩包、音视频文件 URL。
- 把最近捕获结果放到 Surge 面板里查看。
- 通过导出面板复制 CSV 文本，继续做产品资料索引。
- 可选：把新捕获文件发送到自建归档 webhook，由 VPS/电脑下载文件并按产品整理成目录。
- 如果产品页只是罗列“宣传彩页、产品条款、产品合同”等入口链接，AIA 专用版可把产品页提交给归档服务，由 VPS 抓取入口页并提取最终文件。
- 浏览 AIA 友邦页面时，把随机 PDF/图片 URL 尽量关联到产品名和资料类型。

## 安全边界

- 通用 `file-capture.sgmodule` 不追加 `[MITM] hostname`。
- 主捕获脚本使用 `requires-body=false,max-size=0`，只看 URL 和响应头，不读取图片/PDF/二进制 body。
- 脚本不修改 HTTP 响应；异常时失败开放，原响应继续返回。
- 记录里默认 `query=redact`，会脱敏 `token`、`sign`、`key`、`session` 等查询参数。
- 记录有数量上限并按 URL/类型/大小去重。
- 可选归档 webhook 只发送新捕获项的元数据；Surge 端仍不读取二进制 body。
- 归档服务下载文件时默认要求 token、建议 host allowlist，并阻止内网/回环地址，避免 SSRF。
- 不要把 MITM 改成 `hostname=*`。

## AIA 专用版

`aia-file-capture.sgmodule` 会追加窄域 MITM：

```ini
hostname = %APPEND% www.aia.com.cn, cws.aia.com.cn, nav.aia.com.cn, 01000001.h5.aia.com, mpaas-mgw-fin.cn-shanghai.aliyuncs.com, sop.aia.com.cn, nav-st.aia.com.cn, nav-uat.aia.com.cn
```

它做三件事：

1. **文件响应捕获**
   - 对 AIA 官网、导航器、App H5/静态域的图片/PDF/Office/压缩包响应，只读取 URL 和响应头。
   - 如果近期已浏览产品页/API，会把文件关联到最近产品上下文。

2. **产品上下文与产品页捕获**
   - 只对 AIA 的非文件页面/API 读取最多 1MB 文本 body。
   - 用于识别产品名、产品代码、产品状态、产品组。
   - 如果 API 内出现公开披露资料字段，会自动补全官网 PDF URL。
   - 如果页面内出现宣传彩页、产品条款、产品合同等入口链接，会把产品页 URL 提交给归档服务；服务端抓取该页及一层入口页，提取最终 PDF/图片/Office 文件并按资料类型归档。

3. **App H5 / mPaaS / SOP 诊断**
   - 监听 `01000001.h5.aia.com`、`mpaas-mgw-fin.cn-shanghai.aliyuncs.com`、`sop.aia.com.cn`，用于确认 App 内产品页和 API 入口。
   - mPaaS 钩子 `requires-body=false,max-size=0`，只记录脱敏 URL、`Operation-Type`、`x-mgs-encryption` 加密标记、Content-Type/大小，不读取或保存加密正文。
   - H5 钩子最多读取 1MB 文本页面用于标题/产品名识别；SOP 钩子从 URL 事件参数中提取标题、产品名和事件名。
   - SOP 点击事件会作为近实时上下文：如果“产品条款/说明书/彩页/一图”等点击事件比文件响应晚几十毫秒出现，脚本会把刚捕获的 PDF/Office 以及符合文档资料特征的大图反向补齐产品名和资料类型，并把脱敏后的 `appContext` / `sopContext` 随归档元数据发送给服务端。
   - AIA 响应捕获会在手机侧先做图片白名单：`/sps/sps_product_core/static/png/` 视为产品资料图片；带明确“一图/宣传彩页/彩页”等 SOP/页面标签的图片可保留；`/cms/file/images/` 这类无明确资料上下文的 CMS 大图、广告图、banner、活动图，以及明显 UI 图标/小图会直接跳过，避免 VPS 队列被噪声拖慢。
   - 诊断记录只保存在 Surge 本地面板/CSV，并通过系统通知提示；不会把 mPaaS/H5/SOP 诊断记录发送到归档 webhook。只有被 SOP 事件补齐后的非诊断文件元数据会重发给归档服务。

支持的 AIA 资料字段：

- `productItem` → 产品条款
- `ratesTable` → 费率表
- `cashValueTable` → 现金价值全表
- `productInstruction` → 产品说明书/产品说明
- `followUpService` → 停售时间、停售原因及后续服务措施

## 面板

模块会添加三个面板：

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
- `文件捕获清空` / `AIA 文件捕获清空`：默认只显示静态提示；手动点面板刷新按钮才会清空 Surge 本地捕获记录和上下文缓存，不删除 VPS 已归档文件。

## 归档 webhook：真正保存文件

如果只启用模块，Surge 本地保存的是索引，不保存 PDF/图片本体。要把文件整理成目录，运行仓库里的归档服务：

```bash
python3 tools/file-archive-server.py \
  --host 0.0.0.0 \
  --port 8765 \
  --root /data/surge-file-archive \
  --allowed-hosts www.aia.com.cn,nav.aia.com.cn \
  --token '换成强随机token'
```

通用版可在 Surge 模块参数编辑器里填写这两个字段。脚本 URL 是硬编码的外部脚本地址：

```text
archive_url = https://你的域名/archive
archive_token = 换成强随机token
```

AIA 专用版当前为联调测试版：不暴露任何可编辑参数，归档地址已固定为 `https://aia.zuiai.ggff.net/archive`，请求不附带 `archive_token`。

```text
安装模块即可，无需填写 token 参数。
```

归档服务默认异步处理：`POST /archive` 会先返回 `202 Accepted`、`job_id` 和 `/jobs/{job_id}`，后台再下载、去重、retag 和写索引；如果需要调试同步路径，可临时请求 `/archive?sync=1`。保存后的目录示例（文件名统一为 `<产品名>_<资料类型>_<短hash>.<扩展名>`，不使用序号）：

```text
/data/surge-file-archive/
  index.csv
  index.jsonl
  友邦某某保险/
    一图/
      友邦某某保险_一图_a1b2c3d4.jpg
    宣传彩页/
      友邦某某保险_宣传彩页_b2c3d4e5.pdf
    产品条款/
      友邦某某保险_产品条款_c3d4e5f6.pdf
    待确认图片资料/
      友邦某某保险_待确认图片资料_d4e5f6a7.jpg
    待确认PDF资料/
      友邦某某保险_待确认PDF资料_e5f6a7b8.pdf
    忽略小图标/
      友邦某某保险_忽略小图标_f6a7b8c9.png
```

归档服务会按 SHA256 去重；如果同一文件先被放进 `未关联产品/文件`，后续 SOP/产品页带来更明确的产品名和资料类型，会移动到更准确目录而不是复制一份。扩展名以 magic bytes / Content-Type 校正，不只信 URL 后缀。AIA 专用模块会优先在手机侧丢弃无明确资料上下文的 `/cms/file/images/` 广告图/banner；仍进入服务端的无明确标签大图才会进入 `待确认图片资料`，不强行归成 `一图` 或 `宣传彩页`。PDF 如安装了 `pdftotext`，服务端会读取前几页标题/正文信号，把误继承的“产品条款”纠正为 `费率表`、`产品说明书`、`营运规则` 等。

服务端环境变量也可配置：

- `FILE_ARCHIVE_ROOT`：归档根目录。
- `FILE_ARCHIVE_TOKEN`：Bearer token。
- `FILE_ARCHIVE_ALLOWED_HOST_SUFFIXES`：允许下载的域名后缀，逗号分隔。
- `FILE_ARCHIVE_MAX_BYTES`：单文件最大字节数，默认 80MB。
- `FILE_ARCHIVE_HOST` / `FILE_ARCHIVE_PORT`：监听地址和端口。
- `FILE_ARCHIVE_ASYNC`：默认 `1`，异步接收归档任务；设为 `0` 可回退同步处理。
- `FILE_ARCHIVE_QUEUE_SIZE`：后台任务队列上限，默认 1000。

建议通过 Nginx/Caddy 提供 HTTPS；不要长期裸奔暴露无 token 的归档服务。通用抓取可把 allowlist 扩大到需要的网站，AIA 抓取建议只允许 `www.aia.com.cn,nav.aia.com.cn,cws.aia.com.cn,01000001.h5.aia.com,nav-st.aia.com.cn,nav-uat.aia.com.cn`。mPaaS/SOP 诊断记录不需要服务端下载，因此不应加入归档服务 allowlist。

## 参数

通用版主要参数（Surge 参数表使用英文小写键名，模块头部为 `#!arguments=keep=120&...`）：

- `keep`：默认 120，最多 800。
- `notify`：默认 0；设为 1 后捕获文件时发系统通知。
- `min_bytes`：默认 0；可设为 10240 忽略小图标。
- `kinds`：默认 `image|pdf|archive|video|audio|office|binary`。
- `query`：默认 `redact`，也可用 `strip` 或 `keep`。
- `archive_url`：可选；填归档服务地址后，新文件元数据会 POST 到服务端下载保存。
- `archive_token`：可选；作为 Bearer token 发送。

AIA 专用版当前不暴露额外参数；固定使用安全默认值：`keep=200`、`keep_context=80`、`notify=1`、`notify_diag=1`、`context_notify=0`、`harvest_links=1`、`archive_page=1`、`query=redact`。

## 非目标

- Surge 模块本体不直接下载二进制文件；只有你配置归档 webhook 后，服务端才会下载。
- 不保存 Cookie、请求头、账号信息或响应正文。
- 不做 OCR，不绕过授权，也不保存 Cookie/账号信息。归档服务只读取文件头/magic bytes、图片尺寸，并在本机安装 `pdftotext` 时读取 PDF 前几页文本用于资料类型纠偏。
- 不绕过登录、权限或付费限制。
- 不进入主 `Surge.conf` 默认启用。
