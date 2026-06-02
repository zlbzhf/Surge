// Surge File Capture v3
// Metadata-only file detector + optional AIA product context harvester + optional archive webhook.
// Safe defaults: capture hooks use requires-body=false/max-size=0, no response rewrite, bounded storage.

const STORE_KEY = 'surge.file_capture.items.v2';
const LEGACY_STORE_KEY = 'surge.file_capture.items.v1';
const CONTEXT_KEY = 'surge.file_capture.context.v1';
const DEFAULT_KEEP = 120;
const DEFAULT_KEEP_CONTEXT = 40;
const DEFAULT_CONTEXT_TTL_MIN = 45;

const SECRET_QUERY_KEYS = /(^|_|-|\.)(token|access_token|auth|authorization|session|sid|password|passwd|pwd|secret|key|api_key|apikey|signature|sign|x-crp-sign|ticket|code|openid|unionid)(_|-|\.|$)/i;
const FILE_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'svg', 'bmp', 'tiff', 'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key'];

const AIA_MATERIAL_FIELDS = [
  ['productItem', '产品条款'],
  ['ratesTable', '费率表'],
  ['cashValueTable', '现金价值全表'],
  ['productInstruction', '产品说明书/产品说明'],
  ['followUpService', '停售时间、停售原因及后续服务措施'],
];

const AIA_MATERIAL_PAGE_RE = /一图|一图读懂|一张图|图解|宣传彩页|彩页|产品条款|保险条款|产品合同|保险合同|合同样本|费率表|现金价值|产品说明书|产品说明|投保须知|公开披露|资料下载|相关资料/i;
const AIA_EXPLICIT_IMAGE_MATERIAL_RE = /一图|一图读懂|一张图|图解|宣传彩页|彩页|one\s*page|onepage|infographic|poster|brochure|leaflet|flyer|color\s*page|colorpage/i;

function parseArgs(input) {
  const out = {};
  String(input || '')
    .split('&')
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      const key = idx >= 0 ? pair.slice(0, idx) : pair;
      const val = idx >= 0 ? pair.slice(idx + 1) : '';
      try {
        out[decodeURIComponent(key).toLowerCase()] = decodeURIComponent(String(val).replace(/\+/g, ' '));
      } catch (_) {
        out[String(key).toLowerCase()] = val;
      }
    });
  return out;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return !!fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function asInt(value) {
  const n = Number(String(value || '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function lowerHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach((key) => {
    out[String(key).toLowerCase()] = headers[key];
  });
  return out;
}

function safeDecode(value) {
  const s = String(value || '');
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s;
  }
}

function safeUrl(url) {
  const raw = String(url || '');
  try {
    if (typeof URL !== 'undefined') {
      const u = new URL(raw);
      return { protocol: u.protocol, host: u.host, hostname: u.hostname, pathname: u.pathname || '/', search: u.search || '', href: u.href };
    }
  } catch (_) {}
  const match = raw.match(/^(https?:)\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!match) return null;
  const host = match[2];
  return { protocol: match[1], host, hostname: host.split(':')[0], pathname: match[3] || '/', search: match[4] || '', href: raw.split('#')[0] };
}

function rootDomain(host) {
  const h = String(host || '').split(':')[0].toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  if (['com.cn', 'net.cn', 'org.cn', 'gov.cn'].includes(last2) && parts.length >= 3) return parts.slice(-3).join('.');
  return last2;
}

function extFromPath(pathname) {
  const match = String(pathname || '').split('?')[0].match(/\.([a-z0-9]{1,12})$/i);
  return match ? match[1].toLowerCase() : '';
}

function filenameFromDisposition(value) {
  const cd = String(value || '');
  const star = cd.match(/filename\*=(?:UTF-8''|)([^;]+)/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  const raw = star ? star[1] : plain ? plain[1] : '';
  if (!raw) return '';
  return safeDecode(raw.trim().replace(/^"|"$/g, ''));
}

function extFromName(name) {
  const match = String(name || '').match(/\.([a-z0-9]{1,12})(?:$|[?#])/i);
  return match ? match[1].toLowerCase() : '';
}

function basenameFromUrl(url) {
  const u = safeUrl(url);
  if (!u) return '';
  const tail = safeDecode((u.pathname || '').split('/').pop() || '');
  return tail.slice(0, 180);
}

function classify(contentType, ext) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  const e = String(ext || '').toLowerCase();
  if (ct === 'application/pdf' || e === 'pdf') return 'pdf';
  if (ct.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'svg', 'bmp', 'tiff'].includes(e)) return 'image';
  if (ct.startsWith('video/') || ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'].includes(e)) return 'video';
  if (ct.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'].includes(e)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(e) || ['application/zip', 'application/x-7z-compressed', 'application/x-rar-compressed', 'application/gzip'].includes(ct)) return 'archive';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key'].includes(e) || ct.includes('officedocument') || ct.includes('msword') || ct.includes('ms-excel') || ct.includes('ms-powerpoint')) return 'office';
  if (ct === 'application/octet-stream' && e) return 'binary';
  return '';
}

function inferMaterialType(pathname, filename, url) {
  const text = safeDecode([pathname, filename, url].join(' ')).toLowerCase();
  if (/一图|一图读懂|一张图|图解|one\s*page|onepage|infographic/.test(text)) return '一图';
  if (text.indexOf('宣传彩页') >= 0 || text.indexOf('彩页') >= 0 || /brochure|leaflet|flyer|color\s*page|colorpage|poster/.test(text)) return '宣传彩页';
  if (text.indexOf('产品合同') >= 0 || text.indexOf('保险合同') >= 0 || text.indexOf('合同样本') >= 0) return '产品合同';
  if (/\/prem\//i.test(text) || text.indexOf('费率') >= 0 || text.indexOf('rate') >= 0) return '费率表';
  if (/\/csv\//i.test(text) || text.indexOf('现金价值') >= 0) return '现金价值全表';
  if (/\/brochure\//i.test(text) || text.indexOf('说明书') >= 0 || text.indexOf('brochure') >= 0) return '产品说明书/产品说明';
  if (text.indexOf('条款') >= 0 || text.indexOf('clause') >= 0 || text.indexOf('terms') >= 0) return '产品条款';
  if (text.indexOf('follow') >= 0 || text.indexOf('停售') >= 0) return '停售时间、停售原因及后续服务措施';
  return '';
}

function inferMaterialFromLabel(label, fallback) {
  const text = safeDecode(String(label || '')).replace(/\s+/g, ' ');
  if (/一图|一图读懂|一张图|图解/.test(text) || /one\s*page|onepage|infographic/i.test(text)) return '一图';
  if (/宣传彩页|彩页/.test(text) || /brochure|leaflet|flyer|color\s*page|colorpage|poster/i.test(text)) return '宣传彩页';
  if (/产品合同|保险合同|合同样本/.test(text)) return '产品合同';
  if (/产品条款|保险条款|条款/.test(text)) return '产品条款';
  if (/费率表|费率/.test(text)) return '费率表';
  if (/现金价值/.test(text)) return '现金价值全表';
  if (/产品说明书|产品说明|说明书/.test(text)) return '产品说明书/产品说明';
  if (/投保须知/.test(text)) return '投保须知';
  if (/停售|后续服务/.test(text)) return '停售时间、停售原因及后续服务措施';
  return fallback || '';
}

function inferMaterialFromSopEvent(eventName, title, detail) {
  const text = safeDecode([eventName || '', title || '', detail || ''].join(' ')).replace(/\s+/g, ' ');
  const byLabel = inferMaterialFromLabel(text, '');
  if (byLabel) return byLabel;
  if (/One\s*Page|OnePage|OnePicture|Infographic|PictureClick|ImageClick|GraphClick/i.test(text)) return '一图';
  if (/Terms?Click|Clause|PolicyTerm|TermDetail/i.test(text)) return '产品条款';
  if (/Brochure|Leaflet|ColorPage|Poster|Flyer/i.test(text)) return '宣传彩页';
  if (/Instruction|ProductIntro|Description/i.test(text)) return '产品说明书/产品说明';
  if (/Rate|Premium/i.test(text)) return '费率表';
  if (/CashValue|CSV/i.test(text)) return '现金价值全表';
  if (/Contract/i.test(text)) return '产品合同';
  return '';
}

function inferProductFromFilename(filename) {
  let name = safeDecode(String(filename || '')).replace(/\.[a-z0-9]{1,12}$/i, '');
  if (!name || /^[a-f0-9]{16,}$/i.test(name) || /^[0-9a-f-]{24,}$/i.test(name)) return '';
  name = name.replace(/^[A-Z0-9]{3,8}-\d+/i, '');
  name = name.replace(/(的)?(产品条款|条款|费率表|现金价值表全表|现金价值全表|现金价值表|产品说明书|产品说明|停售时间、停售原因及后续服务措施)$/g, '');
  name = name.replace(/[\s_-]+$/g, '').trim();
  return /保险|友邦|寿险|年金|重疾|医疗|意外|分红/.test(name) ? name.slice(0, 120) : '';
}

function sanitizeUrl(url, queryMode) {
  const raw = String(url || '').split('#')[0];
  const u = safeUrl(raw);
  if (!u) return raw.slice(0, 1000);
  const base = `${u.protocol}//${u.host}${u.pathname || '/'}`;
  const mode = String(queryMode || 'redact').toLowerCase();
  if (!u.search || mode === 'none' || mode === 'strip') return base;
  const query = u.search.replace(/^\?/, '');
  if (!query) return base;
  if (mode === 'keep') return raw.slice(0, 1500);
  const parts = query.split('&').slice(0, 20).map((part) => {
    const idx = part.indexOf('=');
    const key = idx >= 0 ? part.slice(0, idx) : part;
    const value = idx >= 0 ? part.slice(idx + 1) : '';
    const decodedKey = safeDecode(key);
    if (SECRET_QUERY_KEYS.test(decodedKey)) return `${key}=[REDACTED]`;
    return value.length > 160 ? `${key}=${value.slice(0, 80)}…` : part;
  });
  if (query.split('&').length > 20) parts.push('…');
  return `${base}?${parts.join('&')}`.slice(0, 1500);
}

const AIA_DIAGNOSTIC_SECRET_KEYS = /(^|_|-|\.)(token|access_token|auth|authorization|session|sid|password|passwd|pwd|secret|key|api_key|apikey|signature|sign|x-crp-sign|ticket|code|openid|unionid|cookie|set-cookie|h5token|uid|uuid|utdid|did|device|idfa|account|agent|customer|phone|mobile|trace|data)(_|-|\.|$)/i;

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/([?&#]|^)([^=&#?/]{1,60})=([^&#]*)/g, function (_, sep, key, val) {
      if (AIA_DIAGNOSTIC_SECRET_KEYS.test(safeDecode(key))) return `${sep}${key}=[REDACTED]`;
      return `${sep}${key}=${val.length > 160 ? val.slice(0, 80) + '…' : val}`;
    })
    .replace(/\b[0-9a-f]{32,}\b/gi, '[HEX_REDACTED]')
    .replace(/\b1[3-9]\d{9}\b/g, '[PHONE_REDACTED]')
    .slice(0, 1200);
}

function sanitizeDiagnosticUrl(url) {
  const raw = String(url || '');
  if (!raw) return '';
  const parts = raw.split('#');
  const base = redactDiagnosticText(sanitizeUrl(parts[0], 'redact'));
  if (parts.length < 2) return base;
  const hash = redactDiagnosticText(parts.slice(1).join('#')).slice(0, 500);
  return `${base}#${hash}`.slice(0, 1500);
}

function queryValue(rawUrl, name) {
  const u = safeUrl(rawUrl || '');
  const search = u && u.search ? u.search.replace(/^\?/, '') : '';
  if (!search) return '';
  const parts = search.split('&');
  for (let i = 0; i < parts.length; i += 1) {
    const idx = parts[i].indexOf('=');
    const key = idx >= 0 ? parts[i].slice(0, idx) : parts[i];
    if (safeDecode(key) === name) return idx >= 0 ? safeDecode(parts[i].slice(idx + 1)) : '';
  }
  return '';
}

function safeBase64Decode(value) {
  let s = String(value || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
  } catch (_) {}
  try {
    if (typeof atob === 'function') {
      const binary = atob(s);
      try {
        let escaped = '';
        for (let i = 0; i < binary.length; i += 1) escaped += `%${(`00${binary.charCodeAt(i).toString(16)}`).slice(-2)}`;
        return decodeURIComponent(escaped);
      } catch (_) {
        return binary;
      }
    }
  } catch (_) {}
  return '';
}

function parseSopTelemetry(rawUrl) {
  const data = queryValue(rawUrl, 'data');
  if (!data) return null;
  const decoded = safeDecode(safeBase64Decode(data));
  if (!decoded || decoded.charAt(0) !== '{') return null;
  try {
    const payload = JSON.parse(decoded);
    return {
      title: objectString(payload, ['title']),
      eventName: objectString(payload, ['event_name', 'old_event_log_value']),
      description: objectString(payload, ['old_event_log_description', 'sourcePage', 'subApplicationName']),
      pageUrl: objectString(payload, ['url']),
      policyListName: objectString(payload, ['policyListName']),
      clauseName: objectString(payload, ['clauseName', 'policyClauseName', 'materialName', 'materialType', 'name']),
      productName: objectString(payload, ['policyListName', 'productName', 'productCName', 'productFullName']),
      platformType: objectString(payload, ['platformType']),
    };
  } catch (_) {
    return null;
  }
}

function buildDiagnosticItem(options) {
  const opts = options || {};
  const u = safeUrl(opts.url || opts.sourceUrl || '');
  const item = {
    ts: nowIso(),
    kind: 'diagnostic',
    filename: String(opts.filename || 'AIA 诊断').slice(0, 220),
    ext: 'diag',
    materialType: opts.materialType || '诊断',
    productName: opts.productName || '',
    productCode: opts.productCode || '',
    size: asInt(opts.size),
    contentType: String(opts.contentType || '').split(';')[0].slice(0, 80),
    status: opts.status || 0,
    host: opts.host || (u ? u.host : ''),
    url: sanitizeDiagnosticUrl(opts.url || opts.sourceUrl || ''),
    source: opts.source || 'aia-diagnostic',
    pageTitle: opts.pageTitle || '',
  };
  if (opts.operationType) item.operationType = String(opts.operationType).slice(0, 220);
  if (opts.encrypted !== undefined && opts.encrypted !== null && String(opts.encrypted) !== '') item.encrypted = String(opts.encrypted).slice(0, 20);
  if (opts.eventName) item.eventName = String(opts.eventName).slice(0, 180);
  if (opts.detail) item.detail = redactDiagnosticText(opts.detail).slice(0, 500);
  return item;
}

function readJsonKey(key, fallback) {
  try {
    const value = $persistentStore.read(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonKey(key, value) {
  return $persistentStore.write(JSON.stringify(value), key);
}

function readItems() {
  const current = readJsonKey(STORE_KEY, null);
  if (current) return current;
  return readJsonKey(LEGACY_STORE_KEY, []);
}

function writeItems(items) {
  return writeJsonKey(STORE_KEY, items);
}

function readContexts() {
  return readJsonKey(CONTEXT_KEY, []);
}

function writeContexts(items) {
  return writeJsonKey(CONTEXT_KEY, items);
}

function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function nowIso() {
  return new Date().toISOString();
}

function csvEscape(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fingerprint(item) {
  return [item.kind, item.size || '', item.contentType || '', item.url || '', item.productName || '', item.materialType || '', item.source || '', item.operationType || '', item.eventName || '', item.encrypted || ''].join('|');
}

function upsertItems(newItems, keep) {
  const incoming = Array.isArray(newItems) ? newItems : [newItems];
  const items = readItems();
  const fp = {};
  const merged = [];
  incoming.concat(items).forEach((item) => {
    const key = fingerprint(item);
    if (!key || fp[key]) return;
    fp[key] = true;
    merged.push(item);
  });
  writeItems(merged.slice(0, keep));
  return merged.slice(0, keep);
}

function filterNewItems(newItems) {
  const incoming = (Array.isArray(newItems) ? newItems : [newItems]).filter(Boolean);
  if (!incoming.length) return [];
  const seen = {};
  readItems().forEach((item) => {
    const key = fingerprint(item);
    if (key) seen[key] = true;
  });
  const out = [];
  incoming.forEach((item) => {
    const key = fingerprint(item);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(item);
  });
  return out;
}

function archiveEndpoint(args) {
  const url = String(args.archive_url || args.archive_webhook || args.webhook || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function compactArchiveContext(ctx) {
  if (!ctx) return null;
  const out = {};
  ['ts', 'productName', 'productCode', 'materialType', 'title', 'eventName', 'policyListName', 'clauseName', 'source', 'host', 'root'].forEach((key) => {
    if (ctx[key] !== undefined && ctx[key] !== null && String(ctx[key]) !== '') out[key] = String(ctx[key]).slice(0, 220);
  });
  if (ctx.sourceUrl) out.sourceUrl = sanitizeDiagnosticUrl(ctx.sourceUrl);
  if (ctx.pageUrl) out.pageUrl = sanitizeDiagnosticUrl(ctx.pageUrl);
  return Object.keys(out).length ? out : null;
}

function archivePayloadItem(item) {
  const out = {};
  ['ts', 'kind', 'filename', 'ext', 'materialType', 'productName', 'productCode', 'size', 'contentType', 'status', 'host', 'url', 'downloadUrl', 'source', 'sourceUrl', 'pageTitle'].forEach((key) => {
    if (item && item[key] !== undefined && item[key] !== null && String(item[key]) !== '') out[key] = item[key];
  });
  const appContext = compactArchiveContext(item && item.appContext);
  const sopContext = compactArchiveContext(item && item.sopContext);
  const context = compactArchiveContext(item && item.context);
  if (appContext) out.appContext = appContext;
  if (sopContext) out.sopContext = sopContext;
  if (context) out.context = context;
  return out;
}

function finishAfterArchive(items, args, event, doneValue) {
  const endpoint = archiveEndpoint(args || {});
  const archiveItems = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!endpoint || !archiveItems.length || typeof $httpClient === 'undefined') {
    $done(doneValue || {});
    return;
  }
  const token = String((args || {}).archive_token || (args || {}).archive_key || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = JSON.stringify({
    schema: 'surge-file-capture.archive.v1',
    event: event || 'capture',
    sentAt: nowIso(),
    items: archiveItems.map(archivePayloadItem),
  });
  $httpClient.post({ url: endpoint, headers, body, timeout: 5 }, function (error, response) {
    if (error) console.log(`[File Capture] archive webhook failed: ${error}`);
    else if (response && response.status && response.status >= 400) console.log(`[File Capture] archive webhook HTTP ${response.status}`);
    $done(doneValue || {});
  });
}

function rememberContexts(contexts, keep) {
  const incoming = (Array.isArray(contexts) ? contexts : [contexts]).filter((ctx) => ctx && (ctx.productName || ctx.title || ctx.productCode));
  if (!incoming.length) return readContexts();
  const all = incoming.concat(readContexts());
  const seen = {};
  const merged = [];
  all.forEach((ctx) => {
    const key = [ctx.productName || '', ctx.productCode || '', ctx.title || '', ctx.sourceUrl || ''].join('|');
    if (seen[key]) return;
    seen[key] = true;
    merged.push(ctx);
  });
  writeContexts(merged.slice(0, keep));
  return merged.slice(0, keep);
}

function attachContext(item, ttlMinutes) {
  const contexts = readContexts();
  if (!contexts.length) return item;
  const now = Date.now();
  const itemText = safeDecode([item.filename, item.url].join(' '));
  const itemRoot = rootDomain(item.host || '');
  let best = null;
  let bestScore = 0;
  contexts.forEach((ctx, index) => {
    const ts = Date.parse(ctx.ts || '') || 0;
    if (ts && now - ts > ttlMinutes * 60 * 1000) return;
    let score = 0;
    if (ctx.host && item.host && ctx.host === item.host) score += 4;
    if (ctx.root && itemRoot && ctx.root === itemRoot) score += 2;
    if (ctx.productName && itemText.indexOf(ctx.productName) >= 0) score += 20;
    if (ctx.productCode && itemText.indexOf(ctx.productCode) >= 0) score += 15;
    score += Math.max(0, 3 - index * 0.05);
    if (score > bestScore) {
      bestScore = score;
      best = ctx;
    }
  });
  if (!best || bestScore < 2.5) return item;
  if (!item.productName && best.productName) item.productName = best.productName;
  if (!item.productCode && best.productCode) item.productCode = best.productCode;
  if (!item.materialType && best.materialType) item.materialType = best.materialType;
  if (!item.pageTitle && best.title) item.pageTitle = best.title;
  if (!item.sourceUrl && best.sourceUrl) item.sourceUrl = best.sourceUrl;
  const archiveContext = compactArchiveContext(best);
  if (archiveContext) {
    item.appContext = archiveContext;
    if (/sop/i.test(String(best.source || ''))) item.sopContext = archiveContext;
  }
  return item;
}

function isRetaggableImage(item, ctx) {
  const material = String((ctx && ctx.materialType) || '');
  if (!material) return false;
  const text = safeDecode([item && item.filename, item && item.url, item && item.sourceUrl, material, ctx && ctx.eventName, ctx && ctx.title].join(' '));
  if (AIA_EXPLICIT_IMAGE_MATERIAL_RE.test(text)) return asInt(item && item.size) >= 80 * 1024;
  if (/产品条款|保险条款|产品合同|保险合同|合同样本/.test(material)) return asInt(item && item.size) >= 300 * 1024;
  return false;
}

function retagRecentFilesFromContext(ctx, options) {
  const opts = options || {};
  if (!ctx || !ctx.materialType) return [];
  const keep = Math.max(1, Math.min(800, asInt(opts.keep) || DEFAULT_KEEP));
  const ttlMs = Math.max(1, asInt(opts.seconds) || 20) * 1000;
  const ctxRoot = ctx.root || rootDomain(ctx.host || '');
  const now = Date.now();
  const changed = [];
  const items = readItems().map((item) => {
    if (!item || item.kind === 'diagnostic' || item.kind === 'page') return item;
    if (!['pdf', 'office', 'archive', 'binary'].includes(item.kind) && !(item.kind === 'image' && isRetaggableImage(item, ctx))) return item;
    const ts = Date.parse(item.ts || '') || 0;
    if (ts && Math.abs(now - ts) > ttlMs) return item;
    const itemRoot = rootDomain(item.host || '');
    if (ctxRoot && itemRoot && ctxRoot !== itemRoot) return item;

    let next = item;
    function clone() {
      if (next === item) next = Object.assign({}, item);
    }
    if (!next.productName && ctx.productName) {
      clone();
      next.productName = ctx.productName;
    }
    if (!next.materialType && ctx.materialType) {
      clone();
      next.materialType = ctx.materialType;
    }
    if (!next.pageTitle && ctx.title) {
      clone();
      next.pageTitle = ctx.title;
    }
    if (!next.sourceUrl && ctx.sourceUrl) {
      clone();
      next.sourceUrl = ctx.sourceUrl;
    }
    if (ctx) {
      const archiveContext = compactArchiveContext(ctx);
      if (archiveContext) {
        clone();
        next.appContext = archiveContext;
        if (/sop/i.test(String(ctx.source || ''))) next.sopContext = archiveContext;
      }
    }
    if (next !== item) changed.push(Object.assign({}, next, { downloadUrl: next.downloadUrl || next.url }));
    return next;
  });
  if (changed.length) writeItems(items.slice(0, keep));
  return changed;
}

function buildFileItem(rawUrl, options) {
  const opts = options || {};
  const u = safeUrl(rawUrl);
  const headers = lowerHeaders(opts.headers || {});
  const cdName = filenameFromDisposition(headers['content-disposition']);
  const urlExt = u ? extFromPath(u.pathname) : extFromName(rawUrl);
  const nameExt = extFromName(cdName);
  const ext = (opts.ext || nameExt || urlExt || '').toLowerCase();
  const contentType = opts.contentType || headers['content-type'] || '';
  const size = asInt(opts.size || headers['content-length']);
  const kind = opts.kind || classify(contentType, ext);
  if (!kind) return null;
  const filename = opts.filename || cdName || basenameFromUrl(rawUrl) || `${kind}.${ext || 'bin'}`;
  const materialType = opts.materialType || inferMaterialType(u ? u.pathname : '', filename, rawUrl);
  const item = {
    ts: nowIso(),
    kind,
    filename,
    ext,
    materialType,
    productName: opts.productName || inferProductFromFilename(filename),
    productCode: opts.productCode || '',
    size,
    contentType: String(contentType).split(';')[0],
    status: opts.status || 0,
    host: u ? u.host : '',
    url: sanitizeUrl(rawUrl, opts.queryMode || 'redact'),
    source: opts.source || 'response',
  };
  if (opts.sourceUrl) item.sourceUrl = sanitizeUrl(opts.sourceUrl, opts.queryMode || 'redact');
  if (opts.pageTitle) item.pageTitle = opts.pageTitle;
  return item;
}

function itemUrlParts(item) {
  const raw = String((item && (item.downloadUrl || item.url || item.sourceUrl)) || '');
  const u = safeUrl(raw);
  let host = u ? u.hostname : String((item && item.host) || '').split(':')[0];
  let pathname = u ? u.pathname : '';
  if (!pathname && raw) {
    const match = raw.match(/^https?:\/\/[^/?#]+([^?#]*)/i);
    if (match) pathname = match[1] || '/';
  }
  return { host: String(host || '').toLowerCase(), pathname: safeDecode(pathname || '').toLowerCase() };
}

function isAiaHostName(host) {
  const h = String(host || '').split(':')[0].toLowerCase();
  return /(^|\.)aia\.com\.cn$/i.test(h) || h === '01000001.h5.aia.com' || /(^|\.)h5\.aia\.com$/i.test(h);
}

function imageContextText(item) {
  const parts = [item && item.filename, item && item.url, item && item.sourceUrl, item && item.materialType, item && item.pageTitle];
  ['appContext', 'sopContext', 'context'].forEach((key) => {
    const ctx = item && item[key];
    if (!ctx) return;
    parts.push(ctx.materialType, ctx.clauseName, ctx.eventName, ctx.title, ctx.policyListName, ctx.productName);
  });
  return safeDecode(parts.filter(Boolean).join(' '));
}

function hasExplicitImageMaterialContext(item) {
  return Boolean(item && item.kind === 'image' && AIA_EXPLICIT_IMAGE_MATERIAL_RE.test(imageContextText(item)));
}

function isAiaProductMaterialImagePath(item) {
  const parts = itemUrlParts(item);
  return isAiaHostName(parts.host) && /\/sps\/sps_product_core\/static\/png\//i.test(parts.pathname);
}

function isAiaGenericCmsImagePath(item) {
  const parts = itemUrlParts(item);
  return isAiaHostName(parts.host) && /\/cms\/file\/images\//i.test(parts.pathname);
}

function hasStrongImageMaterialContext(item) {
  if (!item || item.kind !== 'image') return false;
  return isAiaProductMaterialImagePath(item) || hasExplicitImageMaterialContext(item);
}

function isLikelyUiImage(item) {
  if (!item || item.kind !== 'image') return false;
  if (isAiaProductMaterialImagePath(item)) return false;
  const name = safeDecode(String(item.filename || '')).toLowerCase();
  const url = safeDecode(String(item.url || '')).toLowerCase();
  const text = `${name} ${url}`;
  if (/\.(svg|gif)$/i.test(name)) return true;
  if (/^(default|placeholder|loading|avatar|user|man|woman|male|female)[-_a-z0-9]*\.(?:png|jpe?g|webp)$/i.test(name)) return true;
  if (/^\d{4,8}(?:_\d{1,6})?\.png$/i.test(name)) return true;
  if (/(^|[\/_-])(banner|banners|ad|ads|advert|activity|campaign|promo|promotion|kv|swiper|carousel|hero|icon|icons|logo|logos|sprite|sprites|avatar|avatars|thumb|thumbnail|btn|button|tab|menu|close|arrow|back|home|search|share|wechat|weixin)([\/_\.-]|$)/i.test(text)) return true;
  if (isAiaGenericCmsImagePath(item) && !hasExplicitImageMaterialContext(item)) return true;
  return false;
}

function shouldSkipCaptureItem(item, minBytes) {
  if (!item) return true;
  if (item.kind !== 'image') return false;
  const strong = hasStrongImageMaterialContext(item);
  if (isLikelyUiImage(item)) return true;
  if (isAiaHostName(itemUrlParts(item).host) && !strong) return true;
  if (!strong && minBytes && item.size && item.size < minBytes) return true;
  return false;
}

function capture() {
  const args = parseArgs(typeof $argument === 'string' ? $argument : '');
  const keep = Math.max(1, Math.min(800, asInt(args.keep) || DEFAULT_KEEP));
  const minBytes = asInt(args.min_bytes);
  const notify = toBool(args.notify, false);
  const queryMode = args.query || 'redact';
  const ttl = Math.max(1, asInt(args.context_ttl) || DEFAULT_CONTEXT_TTL_MIN);
  const allowed = new Set(String(args.kinds || 'image|pdf|archive|video|audio|office|binary').split(/[|,]/).map((x) => x.trim()).filter(Boolean));
  const req = typeof $request !== 'undefined' ? $request : {};
  const res = typeof $response !== 'undefined' ? $response : {};
  const item = buildFileItem(req.url || '', { headers: res.headers || {}, status: res.status || 0, source: 'response', queryMode });
  if (!item || !allowed.has(item.kind)) {
    $done({});
    return;
  }
  attachContext(item, ttl);
  if (shouldSkipCaptureItem(item, minBytes)) {
    $done({});
    return;
  }
  const newItems = filterNewItems(item).map((entry) => Object.assign({}, entry, { downloadUrl: req.url || entry.url }));
  upsertItems(item, keep);
  if (notify) {
    const title = item.productName ? `捕获：${item.productName}` : 'Surge 捕获文件';
    const sub = `${item.materialType || item.kind.toUpperCase()} · ${fmtBytes(item.size)}`;
    $notification.post(title, sub, `${item.filename}\n${item.host}`, { url: req.url || item.url });
  }
  finishAfterArchive(newItems, args, 'response', {});
}

function objectString(obj, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (obj && obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) return String(obj[key]).trim();
  }
  return '';
}

function isLikelyProductName(value) {
  return /保险|寿险|年金|重疾|医疗|意外|分红|友邦/.test(String(value || ''));
}

function encodeMaterialStem(stem) {
  return String(stem || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function aiaMaterialUrl(stem) {
  return `https://www.aia.com.cn/content/dam/cn/zh-cn/docs/public-disclosure/${encodeMaterialStem(stem)}.pdf`;
}

function extractContextsFromJson(value, base) {
  const contexts = [];
  const embeddedItems = [];
  const queue = [value];
  let inspected = 0;
  while (queue.length && inspected < 600) {
    inspected += 1;
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      node.slice(0, 200).forEach((x) => queue.push(x));
      continue;
    }
    const productName = objectString(node, ['productName', 'productCName', 'productFullName', 'productTitle', 'prodName', 'prdName', 'planName', 'insuranceName']);
    const looseName = objectString(node, ['title', 'name']);
    const name = productName || (isLikelyProductName(looseName) ? looseName : '');
    const productCode = objectString(node, ['productCode', 'prodCode', 'prdCode', 'planCode', 'productId', 'code']);
    if (name || productCode) {
      contexts.push({
        ts: nowIso(),
        productName: name,
        productCode,
        productStatus: objectString(node, ['productStatus', 'status']),
        productGroup: objectString(node, ['productGroup', 'group']),
        title: base.title || name,
        host: base.host,
        root: base.root,
        sourceUrl: base.sourceUrl,
        source: 'json-context',
      });
    }
    AIA_MATERIAL_FIELDS.forEach((pair) => {
      const field = pair[0];
      const label = pair[1];
      const stem = objectString(node, [field]);
      if (!stem) return;
      const item = buildFileItem(aiaMaterialUrl(stem), {
        kind: 'pdf',
        ext: 'pdf',
        materialType: label,
        productName: name,
        productCode,
        source: 'aia-api',
        sourceUrl: base.sourceUrl,
        pageTitle: base.title,
        queryMode: 'redact',
      });
      if (item) embeddedItems.push(item);
    });
    Object.keys(node).slice(0, 120).forEach((key) => {
      const child = node[key];
      if (child && typeof child === 'object') queue.push(child);
    });
  }
  return { contexts, embeddedItems };
}

function htmlTitle(body) {
  const html = String(body || '');
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const title = og ? og[1] : (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
  return safeDecode(title).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function stripHtmlText(value) {
  return safeDecode(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim());
}

function likelyMaterialPage(body, title) {
  return AIA_MATERIAL_PAGE_RE.test([title || '', String(body || '').slice(0, 200000)].join(' '));
}

function inferProductNameFromText(body, title) {
  const candidates = [];
  if (title) candidates.push(String(title).replace(/\s*[-_|].*$/g, ''));
  const plain = stripHtmlText(body).slice(0, 30000);
  const re = /[\u4e00-\u9fffA-Za-z0-9（）()·\-]{2,80}(?:保险|寿险|年金|重疾|医疗|意外|分红)[\u4e00-\u9fffA-Za-z0-9（）()·\-]{0,40}/g;
  let m;
  while ((m = re.exec(plain)) && candidates.length < 12) candidates.push(m[0]);
  for (let i = 0; i < candidates.length; i += 1) {
    const value = candidates[i].replace(/^(产品名称|名称)[:：]/, '').replace(/(宣传彩页|产品条款|产品合同|费率表|现金价值).*$/g, '').trim();
    if (isLikelyProductName(value)) return value.slice(0, 120);
  }
  return '';
}

function extractEmbeddedLinks(body, baseUrl, baseContext) {
  const out = [];
  const text = String(body || '');
  const extPattern = FILE_EXTS.join('|');
  const absolute = new RegExp(`https?:\\/\\/[^\\s"'<>\\)]+\\.(?:${extPattern})(?:\\?[^\\s"'<>\\)]*)?`, 'ig');
  const attr = new RegExp(`(?:href|src|data-src|url)=["']([^"']+\\.(?:${extPattern})(?:\\?[^"']*)?)["']`, 'ig');
  const anchor = new RegExp(`<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>`, 'ig');
  let m;
  const seen = {};
  function add(link, label) {
    const resolved = resolveUrl(link, baseUrl);
    if (!resolved || seen[resolved]) return;
    seen[resolved] = true;
    const materialType = inferMaterialFromLabel(label, '');
    const item = buildFileItem(resolved, {
      source: 'embedded',
      sourceUrl: baseUrl,
      productName: baseContext.productName || '',
      productCode: baseContext.productCode || '',
      materialType,
      pageTitle: baseContext.title || '',
      queryMode: 'redact',
    });
    if (item) out.push(item);
  }
  while ((m = anchor.exec(text)) && out.length < 300) add(m[1], stripHtmlText(m[2]));
  while ((m = absolute.exec(text)) && out.length < 400) add(m[0], '');
  while ((m = attr.exec(text)) && out.length < 500) add(m[1], '');
  return out;
}

function buildPageCrawlItem(pageUrl, baseContext) {
  const u = safeUrl(pageUrl || '');
  if (!u) return null;
  const productName = baseContext.productName || (isLikelyProductName(baseContext.title) ? baseContext.title.replace(/\s*[-_|].*$/g, '') : '');
  return {
    ts: nowIso(),
    kind: 'page',
    filename: '产品资料页',
    ext: 'html',
    materialType: '产品资料页',
    productName,
    productCode: baseContext.productCode || '',
    size: 0,
    contentType: 'text/html',
    status: 0,
    host: u.host,
    url: sanitizeUrl(pageUrl, 'redact'),
    downloadUrl: pageUrl,
    source: 'product-page',
    sourceUrl: sanitizeUrl(pageUrl, 'redact'),
    pageTitle: baseContext.title || '',
  };
}

function resolveUrl(link, baseUrl) {
  const raw = safeDecode(String(link || '').trim()).replace(/\\u002F/g, '/');
  if (!raw || raw.indexOf('data:') === 0) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = safeUrl(baseUrl);
  if (!base) return raw;
  if (raw.indexOf('//') === 0) return `${base.protocol}${raw}`;
  if (raw.charAt(0) === '/') return `${base.protocol}//${base.host}${raw}`;
  const dir = (base.pathname || '/').replace(/\/[^/]*$/, '/');
  return `${base.protocol}//${base.host}${dir}${raw}`;
}

function contextCapture() {
  const args = parseArgs(typeof $argument === 'string' ? $argument : '');
  const keep = Math.max(1, Math.min(800, asInt(args.keep) || DEFAULT_KEEP));
  const keepContext = Math.max(1, Math.min(200, asInt(args.keep_context) || DEFAULT_KEEP_CONTEXT));
  const harvestLinks = toBool(args.harvest_links, true);
  const notify = toBool(args.notify_context, false);
  const req = typeof $request !== 'undefined' ? $request : {};
  const res = typeof $response !== 'undefined' ? $response : {};
  const headers = lowerHeaders(res.headers || {});
  const contentType = String(headers['content-type'] || '').toLowerCase();
  const body = typeof res.body === 'string' ? res.body : '';
  if (!body || /application\/(pdf|zip|octet-stream)|image\/|video\/|audio\//i.test(contentType)) {
    $done({});
    return;
  }
  const u = safeUrl(req.url || '');
  const baseTitle = htmlTitle(body);
  const base = { host: u ? u.host : '', root: rootDomain(u ? u.host : ''), sourceUrl: req.url || '', title: baseTitle };
  let contexts = [];
  let embedded = [];
  try {
    if (contentType.indexOf('json') >= 0 || /^[\s\r\n]*[\[{]/.test(body)) {
      const parsed = JSON.parse(body);
      const got = extractContextsFromJson(parsed, base);
      contexts = contexts.concat(got.contexts);
      embedded = embedded.concat(got.embeddedItems);
    }
  } catch (_) {}
  if (!contexts.length && baseTitle) {
    const titleName = inferProductNameFromText(body, baseTitle);
    contexts.push({ ts: nowIso(), productName: titleName, productCode: '', title: baseTitle, host: base.host, root: base.root, sourceUrl: base.sourceUrl, source: 'html-title' });
  }
  if (harvestLinks) {
    const current = contexts[0] || { title: baseTitle, productName: '', productCode: '' };
    embedded = embedded.concat(extractEmbeddedLinks(body, req.url || '', current));
  }
  if (contexts.length) rememberContexts(contexts, keepContext);
  const pageItems = [];
  if (toBool(args.archive_page, true) && likelyMaterialPage(body, baseTitle || '')) {
    const current = contexts[0] || { title: baseTitle, productName: '', productCode: '' };
    const pageItem = buildPageCrawlItem(req.url || '', current);
    if (pageItem) pageItems.push(pageItem);
  }
  const newEmbedded = embedded.length ? filterNewItems(embedded).map((entry) => Object.assign({}, entry, { downloadUrl: entry.url })) : [];
  const newPageItems = pageItems.length ? filterNewItems(pageItems) : [];
  if (embedded.length || pageItems.length) upsertItems(embedded.concat(pageItems), keep);
  if (notify && (contexts.length || embedded.length || pageItems.length)) {
    const c = contexts[0] || {};
    const detail = embedded.length ? `发现 ${embedded.length} 个文件链接` : pageItems.length ? '已提交产品资料页抓取' : '等待后续文件响应关联';
    $notification.post('Surge 文件上下文', c.productName || c.title || '已记录页面上下文', detail, { url: req.url || '' });
  }
  finishAfterArchive(newEmbedded.concat(newPageItems), args, 'context', {});
}

function diagnosticCapture() {
  const args = parseArgs(typeof $argument === 'string' ? $argument : '');
  const keep = Math.max(1, Math.min(800, asInt(args.keep) || DEFAULT_KEEP));
  const notify = toBool(args.notify_diag, true);
  const req = typeof $request !== 'undefined' ? $request : {};
  const res = typeof $response !== 'undefined' ? $response : {};
  const responseHeaders = lowerHeaders(res.headers || {});
  const requestHeaders = lowerHeaders(req.headers || {});
  const contentType = String(responseHeaders['content-type'] || '').toLowerCase();
  const contentLength = responseHeaders['content-length'] || '';
  const u = safeUrl(req.url || '');
  const host = u ? u.hostname : '';
  const body = typeof res.body === 'string' ? res.body : '';
  const operationType = requestHeaders['operation-type'] || requestHeaders['x-operation-type'] || responseHeaders['operation-type'] || '';
  const encrypted = requestHeaders['x-mgs-encryption'] || responseHeaders['x-mgs-encryption'] || '';
  let item = null;
  let retaggedItems = [];

  if (/mpaas-mgw-fin\.cn-shanghai\.aliyuncs\.com$/i.test(host)) {
    item = buildDiagnosticItem({
      url: req.url || '',
      host,
      status: res.status || 0,
      contentType,
      size: contentLength,
      materialType: 'mPaaS API',
      source: 'aia-diagnostic-mpaas',
      filename: `mPaaS ${operationType || 'unknown-operation'}${encrypted ? ' encrypted' : ''}`,
      operationType,
      encrypted: encrypted || 'unknown',
      detail: `Operation-Type=${operationType || 'missing'}; encrypted=${encrypted || 'unknown'}; body-read=0`,
    });
  } else if (/sop\.aia\.com\.cn$/i.test(host)) {
    const telemetry = parseSopTelemetry(req.url || '') || {};
    const materialHint = inferMaterialFromSopEvent(telemetry.eventName || '', telemetry.title || '', [telemetry.description || '', telemetry.clauseName || '', telemetry.policyListName || ''].join(' '));
    item = buildDiagnosticItem({
      url: req.url || '',
      host,
      status: res.status || 0,
      contentType,
      size: contentLength,
      materialType: 'SOP 事件',
      source: 'aia-diagnostic-sop',
      filename: `SOP ${telemetry.eventName || telemetry.title || 'event'}`,
      productName: telemetry.productName || '',
      pageTitle: telemetry.title || '',
      eventName: telemetry.eventName || '',
      detail: [materialHint ? `material=${materialHint}` : '', telemetry.clauseName ? `clauseName=${telemetry.clauseName}` : '', telemetry.description, telemetry.platformType, telemetry.pageUrl].filter(Boolean).join(' · '),
    });
    if (telemetry.productName || telemetry.title) {
      const ctx = {
        ts: nowIso(),
        productName: telemetry.productName || '',
        productCode: '',
        title: telemetry.title || '',
        materialType: materialHint,
        eventName: telemetry.eventName || '',
        policyListName: telemetry.policyListName || '',
        clauseName: telemetry.clauseName || '',
        pageUrl: telemetry.pageUrl || '',
        host,
        root: rootDomain(host),
        sourceUrl: sanitizeDiagnosticUrl(req.url || ''),
        source: 'aia-diagnostic-sop',
      };
      rememberContexts([ctx], Math.max(1, Math.min(200, asInt(args.keep_context) || DEFAULT_KEEP_CONTEXT)));
      retaggedItems = retagRecentFilesFromContext(ctx, { keep, seconds: asInt(args.retag_seconds) || 20 });
    }
  } else if (/01000001\.h5\.aia\.com$/i.test(host)) {
    const title = htmlTitle(body);
    const productName = inferProductNameFromText(body, title);
    item = buildDiagnosticItem({
      url: req.url || '',
      host,
      status: res.status || 0,
      contentType,
      size: contentLength || body.length,
      materialType: 'H5 页面',
      source: 'aia-diagnostic-h5',
      filename: `H5 ${title || (u ? u.pathname : '') || 'page'}`,
      productName,
      pageTitle: title,
      detail: title || productName || 'H5 page observed',
    });
    if (title || productName) rememberContexts([{ ts: nowIso(), productName, productCode: '', title, host, root: rootDomain(host), sourceUrl: sanitizeDiagnosticUrl(req.url || ''), source: 'aia-diagnostic-h5' }], Math.max(1, Math.min(200, asInt(args.keep_context) || DEFAULT_KEEP_CONTEXT)));
  } else if (/^(nav-st|nav-uat)\.aia\.com\.cn$/i.test(host)) {
    item = buildDiagnosticItem({
      url: req.url || '',
      host,
      status: res.status || 0,
      contentType,
      size: contentLength,
      materialType: '导航资源',
      source: 'aia-diagnostic-nav-static',
      filename: `NAV ${basenameFromUrl(req.url || '') || host}`,
      detail: 'nav static/uat resource observed',
    });
  }

  if (!item) {
    $done({});
    return;
  }
  const newItems = filterNewItems(item);
  upsertItems(item, keep);
  if (notify && newItems.length) {
    const sub = item.operationType || item.productName || item.pageTitle || item.host || item.materialType;
    const detail = [item.eventName, item.encrypted ? `encrypted=${item.encrypted}` : '', item.detail || '', item.url].filter(Boolean).join('\n').slice(0, 1800);
    $notification.post('AIA 诊断捕获', sub || item.filename, detail, { url: req.url || item.url });
  }
  if (retaggedItems.length && archiveEndpoint(args)) {
    finishAfterArchive(retaggedItems, args, 'context-retag', {});
    return;
  }
  $done({});
}

function panel() {
  const items = readItems();
  const contexts = readContexts();
  const counts = items.reduce((acc, item) => {
    acc[item.kind] = (acc[item.kind] || 0) + 1;
    return acc;
  }, {});
  const latest = items[0];
  const countLine = Object.keys(counts).sort().map((k) => `${k}:${counts[k]}`).join('  ');
  const latestLine = latest ? `${latest.productName ? latest.productName + '\n' : ''}${latest.materialType || latest.kind.toUpperCase()} · ${fmtBytes(latest.size)}\n${latest.filename}\n${latest.host}` : '暂无捕获记录';
  const ctxLine = contexts[0] ? `上下文：${contexts[0].productName || contexts[0].title || contexts[0].host}` : '上下文：暂无';
  $done({
    title: `文件捕获 ${items.length}`,
    content: `${countLine || '暂无'}\n${ctxLine}\n${latestLine}`,
    icon: 'tray.and.arrow.down',
    'icon-color': '#CC785C',
  });
}

function exportPanel() {
  const args = parseArgs(typeof $argument === 'string' ? $argument : '');
  const limit = Math.max(1, Math.min(80, asInt(args.limit) || 30));
  const items = readItems().slice(0, limit);
  const header = ['ts', 'productName', 'materialType', 'kind', 'filename', 'size', 'host', 'operationType', 'encrypted', 'eventName', 'pageTitle', 'detail', 'url', 'source'];
  const lines = [header.join(',')].concat(items.map((item) => header.map((key) => csvEscape(item[key])).join(',')));
  $done({
    title: `文件捕获导出 ${items.length}`,
    content: lines.join('\n').slice(0, 12000),
    icon: 'doc.text',
    'icon-color': '#8FA08A',
  });
}

function clear() {
  const args = parseArgs(typeof $argument === 'string' ? $argument : '');
  writeItems([]);
  if (toBool(args.context, true)) writeContexts([]);
  $notification.post('Surge 文件捕获', '已清空记录', '新的图片/PDF/归档会继续被识别。');
  $done({
    title: '文件捕获',
    content: '已清空记录',
    icon: 'trash',
    'icon-color': '#8FA08A',
  });
}

try {
  const args = parseArgs(typeof $argument === 'string' ? $argument : '');
  if (args.mode === 'panel') panel();
  else if (args.mode === 'export') exportPanel();
  else if (args.mode === 'clear') clear();
  else if (args.mode === 'context') contextCapture();
  else if (args.mode === 'diagnostic') diagnosticCapture();
  else capture();
} catch (e) {
  console.log(`[File Capture] ${e && e.stack ? e.stack : e}`);
  if (typeof $script !== 'undefined' && $script.type === 'generic') {
    $done({ title: '文件捕获', content: '脚本异常，已失败开放', icon: 'exclamationmark.triangle', 'icon-color': '#CC785C' });
  } else {
    $done({});
  }
}
