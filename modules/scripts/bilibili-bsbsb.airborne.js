// SPDX-License-Identifier: GPL-3.0-or-later
// Derived from kokoryh/Sparkle commit ace03cd2717b5f4894a6e7e5a1e1e5c70048051f with zlbzhf/Surge bsbsb optional-module patches.
// Data/API source: hanydd/BilibiliSponsorBlock / https://bsbsb.top/.

// src/core/compose.ts
var compose = (middleware) => async (ctx2, next) => {
  const dispatch = (i) => async () => {
    const fn = i === middleware.length ? next : middleware[i];
    if (!fn) return;
    return await fn(ctx2, dispatch(i + 1));
  };
  return dispatch(0)();
};

// src/utils/bilibili.ts
function toBvid(avid) {
  const XOR_CODE = 23442827791579n;
  const MAX_AID = 1n << 51n;
  const BASE = 58n;
  const data = "FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf";
  const bytes = ["B", "V", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
  let bvIndex = bytes.length - 1;
  let tmp = (MAX_AID | BigInt(avid)) ^ XOR_CODE;
  while (tmp > 0) {
    bytes[bvIndex] = data[Number(tmp % BigInt(BASE))];
    tmp = tmp / BASE;
    bvIndex -= 1;
  }
  [bytes[3], bytes[9]] = [bytes[9], bytes[3]];
  [bytes[4], bytes[7]] = [bytes[7], bytes[4]];
  return bytes.join("");
}

// src/utils/index.ts
function toString(value) {
  if (typeof value !== "object" || value === null) {
    return String(value);
  }
  if (value instanceof Error) {
    return `${value.toString()} ${JSON.stringify({ stack: value.stack })}`;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
    return value.toString();
  }
  return JSON.stringify(value);
}
function ungzip(data) {
  return $utils.ungzip(data);
}

// src/core/process.ts
var ExitError = class extends Error {
  constructor(code, message = `Process exited with code ${code}`) {
    super(message);
    this.code = code;
  }
  name = "Exit";
  toString() {
    return `[${this.name}] ${this.message}`;
  }
};
function exit(code = 0) {
  throw new ExitError(code);
}

// src/core/logger.ts
var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[LogLevel2["DEBUG"] = 1] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 2] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 3] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 4] = "ERROR";
  LogLevel2[LogLevel2["OFF"] = 5] = "OFF";
  return LogLevel2;
})(LogLevel || {});
var Logger = class {
  static level = 4 /* ERROR */;
  static setLevel(level) {
    this.level = Number(level) || LogLevel[level.toUpperCase()] || 4 /* ERROR */;
  }
  static log(...messages) {
    console.log(messages.map((msg) => toString(msg)).join(" "));
  }
  static debug(...messages) {
    if (this.level > 1 /* DEBUG */) return;
    this.log("[DEBUG]", ...messages);
  }
  static info(...messages) {
    if (this.level > 2 /* INFO */) return;
    this.log("[INFO]", ...messages);
  }
  static warn(...messages) {
    if (this.level > 3 /* WARN */) return;
    this.log("[WARN]", ...messages);
  }
  static error(...messages) {
    if (this.level > 4 /* ERROR */) return;
    const firstMessage = messages[0];
    if (firstMessage instanceof ExitError) {
      if (firstMessage.code !== 0) {
        this.error(firstMessage.toString());
      }
      return;
    }
    this.log("[ERROR]", ...messages);
  }
};

// src/core/context.ts
var Context = class _Context {
  static getInstance() {
    if (!_Context.instance) {
      _Context.instance = _Context.createInstance();
    }
    return _Context.instance;
  }
  static createInstance() {
    if (typeof $loon !== "undefined") return new LoonContext();
    if (typeof $task !== "undefined") throw new Error("QuantumultX is not supported");
    return new SurgeContext();
  }
  static instance;
  request;
  response;
  argument = {};
  state = {};
  #url;
  get url() {
    if (!this.#url) this.#url = new URL(this.request.url);
    return this.#url;
  }
  get path() {
    return this.url.pathname;
  }
  get method() {
    return this.request.method;
  }
  constructor() {
    this.request = this.createRequest(typeof $request !== "undefined" ? $request : null);
    this.response = this.createResponse(typeof $response !== "undefined" ? $response : null);
  }
  getJSON(key) {
    const val = this.getVal(key);
    return val ? JSON.parse(val) : null;
  }
  setJSON(val, key) {
    this.setVal(JSON.stringify(val), key);
  }
  exit() {
    $done({});
  }
  toString() {
    const { method, url } = this.request;
    const { status, body } = this.response;
    return JSON.stringify({ method, url, status, body });
  }
};
var SurgeContext = class extends Context {
  createRequest(request) {
    return Object.create(request, {
      bodyBytes: {
        get() {
          return this.body;
        },
        set(value) {
          this.body = value;
        }
      }
    });
  }
  createResponse(response) {
    return Object.create(response, {
      bodyBytes: {
        get() {
          return this.body;
        },
        set(value) {
          this.body = value;
        }
      }
    });
  }
  initArgument(argument) {
    Object.assign(this.argument, argument);
    if (typeof $argument === "string") {
      try {
        Object.assign(this.argument, JSON.parse($argument));
      } catch (e) {
        Logger.log(e);
      }
    }
  }
  getVal(key) {
    return $persistentStore.read(key);
  }
  setVal(val, key) {
    return $persistentStore.write(val, key);
  }
  fetch(request) {
    const { method, body, timeout = 5, ...rest } = request;
    return new Promise((resolve, reject) => {
      $httpClient[method.toLowerCase()](
        {
          ...rest,
          body,
          "binary-mode": body instanceof Uint8Array,
          timeout
        },
        (error, response, data) => {
          if (error) {
            return reject(error);
          }
          resolve(this.createResponse({ ...response, body: data }));
        }
      );
    });
  }
  notify(title = "", subtitle = "", content = "", options = {}) {
    const { openUrl, clipboard, mediaUrl, dismiss, sound = true } = options;
    const opts = {
      url: openUrl,
      text: clipboard,
      "media-url": mediaUrl,
      "auto-dismiss": dismiss,
      sound
    };
    if (openUrl) {
      opts.action = "open-url";
    } else if (clipboard) {
      opts.action = "clipboard";
    }
    $notification.post(title, subtitle, content, opts);
  }
  done(result) {
    $done({ ...result });
  }
  abort() {
    $done({ abort: true });
  }
};
var LoonContext = class extends SurgeContext {
  initArgument(argument) {
    super.initArgument(argument);
    if (typeof $argument === "object") {
      Object.assign(this.argument, $argument);
    }
  }
  fetch(request) {
    request.timeout = (request.timeout ?? 5) * 1e3;
    request.alpn = "h2";
    return super.fetch(request);
  }
  notify(title = "", subtitle = "", content = "", options = {}) {
    const { openUrl, mediaUrl, clipboard, delay } = options;
    const opts = {
      openUrl,
      mediaUrl,
      clipboard
    };
    $notification.post(title, subtitle, content, opts, delay);
  }
  abort() {
    $done();
  }
};
var ctx = Context.getInstance();

// src/core/application.ts
var Application = class {
  middleware = [];
  use(fn) {
    this.middleware.push(fn);
    return this;
  }
  run() {
    compose(this.middleware)(ctx).catch((e) => Logger.error(e, ctx)).finally(() => ctx.exit());
  }
};

// src/core/middleware.ts
var doneFakeResponse = (ctx2, next) => {
  return next().then(() => {
    ctx2.done({ response: ctx2.response });
  });
};
var parseGrpcResponse = async (ctx2, next) => {
  let body = ctx2.response.bodyBytes;
  ctx2.response.bodyBytes = body[0] ? ungzip(body.subarray(5)) : body.subarray(5);
  await next();
  body = ctx2.response.bodyBytes;
  const length = body.length;
  const result = new Uint8Array(5 + length);
  result[0] = 0;
  result[1] = length >>> 24;
  result[2] = length >>> 16 & 255;
  result[3] = length >>> 8 & 255;
  result[4] = length & 255;
  result.set(body, 5);
  ctx2.response.bodyBytes = result;
};
var createInitArgumentMiddleware = (argument) => (ctx2, next) => {
  ctx2.initArgument(argument);
  Logger.setLevel(String(ctx2.argument.logLevel));
  Logger.debug("[Argument]", ctx2.argument);
  return next();
};

// src/script/bilibili/protobuf/middleware.ts
var initArgument = createInitArgumentMiddleware({
  displayUpList: "show",
  purifyComment: true,
  sponsorBlock: true,
  categories: "sponsor|selfpromo|interaction",
  actionTypes: "skip",
  includeIntroOutro: false,
  includePoiHighlight: false,
  minDuration: 5,
  mergeGap: 1.5,
  offsetMs: 2e3,
  maxSegments: 12,
  cacheMinutes: 60,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 BilibiliSponsorBlock-Surge/1.0"
});
var handleResponseHeaders = (ctx2, next) => {
  return next().then(() => {
    if (ctx2.response.h2_trailers !== void 0) {
      return;
    }
    const engineType = ctx2.request.headers["x-bili-moss-engine-type"];
    if (engineType === void 0) {
      return;
    }
    if (engineType !== "1") {
      Logger.error(`x-bili-moss-engine-type: ${engineType}`);
      return;
    }
    const responseHeaders = ctx2.response.headers;
    if (!Object.hasOwn(responseHeaders, "grpc-status")) {
      ctx2.response.headers = { ...responseHeaders, "grpc-status": "0" };
    }
  });
};

// src/core/layer.ts
var Layer = class {
  path;
  methods;
  stack;
  constructor(path, methods, middleware) {
    this.path = path;
    this.methods = methods;
    this.stack = middleware;
  }
};

// src/core/router.ts
var matchExactPath = (layer, ctx2) => ctx2.path === layer.path;
var matchUrlSuffix = (layer, ctx2) => ctx2.request.url.endsWith(layer.path);
var Router = class {
  stack = [];
  matchPath;
  constructor(opts = {}) {
    this.matchPath = opts.matchPath || matchExactPath;
  }
  use(...middleware) {
    return this.register("", [], middleware);
  }
  get(path, ...middleware) {
    return this.register(path, ["GET"], middleware);
  }
  post(path, ...middleware) {
    return this.register(path, ["POST"], middleware);
  }
  routes() {
    return (ctx2, next) => {
      const matched = this.match(ctx2);
      if (!matched.route) return next();
      ctx2.state.route = true;
      const layerChain = matched.pathAndMethod.flatMap((layer) => layer.stack);
      return compose(layerChain)(ctx2, next);
    };
  }
  routeNotMatched() {
    return (ctx2, next) => {
      return next().then(() => {
        if (!ctx2.state.route) throw new Error("Unexpected request");
      });
    };
  }
  match(ctx2) {
    const matched = {
      path: [],
      pathAndMethod: [],
      route: false
    };
    for (const layer of this.stack) {
      if (layer.path === "" || this.matchPath(layer, ctx2)) {
        matched.path.push(layer);
        if (layer.methods.length === 0 || layer.methods.includes(ctx2.method)) {
          matched.pathAndMethod.push(layer);
          if (layer.methods.length > 0) {
            matched.route = true;
          }
        }
      }
    }
    return matched;
  }
  register(path, methods, middleware) {
    if (Array.isArray(path)) {
      for (const singlePath of path) {
        this.stack.push(new Layer(singlePath, methods, middleware));
      }
    } else {
      this.stack.push(new Layer(path, methods, middleware));
    }
    return this;
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/json-typings.js
function typeofJsonValue(value) {
  let t = typeof value;
  if (t == "object") {
    if (Array.isArray(value))
      return "array";
    if (value === null)
      return "null";
  }
  return t;
}
function isJsonObject(value) {
  return value !== null && typeof value == "object" && !Array.isArray(value);
}

// node_modules/@protobuf-ts/runtime/build/es2015/base64.js
var encTable = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
var decTable = [];
for (let i = 0; i < encTable.length; i++)
  decTable[encTable[i].charCodeAt(0)] = i;
decTable["-".charCodeAt(0)] = encTable.indexOf("+");
decTable["_".charCodeAt(0)] = encTable.indexOf("/");
function base64decode(base64Str) {
  let es = base64Str.length * 3 / 4;
  if (base64Str[base64Str.length - 2] == "=")
    es -= 2;
  else if (base64Str[base64Str.length - 1] == "=")
    es -= 1;
  let bytes = new Uint8Array(es), bytePos = 0, groupPos = 0, b, p = 0;
  for (let i = 0; i < base64Str.length; i++) {
    b = decTable[base64Str.charCodeAt(i)];
    if (b === void 0) {
      switch (base64Str[i]) {
        case "=":
          groupPos = 0;
        // reset state when padding found
        case "\n":
        case "\r":
        case "	":
        case " ":
          continue;
        // skip white-space, and padding
        default:
          throw Error(`invalid base64 string.`);
      }
    }
    switch (groupPos) {
      case 0:
        p = b;
        groupPos = 1;
        break;
      case 1:
        bytes[bytePos++] = p << 2 | (b & 48) >> 4;
        p = b;
        groupPos = 2;
        break;
      case 2:
        bytes[bytePos++] = (p & 15) << 4 | (b & 60) >> 2;
        p = b;
        groupPos = 3;
        break;
      case 3:
        bytes[bytePos++] = (p & 3) << 6 | b;
        groupPos = 0;
        break;
    }
  }
  if (groupPos == 1)
    throw Error(`invalid base64 string.`);
  return bytes.subarray(0, bytePos);
}
function base64encode(bytes) {
  let base64 = "", groupPos = 0, b, p = 0;
  for (let i = 0; i < bytes.length; i++) {
    b = bytes[i];
    switch (groupPos) {
      case 0:
        base64 += encTable[b >> 2];
        p = (b & 3) << 4;
        groupPos = 1;
        break;
      case 1:
        base64 += encTable[p | b >> 4];
        p = (b & 15) << 2;
        groupPos = 2;
        break;
      case 2:
        base64 += encTable[p | b >> 6];
        base64 += encTable[b & 63];
        groupPos = 0;
        break;
    }
  }
  if (groupPos) {
    base64 += encTable[p];
    base64 += "=";
    if (groupPos == 1)
      base64 += "=";
  }
  return base64;
}

// node_modules/@protobuf-ts/runtime/build/es2015/binary-format-contract.js
var UnknownFieldHandler;
(function(UnknownFieldHandler2) {
  UnknownFieldHandler2.symbol = Symbol.for("protobuf-ts/unknown");
  UnknownFieldHandler2.onRead = (typeName, message, fieldNo, wireType, data) => {
    let container = is(message) ? message[UnknownFieldHandler2.symbol] : message[UnknownFieldHandler2.symbol] = [];
    container.push({ no: fieldNo, wireType, data });
  };
  UnknownFieldHandler2.onWrite = (typeName, message, writer) => {
    for (let { no, wireType, data } of UnknownFieldHandler2.list(message))
      writer.tag(no, wireType).raw(data);
  };
  UnknownFieldHandler2.list = (message, fieldNo) => {
    if (is(message)) {
      let all = message[UnknownFieldHandler2.symbol];
      return fieldNo ? all.filter((uf) => uf.no == fieldNo) : all;
    }
    return [];
  };
  UnknownFieldHandler2.last = (message, fieldNo) => UnknownFieldHandler2.list(message, fieldNo).slice(-1)[0];
  const is = (message) => message && Array.isArray(message[UnknownFieldHandler2.symbol]);
})(UnknownFieldHandler || (UnknownFieldHandler = {}));
var WireType;
(function(WireType2) {
  WireType2[WireType2["Varint"] = 0] = "Varint";
  WireType2[WireType2["Bit64"] = 1] = "Bit64";
  WireType2[WireType2["LengthDelimited"] = 2] = "LengthDelimited";
  WireType2[WireType2["StartGroup"] = 3] = "StartGroup";
  WireType2[WireType2["EndGroup"] = 4] = "EndGroup";
  WireType2[WireType2["Bit32"] = 5] = "Bit32";
})(WireType || (WireType = {}));

// node_modules/@protobuf-ts/runtime/build/es2015/goog-varint.js
function varint64read() {
  let lowBits = 0;
  let highBits = 0;
  for (let shift = 0; shift < 28; shift += 7) {
    let b = this.buf[this.pos++];
    lowBits |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.assertBounds();
      return [lowBits, highBits];
    }
  }
  let middleByte = this.buf[this.pos++];
  lowBits |= (middleByte & 15) << 28;
  highBits = (middleByte & 112) >> 4;
  if ((middleByte & 128) == 0) {
    this.assertBounds();
    return [lowBits, highBits];
  }
  for (let shift = 3; shift <= 31; shift += 7) {
    let b = this.buf[this.pos++];
    highBits |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.assertBounds();
      return [lowBits, highBits];
    }
  }
  throw new Error("invalid varint");
}
function varint64write(lo, hi, bytes) {
  for (let i = 0; i < 28; i = i + 7) {
    const shift = lo >>> i;
    const hasNext = !(shift >>> 7 == 0 && hi == 0);
    const byte = (hasNext ? shift | 128 : shift) & 255;
    bytes.push(byte);
    if (!hasNext) {
      return;
    }
  }
  const splitBits = lo >>> 28 & 15 | (hi & 7) << 4;
  const hasMoreBits = !(hi >> 3 == 0);
  bytes.push((hasMoreBits ? splitBits | 128 : splitBits) & 255);
  if (!hasMoreBits) {
    return;
  }
  for (let i = 3; i < 31; i = i + 7) {
    const shift = hi >>> i;
    const hasNext = !(shift >>> 7 == 0);
    const byte = (hasNext ? shift | 128 : shift) & 255;
    bytes.push(byte);
    if (!hasNext) {
      return;
    }
  }
  bytes.push(hi >>> 31 & 1);
}
var TWO_PWR_32_DBL = (1 << 16) * (1 << 16);
function int64fromString(dec) {
  let minus = dec[0] == "-";
  if (minus)
    dec = dec.slice(1);
  const base = 1e6;
  let lowBits = 0;
  let highBits = 0;
  function add1e6digit(begin, end) {
    const digit1e6 = Number(dec.slice(begin, end));
    highBits *= base;
    lowBits = lowBits * base + digit1e6;
    if (lowBits >= TWO_PWR_32_DBL) {
      highBits = highBits + (lowBits / TWO_PWR_32_DBL | 0);
      lowBits = lowBits % TWO_PWR_32_DBL;
    }
  }
  add1e6digit(-24, -18);
  add1e6digit(-18, -12);
  add1e6digit(-12, -6);
  add1e6digit(-6);
  return [minus, lowBits, highBits];
}
function int64toString(bitsLow, bitsHigh) {
  if (bitsHigh >>> 0 <= 2097151) {
    return "" + (TWO_PWR_32_DBL * bitsHigh + (bitsLow >>> 0));
  }
  let low = bitsLow & 16777215;
  let mid = (bitsLow >>> 24 | bitsHigh << 8) >>> 0 & 16777215;
  let high = bitsHigh >> 16 & 65535;
  let digitA = low + mid * 6777216 + high * 6710656;
  let digitB = mid + high * 8147497;
  let digitC = high * 2;
  let base = 1e7;
  if (digitA >= base) {
    digitB += Math.floor(digitA / base);
    digitA %= base;
  }
  if (digitB >= base) {
    digitC += Math.floor(digitB / base);
    digitB %= base;
  }
  function decimalFrom1e7(digit1e7, needLeadingZeros) {
    let partial = digit1e7 ? String(digit1e7) : "";
    if (needLeadingZeros) {
      return "0000000".slice(partial.length) + partial;
    }
    return partial;
  }
  return decimalFrom1e7(
    digitC,
    /*needLeadingZeros=*/
    0
  ) + decimalFrom1e7(
    digitB,
    /*needLeadingZeros=*/
    digitC
  ) + // If the final 1e7 digit didn't need leading zeros, we would have
  // returned via the trivial code path at the top.
  decimalFrom1e7(
    digitA,
    /*needLeadingZeros=*/
    1
  );
}
function varint32write(value, bytes) {
  if (value >= 0) {
    while (value > 127) {
      bytes.push(value & 127 | 128);
      value = value >>> 7;
    }
    bytes.push(value);
  } else {
    for (let i = 0; i < 9; i++) {
      bytes.push(value & 127 | 128);
      value = value >> 7;
    }
    bytes.push(1);
  }
}
function varint32read() {
  let b = this.buf[this.pos++];
  let result = b & 127;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 7;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 14;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 21;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 15) << 28;
  for (let readBytes = 5; (b & 128) !== 0 && readBytes < 10; readBytes++)
    b = this.buf[this.pos++];
  if ((b & 128) != 0)
    throw new Error("invalid varint");
  this.assertBounds();
  return result >>> 0;
}

// node_modules/@protobuf-ts/runtime/build/es2015/pb-long.js
var BI;
function detectBi() {
  const dv = new DataView(new ArrayBuffer(8));
  const ok = globalThis.BigInt !== void 0 && typeof dv.getBigInt64 === "function" && typeof dv.getBigUint64 === "function" && typeof dv.setBigInt64 === "function" && typeof dv.setBigUint64 === "function";
  BI = ok ? {
    MIN: BigInt("-9223372036854775808"),
    MAX: BigInt("9223372036854775807"),
    UMIN: BigInt("0"),
    UMAX: BigInt("18446744073709551615"),
    C: BigInt,
    V: dv
  } : void 0;
}
detectBi();
function assertBi(bi) {
  if (!bi)
    throw new Error("BigInt unavailable, see https://github.com/timostamm/protobuf-ts/blob/v1.0.8/MANUAL.md#bigint-support");
}
var RE_DECIMAL_STR = /^-?[0-9]+$/;
var TWO_PWR_32_DBL2 = 4294967296;
var HALF_2_PWR_32 = 2147483648;
var SharedPbLong = class {
  /**
   * Create a new instance with the given bits.
   */
  constructor(lo, hi) {
    this.lo = lo | 0;
    this.hi = hi | 0;
  }
  /**
   * Is this instance equal to 0?
   */
  isZero() {
    return this.lo == 0 && this.hi == 0;
  }
  /**
   * Convert to a native number.
   */
  toNumber() {
    let result = this.hi * TWO_PWR_32_DBL2 + (this.lo >>> 0);
    if (!Number.isSafeInteger(result))
      throw new Error("cannot convert to safe number");
    return result;
  }
};
var PbULong = class _PbULong extends SharedPbLong {
  /**
   * Create instance from a `string`, `number` or `bigint`.
   */
  static from(value) {
    if (BI)
      switch (typeof value) {
        case "string":
          if (value == "0")
            return this.ZERO;
          if (value == "")
            throw new Error("string is no integer");
          value = BI.C(value);
        case "number":
          if (value === 0)
            return this.ZERO;
          value = BI.C(value);
        case "bigint":
          if (!value)
            return this.ZERO;
          if (value < BI.UMIN)
            throw new Error("signed value for ulong");
          if (value > BI.UMAX)
            throw new Error("ulong too large");
          BI.V.setBigUint64(0, value, true);
          return new _PbULong(BI.V.getInt32(0, true), BI.V.getInt32(4, true));
      }
    else
      switch (typeof value) {
        case "string":
          if (value == "0")
            return this.ZERO;
          value = value.trim();
          if (!RE_DECIMAL_STR.test(value))
            throw new Error("string is no integer");
          let [minus, lo, hi] = int64fromString(value);
          if (minus)
            throw new Error("signed value for ulong");
          return new _PbULong(lo, hi);
        case "number":
          if (value == 0)
            return this.ZERO;
          if (!Number.isSafeInteger(value))
            throw new Error("number is no integer");
          if (value < 0)
            throw new Error("signed value for ulong");
          return new _PbULong(value, value / TWO_PWR_32_DBL2);
      }
    throw new Error("unknown value " + typeof value);
  }
  /**
   * Convert to decimal string.
   */
  toString() {
    return BI ? this.toBigInt().toString() : int64toString(this.lo, this.hi);
  }
  /**
   * Convert to native bigint.
   */
  toBigInt() {
    assertBi(BI);
    BI.V.setInt32(0, this.lo, true);
    BI.V.setInt32(4, this.hi, true);
    return BI.V.getBigUint64(0, true);
  }
};
PbULong.ZERO = new PbULong(0, 0);
var PbLong = class _PbLong extends SharedPbLong {
  /**
   * Create instance from a `string`, `number` or `bigint`.
   */
  static from(value) {
    if (BI)
      switch (typeof value) {
        case "string":
          if (value == "0")
            return this.ZERO;
          if (value == "")
            throw new Error("string is no integer");
          value = BI.C(value);
        case "number":
          if (value === 0)
            return this.ZERO;
          value = BI.C(value);
        case "bigint":
          if (!value)
            return this.ZERO;
          if (value < BI.MIN)
            throw new Error("signed long too small");
          if (value > BI.MAX)
            throw new Error("signed long too large");
          BI.V.setBigInt64(0, value, true);
          return new _PbLong(BI.V.getInt32(0, true), BI.V.getInt32(4, true));
      }
    else
      switch (typeof value) {
        case "string":
          if (value == "0")
            return this.ZERO;
          value = value.trim();
          if (!RE_DECIMAL_STR.test(value))
            throw new Error("string is no integer");
          let [minus, lo, hi] = int64fromString(value);
          if (minus) {
            if (hi > HALF_2_PWR_32 || hi == HALF_2_PWR_32 && lo != 0)
              throw new Error("signed long too small");
          } else if (hi >= HALF_2_PWR_32)
            throw new Error("signed long too large");
          let pbl = new _PbLong(lo, hi);
          return minus ? pbl.negate() : pbl;
        case "number":
          if (value == 0)
            return this.ZERO;
          if (!Number.isSafeInteger(value))
            throw new Error("number is no integer");
          return value > 0 ? new _PbLong(value, value / TWO_PWR_32_DBL2) : new _PbLong(-value, -value / TWO_PWR_32_DBL2).negate();
      }
    throw new Error("unknown value " + typeof value);
  }
  /**
   * Do we have a minus sign?
   */
  isNegative() {
    return (this.hi & HALF_2_PWR_32) !== 0;
  }
  /**
   * Negate two's complement.
   * Invert all the bits and add one to the result.
   */
  negate() {
    let hi = ~this.hi, lo = this.lo;
    if (lo)
      lo = ~lo + 1;
    else
      hi += 1;
    return new _PbLong(lo, hi);
  }
  /**
   * Convert to decimal string.
   */
  toString() {
    if (BI)
      return this.toBigInt().toString();
    if (this.isNegative()) {
      let n = this.negate();
      return "-" + int64toString(n.lo, n.hi);
    }
    return int64toString(this.lo, this.hi);
  }
  /**
   * Convert to native bigint.
   */
  toBigInt() {
    assertBi(BI);
    BI.V.setInt32(0, this.lo, true);
    BI.V.setInt32(4, this.hi, true);
    return BI.V.getBigInt64(0, true);
  }
};
PbLong.ZERO = new PbLong(0, 0);

// node_modules/@protobuf-ts/runtime/build/es2015/binary-reader.js
var defaultsRead = {
  readUnknownField: true,
  readerFactory: (bytes) => new BinaryReader(bytes)
};
function binaryReadOptions(options) {
  return options ? Object.assign(Object.assign({}, defaultsRead), options) : defaultsRead;
}
var BinaryReader = class {
  constructor(buf, textDecoder) {
    this.varint64 = varint64read;
    this.uint32 = varint32read;
    this.buf = buf;
    this.len = buf.length;
    this.pos = 0;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.textDecoder = textDecoder !== null && textDecoder !== void 0 ? textDecoder : new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true
    });
  }
  /**
   * Reads a tag - field number and wire type.
   */
  tag() {
    let tag = this.uint32(), fieldNo = tag >>> 3, wireType = tag & 7;
    if (fieldNo <= 0 || wireType < 0 || wireType > 5)
      throw new Error("illegal tag: field no " + fieldNo + " wire type " + wireType);
    return [fieldNo, wireType];
  }
  /**
   * Skip one element on the wire and return the skipped data.
   * Supports WireType.StartGroup since v2.0.0-alpha.23.
   */
  skip(wireType) {
    let start = this.pos;
    switch (wireType) {
      case WireType.Varint:
        while (this.buf[this.pos++] & 128) {
        }
        break;
      case WireType.Bit64:
        this.pos += 4;
      case WireType.Bit32:
        this.pos += 4;
        break;
      case WireType.LengthDelimited:
        let len = this.uint32();
        this.pos += len;
        break;
      case WireType.StartGroup:
        let t;
        while ((t = this.tag()[1]) !== WireType.EndGroup) {
          this.skip(t);
        }
        break;
      default:
        throw new Error("cant skip wire type " + wireType);
    }
    this.assertBounds();
    return this.buf.subarray(start, this.pos);
  }
  /**
   * Throws error if position in byte array is out of range.
   */
  assertBounds() {
    if (this.pos > this.len)
      throw new RangeError("premature EOF");
  }
  /**
   * Read a `int32` field, a signed 32 bit varint.
   */
  int32() {
    return this.uint32() | 0;
  }
  /**
   * Read a `sint32` field, a signed, zigzag-encoded 32-bit varint.
   */
  sint32() {
    let zze = this.uint32();
    return zze >>> 1 ^ -(zze & 1);
  }
  /**
   * Read a `int64` field, a signed 64-bit varint.
   */
  int64() {
    return new PbLong(...this.varint64());
  }
  /**
   * Read a `uint64` field, an unsigned 64-bit varint.
   */
  uint64() {
    return new PbULong(...this.varint64());
  }
  /**
   * Read a `sint64` field, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64() {
    let [lo, hi] = this.varint64();
    let s = -(lo & 1);
    lo = (lo >>> 1 | (hi & 1) << 31) ^ s;
    hi = hi >>> 1 ^ s;
    return new PbLong(lo, hi);
  }
  /**
   * Read a `bool` field, a variant.
   */
  bool() {
    let [lo, hi] = this.varint64();
    return lo !== 0 || hi !== 0;
  }
  /**
   * Read a `fixed32` field, an unsigned, fixed-length 32-bit integer.
   */
  fixed32() {
    return this.view.getUint32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `sfixed32` field, a signed, fixed-length 32-bit integer.
   */
  sfixed32() {
    return this.view.getInt32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `fixed64` field, an unsigned, fixed-length 64 bit integer.
   */
  fixed64() {
    return new PbULong(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `fixed64` field, a signed, fixed-length 64-bit integer.
   */
  sfixed64() {
    return new PbLong(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `float` field, 32-bit floating point number.
   */
  float() {
    return this.view.getFloat32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `double` field, a 64-bit floating point number.
   */
  double() {
    return this.view.getFloat64((this.pos += 8) - 8, true);
  }
  /**
   * Read a `bytes` field, length-delimited arbitrary data.
   */
  bytes() {
    let len = this.uint32();
    let start = this.pos;
    this.pos += len;
    this.assertBounds();
    return this.buf.subarray(start, start + len);
  }
  /**
   * Read a `string` field, length-delimited data converted to UTF-8 text.
   */
  string() {
    return this.textDecoder.decode(this.bytes());
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/assert.js
function assert(condition, msg) {
  if (!condition) {
    throw new Error(msg);
  }
}
var FLOAT32_MAX = 34028234663852886e22;
var FLOAT32_MIN = -34028234663852886e22;
var UINT32_MAX = 4294967295;
var INT32_MAX = 2147483647;
var INT32_MIN = -2147483648;
function assertInt32(arg) {
  if (typeof arg !== "number")
    throw new Error("invalid int 32: " + typeof arg);
  if (!Number.isInteger(arg) || arg > INT32_MAX || arg < INT32_MIN)
    throw new Error("invalid int 32: " + arg);
}
function assertUInt32(arg) {
  if (typeof arg !== "number")
    throw new Error("invalid uint 32: " + typeof arg);
  if (!Number.isInteger(arg) || arg > UINT32_MAX || arg < 0)
    throw new Error("invalid uint 32: " + arg);
}
function assertFloat32(arg) {
  if (typeof arg !== "number")
    throw new Error("invalid float 32: " + typeof arg);
  if (!Number.isFinite(arg))
    return;
  if (arg > FLOAT32_MAX || arg < FLOAT32_MIN)
    throw new Error("invalid float 32: " + arg);
}

// node_modules/@protobuf-ts/runtime/build/es2015/binary-writer.js
var defaultsWrite = {
  writeUnknownFields: true,
  writerFactory: () => new BinaryWriter()
};
function binaryWriteOptions(options) {
  return options ? Object.assign(Object.assign({}, defaultsWrite), options) : defaultsWrite;
}
var BinaryWriter = class {
  constructor(textEncoder) {
    this.stack = [];
    this.textEncoder = textEncoder !== null && textEncoder !== void 0 ? textEncoder : new TextEncoder();
    this.chunks = [];
    this.buf = [];
  }
  /**
   * Return all bytes written and reset this writer.
   */
  finish() {
    this.chunks.push(new Uint8Array(this.buf));
    let len = 0;
    for (let i = 0; i < this.chunks.length; i++)
      len += this.chunks[i].length;
    let bytes = new Uint8Array(len);
    let offset = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      bytes.set(this.chunks[i], offset);
      offset += this.chunks[i].length;
    }
    this.chunks = [];
    return bytes;
  }
  /**
   * Start a new fork for length-delimited data like a message
   * or a packed repeated field.
   *
   * Must be joined later with `join()`.
   */
  fork() {
    this.stack.push({ chunks: this.chunks, buf: this.buf });
    this.chunks = [];
    this.buf = [];
    return this;
  }
  /**
   * Join the last fork. Write its length and bytes, then
   * return to the previous state.
   */
  join() {
    let chunk = this.finish();
    let prev = this.stack.pop();
    if (!prev)
      throw new Error("invalid state, fork stack empty");
    this.chunks = prev.chunks;
    this.buf = prev.buf;
    this.uint32(chunk.byteLength);
    return this.raw(chunk);
  }
  /**
   * Writes a tag (field number and wire type).
   *
   * Equivalent to `uint32( (fieldNo << 3 | type) >>> 0 )`.
   *
   * Generated code should compute the tag ahead of time and call `uint32()`.
   */
  tag(fieldNo, type) {
    return this.uint32((fieldNo << 3 | type) >>> 0);
  }
  /**
   * Write a chunk of raw bytes.
   */
  raw(chunk) {
    if (this.buf.length) {
      this.chunks.push(new Uint8Array(this.buf));
      this.buf = [];
    }
    this.chunks.push(chunk);
    return this;
  }
  /**
   * Write a `uint32` value, an unsigned 32 bit varint.
   */
  uint32(value) {
    assertUInt32(value);
    while (value > 127) {
      this.buf.push(value & 127 | 128);
      value = value >>> 7;
    }
    this.buf.push(value);
    return this;
  }
  /**
   * Write a `int32` value, a signed 32 bit varint.
   */
  int32(value) {
    assertInt32(value);
    varint32write(value, this.buf);
    return this;
  }
  /**
   * Write a `bool` value, a variant.
   */
  bool(value) {
    this.buf.push(value ? 1 : 0);
    return this;
  }
  /**
   * Write a `bytes` value, length-delimited arbitrary data.
   */
  bytes(value) {
    this.uint32(value.byteLength);
    return this.raw(value);
  }
  /**
   * Write a `string` value, length-delimited data converted to UTF-8 text.
   */
  string(value) {
    let chunk = this.textEncoder.encode(value);
    this.uint32(chunk.byteLength);
    return this.raw(chunk);
  }
  /**
   * Write a `float` value, 32-bit floating point number.
   */
  float(value) {
    assertFloat32(value);
    let chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setFloat32(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `double` value, a 64-bit floating point number.
   */
  double(value) {
    let chunk = new Uint8Array(8);
    new DataView(chunk.buffer).setFloat64(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `fixed32` value, an unsigned, fixed-length 32-bit integer.
   */
  fixed32(value) {
    assertUInt32(value);
    let chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setUint32(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `sfixed32` value, a signed, fixed-length 32-bit integer.
   */
  sfixed32(value) {
    assertInt32(value);
    let chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setInt32(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `sint32` value, a signed, zigzag-encoded 32-bit varint.
   */
  sint32(value) {
    assertInt32(value);
    value = (value << 1 ^ value >> 31) >>> 0;
    varint32write(value, this.buf);
    return this;
  }
  /**
   * Write a `fixed64` value, a signed, fixed-length 64-bit integer.
   */
  sfixed64(value) {
    let chunk = new Uint8Array(8);
    let view = new DataView(chunk.buffer);
    let long = PbLong.from(value);
    view.setInt32(0, long.lo, true);
    view.setInt32(4, long.hi, true);
    return this.raw(chunk);
  }
  /**
   * Write a `fixed64` value, an unsigned, fixed-length 64 bit integer.
   */
  fixed64(value) {
    let chunk = new Uint8Array(8);
    let view = new DataView(chunk.buffer);
    let long = PbULong.from(value);
    view.setInt32(0, long.lo, true);
    view.setInt32(4, long.hi, true);
    return this.raw(chunk);
  }
  /**
   * Write a `int64` value, a signed 64-bit varint.
   */
  int64(value) {
    let long = PbLong.from(value);
    varint64write(long.lo, long.hi, this.buf);
    return this;
  }
  /**
   * Write a `sint64` value, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64(value) {
    let long = PbLong.from(value), sign = long.hi >> 31, lo = long.lo << 1 ^ sign, hi = (long.hi << 1 | long.lo >>> 31) ^ sign;
    varint64write(lo, hi, this.buf);
    return this;
  }
  /**
   * Write a `uint64` value, an unsigned 64-bit varint.
   */
  uint64(value) {
    let long = PbULong.from(value);
    varint64write(long.lo, long.hi, this.buf);
    return this;
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/json-format-contract.js
var defaultsWrite2 = {
  emitDefaultValues: false,
  enumAsInteger: false,
  useProtoFieldName: false,
  prettySpaces: 0
};
var defaultsRead2 = {
  ignoreUnknownFields: false
};
function jsonReadOptions(options) {
  return options ? Object.assign(Object.assign({}, defaultsRead2), options) : defaultsRead2;
}
function jsonWriteOptions(options) {
  return options ? Object.assign(Object.assign({}, defaultsWrite2), options) : defaultsWrite2;
}

// node_modules/@protobuf-ts/runtime/build/es2015/message-type-contract.js
var MESSAGE_TYPE = Symbol.for("protobuf-ts/message-type");

// node_modules/@protobuf-ts/runtime/build/es2015/lower-camel-case.js
function lowerCamelCase(snakeCase) {
  let capNext = false;
  const sb = [];
  for (let i = 0; i < snakeCase.length; i++) {
    let next = snakeCase.charAt(i);
    if (next == "_") {
      capNext = true;
    } else if (/\d/.test(next)) {
      sb.push(next);
      capNext = true;
    } else if (capNext) {
      sb.push(next.toUpperCase());
      capNext = false;
    } else if (i == 0) {
      sb.push(next.toLowerCase());
    } else {
      sb.push(next);
    }
  }
  return sb.join("");
}

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-info.js
var ScalarType;
(function(ScalarType2) {
  ScalarType2[ScalarType2["DOUBLE"] = 1] = "DOUBLE";
  ScalarType2[ScalarType2["FLOAT"] = 2] = "FLOAT";
  ScalarType2[ScalarType2["INT64"] = 3] = "INT64";
  ScalarType2[ScalarType2["UINT64"] = 4] = "UINT64";
  ScalarType2[ScalarType2["INT32"] = 5] = "INT32";
  ScalarType2[ScalarType2["FIXED64"] = 6] = "FIXED64";
  ScalarType2[ScalarType2["FIXED32"] = 7] = "FIXED32";
  ScalarType2[ScalarType2["BOOL"] = 8] = "BOOL";
  ScalarType2[ScalarType2["STRING"] = 9] = "STRING";
  ScalarType2[ScalarType2["BYTES"] = 12] = "BYTES";
  ScalarType2[ScalarType2["UINT32"] = 13] = "UINT32";
  ScalarType2[ScalarType2["SFIXED32"] = 15] = "SFIXED32";
  ScalarType2[ScalarType2["SFIXED64"] = 16] = "SFIXED64";
  ScalarType2[ScalarType2["SINT32"] = 17] = "SINT32";
  ScalarType2[ScalarType2["SINT64"] = 18] = "SINT64";
})(ScalarType || (ScalarType = {}));
var LongType;
(function(LongType2) {
  LongType2[LongType2["BIGINT"] = 0] = "BIGINT";
  LongType2[LongType2["STRING"] = 1] = "STRING";
  LongType2[LongType2["NUMBER"] = 2] = "NUMBER";
})(LongType || (LongType = {}));
var RepeatType;
(function(RepeatType2) {
  RepeatType2[RepeatType2["NO"] = 0] = "NO";
  RepeatType2[RepeatType2["PACKED"] = 1] = "PACKED";
  RepeatType2[RepeatType2["UNPACKED"] = 2] = "UNPACKED";
})(RepeatType || (RepeatType = {}));
function normalizeFieldInfo(field) {
  var _a, _b, _c, _d;
  field.localName = (_a = field.localName) !== null && _a !== void 0 ? _a : lowerCamelCase(field.name);
  field.jsonName = (_b = field.jsonName) !== null && _b !== void 0 ? _b : lowerCamelCase(field.name);
  field.repeat = (_c = field.repeat) !== null && _c !== void 0 ? _c : RepeatType.NO;
  field.opt = (_d = field.opt) !== null && _d !== void 0 ? _d : field.repeat ? false : field.oneof ? false : field.kind == "message";
  return field;
}

// node_modules/@protobuf-ts/runtime/build/es2015/oneof.js
function isOneofGroup(any) {
  if (typeof any != "object" || any === null || !any.hasOwnProperty("oneofKind")) {
    return false;
  }
  switch (typeof any.oneofKind) {
    case "string":
      if (any[any.oneofKind] === void 0)
        return false;
      return Object.keys(any).length == 2;
    case "undefined":
      return Object.keys(any).length == 1;
    default:
      return false;
  }
}

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-type-check.js
var ReflectionTypeCheck = class {
  constructor(info) {
    var _a;
    this.fields = (_a = info.fields) !== null && _a !== void 0 ? _a : [];
  }
  prepare() {
    if (this.data)
      return;
    const req = [], known = [], oneofs = [];
    for (let field of this.fields) {
      if (field.oneof) {
        if (!oneofs.includes(field.oneof)) {
          oneofs.push(field.oneof);
          req.push(field.oneof);
          known.push(field.oneof);
        }
      } else {
        known.push(field.localName);
        switch (field.kind) {
          case "scalar":
          case "enum":
            if (!field.opt || field.repeat)
              req.push(field.localName);
            break;
          case "message":
            if (field.repeat)
              req.push(field.localName);
            break;
          case "map":
            req.push(field.localName);
            break;
        }
      }
    }
    this.data = { req, known, oneofs: Object.values(oneofs) };
  }
  /**
   * Is the argument a valid message as specified by the
   * reflection information?
   *
   * Checks all field types recursively. The `depth`
   * specifies how deep into the structure the check will be.
   *
   * With a depth of 0, only the presence of fields
   * is checked.
   *
   * With a depth of 1 or more, the field types are checked.
   *
   * With a depth of 2 or more, the members of map, repeated
   * and message fields are checked.
   *
   * Message fields will be checked recursively with depth - 1.
   *
   * The number of map entries / repeated values being checked
   * is < depth.
   */
  is(message, depth, allowExcessProperties = false) {
    if (depth < 0)
      return true;
    if (message === null || message === void 0 || typeof message != "object")
      return false;
    this.prepare();
    let keys = Object.keys(message), data = this.data;
    if (keys.length < data.req.length || data.req.some((n) => !keys.includes(n)))
      return false;
    if (!allowExcessProperties) {
      if (keys.some((k) => !data.known.includes(k)))
        return false;
    }
    if (depth < 1) {
      return true;
    }
    for (const name of data.oneofs) {
      const group = message[name];
      if (!isOneofGroup(group))
        return false;
      if (group.oneofKind === void 0)
        continue;
      const field = this.fields.find((f) => f.localName === group.oneofKind);
      if (!field)
        return false;
      if (!this.field(group[group.oneofKind], field, allowExcessProperties, depth))
        return false;
    }
    for (const field of this.fields) {
      if (field.oneof !== void 0)
        continue;
      if (!this.field(message[field.localName], field, allowExcessProperties, depth))
        return false;
    }
    return true;
  }
  field(arg, field, allowExcessProperties, depth) {
    let repeated = field.repeat;
    switch (field.kind) {
      case "scalar":
        if (arg === void 0)
          return field.opt;
        if (repeated)
          return this.scalars(arg, field.T, depth, field.L);
        return this.scalar(arg, field.T, field.L);
      case "enum":
        if (arg === void 0)
          return field.opt;
        if (repeated)
          return this.scalars(arg, ScalarType.INT32, depth);
        return this.scalar(arg, ScalarType.INT32);
      case "message":
        if (arg === void 0)
          return true;
        if (repeated)
          return this.messages(arg, field.T(), allowExcessProperties, depth);
        return this.message(arg, field.T(), allowExcessProperties, depth);
      case "map":
        if (typeof arg != "object" || arg === null)
          return false;
        if (depth < 2)
          return true;
        if (!this.mapKeys(arg, field.K, depth))
          return false;
        switch (field.V.kind) {
          case "scalar":
            return this.scalars(Object.values(arg), field.V.T, depth, field.V.L);
          case "enum":
            return this.scalars(Object.values(arg), ScalarType.INT32, depth);
          case "message":
            return this.messages(Object.values(arg), field.V.T(), allowExcessProperties, depth);
        }
        break;
    }
    return true;
  }
  message(arg, type, allowExcessProperties, depth) {
    if (allowExcessProperties) {
      return type.isAssignable(arg, depth);
    }
    return type.is(arg, depth);
  }
  messages(arg, type, allowExcessProperties, depth) {
    if (!Array.isArray(arg))
      return false;
    if (depth < 2)
      return true;
    if (allowExcessProperties) {
      for (let i = 0; i < arg.length && i < depth; i++)
        if (!type.isAssignable(arg[i], depth - 1))
          return false;
    } else {
      for (let i = 0; i < arg.length && i < depth; i++)
        if (!type.is(arg[i], depth - 1))
          return false;
    }
    return true;
  }
  scalar(arg, type, longType) {
    let argType = typeof arg;
    switch (type) {
      case ScalarType.UINT64:
      case ScalarType.FIXED64:
      case ScalarType.INT64:
      case ScalarType.SFIXED64:
      case ScalarType.SINT64:
        switch (longType) {
          case LongType.BIGINT:
            return argType == "bigint";
          case LongType.NUMBER:
            return argType == "number" && !isNaN(arg);
          default:
            return argType == "string";
        }
      case ScalarType.BOOL:
        return argType == "boolean";
      case ScalarType.STRING:
        return argType == "string";
      case ScalarType.BYTES:
        return arg instanceof Uint8Array;
      case ScalarType.DOUBLE:
      case ScalarType.FLOAT:
        return argType == "number" && !isNaN(arg);
      default:
        return argType == "number" && Number.isInteger(arg);
    }
  }
  scalars(arg, type, depth, longType) {
    if (!Array.isArray(arg))
      return false;
    if (depth < 2)
      return true;
    if (Array.isArray(arg)) {
      for (let i = 0; i < arg.length && i < depth; i++)
        if (!this.scalar(arg[i], type, longType))
          return false;
    }
    return true;
  }
  mapKeys(map, type, depth) {
    let keys = Object.keys(map);
    switch (type) {
      case ScalarType.INT32:
      case ScalarType.FIXED32:
      case ScalarType.SFIXED32:
      case ScalarType.SINT32:
      case ScalarType.UINT32:
        return this.scalars(keys.slice(0, depth).map((k) => parseInt(k)), type, depth);
      case ScalarType.BOOL:
        return this.scalars(keys.slice(0, depth).map((k) => k == "true" ? true : k == "false" ? false : k), type, depth);
      default:
        return this.scalars(keys, type, depth, LongType.STRING);
    }
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-long-convert.js
function reflectionLongConvert(long, type) {
  switch (type) {
    case LongType.BIGINT:
      return long.toBigInt();
    case LongType.NUMBER:
      return long.toNumber();
    default:
      return long.toString();
  }
}

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-json-reader.js
var ReflectionJsonReader = class {
  constructor(info) {
    this.info = info;
  }
  prepare() {
    var _a;
    if (this.fMap === void 0) {
      this.fMap = {};
      const fieldsInput = (_a = this.info.fields) !== null && _a !== void 0 ? _a : [];
      for (const field of fieldsInput) {
        this.fMap[field.name] = field;
        this.fMap[field.jsonName] = field;
        this.fMap[field.localName] = field;
      }
    }
  }
  // Cannot parse JSON <type of jsonValue> for <type name>#<fieldName>.
  assert(condition, fieldName, jsonValue) {
    if (!condition) {
      let what = typeofJsonValue(jsonValue);
      if (what == "number" || what == "boolean")
        what = jsonValue.toString();
      throw new Error(`Cannot parse JSON ${what} for ${this.info.typeName}#${fieldName}`);
    }
  }
  /**
   * Reads a message from canonical JSON format into the target message.
   *
   * Repeated fields are appended. Map entries are added, overwriting
   * existing keys.
   *
   * If a message field is already present, it will be merged with the
   * new data.
   */
  read(input, message, options) {
    this.prepare();
    const oneofsHandled = [];
    for (const [jsonKey, jsonValue] of Object.entries(input)) {
      const field = this.fMap[jsonKey];
      if (!field) {
        if (!options.ignoreUnknownFields)
          throw new Error(`Found unknown field while reading ${this.info.typeName} from JSON format. JSON key: ${jsonKey}`);
        continue;
      }
      const localName = field.localName;
      let target;
      if (field.oneof) {
        if (jsonValue === null && (field.kind !== "enum" || field.T()[0] !== "google.protobuf.NullValue")) {
          continue;
        }
        if (oneofsHandled.includes(field.oneof))
          throw new Error(`Multiple members of the oneof group "${field.oneof}" of ${this.info.typeName} are present in JSON.`);
        oneofsHandled.push(field.oneof);
        target = message[field.oneof] = {
          oneofKind: localName
        };
      } else {
        target = message;
      }
      if (field.kind == "map") {
        if (jsonValue === null) {
          continue;
        }
        this.assert(isJsonObject(jsonValue), field.name, jsonValue);
        const fieldObj = target[localName];
        for (const [jsonObjKey, jsonObjValue] of Object.entries(jsonValue)) {
          this.assert(jsonObjValue !== null, field.name + " map value", null);
          let val;
          switch (field.V.kind) {
            case "message":
              val = field.V.T().internalJsonRead(jsonObjValue, options);
              break;
            case "enum":
              val = this.enum(field.V.T(), jsonObjValue, field.name, options.ignoreUnknownFields);
              if (val === false)
                continue;
              break;
            case "scalar":
              val = this.scalar(jsonObjValue, field.V.T, field.V.L, field.name);
              break;
          }
          this.assert(val !== void 0, field.name + " map value", jsonObjValue);
          let key = jsonObjKey;
          if (field.K == ScalarType.BOOL)
            key = key == "true" ? true : key == "false" ? false : key;
          key = this.scalar(key, field.K, LongType.STRING, field.name).toString();
          fieldObj[key] = val;
        }
      } else if (field.repeat) {
        if (jsonValue === null)
          continue;
        this.assert(Array.isArray(jsonValue), field.name, jsonValue);
        const fieldArr = target[localName];
        for (const jsonItem of jsonValue) {
          this.assert(jsonItem !== null, field.name, null);
          let val;
          switch (field.kind) {
            case "message":
              val = field.T().internalJsonRead(jsonItem, options);
              break;
            case "enum":
              val = this.enum(field.T(), jsonItem, field.name, options.ignoreUnknownFields);
              if (val === false)
                continue;
              break;
            case "scalar":
              val = this.scalar(jsonItem, field.T, field.L, field.name);
              break;
          }
          this.assert(val !== void 0, field.name, jsonValue);
          fieldArr.push(val);
        }
      } else {
        switch (field.kind) {
          case "message":
            if (jsonValue === null && field.T().typeName != "google.protobuf.Value") {
              this.assert(field.oneof === void 0, field.name + " (oneof member)", null);
              continue;
            }
            target[localName] = field.T().internalJsonRead(jsonValue, options, target[localName]);
            break;
          case "enum":
            if (jsonValue === null)
              continue;
            let val = this.enum(field.T(), jsonValue, field.name, options.ignoreUnknownFields);
            if (val === false)
              continue;
            target[localName] = val;
            break;
          case "scalar":
            if (jsonValue === null)
              continue;
            target[localName] = this.scalar(jsonValue, field.T, field.L, field.name);
            break;
        }
      }
    }
  }
  /**
   * Returns `false` for unrecognized string representations.
   *
   * google.protobuf.NullValue accepts only JSON `null` (or the old `"NULL_VALUE"`).
   */
  enum(type, json, fieldName, ignoreUnknownFields) {
    if (type[0] == "google.protobuf.NullValue")
      assert(json === null || json === "NULL_VALUE", `Unable to parse field ${this.info.typeName}#${fieldName}, enum ${type[0]} only accepts null.`);
    if (json === null)
      return 0;
    switch (typeof json) {
      case "number":
        assert(Number.isInteger(json), `Unable to parse field ${this.info.typeName}#${fieldName}, enum can only be integral number, got ${json}.`);
        return json;
      case "string":
        let localEnumName = json;
        if (type[2] && json.substring(0, type[2].length) === type[2])
          localEnumName = json.substring(type[2].length);
        let enumNumber = type[1][localEnumName];
        if (typeof enumNumber === "undefined" && ignoreUnknownFields) {
          return false;
        }
        assert(typeof enumNumber == "number", `Unable to parse field ${this.info.typeName}#${fieldName}, enum ${type[0]} has no value for "${json}".`);
        return enumNumber;
    }
    assert(false, `Unable to parse field ${this.info.typeName}#${fieldName}, cannot parse enum value from ${typeof json}".`);
  }
  scalar(json, type, longType, fieldName) {
    let e;
    try {
      switch (type) {
        // float, double: JSON value will be a number or one of the special string values "NaN", "Infinity", and "-Infinity".
        // Either numbers or strings are accepted. Exponent notation is also accepted.
        case ScalarType.DOUBLE:
        case ScalarType.FLOAT:
          if (json === null)
            return 0;
          if (json === "NaN")
            return Number.NaN;
          if (json === "Infinity")
            return Number.POSITIVE_INFINITY;
          if (json === "-Infinity")
            return Number.NEGATIVE_INFINITY;
          if (json === "") {
            e = "empty string";
            break;
          }
          if (typeof json == "string" && json.trim().length !== json.length) {
            e = "extra whitespace";
            break;
          }
          if (typeof json != "string" && typeof json != "number") {
            break;
          }
          let float = Number(json);
          if (Number.isNaN(float)) {
            e = "not a number";
            break;
          }
          if (!Number.isFinite(float)) {
            e = "too large or small";
            break;
          }
          if (type == ScalarType.FLOAT)
            assertFloat32(float);
          return float;
        // int32, fixed32, uint32: JSON value will be a decimal number. Either numbers or strings are accepted.
        case ScalarType.INT32:
        case ScalarType.FIXED32:
        case ScalarType.SFIXED32:
        case ScalarType.SINT32:
        case ScalarType.UINT32:
          if (json === null)
            return 0;
          let int32;
          if (typeof json == "number")
            int32 = json;
          else if (json === "")
            e = "empty string";
          else if (typeof json == "string") {
            if (json.trim().length !== json.length)
              e = "extra whitespace";
            else
              int32 = Number(json);
          }
          if (int32 === void 0)
            break;
          if (type == ScalarType.UINT32)
            assertUInt32(int32);
          else
            assertInt32(int32);
          return int32;
        // int64, fixed64, uint64: JSON value will be a decimal string. Either numbers or strings are accepted.
        case ScalarType.INT64:
        case ScalarType.SFIXED64:
        case ScalarType.SINT64:
          if (json === null)
            return reflectionLongConvert(PbLong.ZERO, longType);
          if (typeof json != "number" && typeof json != "string")
            break;
          return reflectionLongConvert(PbLong.from(json), longType);
        case ScalarType.FIXED64:
        case ScalarType.UINT64:
          if (json === null)
            return reflectionLongConvert(PbULong.ZERO, longType);
          if (typeof json != "number" && typeof json != "string")
            break;
          return reflectionLongConvert(PbULong.from(json), longType);
        // bool:
        case ScalarType.BOOL:
          if (json === null)
            return false;
          if (typeof json !== "boolean")
            break;
          return json;
        // string:
        case ScalarType.STRING:
          if (json === null)
            return "";
          if (typeof json !== "string") {
            e = "extra whitespace";
            break;
          }
          try {
            encodeURIComponent(json);
          } catch (e2) {
            e2 = "invalid UTF8";
            break;
          }
          return json;
        // bytes: JSON value will be the data encoded as a string using standard base64 encoding with paddings.
        // Either standard or URL-safe base64 encoding with/without paddings are accepted.
        case ScalarType.BYTES:
          if (json === null || json === "")
            return new Uint8Array(0);
          if (typeof json !== "string")
            break;
          return base64decode(json);
      }
    } catch (error) {
      e = error.message;
    }
    this.assert(false, fieldName + (e ? " - " + e : ""), json);
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-json-writer.js
var ReflectionJsonWriter = class {
  constructor(info) {
    var _a;
    this.fields = (_a = info.fields) !== null && _a !== void 0 ? _a : [];
  }
  /**
   * Converts the message to a JSON object, based on the field descriptors.
   */
  write(message, options) {
    const json = {}, source = message;
    for (const field of this.fields) {
      if (!field.oneof) {
        let jsonValue2 = this.field(field, source[field.localName], options);
        if (jsonValue2 !== void 0)
          json[options.useProtoFieldName ? field.name : field.jsonName] = jsonValue2;
        continue;
      }
      const group = source[field.oneof];
      if (group.oneofKind !== field.localName)
        continue;
      const opt = field.kind == "scalar" || field.kind == "enum" ? Object.assign(Object.assign({}, options), { emitDefaultValues: true }) : options;
      let jsonValue = this.field(field, group[field.localName], opt);
      assert(jsonValue !== void 0);
      json[options.useProtoFieldName ? field.name : field.jsonName] = jsonValue;
    }
    return json;
  }
  field(field, value, options) {
    let jsonValue = void 0;
    if (field.kind == "map") {
      assert(typeof value == "object" && value !== null);
      const jsonObj = {};
      switch (field.V.kind) {
        case "scalar":
          for (const [entryKey, entryValue] of Object.entries(value)) {
            const val = this.scalar(field.V.T, entryValue, field.name, false, true);
            assert(val !== void 0);
            jsonObj[entryKey.toString()] = val;
          }
          break;
        case "message":
          const messageType = field.V.T();
          for (const [entryKey, entryValue] of Object.entries(value)) {
            const val = this.message(messageType, entryValue, field.name, options);
            assert(val !== void 0);
            jsonObj[entryKey.toString()] = val;
          }
          break;
        case "enum":
          const enumInfo = field.V.T();
          for (const [entryKey, entryValue] of Object.entries(value)) {
            assert(entryValue === void 0 || typeof entryValue == "number");
            const val = this.enum(enumInfo, entryValue, field.name, false, true, options.enumAsInteger);
            assert(val !== void 0);
            jsonObj[entryKey.toString()] = val;
          }
          break;
      }
      if (options.emitDefaultValues || Object.keys(jsonObj).length > 0)
        jsonValue = jsonObj;
    } else if (field.repeat) {
      assert(Array.isArray(value));
      const jsonArr = [];
      switch (field.kind) {
        case "scalar":
          for (let i = 0; i < value.length; i++) {
            const val = this.scalar(field.T, value[i], field.name, field.opt, true);
            assert(val !== void 0);
            jsonArr.push(val);
          }
          break;
        case "enum":
          const enumInfo = field.T();
          for (let i = 0; i < value.length; i++) {
            assert(value[i] === void 0 || typeof value[i] == "number");
            const val = this.enum(enumInfo, value[i], field.name, field.opt, true, options.enumAsInteger);
            assert(val !== void 0);
            jsonArr.push(val);
          }
          break;
        case "message":
          const messageType = field.T();
          for (let i = 0; i < value.length; i++) {
            const val = this.message(messageType, value[i], field.name, options);
            assert(val !== void 0);
            jsonArr.push(val);
          }
          break;
      }
      if (options.emitDefaultValues || jsonArr.length > 0 || options.emitDefaultValues)
        jsonValue = jsonArr;
    } else {
      switch (field.kind) {
        case "scalar":
          jsonValue = this.scalar(field.T, value, field.name, field.opt, options.emitDefaultValues);
          break;
        case "enum":
          jsonValue = this.enum(field.T(), value, field.name, field.opt, options.emitDefaultValues, options.enumAsInteger);
          break;
        case "message":
          jsonValue = this.message(field.T(), value, field.name, options);
          break;
      }
    }
    return jsonValue;
  }
  /**
   * Returns `null` as the default for google.protobuf.NullValue.
   */
  enum(type, value, fieldName, optional, emitDefaultValues, enumAsInteger) {
    if (type[0] == "google.protobuf.NullValue")
      return !emitDefaultValues && !optional ? void 0 : null;
    if (value === void 0) {
      assert(optional);
      return void 0;
    }
    if (value === 0 && !emitDefaultValues && !optional)
      return void 0;
    assert(typeof value == "number");
    assert(Number.isInteger(value));
    if (enumAsInteger || !type[1].hasOwnProperty(value))
      return value;
    if (type[2])
      return type[2] + type[1][value];
    return type[1][value];
  }
  message(type, value, fieldName, options) {
    if (value === void 0)
      return options.emitDefaultValues ? null : void 0;
    return type.internalJsonWrite(value, options);
  }
  scalar(type, value, fieldName, optional, emitDefaultValues) {
    if (value === void 0) {
      assert(optional);
      return void 0;
    }
    const ed = emitDefaultValues || optional;
    switch (type) {
      // int32, fixed32, uint32: JSON value will be a decimal number. Either numbers or strings are accepted.
      case ScalarType.INT32:
      case ScalarType.SFIXED32:
      case ScalarType.SINT32:
        if (value === 0)
          return ed ? 0 : void 0;
        assertInt32(value);
        return value;
      case ScalarType.FIXED32:
      case ScalarType.UINT32:
        if (value === 0)
          return ed ? 0 : void 0;
        assertUInt32(value);
        return value;
      // float, double: JSON value will be a number or one of the special string values "NaN", "Infinity", and "-Infinity".
      // Either numbers or strings are accepted. Exponent notation is also accepted.
      case ScalarType.FLOAT:
        assertFloat32(value);
      case ScalarType.DOUBLE:
        if (value === 0)
          return ed ? 0 : void 0;
        assert(typeof value == "number");
        if (Number.isNaN(value))
          return "NaN";
        if (value === Number.POSITIVE_INFINITY)
          return "Infinity";
        if (value === Number.NEGATIVE_INFINITY)
          return "-Infinity";
        return value;
      // string:
      case ScalarType.STRING:
        if (value === "")
          return ed ? "" : void 0;
        assert(typeof value == "string");
        return value;
      // bool:
      case ScalarType.BOOL:
        if (value === false)
          return ed ? false : void 0;
        assert(typeof value == "boolean");
        return value;
      // JSON value will be a decimal string. Either numbers or strings are accepted.
      case ScalarType.UINT64:
      case ScalarType.FIXED64:
        assert(typeof value == "number" || typeof value == "string" || typeof value == "bigint");
        let ulong = PbULong.from(value);
        if (ulong.isZero() && !ed)
          return void 0;
        return ulong.toString();
      // JSON value will be a decimal string. Either numbers or strings are accepted.
      case ScalarType.INT64:
      case ScalarType.SFIXED64:
      case ScalarType.SINT64:
        assert(typeof value == "number" || typeof value == "string" || typeof value == "bigint");
        let long = PbLong.from(value);
        if (long.isZero() && !ed)
          return void 0;
        return long.toString();
      // bytes: JSON value will be the data encoded as a string using standard base64 encoding with paddings.
      // Either standard or URL-safe base64 encoding with/without paddings are accepted.
      case ScalarType.BYTES:
        assert(value instanceof Uint8Array);
        if (!value.byteLength)
          return ed ? "" : void 0;
        return base64encode(value);
    }
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-scalar-default.js
function reflectionScalarDefault(type, longType = LongType.STRING) {
  switch (type) {
    case ScalarType.BOOL:
      return false;
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return reflectionLongConvert(PbULong.ZERO, longType);
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return reflectionLongConvert(PbLong.ZERO, longType);
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return 0;
    case ScalarType.BYTES:
      return new Uint8Array(0);
    case ScalarType.STRING:
      return "";
    default:
      return 0;
  }
}

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-binary-reader.js
var ReflectionBinaryReader = class {
  constructor(info) {
    this.info = info;
  }
  prepare() {
    var _a;
    if (!this.fieldNoToField) {
      const fieldsInput = (_a = this.info.fields) !== null && _a !== void 0 ? _a : [];
      this.fieldNoToField = new Map(fieldsInput.map((field) => [field.no, field]));
    }
  }
  /**
   * Reads a message from binary format into the target message.
   *
   * Repeated fields are appended. Map entries are added, overwriting
   * existing keys.
   *
   * If a message field is already present, it will be merged with the
   * new data.
   */
  read(reader, message, options, length) {
    this.prepare();
    const end = length === void 0 ? reader.len : reader.pos + length;
    while (reader.pos < end) {
      const [fieldNo, wireType] = reader.tag(), field = this.fieldNoToField.get(fieldNo);
      if (!field) {
        let u = options.readUnknownField;
        if (u == "throw")
          throw new Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.info.typeName}`);
        let d = reader.skip(wireType);
        if (u !== false)
          (u === true ? UnknownFieldHandler.onRead : u)(this.info.typeName, message, fieldNo, wireType, d);
        continue;
      }
      let target = message, repeated = field.repeat, localName = field.localName;
      if (field.oneof) {
        target = target[field.oneof];
        if (target.oneofKind !== localName)
          target = message[field.oneof] = {
            oneofKind: localName
          };
      }
      switch (field.kind) {
        case "scalar":
        case "enum":
          let T = field.kind == "enum" ? ScalarType.INT32 : field.T;
          let L = field.kind == "scalar" ? field.L : void 0;
          if (repeated) {
            let arr = target[localName];
            if (wireType == WireType.LengthDelimited && T != ScalarType.STRING && T != ScalarType.BYTES) {
              let e = reader.uint32() + reader.pos;
              while (reader.pos < e)
                arr.push(this.scalar(reader, T, L));
            } else
              arr.push(this.scalar(reader, T, L));
          } else
            target[localName] = this.scalar(reader, T, L);
          break;
        case "message":
          if (repeated) {
            let arr = target[localName];
            let msg = field.T().internalBinaryRead(reader, reader.uint32(), options);
            arr.push(msg);
          } else
            target[localName] = field.T().internalBinaryRead(reader, reader.uint32(), options, target[localName]);
          break;
        case "map":
          let [mapKey, mapVal] = this.mapEntry(field, reader, options);
          target[localName][mapKey] = mapVal;
          break;
      }
    }
  }
  /**
   * Read a map field, expecting key field = 1, value field = 2
   */
  mapEntry(field, reader, options) {
    let length = reader.uint32();
    let end = reader.pos + length;
    let key = void 0;
    let val = void 0;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case 1:
          if (field.K == ScalarType.BOOL)
            key = reader.bool().toString();
          else
            key = this.scalar(reader, field.K, LongType.STRING);
          break;
        case 2:
          switch (field.V.kind) {
            case "scalar":
              val = this.scalar(reader, field.V.T, field.V.L);
              break;
            case "enum":
              val = reader.int32();
              break;
            case "message":
              val = field.V.T().internalBinaryRead(reader, reader.uint32(), options);
              break;
          }
          break;
        default:
          throw new Error(`Unknown field ${fieldNo} (wire type ${wireType}) in map entry for ${this.info.typeName}#${field.name}`);
      }
    }
    if (key === void 0) {
      let keyRaw = reflectionScalarDefault(field.K);
      key = field.K == ScalarType.BOOL ? keyRaw.toString() : keyRaw;
    }
    if (val === void 0)
      switch (field.V.kind) {
        case "scalar":
          val = reflectionScalarDefault(field.V.T, field.V.L);
          break;
        case "enum":
          val = 0;
          break;
        case "message":
          val = field.V.T().create();
          break;
      }
    return [key, val];
  }
  scalar(reader, type, longType) {
    switch (type) {
      case ScalarType.INT32:
        return reader.int32();
      case ScalarType.STRING:
        return reader.string();
      case ScalarType.BOOL:
        return reader.bool();
      case ScalarType.DOUBLE:
        return reader.double();
      case ScalarType.FLOAT:
        return reader.float();
      case ScalarType.INT64:
        return reflectionLongConvert(reader.int64(), longType);
      case ScalarType.UINT64:
        return reflectionLongConvert(reader.uint64(), longType);
      case ScalarType.FIXED64:
        return reflectionLongConvert(reader.fixed64(), longType);
      case ScalarType.FIXED32:
        return reader.fixed32();
      case ScalarType.BYTES:
        return reader.bytes();
      case ScalarType.UINT32:
        return reader.uint32();
      case ScalarType.SFIXED32:
        return reader.sfixed32();
      case ScalarType.SFIXED64:
        return reflectionLongConvert(reader.sfixed64(), longType);
      case ScalarType.SINT32:
        return reader.sint32();
      case ScalarType.SINT64:
        return reflectionLongConvert(reader.sint64(), longType);
    }
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-binary-writer.js
var ReflectionBinaryWriter = class {
  constructor(info) {
    this.info = info;
  }
  prepare() {
    if (!this.fields) {
      const fieldsInput = this.info.fields ? this.info.fields.concat() : [];
      this.fields = fieldsInput.sort((a, b) => a.no - b.no);
    }
  }
  /**
   * Writes the message to binary format.
   */
  write(message, writer, options) {
    this.prepare();
    for (const field of this.fields) {
      let value, emitDefault, repeated = field.repeat, localName = field.localName;
      if (field.oneof) {
        const group = message[field.oneof];
        if (group.oneofKind !== localName)
          continue;
        value = group[localName];
        emitDefault = true;
      } else {
        value = message[localName];
        emitDefault = false;
      }
      switch (field.kind) {
        case "scalar":
        case "enum":
          let T = field.kind == "enum" ? ScalarType.INT32 : field.T;
          if (repeated) {
            assert(Array.isArray(value));
            if (repeated == RepeatType.PACKED)
              this.packed(writer, T, field.no, value);
            else
              for (const item of value)
                this.scalar(writer, T, field.no, item, true);
          } else if (value === void 0)
            assert(field.opt);
          else
            this.scalar(writer, T, field.no, value, emitDefault || field.opt);
          break;
        case "message":
          if (repeated) {
            assert(Array.isArray(value));
            for (const item of value)
              this.message(writer, options, field.T(), field.no, item);
          } else {
            this.message(writer, options, field.T(), field.no, value);
          }
          break;
        case "map":
          assert(typeof value == "object" && value !== null);
          for (const [key, val] of Object.entries(value))
            this.mapEntry(writer, options, field, key, val);
          break;
      }
    }
    let u = options.writeUnknownFields;
    if (u !== false)
      (u === true ? UnknownFieldHandler.onWrite : u)(this.info.typeName, message, writer);
  }
  mapEntry(writer, options, field, key, value) {
    writer.tag(field.no, WireType.LengthDelimited);
    writer.fork();
    let keyValue = key;
    switch (field.K) {
      case ScalarType.INT32:
      case ScalarType.FIXED32:
      case ScalarType.UINT32:
      case ScalarType.SFIXED32:
      case ScalarType.SINT32:
        keyValue = Number.parseInt(key);
        break;
      case ScalarType.BOOL:
        assert(key == "true" || key == "false");
        keyValue = key == "true";
        break;
    }
    this.scalar(writer, field.K, 1, keyValue, true);
    switch (field.V.kind) {
      case "scalar":
        this.scalar(writer, field.V.T, 2, value, true);
        break;
      case "enum":
        this.scalar(writer, ScalarType.INT32, 2, value, true);
        break;
      case "message":
        this.message(writer, options, field.V.T(), 2, value);
        break;
    }
    writer.join();
  }
  message(writer, options, handler, fieldNo, value) {
    if (value === void 0)
      return;
    handler.internalBinaryWrite(value, writer.tag(fieldNo, WireType.LengthDelimited).fork(), options);
    writer.join();
  }
  /**
   * Write a single scalar value.
   */
  scalar(writer, type, fieldNo, value, emitDefault) {
    let [wireType, method, isDefault] = this.scalarInfo(type, value);
    if (!isDefault || emitDefault) {
      writer.tag(fieldNo, wireType);
      writer[method](value);
    }
  }
  /**
   * Write an array of scalar values in packed format.
   */
  packed(writer, type, fieldNo, value) {
    if (!value.length)
      return;
    assert(type !== ScalarType.BYTES && type !== ScalarType.STRING);
    writer.tag(fieldNo, WireType.LengthDelimited);
    writer.fork();
    let [, method] = this.scalarInfo(type);
    for (let i = 0; i < value.length; i++)
      writer[method](value[i]);
    writer.join();
  }
  /**
   * Get information for writing a scalar value.
   *
   * Returns tuple:
   * [0]: appropriate WireType
   * [1]: name of the appropriate method of IBinaryWriter
   * [2]: whether the given value is a default value
   *
   * If argument `value` is omitted, [2] is always false.
   */
  scalarInfo(type, value) {
    let t = WireType.Varint;
    let m;
    let i = value === void 0;
    let d = value === 0;
    switch (type) {
      case ScalarType.INT32:
        m = "int32";
        break;
      case ScalarType.STRING:
        d = i || !value.length;
        t = WireType.LengthDelimited;
        m = "string";
        break;
      case ScalarType.BOOL:
        d = value === false;
        m = "bool";
        break;
      case ScalarType.UINT32:
        m = "uint32";
        break;
      case ScalarType.DOUBLE:
        t = WireType.Bit64;
        m = "double";
        break;
      case ScalarType.FLOAT:
        t = WireType.Bit32;
        m = "float";
        break;
      case ScalarType.INT64:
        d = i || PbLong.from(value).isZero();
        m = "int64";
        break;
      case ScalarType.UINT64:
        d = i || PbULong.from(value).isZero();
        m = "uint64";
        break;
      case ScalarType.FIXED64:
        d = i || PbULong.from(value).isZero();
        t = WireType.Bit64;
        m = "fixed64";
        break;
      case ScalarType.BYTES:
        d = i || !value.byteLength;
        t = WireType.LengthDelimited;
        m = "bytes";
        break;
      case ScalarType.FIXED32:
        t = WireType.Bit32;
        m = "fixed32";
        break;
      case ScalarType.SFIXED32:
        t = WireType.Bit32;
        m = "sfixed32";
        break;
      case ScalarType.SFIXED64:
        d = i || PbLong.from(value).isZero();
        t = WireType.Bit64;
        m = "sfixed64";
        break;
      case ScalarType.SINT32:
        m = "sint32";
        break;
      case ScalarType.SINT64:
        d = i || PbLong.from(value).isZero();
        m = "sint64";
        break;
    }
    return [t, m, i || d];
  }
};

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-create.js
function reflectionCreate(type) {
  const msg = type.messagePrototype ? Object.create(type.messagePrototype) : Object.defineProperty({}, MESSAGE_TYPE, { value: type });
  for (let field of type.fields) {
    let name = field.localName;
    if (field.opt)
      continue;
    if (field.oneof)
      msg[field.oneof] = { oneofKind: void 0 };
    else if (field.repeat)
      msg[name] = [];
    else
      switch (field.kind) {
        case "scalar":
          msg[name] = reflectionScalarDefault(field.T, field.L);
          break;
        case "enum":
          msg[name] = 0;
          break;
        case "map":
          msg[name] = {};
          break;
      }
  }
  return msg;
}

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-merge-partial.js
function reflectionMergePartial(info, target, source) {
  let fieldValue, input = source, output;
  for (let field of info.fields) {
    let name = field.localName;
    if (field.oneof) {
      const group = input[field.oneof];
      if ((group === null || group === void 0 ? void 0 : group.oneofKind) == void 0) {
        continue;
      }
      fieldValue = group[name];
      output = target[field.oneof];
      output.oneofKind = group.oneofKind;
      if (fieldValue == void 0) {
        delete output[name];
        continue;
      }
    } else {
      fieldValue = input[name];
      output = target;
      if (fieldValue == void 0) {
        continue;
      }
    }
    if (field.repeat)
      output[name].length = fieldValue.length;
    switch (field.kind) {
      case "scalar":
      case "enum":
        if (field.repeat)
          for (let i = 0; i < fieldValue.length; i++)
            output[name][i] = fieldValue[i];
        else
          output[name] = fieldValue;
        break;
      case "message":
        let T = field.T();
        if (field.repeat)
          for (let i = 0; i < fieldValue.length; i++)
            output[name][i] = T.create(fieldValue[i]);
        else if (output[name] === void 0)
          output[name] = T.create(fieldValue);
        else
          T.mergePartial(output[name], fieldValue);
        break;
      case "map":
        switch (field.V.kind) {
          case "scalar":
          case "enum":
            Object.assign(output[name], fieldValue);
            break;
          case "message":
            let T2 = field.V.T();
            for (let k of Object.keys(fieldValue))
              output[name][k] = T2.create(fieldValue[k]);
            break;
        }
        break;
    }
  }
}

// node_modules/@protobuf-ts/runtime/build/es2015/reflection-equals.js
function reflectionEquals(info, a, b) {
  if (a === b)
    return true;
  if (!a || !b)
    return false;
  for (let field of info.fields) {
    let localName = field.localName;
    let val_a = field.oneof ? a[field.oneof][localName] : a[localName];
    let val_b = field.oneof ? b[field.oneof][localName] : b[localName];
    switch (field.kind) {
      case "enum":
      case "scalar":
        let t = field.kind == "enum" ? ScalarType.INT32 : field.T;
        if (!(field.repeat ? repeatedPrimitiveEq(t, val_a, val_b) : primitiveEq(t, val_a, val_b)))
          return false;
        break;
      case "map":
        if (!(field.V.kind == "message" ? repeatedMsgEq(field.V.T(), objectValues(val_a), objectValues(val_b)) : repeatedPrimitiveEq(field.V.kind == "enum" ? ScalarType.INT32 : field.V.T, objectValues(val_a), objectValues(val_b))))
          return false;
        break;
      case "message":
        let T = field.T();
        if (!(field.repeat ? repeatedMsgEq(T, val_a, val_b) : T.equals(val_a, val_b)))
          return false;
        break;
    }
  }
  return true;
}
var objectValues = Object.values;
function primitiveEq(type, a, b) {
  if (a === b)
    return true;
  if (type !== ScalarType.BYTES)
    return false;
  let ba = a;
  let bb = b;
  if (ba.length !== bb.length)
    return false;
  for (let i = 0; i < ba.length; i++)
    if (ba[i] != bb[i])
      return false;
  return true;
}
function repeatedPrimitiveEq(type, a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0; i < a.length; i++)
    if (!primitiveEq(type, a[i], b[i]))
      return false;
  return true;
}
function repeatedMsgEq(type, a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0; i < a.length; i++)
    if (!type.equals(a[i], b[i]))
      return false;
  return true;
}

// node_modules/@protobuf-ts/runtime/build/es2015/message-type.js
var baseDescriptors = Object.getOwnPropertyDescriptors(Object.getPrototypeOf({}));
var messageTypeDescriptor = baseDescriptors[MESSAGE_TYPE] = {};
var MessageType = class {
  constructor(name, fields, options) {
    this.defaultCheckDepth = 16;
    this.typeName = name;
    this.fields = fields.map(normalizeFieldInfo);
    this.options = options !== null && options !== void 0 ? options : {};
    messageTypeDescriptor.value = this;
    this.messagePrototype = Object.create(null, baseDescriptors);
    this.refTypeCheck = new ReflectionTypeCheck(this);
    this.refJsonReader = new ReflectionJsonReader(this);
    this.refJsonWriter = new ReflectionJsonWriter(this);
    this.refBinReader = new ReflectionBinaryReader(this);
    this.refBinWriter = new ReflectionBinaryWriter(this);
  }
  create(value) {
    let message = reflectionCreate(this);
    if (value !== void 0) {
      reflectionMergePartial(this, message, value);
    }
    return message;
  }
  /**
   * Clone the message.
   *
   * Unknown fields are discarded.
   */
  clone(message) {
    let copy = this.create();
    reflectionMergePartial(this, copy, message);
    return copy;
  }
  /**
   * Determines whether two message of the same type have the same field values.
   * Checks for deep equality, traversing repeated fields, oneof groups, maps
   * and messages recursively.
   * Will also return true if both messages are `undefined`.
   */
  equals(a, b) {
    return reflectionEquals(this, a, b);
  }
  /**
   * Is the given value assignable to our message type
   * and contains no [excess properties](https://www.typescriptlang.org/docs/handbook/interfaces.html#excess-property-checks)?
   */
  is(arg, depth = this.defaultCheckDepth) {
    return this.refTypeCheck.is(arg, depth, false);
  }
  /**
   * Is the given value assignable to our message type,
   * regardless of [excess properties](https://www.typescriptlang.org/docs/handbook/interfaces.html#excess-property-checks)?
   */
  isAssignable(arg, depth = this.defaultCheckDepth) {
    return this.refTypeCheck.is(arg, depth, true);
  }
  /**
   * Copy partial data into the target message.
   */
  mergePartial(target, source) {
    reflectionMergePartial(this, target, source);
  }
  /**
   * Create a new message from binary format.
   */
  fromBinary(data, options) {
    let opt = binaryReadOptions(options);
    return this.internalBinaryRead(opt.readerFactory(data), data.byteLength, opt);
  }
  /**
   * Read a new message from a JSON value.
   */
  fromJson(json, options) {
    return this.internalJsonRead(json, jsonReadOptions(options));
  }
  /**
   * Read a new message from a JSON string.
   * This is equivalent to `T.fromJson(JSON.parse(json))`.
   */
  fromJsonString(json, options) {
    let value = JSON.parse(json);
    return this.fromJson(value, options);
  }
  /**
   * Write the message to canonical JSON value.
   */
  toJson(message, options) {
    return this.internalJsonWrite(message, jsonWriteOptions(options));
  }
  /**
   * Convert the message to canonical JSON string.
   * This is equivalent to `JSON.stringify(T.toJson(t))`
   */
  toJsonString(message, options) {
    var _a;
    let value = this.toJson(message, options);
    return JSON.stringify(value, null, (_a = options === null || options === void 0 ? void 0 : options.prettySpaces) !== null && _a !== void 0 ? _a : 0);
  }
  /**
   * Write the message to binary format.
   */
  toBinary(message, options) {
    let opt = binaryWriteOptions(options);
    return this.internalBinaryWrite(message, opt.writerFactory(), opt).finish();
  }
  /**
   * This is an internal method. If you just want to read a message from
   * JSON, use `fromJson()` or `fromJsonString()`.
   *
   * Reads JSON value and merges the fields into the target
   * according to protobuf rules. If the target is omitted,
   * a new instance is created first.
   */
  internalJsonRead(json, options, target) {
    if (json !== null && typeof json == "object" && !Array.isArray(json)) {
      let message = target !== null && target !== void 0 ? target : this.create();
      this.refJsonReader.read(json, message, options);
      return message;
    }
    throw new Error(`Unable to parse message ${this.typeName} from JSON ${typeofJsonValue(json)}.`);
  }
  /**
   * This is an internal method. If you just want to write a message
   * to JSON, use `toJson()` or `toJsonString().
   *
   * Writes JSON value and returns it.
   */
  internalJsonWrite(message, options) {
    return this.refJsonWriter.write(message, options);
  }
  /**
   * This is an internal method. If you just want to write a message
   * in binary format, use `toBinary()`.
   *
   * Serializes the message in binary format and appends it to the given
   * writer. Returns passed writer.
   */
  internalBinaryWrite(message, writer, options) {
    this.refBinWriter.write(message, writer, options);
    return writer;
  }
  /**
   * This is an internal method. If you just want to read a message from
   * binary data, use `fromBinary()`.
   *
   * Reads data from binary format and merges the fields into
   * the target according to protobuf rules. If the target is
   * omitted, a new instance is created first.
   */
  internalBinaryRead(reader, length, options, target) {
    let message = target !== null && target !== void 0 ? target : this.create();
    this.refBinReader.read(reader, message, options, length);
    return message;
  }
};

// src/proto/bilibili/app/viewunite/v1/view.ts
var TabType = /* @__PURE__ */ ((TabType2) => {
  TabType2[TabType2["TAB_NONE"] = 0] = "TAB_NONE";
  TabType2[TabType2["TAB_INTRODUCTION"] = 1] = "TAB_INTRODUCTION";
  return TabType2;
})(TabType || {});
var ModuleType = /* @__PURE__ */ ((ModuleType2) => {
  ModuleType2[ModuleType2["UNKNOWN"] = 0] = "UNKNOWN";
  ModuleType2[ModuleType2["UGC_HEADLINE"] = 3] = "UGC_HEADLINE";
  ModuleType2[ModuleType2["ACTIVITY"] = 18] = "ACTIVITY";
  ModuleType2[ModuleType2["RELATED_RECOMMEND"] = 28] = "RELATED_RECOMMEND";
  ModuleType2[ModuleType2["PAY_BAR"] = 29] = "PAY_BAR";
  ModuleType2[ModuleType2["SPECIALTAG"] = 37] = "SPECIALTAG";
  ModuleType2[ModuleType2["MERCHANDISE"] = 55] = "MERCHANDISE";
  ModuleType2[ModuleType2["VIDEO_MENTIONS"] = 63] = "VIDEO_MENTIONS";
  return ModuleType2;
})(ModuleType || {});
var RelateCardType = /* @__PURE__ */ ((RelateCardType2) => {
  RelateCardType2[RelateCardType2["CARD_TYPE_UNKNOWN"] = 0] = "CARD_TYPE_UNKNOWN";
  RelateCardType2[RelateCardType2["AV"] = 1] = "AV";
  RelateCardType2[RelateCardType2["GAME"] = 4] = "GAME";
  RelateCardType2[RelateCardType2["CM_TYPE"] = 5] = "CM_TYPE";
  RelateCardType2[RelateCardType2["LIVE"] = 6] = "LIVE";
  RelateCardType2[RelateCardType2["AI_RECOMMEND"] = 7] = "AI_RECOMMEND";
  RelateCardType2[RelateCardType2["COURSE"] = 11] = "COURSE";
  return RelateCardType2;
})(RelateCardType || {});
var ViewReply$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.ViewReply", [
      { no: 3, name: "req_user", kind: "message", T: () => ReqUser },
      { no: 5, name: "tab", kind: "message", T: () => Tab },
      {
        no: 7,
        name: "cm",
        kind: "scalar",
        opt: true,
        T: 12
        /*ScalarType.BYTES*/
      }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* bilibili.app.viewunite.v1.ReqUser req_user */
        3:
          message.reqUser = ReqUser.internalBinaryRead(reader, reader.uint32(), options, message.reqUser);
          break;
        case /* bilibili.app.viewunite.v1.Tab tab */
        5:
          message.tab = Tab.internalBinaryRead(reader, reader.uint32(), options, message.tab);
          break;
        case /* optional bytes cm */
        7:
          message.cm = reader.bytes();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.reqUser)
      ReqUser.internalBinaryWrite(message.reqUser, writer.tag(3, WireType.LengthDelimited).fork(), options).join();
    if (message.tab)
      Tab.internalBinaryWrite(message.tab, writer.tag(5, WireType.LengthDelimited).fork(), options).join();
    if (message.cm !== void 0)
      writer.tag(7, WireType.LengthDelimited).bytes(message.cm);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var ViewReply = /* @__PURE__ */ new ViewReply$Type();
var ReqUser$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.ReqUser", [
      {
        no: 7,
        name: "elec_plus_btn",
        kind: "scalar",
        opt: true,
        T: 12
        /*ScalarType.BYTES*/
      }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* optional bytes elec_plus_btn */
        7:
          message.elecPlusBtn = reader.bytes();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.elecPlusBtn !== void 0)
      writer.tag(7, WireType.LengthDelimited).bytes(message.elecPlusBtn);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var ReqUser = /* @__PURE__ */ new ReqUser$Type();
var Tab$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.Tab", [
      { no: 1, name: "tab_module", kind: "message", repeat: 2, T: () => TabModule }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.tabModule = [];
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* repeated bilibili.app.viewunite.v1.TabModule tab_module */
        1:
          message.tabModule.push(TabModule.internalBinaryRead(reader, reader.uint32(), options));
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    for (let i = 0; i < message.tabModule.length; i++)
      TabModule.internalBinaryWrite(message.tabModule[i], writer.tag(1, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var Tab = /* @__PURE__ */ new Tab$Type();
var TabModule$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.TabModule", [
      { no: 1, name: "tab_type", kind: "enum", T: () => ["bilibili.app.viewunite.v1.TabType", TabType] },
      { no: 2, name: "introduction", kind: "message", oneof: "tab", T: () => IntroductionTab }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.tabType = 0;
    message.tab = { oneofKind: void 0 };
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* bilibili.app.viewunite.v1.TabType tab_type */
        1:
          message.tabType = reader.int32();
          break;
        case /* bilibili.app.viewunite.v1.IntroductionTab introduction */
        2:
          message.tab = {
            oneofKind: "introduction",
            introduction: IntroductionTab.internalBinaryRead(reader, reader.uint32(), options, message.tab.introduction)
          };
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.tabType !== 0)
      writer.tag(1, WireType.Varint).int32(message.tabType);
    if (message.tab.oneofKind === "introduction")
      IntroductionTab.internalBinaryWrite(message.tab.introduction, writer.tag(2, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var TabModule = /* @__PURE__ */ new TabModule$Type();
var IntroductionTab$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.IntroductionTab", [
      { no: 2, name: "modules", kind: "message", repeat: 2, T: () => Module }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.modules = [];
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* repeated bilibili.app.viewunite.v1.Module modules */
        2:
          message.modules.push(Module.internalBinaryRead(reader, reader.uint32(), options));
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    for (let i = 0; i < message.modules.length; i++)
      Module.internalBinaryWrite(message.modules[i], writer.tag(2, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var IntroductionTab = /* @__PURE__ */ new IntroductionTab$Type();
var Module$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.Module", [
      { no: 1, name: "type", kind: "enum", T: () => ["bilibili.app.viewunite.v1.ModuleType", ModuleType] },
      { no: 5, name: "head_line", kind: "message", oneof: "data", T: () => Headline },
      { no: 22, name: "relates", kind: "message", oneof: "data", T: () => Relates }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.type = 0;
    message.data = { oneofKind: void 0 };
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* bilibili.app.viewunite.v1.ModuleType type */
        1:
          message.type = reader.int32();
          break;
        case /* bilibili.app.viewunite.v1.Headline head_line */
        5:
          message.data = {
            oneofKind: "headLine",
            headLine: Headline.internalBinaryRead(reader, reader.uint32(), options, message.data.headLine)
          };
          break;
        case /* bilibili.app.viewunite.v1.Relates relates */
        22:
          message.data = {
            oneofKind: "relates",
            relates: Relates.internalBinaryRead(reader, reader.uint32(), options, message.data.relates)
          };
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.type !== 0)
      writer.tag(1, WireType.Varint).int32(message.type);
    if (message.data.oneofKind === "headLine")
      Headline.internalBinaryWrite(message.data.headLine, writer.tag(5, WireType.LengthDelimited).fork(), options).join();
    if (message.data.oneofKind === "relates")
      Relates.internalBinaryWrite(message.data.relates, writer.tag(22, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var Module = /* @__PURE__ */ new Module$Type();
var Headline$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.Headline", [
      {
        no: 1,
        name: "label",
        kind: "scalar",
        opt: true,
        T: 12
        /*ScalarType.BYTES*/
      }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* optional bytes label */
        1:
          message.label = reader.bytes();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.label !== void 0)
      writer.tag(1, WireType.LengthDelimited).bytes(message.label);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var Headline = /* @__PURE__ */ new Headline$Type();
var Relates$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.Relates", [
      { no: 1, name: "cards", kind: "message", repeat: 2, T: () => RelateCard }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.cards = [];
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* repeated bilibili.app.viewunite.v1.RelateCard cards */
        1:
          message.cards.push(RelateCard.internalBinaryRead(reader, reader.uint32(), options));
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    for (let i = 0; i < message.cards.length; i++)
      RelateCard.internalBinaryWrite(message.cards[i], writer.tag(1, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var Relates = /* @__PURE__ */ new Relates$Type();
var RelateCard$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.RelateCard", [
      { no: 1, name: "relate_card_type", kind: "enum", T: () => ["bilibili.app.viewunite.v1.RelateCardType", RelateCardType] },
      {
        no: 11,
        name: "cm_stock",
        kind: "scalar",
        T: 12
        /*ScalarType.BYTES*/
      },
      { no: 12, name: "basic_info", kind: "message", T: () => CardBasicInfo }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.relateCardType = 0;
    message.cmStock = new Uint8Array(0);
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* bilibili.app.viewunite.v1.RelateCardType relate_card_type */
        1:
          message.relateCardType = reader.int32();
          break;
        case /* bytes cm_stock */
        11:
          message.cmStock = reader.bytes();
          break;
        case /* bilibili.app.viewunite.v1.CardBasicInfo basic_info */
        12:
          message.basicInfo = CardBasicInfo.internalBinaryRead(reader, reader.uint32(), options, message.basicInfo);
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.relateCardType !== 0)
      writer.tag(1, WireType.Varint).int32(message.relateCardType);
    if (message.cmStock.length)
      writer.tag(11, WireType.LengthDelimited).bytes(message.cmStock);
    if (message.basicInfo)
      CardBasicInfo.internalBinaryWrite(message.basicInfo, writer.tag(12, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var RelateCard = /* @__PURE__ */ new RelateCard$Type();
var CardBasicInfo$Type = class extends MessageType {
  constructor() {
    super("bilibili.app.viewunite.v1.CardBasicInfo", [
      {
        no: 6,
        name: "unique_id",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.uniqueId = "";
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string unique_id */
        6:
          message.uniqueId = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.uniqueId !== "")
      writer.tag(6, WireType.LengthDelimited).string(message.uniqueId);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var CardBasicInfo = /* @__PURE__ */ new CardBasicInfo$Type();

// src/proto/bilibili/community/service/dm/v1/dm.ts
var DmColorfulType = /* @__PURE__ */ ((DmColorfulType2) => {
  DmColorfulType2[DmColorfulType2["NONE_TYPE"] = 0] = "NONE_TYPE";
  DmColorfulType2[DmColorfulType2["VIP_GRADUAL_COLOR"] = 60001] = "VIP_GRADUAL_COLOR";
  return DmColorfulType2;
})(DmColorfulType || {});
var DmSegMobileReq$Type = class extends MessageType {
  constructor() {
    super("bilibili.community.service.dm.v1.DmSegMobileReq", [
      {
        no: 1,
        name: "pid",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      },
      {
        no: 2,
        name: "oid",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      },
      {
        no: 3,
        name: "type",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 4,
        name: "segment_index",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      },
      {
        no: 6,
        name: "ps",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      },
      {
        no: 7,
        name: "pe",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.pid = "0";
    message.oid = "0";
    message.type = 0;
    message.segmentIndex = "0";
    message.ps = "0";
    message.pe = "0";
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* int64 pid */
        1:
          message.pid = reader.int64().toString();
          break;
        case /* int64 oid */
        2:
          message.oid = reader.int64().toString();
          break;
        case /* int32 type */
        3:
          message.type = reader.int32();
          break;
        case /* int64 segment_index */
        4:
          message.segmentIndex = reader.int64().toString();
          break;
        case /* int64 ps */
        6:
          message.ps = reader.int64().toString();
          break;
        case /* int64 pe */
        7:
          message.pe = reader.int64().toString();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.pid !== "0")
      writer.tag(1, WireType.Varint).int64(message.pid);
    if (message.oid !== "0")
      writer.tag(2, WireType.Varint).int64(message.oid);
    if (message.type !== 0)
      writer.tag(3, WireType.Varint).int32(message.type);
    if (message.segmentIndex !== "0")
      writer.tag(4, WireType.Varint).int64(message.segmentIndex);
    if (message.ps !== "0")
      writer.tag(6, WireType.Varint).int64(message.ps);
    if (message.pe !== "0")
      writer.tag(7, WireType.Varint).int64(message.pe);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var DmSegMobileReq = /* @__PURE__ */ new DmSegMobileReq$Type();
var DmSegMobileReply$Type = class extends MessageType {
  constructor() {
    super("bilibili.community.service.dm.v1.DmSegMobileReply", [
      { no: 1, name: "elems", kind: "message", repeat: 2, T: () => DanmakuElem }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.elems = [];
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* repeated bilibili.community.service.dm.v1.DanmakuElem elems */
        1:
          message.elems.push(DanmakuElem.internalBinaryRead(reader, reader.uint32(), options));
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    for (let i = 0; i < message.elems.length; i++)
      DanmakuElem.internalBinaryWrite(message.elems[i], writer.tag(1, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var DmSegMobileReply = /* @__PURE__ */ new DmSegMobileReply$Type();
var DanmakuElem$Type = class extends MessageType {
  constructor() {
    super("bilibili.community.service.dm.v1.DanmakuElem", [
      {
        no: 1,
        name: "id",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      },
      {
        no: 2,
        name: "progress",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 3,
        name: "mode",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 4,
        name: "fontsize",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 5,
        name: "color",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 6,
        name: "mid_hash",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      {
        no: 7,
        name: "content",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      {
        no: 8,
        name: "ctime",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      },
      {
        no: 9,
        name: "weight",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 10,
        name: "action",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      {
        no: 11,
        name: "pool",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 12,
        name: "id_str",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      {
        no: 13,
        name: "attr",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 22,
        name: "animation",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      {
        no: 23,
        name: "extra",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      { no: 24, name: "colorful", kind: "enum", T: () => ["bilibili.community.service.dm.v1.DmColorfulType", DmColorfulType] },
      {
        no: 25,
        name: "type",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      },
      {
        no: 26,
        name: "oid",
        kind: "scalar",
        T: 3
        /*ScalarType.INT64*/
      },
      {
        no: 27,
        name: "dm_from",
        kind: "scalar",
        T: 5
        /*ScalarType.INT32*/
      }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.id = "0";
    message.progress = 0;
    message.mode = 0;
    message.fontsize = 0;
    message.color = 0;
    message.midHash = "";
    message.content = "";
    message.ctime = "0";
    message.weight = 0;
    message.action = "";
    message.pool = 0;
    message.idStr = "";
    message.attr = 0;
    message.animation = "";
    message.extra = "";
    message.colorful = 0;
    message.type = 0;
    message.oid = "0";
    message.dmFrom = 0;
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* int64 id */
        1:
          message.id = reader.int64().toString();
          break;
        case /* int32 progress */
        2:
          message.progress = reader.int32();
          break;
        case /* int32 mode */
        3:
          message.mode = reader.int32();
          break;
        case /* int32 fontsize */
        4:
          message.fontsize = reader.int32();
          break;
        case /* int32 color */
        5:
          message.color = reader.int32();
          break;
        case /* string mid_hash */
        6:
          message.midHash = reader.string();
          break;
        case /* string content */
        7:
          message.content = reader.string();
          break;
        case /* int64 ctime */
        8:
          message.ctime = reader.int64().toString();
          break;
        case /* int32 weight */
        9:
          message.weight = reader.int32();
          break;
        case /* string action */
        10:
          message.action = reader.string();
          break;
        case /* int32 pool */
        11:
          message.pool = reader.int32();
          break;
        case /* string id_str */
        12:
          message.idStr = reader.string();
          break;
        case /* int32 attr */
        13:
          message.attr = reader.int32();
          break;
        case /* string animation */
        22:
          message.animation = reader.string();
          break;
        case /* string extra */
        23:
          message.extra = reader.string();
          break;
        case /* bilibili.community.service.dm.v1.DmColorfulType colorful */
        24:
          message.colorful = reader.int32();
          break;
        case /* int32 type */
        25:
          message.type = reader.int32();
          break;
        case /* int64 oid */
        26:
          message.oid = reader.int64().toString();
          break;
        case /* int32 dm_from */
        27:
          message.dmFrom = reader.int32();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.id !== "0")
      writer.tag(1, WireType.Varint).int64(message.id);
    if (message.progress !== 0)
      writer.tag(2, WireType.Varint).int32(message.progress);
    if (message.mode !== 0)
      writer.tag(3, WireType.Varint).int32(message.mode);
    if (message.fontsize !== 0)
      writer.tag(4, WireType.Varint).int32(message.fontsize);
    if (message.color !== 0)
      writer.tag(5, WireType.Varint).int32(message.color);
    if (message.midHash !== "")
      writer.tag(6, WireType.LengthDelimited).string(message.midHash);
    if (message.content !== "")
      writer.tag(7, WireType.LengthDelimited).string(message.content);
    if (message.ctime !== "0")
      writer.tag(8, WireType.Varint).int64(message.ctime);
    if (message.weight !== 0)
      writer.tag(9, WireType.Varint).int32(message.weight);
    if (message.action !== "")
      writer.tag(10, WireType.LengthDelimited).string(message.action);
    if (message.pool !== 0)
      writer.tag(11, WireType.Varint).int32(message.pool);
    if (message.idStr !== "")
      writer.tag(12, WireType.LengthDelimited).string(message.idStr);
    if (message.attr !== 0)
      writer.tag(13, WireType.Varint).int32(message.attr);
    if (message.animation !== "")
      writer.tag(22, WireType.LengthDelimited).string(message.animation);
    if (message.extra !== "")
      writer.tag(23, WireType.LengthDelimited).string(message.extra);
    if (message.colorful !== 0)
      writer.tag(24, WireType.Varint).int32(message.colorful);
    if (message.type !== 0)
      writer.tag(25, WireType.Varint).int32(message.type);
    if (message.oid !== "0")
      writer.tag(26, WireType.Varint).int64(message.oid);
    if (message.dmFrom !== 0)
      writer.tag(27, WireType.Varint).int32(message.dmFrom);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var DanmakuElem = /* @__PURE__ */ new DanmakuElem$Type();

// src/proto/bilibili/main/community/reply/v1/reply.ts
var Type = /* @__PURE__ */ ((Type2) => {
  Type2[Type2["UNKNOWN"] = 0] = "UNKNOWN";
  Type2[Type2["OGV_GRADE"] = 1] = "OGV_GRADE";
  Type2[Type2["UP_PROTECTION"] = 2] = "UP_PROTECTION";
  Type2[Type2["CM"] = 3] = "CM";
  Type2[Type2["UP_SELECTION"] = 4] = "UP_SELECTION";
  Type2[Type2["OPERATION"] = 5] = "OPERATION";
  Type2[Type2["VOTE"] = 6] = "VOTE";
  Type2[Type2["ESPORTS_GRADE"] = 7] = "ESPORTS_GRADE";
  return Type2;
})(Type || {});
var MainListReply$Type = class extends MessageType {
  constructor() {
    super("bilibili.main.community.reply.v1.MainListReply", [
      {
        no: 11,
        name: "cm",
        kind: "scalar",
        opt: true,
        T: 12
        /*ScalarType.BYTES*/
      },
      { no: 14, name: "top_replies", kind: "message", repeat: 2, T: () => ReplyInfo },
      { no: 28, name: "subject_top_cards", kind: "message", repeat: 2, T: () => SubjectTopCard }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.topReplies = [];
    message.subjectTopCards = [];
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* optional bytes cm */
        11:
          message.cm = reader.bytes();
          break;
        case /* repeated bilibili.main.community.reply.v1.ReplyInfo top_replies */
        14:
          message.topReplies.push(ReplyInfo.internalBinaryRead(reader, reader.uint32(), options));
          break;
        case /* repeated bilibili.main.community.reply.v1.SubjectTopCard subject_top_cards */
        28:
          message.subjectTopCards.push(SubjectTopCard.internalBinaryRead(reader, reader.uint32(), options));
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.cm !== void 0)
      writer.tag(11, WireType.LengthDelimited).bytes(message.cm);
    for (let i = 0; i < message.topReplies.length; i++)
      ReplyInfo.internalBinaryWrite(message.topReplies[i], writer.tag(14, WireType.LengthDelimited).fork(), options).join();
    for (let i = 0; i < message.subjectTopCards.length; i++)
      SubjectTopCard.internalBinaryWrite(message.subjectTopCards[i], writer.tag(28, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var MainListReply = /* @__PURE__ */ new MainListReply$Type();
var ReplyInfo$Type = class extends MessageType {
  constructor() {
    super("bilibili.main.community.reply.v1.ReplyInfo", [
      { no: 12, name: "content", kind: "message", T: () => Content }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* bilibili.main.community.reply.v1.Content content */
        12:
          message.content = Content.internalBinaryRead(reader, reader.uint32(), options, message.content);
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.content)
      Content.internalBinaryWrite(message.content, writer.tag(12, WireType.LengthDelimited).fork(), options).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var ReplyInfo = /* @__PURE__ */ new ReplyInfo$Type();
var Content$Type = class extends MessageType {
  constructor() {
    super("bilibili.main.community.reply.v1.Content", [
      {
        no: 1,
        name: "message",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      { no: 5, name: "urls", kind: "map", K: 9, V: { kind: "message", T: () => Url } }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.message = "";
    message.urls = {};
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string message */
        1:
          message.message = reader.string();
          break;
        case /* map<string, bilibili.main.community.reply.v1.Url> urls */
        5:
          this.binaryReadMap5(message.urls, reader, options);
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  binaryReadMap5(map, reader, options) {
    let len = reader.uint32(), end = reader.pos + len, key, val;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case 1:
          key = reader.string();
          break;
        case 2:
          val = Url.internalBinaryRead(reader, reader.uint32(), options);
          break;
        default:
          throw new globalThis.Error("unknown map entry field for bilibili.main.community.reply.v1.Content.urls");
      }
    }
    map[key ?? ""] = val ?? Url.create();
  }
  internalBinaryWrite(message, writer, options) {
    if (message.message !== "")
      writer.tag(1, WireType.LengthDelimited).string(message.message);
    for (let k of globalThis.Object.keys(message.urls)) {
      writer.tag(5, WireType.LengthDelimited).fork().tag(1, WireType.LengthDelimited).string(k);
      writer.tag(2, WireType.LengthDelimited).fork();
      Url.internalBinaryWrite(message.urls[k], writer, options);
      writer.join().join();
    }
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var Content = /* @__PURE__ */ new Content$Type();
var Url$Type = class extends MessageType {
  constructor() {
    super("bilibili.main.community.reply.v1.Url", [
      {
        no: 1,
        name: "title",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      {
        no: 5,
        name: "app_name",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      },
      {
        no: 6,
        name: "app_package_name",
        kind: "scalar",
        T: 9
        /*ScalarType.STRING*/
      }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.title = "";
    message.appName = "";
    message.appPackageName = "";
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string title */
        1:
          message.title = reader.string();
          break;
        case /* string app_name */
        5:
          message.appName = reader.string();
          break;
        case /* string app_package_name */
        6:
          message.appPackageName = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.title !== "")
      writer.tag(1, WireType.LengthDelimited).string(message.title);
    if (message.appName !== "")
      writer.tag(5, WireType.LengthDelimited).string(message.appName);
    if (message.appPackageName !== "")
      writer.tag(6, WireType.LengthDelimited).string(message.appPackageName);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var Url = /* @__PURE__ */ new Url$Type();
var SubjectTopCard$Type = class extends MessageType {
  constructor() {
    super("bilibili.main.community.reply.v1.SubjectTopCard", [
      { no: 1, name: "type", kind: "enum", T: () => ["bilibili.main.community.reply.v1.Type", Type] }
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.type = 0;
    if (value !== void 0)
      reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(), end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* bilibili.main.community.reply.v1.Type type */
        1:
          message.type = reader.int32();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    if (message.type !== 0)
      writer.tag(1, WireType.Varint).int32(message.type);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
    return writer;
  }
};
var SubjectTopCard = /* @__PURE__ */ new SubjectTopCard$Type();

// src/service/sponsor-block.service.ts
function encodeJsonList(values) {
  return encodeURIComponent(JSON.stringify(values));
}
function getSkipSegments(videoId, cid = "", options = { categories: ["sponsor"], actionTypes: ["skip"] }) {
  cid = cid !== "0" ? cid : "";
  const query = [
    `videoID=${encodeURIComponent(videoId)}`,
    `cid=${encodeURIComponent(cid)}`,
    `categories=${encodeJsonList(options.categories)}`,
    `actionTypes=${encodeJsonList(options.actionTypes)}`
  ].join("&");
  return ctx.fetch({
    method: "get",
    url: `https://bsbsb.top/api/skipSegments?${query}`,
    headers: {
      origin: "chrome-extension://eaoelafamejbnggahofapllmfhlhajdd",
      "x-ext-version": "0.5.0",
      "User-Agent": options.userAgent || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 BilibiliSponsorBlock-Surge/1.0"
    },
    timeout: 3
    // fail open quickly; never block Bilibili playback for bsbsb lookup
  });
}

// src/script/bilibili/protobuf/handler.ts
var handleViewReply = (ctx2, next) => {
  const message = ViewReply.fromBinary(ctx2.response.bodyBytes);
  message.cm = void 0;
  message.reqUser && (message.reqUser.elecPlusBtn = void 0);
  const excludeTypes = [
    18 /* ACTIVITY */,
    29 /* PAY_BAR */,
    37 /* SPECIALTAG */,
    55 /* MERCHANDISE */,
    63 /* VIDEO_MENTIONS */
  ];
  message.tab?.tabModule.forEach((tabModule) => {
    if (tabModule.tab.oneofKind !== "introduction") return;
    tabModule.tab.introduction.modules = tabModule.tab.introduction.modules.filter((module) => {
      if (excludeTypes.includes(module.type)) {
        return false;
      }
      if (module.type === 3 /* UGC_HEADLINE */ && module.data.oneofKind === "headLine") {
        module.data.headLine.label = void 0;
      } else if (module.type === 28 /* RELATED_RECOMMEND */ && module.data.oneofKind === "relates") {
        module.data.relates.cards = handleRelateCard(module.data.relates.cards);
      }
      return true;
    }, []);
  });
  ctx2.response.bodyBytes = ViewReply.toBinary(message);
  return next();
};
function handleRelateCard(cards) {
  const excludeTypes = [
    4 /* GAME */,
    5 /* CM_TYPE */,
    6 /* LIVE */,
    7 /* AI_RECOMMEND */,
    11 /* COURSE */
  ];
  return cards.filter((card) => {
    return !excludeTypes.includes(card.relateCardType) && !card.cmStock.length && !card.basicInfo?.uniqueId;
  });
}
var handleMainListReply = (ctx2, next) => {
  const { purifyComment } = ctx2.argument;
  const message = MainListReply.fromBinary(ctx2.response.bodyBytes);
  message.cm = void 0;
  message.subjectTopCards = message.subjectTopCards.filter((item) => item.type !== 3 /* CM */);
  if (purifyComment) {
    const excludeLinkPattern = /https:\/\/b23\.tv\/(?:cm|mall)/;
    const excludeKeywordPattern = /淘宝|某宝|天猫|京东|狗东|拼多多|饿了么|美团|转转|妙界|神气小鹿/;
    message.topReplies = message.topReplies.filter((reply) => {
      const urls = reply.content?.urls || {};
      const message2 = reply.content?.message || "";
      return !Object.keys(urls).some((url) => excludeLinkPattern.test(url)) && !excludeLinkPattern.test(message2) && !excludeKeywordPattern.test(message2);
    });
  }
  ctx2.response.bodyBytes = MainListReply.toBinary(message);
  return next();
};
var handleRequest = async (ctx2, next) => {
  const { headers, bodyBytes, h2_trailers } = await fetchBilibili(ctx2);
  ctx2.response.headers = headers;
  ctx2.response.bodyBytes = bodyBytes;
  ctx2.response.h2_trailers = h2_trailers;
  return next();
};
var handleDmSegMobileReq = async (ctx2, next) => {
  let body = ctx2.request.bodyBytes;
  let data = body[0] ? ungzip(body.subarray(5)) : body.subarray(5);
  const message = DmSegMobileReq.fromBinary(data);
  if (message.type !== 1) exit();
  const { pid, oid } = message;
  const videoId = toBvid(pid);
  const [{ headers, bodyBytes, h2_trailers }, segments] = await Promise.all([
    fetchBilibili(ctx2, 1),
    fetchSponsorBlock(ctx2, videoId, oid)
  ]);
  ctx2.response.headers = headers;
  ctx2.response.bodyBytes = bodyBytes;
  ctx2.response.h2_trailers = h2_trailers;
  if (segments.length) {
    ctx2.state.segments = segments;
    ctx2.state.sponsorBlockOptions = normalizeSponsorBlockOptions(ctx2.argument);
    return next();
  }
};
async function fetchBilibili(ctx2, maxRetries = 2) {
  const { method, url: sourceUrl, headers, bodyBytes } = ctx2.request;
  const url = new URL(sourceUrl);
  const hosts = ["grpc.biliapi.net", "app.bilibili.com"];
  const startIndex = Math.max(0, hosts.indexOf(url.hostname));
  const endIndex = Math.min(startIndex + maxRetries, hosts.length);
  for (let i = startIndex; i < endIndex; i++) {
    url.hostname = hosts[i];
    const request = { method, url: url.toString(), headers, body: bodyBytes, timeout: 3 };
    try {
      const response = await ctx2.fetch(request);
      if (response.status === 200 && response.bodyBytes) {
        return response;
      }
      Logger.info("[Bilibili] Invalid response", {
        method: request.method,
        url: request.url,
        status: response.status,
        headers: response.headers,
        body: response.bodyBytes
      });
    } catch (e) {
      Logger.info("[Bilibili]", e, {
        method: request.method,
        url: request.url
      });
    }
  }
  Logger.error("[Bilibili] All hosts failed", {
    method: ctx2.method,
    url: ctx2.request.url
  });
  exit(1);
}
var DEFAULT_CATEGORIES = ["sponsor", "selfpromo", "interaction"];
var INTRO_OUTRO_CATEGORIES = ["intro", "outro", "padding", "music_offtopic"];
var POI_CATEGORIES = ["poi_highlight"];
var DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 BilibiliSponsorBlock-Surge/1.0";
var CATEGORY_LABELS = {
  sponsor: "\u6070\u996D\u5E7F\u544A\u5DF2\u6807\u8BB0",
  selfpromo: "\u63A8\u5E7F\u7247\u6BB5\u5DF2\u6807\u8BB0",
  interaction: "\u4E92\u52A8\u63D0\u9192\u5DF2\u6807\u8BB0",
  intro: "\u7247\u5934\u53EF\u8DF3\u8FC7",
  outro: "\u7247\u5C3E\u53EF\u8DF3\u8FC7",
  padding: "\u7A7A\u767D\u6BB5\u843D\u53EF\u8DF3\u8FC7",
  music_offtopic: "\u975E\u97F3\u4E50\u6BB5\u843D\u53EF\u8DF3\u8FC7",
  poi_highlight: "\u9AD8\u80FD\u70B9\u5DF2\u6807\u8BB0"
};
function normalizeSponsorBlockOptions(argument) {
  const categories = new Set(parseList(argument.categories, DEFAULT_CATEGORIES));
  if (toBoolean(argument.includeIntroOutro)) INTRO_OUTRO_CATEGORIES.forEach((category) => categories.add(category));
  if (toBoolean(argument.includePoiHighlight)) POI_CATEGORIES.forEach((category) => categories.add(category));
  const actionTypes = new Set(parseList(argument.actionTypes, ["skip"]));
  if (toBoolean(argument.includePoiHighlight)) actionTypes.add("poi");
  return {
    categories: [...categories],
    actionTypes: [...actionTypes],
    minDuration: toNumber(argument.minDuration, 5, 0, 120),
    mergeGap: toNumber(argument.mergeGap, 1.5, 0, 30),
    offsetMs: toNumber(argument.offsetMs, 2e3, 0, 1e4),
    maxSegments: Math.round(toNumber(argument.maxSegments, 12, 1, 50)),
    cacheMinutes: toNumber(argument.cacheMinutes, 60, 0, 1440),
    userAgent: argument.userAgent || DEFAULT_USER_AGENT
  };
}
function parseList(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = value.split(/[|,\s]+/).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}
function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes", "on", "\u5F00\u542F", "\u542F\u7528"].includes(value.toLowerCase());
  return false;
}
function toNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
async function fetchSponsorBlock(ctx2, videoId, cid) {
  const options = normalizeSponsorBlockOptions(ctx2.argument);
  const cacheKey = buildCacheKey(videoId, cid, options);
  const cached = readCachedSegments(ctx2, cacheKey, options.cacheMinutes);
  if (cached) return cached;
  try {
    const { status, body } = await getSkipSegments(videoId, cid, options);
    Logger.debug("[SponsorBlock]", { videoId, cid, status, categories: options.categories, actionTypes: options.actionTypes });
    if (status !== 200 || !body || body === "[]") {
      return [];
    }
    const segments = parseSegments(body, options);
    writeCachedSegments(ctx2, cacheKey, segments, options.cacheMinutes);
    return segments;
  } catch (e) {
    Logger.info("[SponsorBlock]", e);
    return [];
  }
}
function buildCacheKey(videoId, cid, options) {
  return [
    "bsbsb.airborne.v1",
    videoId,
    cid,
    options.categories.join("|"),
    options.actionTypes.join("|"),
    options.minDuration,
    options.mergeGap
  ].join(":");
}
function readCachedSegments(ctx2, cacheKey, cacheMinutes) {
  if (cacheMinutes <= 0) return null;
  try {
    const cached = ctx2.getJSON(cacheKey);
    if (!cached?.createdAt || !Array.isArray(cached.segments)) return null;
    if (Date.now() - cached.createdAt > cacheMinutes * 60 * 1e3) return null;
    return cached.segments;
  } catch {
    return null;
  }
}
function writeCachedSegments(ctx2, cacheKey, segments, cacheMinutes) {
  if (cacheMinutes <= 0) return;
  try {
    ctx2.setJSON({ createdAt: Date.now(), segments }, cacheKey);
  } catch (e) {
    Logger.debug("[SponsorBlock] cache write failed", e);
  }
}
function parseSegments(body, options) {
  const categories = new Set(options.categories);
  const actionTypes = new Set(options.actionTypes);
  const parsed = JSON.parse(body).reduce((memo, item) => {
    const segment = item.segment;
    if (!Array.isArray(segment) || segment.length < 2) return memo;
    const start = Number(segment[0]);
    const end = Number(segment[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return memo;
    if (!categories.has(item.category) || !actionTypes.has(item.actionType)) return memo;
    if (item.actionType === "poi") {
      memo.push({ start, end: start, category: item.category, actionType: item.actionType, UUID: item.UUID });
      return memo;
    }
    if (end <= start || end - start < options.minDuration) return memo;
    memo.push({ start, end, category: item.category, actionType: item.actionType, UUID: item.UUID });
    return memo;
  }, []);
  return mergeSegments(parsed, options).slice(0, options.maxSegments);
}
function mergeSegments(segments, options) {
  const skipSegments = segments.filter((segment) => segment.actionType === "skip").sort((left, right) => left.start - right.start);
  const merged = [];
  for (const segment of skipSegments) {
    const last = merged.at(-1);
    if (last && segment.start <= last.end + options.mergeGap) {
      last.end = Math.max(last.end, segment.end);
      if (last.category !== segment.category) last.category = "sponsor";
      continue;
    }
    merged.push({ ...segment });
  }
  return [
    ...merged,
    ...segments.filter((segment) => segment.actionType !== "skip")
  ].sort((left, right) => left.start - right.start);
}
var handleDmSegMobileReply = (ctx2, next) => {
  const message = DmSegMobileReply.fromBinary(ctx2.response.bodyBytes);
  message.elems.push(...createAirborneDanmaku(ctx2.state.segments, ctx2.state.sponsorBlockOptions));
  ctx2.response.bodyBytes = DmSegMobileReply.toBinary(message);
  return next();
};
function createAirborneDanmaku(segments, options) {
  return segments.map((segment, index) => {
    const id = String(index + 1);
    const target = Math.floor(segment.end * 1e3);
    const progress = segment.actionType === "poi" ? Math.max(0, Math.floor(segment.start * 1e3) - options.offsetMs) : Math.floor(segment.start * 1e3) + options.offsetMs;
    return {
      id,
      progress,
      mode: 5,
      fontsize: 50,
      color: 16777215,
      midHash: "1948dd5d",
      content: `\u7A7A\u6307\u90E8\u5DF2\u5C31\u4F4D \xB7 ${CATEGORY_LABELS[segment.category] || "\u7247\u6BB5\u5DF2\u6807\u8BB0"}`,
      ctime: "1735660800",
      weight: 11,
      action: `airborne:${target}`,
      pool: 0,
      idStr: id,
      attr: 1310724,
      animation: "",
      extra: JSON.stringify({ category: segment.category, actionType: segment.actionType, UUID: segment.UUID || "" }),
      colorful: 0 /* NONE_TYPE */,
      type: 1,
      oid: "212364987",
      dmFrom: 1
    };
  });
}

// src/script/bilibili/protobuf/request/router.ts
var router = new Router({
  matchPath: matchUrlSuffix
});
router.post("v1.DM/DmSegMobile", handleDmSegMobileReq, parseGrpcResponse, handleDmSegMobileReply);
router.post("viewunite.v1.View/View", handleRequest, parseGrpcResponse, handleViewReply);
router.post("v1.Reply/MainList", handleRequest, parseGrpcResponse, handleMainListReply);

// src/script/bilibili/protobuf/request/app.ts
var app = new Application();
app.use(doneFakeResponse).use(initArgument).use(handleResponseHeaders).use(router.routes()).use(router.routeNotMatched());

// src/script/bilibili/protobuf/request/main.ts
app.run();
