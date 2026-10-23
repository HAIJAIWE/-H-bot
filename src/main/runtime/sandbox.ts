// src/main/runtime/sandbox.ts
//
// 硬化沙箱（架构修复 WI-1 / P0-2）—— 自建节点与第三方插件代码的执行边界。
//
// ## 为什么要有这一层（2026-10-01 实测确认的逃逸）
//
// 旧实现把**宿主 realm 的函数对象**直接塞进了 vm 上下文：
//   · dynamicHandlers / pluginScanner 注入的是宿主 `setTimeout` / `clearTimeout`
//   · `console.*` 是闭合了宿主 logger 的宿主函数
// 而宿主函数的 `.constructor` 是**宿主 realm 的 Function**，不受
// `codeGeneration:{strings:false}` 约束 —— 于是
// `setTimeout.constructor('return process')()` 就能拿到宿主 process，
// 经由 `process.getBuiltinModule('child_process')` 直达 RCE。
// 第二个同源缺口：调用期传入的 `callCtx`（bot / log / callBuiltin）本身是宿主对象，
// 插件 `ctx.log.constructor('return process')()` 同样逃逸。
//
// ## 设计原则（跨 realm 传递的对象必须全部是沙箱 realm 产物）
//
// 1. `__hostBridge` 是唯一一次注入的宿主函数；引导脚本把它捕获进**闭包**后
//    立刻 `delete globalThis.__hostBridge` —— 插件开始执行时全局名已不存在。
// 2. 桥只能经闭包访问，插件的 getOwnPropertyNames / for...in / Proxy 都拿不到。
// 3. 一切进入沙箱的宿主数据都是 **JSON 字符串**，在沙箱内 JSON.parse 成沙箱 realm 对象；
//    返回值同样以 JSON 字符串回传。宿主对象/数组/函数绝不作为参数传给沙箱函数。
// 4. 沙箱内定义的所有函数（ctx.log / ctx.callBuiltin / __invoke）都是沙箱 realm 函数，
//    其 `.constructor` 是本 realm 的 Function，被 codeGeneration.strings=false 拦住。
// 5. 上下文用 **null 原型对象** contextify。若用普通 `{}`，`this.constructor` 会解析到
//    宿主的 Object（实测 `this.constructor === Object` 为 false），
//    `this.constructor.constructor('return process')()` 依然逃逸。
//
// ## 诚实的边界
//
// `node:vm` **不是安全机制**（官方文档口径）。本层消除的是**已知可达**的逃逸路径；
// 真正的硬隔离需要 utilityProcess / 子进程，属后续独立立项。
import vm from 'vm';

/**
 * 宿主能力桥：入参与返回值都必须是 JSON 字符串。
 * 它是唯一一次被注入沙箱的宿主函数，插件永远拿不到它本身。
 */
export type HostBridge = (payloadJson: string) => string;

/** 沙箱 → 宿主的桥消息（全部经 JSON 字符串过界） */
export type SandboxBridgeMessage =
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; args: unknown[] }
  | {
      kind: 'call';
      token: number;
      /** 调用期标识：同一个 handler 可能被并发调用，宿主靠它找回该次的 bot/event/ctx */
      callId: number | null;
      target: 'callBuiltin' | 'botCallApi';
      name: string;
      args: unknown[];
    }
  | { kind: 'timerSet'; id: number; ms: number }
  | { kind: 'timerClear'; id: number };

/** 宿主 → 沙箱的迟到结果（经 deliverToSandbox 送入） */
export interface SandboxInboundMessage {
  kind: '__call-result';
  token: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * 沙箱引导脚本：在插件代码之前跑一次，负责建桥、造 ctx、封死可逃逸的钩子。
 *
 * ⚠️ 这段代码本身必须只用沙箱 realm 的语法（它会被 vm.runInContext 编译），
 * 且不能用模板字符串 —— 它嵌在一个 TS 模板字符串里。
 */
const SANDBOX_BOOTSTRAP = `(function () {
  'use strict';

  // ── 1. 唯一一次注入的宿主能力：捕获进闭包后立刻抹掉全局名 ──────────────
  var bridge = globalThis.__hostBridge;
  delete globalThis.__hostBridge;

  // ── 2. 先扣下本 realm 的原生内建 ────────────────────────────────────────
  // 插件随后可以把 JSON / Promise 的原型改得面目全非；桥的转发必须走启动时
  // 扣下的这一份，否则"宿主回调"会被插件换成自己的函数。
  var jsonParse = JSON.parse;
  var jsonStringify = JSON.stringify;
  var PromiseCtor = Promise;
  var nativeResolve = Promise.resolve;
  var nativeThen = Promise.prototype.then;
  var defineProp = Object.defineProperty;
  var ErrorCtor = Error;

  // AI 插件用的 JSON 桥（与 __hostBridge 的区别：只做 JSON 进出的包装，不交出宿主 Function 引用）
  // AI 插件的工具函数表：插件 activate 时用 api.handleTool(name, fn) 注册，
  // 宿主把调用送进来（inbound 的 kind:'call' 分支）时在这里查表执行。
  var aiHandlers = Object.create(null);

  var __qqbatHostCall = function (payloadJson) {
    try {
      // payloadJson **已经**是 JSON 字符串：直接过桥，不要再 JSON.stringify（那会二次编码）
      return bridge(String(payloadJson));
    } catch (e) {
      return '{"ok":false,"error":"host call failed"}';
    }
  };
  defineProp(globalThis, '__qqbatHostCall', {
    value: __qqbatHostCall,
    writable: false,
    configurable: false,
  });

  // ── 3. 封死 Error.prepareStackTrace ─────────────────────────────────────
  // 它是 V8 交出 CallSite 的唯一钩子，而 CallSite.getFunction()/getThis()
  // 能把栈帧里的函数对象递出来 —— 只要栈上有宿主帧，就等于交出宿主 Function。
  // 默认栈格式化不经过任何用户回调，所以"锁成 undefined 且不可写"是安全的。
  try {
    defineProp(ErrorCtor, 'prepareStackTrace', {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch (e) { /* 引擎没有该属性：忽略 */ }

  function errText(e) {
    try {
      if (e && e.message !== undefined) return String(e.message);
      return String(e);
    } catch (x) {
      return '未知错误';
    }
  }

  function safeJsonText(v) {
    try {
      var s = jsonStringify(v);
      return s === undefined ? 'null' : s;
    } catch (e) {
      return 'null';
    }
  }

  function bridgeCall(msg) {
    return bridge(jsonStringify(msg));
  }

  function envelopeOk(v) {
    return '{"ok":true,"value":' + safeJsonText(v) + '}';
  }

  function envelopeError(e) {
    return '{"ok":false,"error":' + safeJsonText(errText(e)) + '}';
  }

  // ── 4. 日志：沙箱函数 → 桥，参数只送 JSON 能表达的值 ────────────────────
  function safeArg(a) {
    if (a === null) return null;
    var t = typeof a;
    if (t === 'number' || t === 'boolean' || t === 'string') return a;
    return safeJsonText(a);
  }

  function logVia(level, argsLike) {
    var safe = [];
    for (var i = 0; i < argsLike.length; i++) safe.push(safeArg(argsLike[i]));
    try {
      bridgeCall({ kind: 'log', level: level, args: safe });
    } catch (e) { /* 日志失败不该影响节点执行 */ }
  }

  function makeConsole() {
    var c = {};
    var bind = function (level) {
      return function () { logVia(level, arguments); };
    };
    defineProp(c, 'log', { value: bind('info'), writable: false, configurable: false });
    defineProp(c, 'info', { value: bind('info'), writable: false, configurable: false });
    defineProp(c, 'warn', { value: bind('warn'), writable: false, configurable: false });
    defineProp(c, 'error', { value: bind('error'), writable: false, configurable: false });
    return c;
  }

  // ── 5. 定时器：宿主负责时钟，沙箱只登记回调 ─────────────────────────────
  var timerSeq = 1;
  var timerSlots = Object.create(null);

  function sandboxSetTimeout(fn, ms) {
    if (typeof fn !== 'function') throw new TypeError('setTimeout 需要回调函数');
    var id = timerSeq++;
    timerSlots[id] = fn;
    try {
      bridgeCall({ kind: 'timerSet', id: id, ms: Number(ms) || 0 });
    } catch (e) {
      delete timerSlots[id];
      throw e;
    }
    return id;
  }

  function sandboxClearTimeout(id) {
    var key = Number(id) || 0;
    delete timerSlots[key];
    try {
      bridgeCall({ kind: 'timerClear', id: key });
    } catch (e) { /* 清理失败无所谓 */ }
  }

  // ── 6. 调宿主能力（callBuiltin / bot.callApi）：结果由宿主迟到送回 ──────
  var callSeq = 1;
  var callSlots = Object.create(null);

  function callHost(callId, target, name, args) {
    return new PromiseCtor(function (resolve, reject) {
      var token = callSeq++;
      callSlots[token] = { resolve: resolve, reject: reject };
      var msg;
      try {
        msg = jsonStringify({
          kind: 'call',
          token: token,
          callId: callId,
          target: target,
          name: name,
          args: args,
        });
      } catch (e) {
        delete callSlots[token];
        reject(new ErrorCtor('调用宿主能力失败：参数无法序列化'));
        return;
      }
      try {
        bridge(msg);
      } catch (e) {
        delete callSlots[token];
        reject(new ErrorCtor('调用宿主能力失败：' + errText(e)));
      }
    });
  }

  // ── 7. 宿主 → 沙箱 的唯一入口 ───────────────────────────────────────────
  // 宿主扣下这个函数并在异步结果就绪时直接调用它，只传 JSON 字符串。
  function inbound(msgJson) {
    var msg;
    try { msg = jsonParse(msgJson); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    // ── AI 插件的工具调用：宿主送进来的 { kind:'call', target:'aiPlugin', name, args, token }
    if (msg.kind === 'call' && msg.target === 'aiPlugin') {
      var token = msg.token;
      var reply = function (ok, value, error) {
        try {
          bridge(jsonStringify({
            kind: '__call-result', token: token, ok: ok,
            value: value === undefined ? null : value,
            error: error === undefined ? '' : error,
          }));
        } catch (e) { /* 回传失败只能丢弃：宿主侧会按超时收尾 */ }
      };
      var fn = aiHandlers[String(msg.name)];
      if (typeof fn !== 'function') {
        reply(false, null, 'unknown plugin tool: ' + String(msg.name));
        return;
      }
      try {
        var out = fn.apply(null, msg.args || []);
        var done = function (v) { reply(true, v, ''); };
        var fail = function (e) { reply(false, null, errText(e)); };
        if (out && typeof out.then === 'function') {
          nativeThen.call(out, done, fail);
        } else {
          done(out);
        }
      } catch (e) {
        reply(false, null, errText(e));
      }
      return;
    }
    if (msg.kind === '__call-result') {
      var slot = callSlots[msg.token];
      if (!slot) return;
      delete callSlots[msg.token];
      if (msg.ok) slot.resolve(msg.value);
      else slot.reject(new ErrorCtor(String(msg.error)));
      return;
    }
    if (msg.kind === '__timer') {
      var cb = timerSlots[msg.id];
      if (!cb) return;
      delete timerSlots[msg.id];
      try { cb(); } catch (e) { /* 插件定时器回调抛错不该打断宿主 */ }
    }
  }

  // ── 8. ctx 工厂：返回的每个值/函数都是沙箱 realm 产物 ───────────────────
  function makeCtx(data) {
    var d = data && typeof data === 'object' ? data : {};
    var config = d.config === undefined ? {} : d.config;
    // callId 由宿主在每次调用时给出；ctx 里的宿主能力把它带回去，
    // 宿主才能在一次 handler 被并发调用时找回"这一次"的 bot / event / ctx。
    var callId = typeof d.callId === 'number' ? d.callId : null;
    var botData = d.bot && typeof d.bot === 'object' ? d.bot : {};
    var bot = {
      self_id: botData.self_id === undefined ? null : botData.self_id,
      callApi: function (api, params) {
        return callHost(callId, 'botCallApi', String(api), [params === undefined ? {} : params]);
      },
    };
    return {
      config: config,
      // 与旧实现一致：运行时把同一个 kwargs 同时当作 config 与 inputs 暴露
      inputs: config,
      event: d.event,
      projectPath: d.projectPath,
      bot: bot,
      log: function () { logVia('info', arguments); },
      callBuiltin: function (kind, kwargs) {
        return callHost(callId, 'callBuiltin', String(kind), [
          kwargs === undefined ? {} : kwargs,
        ]);
      },
    };
  }

  // ── 9. handler 安装 / 调用 ─────────────────────────────────────────────
  var handlerFn = null;

  function install(fn) {
    if (typeof fn !== 'function') {
      throw new ErrorCtor('handler 必须是一个函数表达式，例如 async (ctx) => { ... }');
    }
    handlerFn = fn;
    return true;
  }

  function isThenable(v) {
    if (!v || (typeof v !== 'object' && typeof v !== 'function')) return false;
    try { return typeof v.then === 'function'; } catch (e) { return false; }
  }

  function invoke(payloadJson) {
    if (typeof handlerFn !== 'function') throw new ErrorCtor('沙箱内尚未安装 handler');
    var data;
    try { data = jsonParse(payloadJson); } catch (e) { return envelopeError(e); }
    var ctx = makeCtx(data);
    var result;
    try { result = handlerFn(ctx); } catch (e) { return envelopeError(e); }
    if (!isThenable(result)) return envelopeOk(result);

    // 异步：返回一个**我们自己造的**"信封 thenable"。
    // 为什么不直接把沙箱 Promise 交给宿主 await：await 会调用对象上的 .then，
    // 插件把 Promise.prototype.then 一改，宿主 resolve/reject 就被递到插件手里
    // （实测：await 会调用被改写的 then）。这里 then 是 own property、不可写，
    // 且它只把 JSON 字符串喂给宿主回调 —— 宿主函数不进插件可见的作用域。
    var settled = nativeResolve.call(PromiseCtor, result);
    var wrapper = {};
    defineProp(wrapper, 'then', {
      value: function (onSettled, onRejected) {
        nativeThen.call(
          settled,
          function (v) {
            try { onSettled(envelopeOk(v)); } catch (e) { /* 宿主回调抛错：忽略 */ }
          },
          function (e) {
            // ⚠️ 必须支持**第二个参数**（2026-10-02 审查发现 L3）。
            // 宿主是按标准 then(resolve, reject) 两参形式调用的，而旧实现只取第一个 ——
            // 于是宿主拿到的 Promise **永远不会 reject**，错误只能以 {ok:false} 信封
            // 从 onFulfilled 里出来。当前调用方（untrustedWorker）恰好解了信封，
            // 但这是个陷阱：任何"信 reject"的调用方都会把失败当成功。
            // 没给第二个参数时保持旧行为（信封走 onSettled），给了才 reject。
            if (typeof onRejected === 'function') {
              try { onRejected(envelopeError(e)); return; } catch (x) { /* 同上 */ }
            }
            try { onSettled(envelopeError(e)); } catch (x) { /* 同上 */ }
          },
        );
      },
      writable: false,
      configurable: false,
      enumerable: false,
    });
    return wrapper;
  }

  // ── 10. 插件脚本的 exports 回传（JSON 字符串，绝不让宿主读沙箱对象）────
  var moduleObj = { exports: {} };
  var exportsAlias = moduleObj.exports;

  function readExports() {
    var v;
    try { v = moduleObj.exports; } catch (e) { return 'null'; }
    if (v === undefined || v === null) v = exportsAlias;
    return safeJsonText(v);
  }

  // ── 11. 全局面：只留沙箱 realm 的东西，宿主函数一个都不留 ────────────────
  globalThis.console = makeConsole();
  globalThis.setTimeout = sandboxSetTimeout;
  globalThis.clearTimeout = sandboxClearTimeout;
  globalThis.process = undefined;
  globalThis.require = undefined;
  globalThis.Buffer = undefined;
  globalThis.global = undefined;
  globalThis.__dirname = undefined;
  globalThis.__filename = undefined;
  globalThis.module = moduleObj;
  globalThis.exports = exportsAlias;

  // 这几个是宿主与沙箱之间的固定接口：不可写、不可配置，插件换不掉。
  defineProp(globalThis, '__qqbatInbound', { value: inbound, writable: false, configurable: false });
  // AI 插件的工具函数表（表本身可变，属性不可换）：只有沙箱内代码能写，宿主拿不到
  defineProp(globalThis, '__qqbatAiHandlers', {
    value: aiHandlers,
    writable: false,
    configurable: false,
  });
  defineProp(globalThis, '__qqbatInstall', { value: install, writable: false, configurable: false });
  defineProp(globalThis, '__qqbatInvoke', { value: invoke, writable: false, configurable: false });
  defineProp(globalThis, '__qqbatReadExports', {
    value: readExports,
    writable: false,
    configurable: false,
  });
})();
`;

/** 每个上下文扣下的"宿主 → 沙箱"入口函数（避免每次 deliver 都 runInContext） */
const INBOUND_FNS = new WeakMap<vm.Context, (msgJson: string) => void>();

/**
 * 建立一个硬化沙箱。
 *
 * @param hostBridge 宿主能力的唯一入口；插件永远拿不到它本身
 * @param opts.microtaskMode 插件脚本路径沿用旧的 `afterEvaluate`（脚本里排队的微任务
 *   在同一次 evaluate 内跑完）；handler 路径不设，保持与旧实现一致
 */
export function createHardenedContext(
  hostBridge: HostBridge,
  opts: { name?: string; microtaskMode?: 'afterEvaluate' } = {},
): vm.Context {
  // ⚠️ 必须用 null 原型对象：普通 `{}` 会让 `this.constructor` 落到宿主 Object 上。
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.__hostBridge = hostBridge;
  const ctx = vm.createContext(sandbox, {
    name: opts.name ?? 'qqbat-sandbox',
    codeGeneration: { strings: false, wasm: false },
    // microtaskMode 只能在这里给：runInContext 的选项类型不含它
    ...(opts.microtaskMode ? { microtaskMode: opts.microtaskMode } : {}),
  });
  vm.runInContext(SANDBOX_BOOTSTRAP, ctx, {
    filename: 'qqbat-sandbox-bootstrap',
    timeout: 5_000,
  });
  return ctx;
}

/**
 * 沙箱内 handler 的调用器。
 *
 * **接口说明（相对设计稿的收紧）**：设计稿写的是 `(json) => string`。这里返回
 * `string | Promise<string>` —— 同步 handler 直接给字符串；异步 handler 给一个
 * **宿主 Promise**，其 resolve 值同样是 JSON 字符串。这样宿主永远只需处理字符串，
 * 且绝不会去 await 沙箱 realm 的 thenable（那会把宿主 resolve/reject 递给插件
 * 可改写的 `Promise.prototype.then`，等于自开一条逃逸路径）。
 */
export type SandboxInvoker = (payloadJson: string) => string | Promise<string>;

/** 在给定沙箱内编译一个 handler 函数；返回的调用器只接受 JSON 字符串 */
export function compileInSandbox(
  ctx: vm.Context,
  source: string,
  opts: { filename: string; timeoutMs: number },
): SandboxInvoker {
  const { filename, timeoutMs } = opts;
  // 尾部补一个换行：源码若以行注释结尾，`)) ` 会被注释吞掉
  vm.runInContext(`__qqbatInstall((${source}\n))`, ctx, { filename, timeout: timeoutMs });

  return (payloadJson: string): string | Promise<string> => {
    // payload 以 JSON 字符串字面量嵌入脚本：既不动全局名，又能吃到 vm 的同步超时
    const out: unknown = vm.runInContext(`__qqbatInvoke(${JSON.stringify(payloadJson)})`, ctx, {
      filename,
      timeout: timeoutMs,
    });
    if (typeof out === 'string') return out;
    return new Promise<string>((resolve, reject) => {
      try {
        (out as { then: (ok: (s: string) => void, err: (e: unknown) => void) => void }).then(
          resolve,
          reject,
        );
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  };
}

/**
 * 在沙箱内执行一段插件脚本，返回 `module.exports` 的 **JSON 字符串**。
 *
 * pluginScanner 以前是宿主直接读 `sandbox.module.exports`（宿主碰沙箱对象，
 * 且形态依赖宿主注入的 `{}`）。现在由沙箱内的 `__qqbatReadExports` 序列化后
 * 以字符串回传，宿主只做 JSON.parse。
 */
export function runScriptInSandbox(
  ctx: vm.Context,
  source: string,
  opts: { filename: string; timeoutMs: number },
): string {
  vm.runInContext(source, ctx, {
    filename: opts.filename,
    timeout: opts.timeoutMs,
  });
  // ⚠️ **必须带 timeout 地在沙箱内调用它**。
  //
  // `__qqbatReadExports` 会 JSON.stringify 插件的 `module.exports` —— 而那是插件完全可控的
  // 对象：`defineProperty(module, 'exports', { get() { for(;;){} } })` 或
  // `{ toJSON() { for(;;){} } }` 就能让**宿主死循环**。
  // 上面那句 `runInContext(source, …, { timeout })` 只覆盖"脚本本身的执行"，
  // 覆盖不到"宿主事后把这个沙箱函数拿到手再调用"这一步（直接 `read()` 调用时，
  // vm 的 watchdog 完全不在链上）。所以要把调用本身也放进 runInContext。
  return vm.runInContext('__qqbatReadExports()', ctx, {
    filename: opts.filename,
    timeout: opts.timeoutMs,
  }) as string;
}

/**
 * 把宿主的迟到结果送进沙箱（callBuiltin / bot.callApi 的返回值、定时器触发）。
 * @param messageJson 只允许 JSON 字符串
 */
export function deliverToSandbox(ctx: vm.Context, messageJson: string): void {
  let inbound = INBOUND_FNS.get(ctx);
  if (!inbound) {
    inbound = vm.runInContext('__qqbatInbound', ctx) as (msgJson: string) => void;
    INBOUND_FNS.set(ctx, inbound);
  }
  inbound(messageJson);
}

// ---------------------------------------------------------------------------
// 布尔表达式求值（debugger 条件断点）—— 复用同一套硬化上下文
//
// 为什么放在这里而不是在 debugger 里再写一个上下文：全仓只允许**一份** contextify
// 逻辑。旧 debugger（`vm.createContext(Object.freeze({...varMap}))`）与 WI-1 修掉的 P0
// 沙箱同形态 —— 普通对象 contextify 时 `this.constructor` 落在宿主 Object 上，
// `this.constructor.constructor('return process')()` 即逃逸（见
// tests/main/services/debugger.test.ts 的反向对照）。
// ---------------------------------------------------------------------------

/**
 * 条件求值不需要任何宿主能力：桥被调用即抛错。
 *
 * 这不只是"用不上"：把桥钉成必抛的桩之后，即便条件表达式绕过了第一层白名单去调桥，
 * 也只能拿到异常，拿不到宿主。
 */
function denyHostBridge(): string {
  throw new Error('条件求值沙箱不提供宿主能力');
}

/** 合法标识符 —— 只有这种键名能在沙箱里被当作变量解析到 */
const CONDITION_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * 必须剔除的键名：`__proto__` 走 `Object.assign` 的 [[Set]] 会改**全局对象的原型**，
 * `constructor` / `prototype` 同理不值得出现在一个求值场景里。剔除比"期望值不是对象"可靠。
 */
const CONDITION_RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 变量表过界前的收窄：只留原始值 + 合法标识符键名。
 *
 * 为什么不信调用方：值来自运行时日志解析，但这一层不该假设它一定干净。
 * 非 string/number/boolean 的一律丢弃（丢弃后表达式因未定义而抛错 → 条件不满足），
 * 于是宿主对象/函数**没有任何路径**进入沙箱。
 */
function pickConditionVars(
  vars: Record<string, string>,
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(vars)) {
    if (!CONDITION_IDENT_RE.test(key) || CONDITION_RESERVED_KEYS.has(key)) continue;
    const value: unknown = vars[key];
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      safe[key] = value as string | number | boolean;
    }
  }
  return safe;
}

/**
 * 在硬化沙箱里求值一条**布尔表达式**（断点条件专用）。
 *
 * 语义与旧 debugger 实现逐条对齐：变量注入作用域 → `Boolean(expr)` → 超时兜底 →
 * 只认布尔结果。差别只在**求值面**：null 原型 contextify + 引导脚本 +
 * `codeGeneration:{strings:false,wasm:false}`，且上下文里没有任何宿主函数可做
 * `.constructor` 跳板。
 *
 * 注意：本函数**不做语法校验** —— 白名单/黑名单是调用方（debugger 第一层）的职责。
 * 这不是漏洞：即使白名单被绕过，表达式也只在硬化上下文里执行，拿不到宿主 process。
 *
 * @param expression 布尔表达式源码（由调用方保证语义上只读变量）
 * @param vars 断点命中时的变量快照；只有原始值会过界
 * @param opts.timeoutMs 同步执行超时（默认 100ms，与旧实现一致）
 */
export function evalBooleanInHardenedSandbox(
  expression: string,
  vars: Record<string, string> = {},
  opts: { timeoutMs?: number; filename?: string } = {},
): boolean {
  const timeoutMs = opts.timeoutMs ?? 100;
  const filename = opts.filename ?? 'qqbat-sandbox-expression';
  try {
    // 每次求值一个全新上下文：条件之间不共享作用域（旧实现同样是每次 createContext），
    // 上一次求值注入的变量/被篡改的原型不会泄漏到下一次。
    const ctx = createHardenedContext(denyHostBridge, { name: 'qqbat-expression' });
    // 变量只以 JSON 字面量过界：宿主对象/数组/函数绝不出现在 vm 调用参数里
    const seed = JSON.stringify(pickConditionVars(vars));
    vm.runInContext(`Object.assign(globalThis, ${seed})`, ctx, { filename, timeout: timeoutMs });
    // 尾随换行：表达式若以行注释结尾，`)` 会被注释吞掉（与 compileInSandbox 同一处理）
    const out: unknown = vm.runInContext(`Boolean(${expression}\n)`, ctx, {
      filename,
      timeout: timeoutMs,
    });
    // 只认严格布尔：表达式把 Boolean(...) 包装"越狱"成别的值（如 `1) , (2`）时按不满足处理
    return out === true;
  } catch {
    // 超时 / 语法错误 / 引用未定义 —— 一律视为条件不满足（旧实现也是 catch 成 false）
    return false;
  }
}
