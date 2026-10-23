// src/main/runtime/untrustedWorker.ts
//
// 不可信节点 worker 的**子进程侧**入口。
//
// 由来：10/18 打包产物里 out/main/untrustedWorker.js 是 `app.asar.unpacked` 的独立入口
// （asar 里 unpacked:true，字节在 resources/app.asar.unpacked/out/main/ 下）；恢复树里
// `untrustedWorkerHost.ts` 还在 fork 它，但源码本身丢了。本文件按那份未压缩产物逐段还原
// （它的 `//#region src/main/runtime/untrustedWorker.ts` 段完整保留了注释），逻辑与 10/18 一致。
//
// 协议方向：主进程 → 本进程用 stdin 每行一个 JSON；回包只用 stdout 的 JSON 行。
// stderr 留给日志（console.* 全被重定向到 stderr，避免污染协议通道）。
import type * as vmType from 'node:vm';
import {
  compileInSandbox,
  createHardenedContext,
  deliverToSandbox,
  type SandboxInvoker,
} from './sandbox';

/** 单次调用的同步兜底超时（真正的超时由主进程侧计时；这里只防"把子进程也挂死"） */
const INVOKE_TIMEOUT_MS = 30_000;

interface SandboxEntry {
  ctx: vmType.Context;
  invoker: SandboxInvoker | null;
  timers: Map<number, NodeJS.Timeout>;
}

const SANDBOXES = new Map<string, SandboxEntry>();

/** 已经发出、等待主进程回复的 callBuiltin / callApi（reqId → 本次沙箱投递信息） */
const PENDING_DELIVER = new Map<number, { ctx: vmType.Context; token: number }>();

let REQ_SEQ = 1;

type ProtocolMessage = Record<string, unknown>;

/** 走协议通道（stdout）——只允许 JSON 行 */
function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 把迟到结果投进沙箱（只送 JSON 字符串） */
function deliver(sandbox: SandboxEntry, payload: unknown): void {
  try {
    deliverToSandbox(sandbox.ctx, JSON.stringify(payload));
  } catch {
    // 沙箱已被销毁 / 已不接收投递：静默丢弃，和 10/18 行为一致
  }
}

/**
 * 该 handler 专属的宿主桥。
 *
 * 它只接受/返回 JSON 字符串，是唯一一次注入沙箱的宿主函数，
 * 引导脚本会把它关进闭包并删掉全局名。
 */
function makeBridge(kind: string, sandbox: SandboxEntry): (payloadJson: string) => string {
  return (payloadJson: string): string => {
    let msg: ProtocolMessage;
    try {
      msg = JSON.parse(payloadJson) as ProtocolMessage;
    } catch {
      return 'null';
    }
    if (!msg || typeof msg !== 'object') return 'null';
    switch (msg.kind) {
      case 'log': {
        const args = Array.isArray(msg.args) ? msg.args : [];
        send({ t: 'log', kind, level: msg.level, args });
        return 'null';
      }
      case 'timerSet': {
        const timerId = Number(msg.id);
        const ms = Math.max(0, Number(msg.ms) || 0);
        const handle = setTimeout(() => {
          sandbox.timers.delete(timerId);
          deliver(sandbox, { kind: '__timer', id: timerId });
        }, ms);
        sandbox.timers.set(timerId, handle);
        return 'null';
      }
      case 'timerClear': {
        const timerId = Number(msg.id);
        const handle = sandbox.timers.get(timerId);
        if (handle) {
          clearTimeout(handle);
          sandbox.timers.delete(timerId);
        }
        return 'null';
      }
      case 'call': {
        const token = Number(msg.token);
        const args = Array.isArray(msg.args) ? msg.args : [];
        const callId = typeof msg.callId === 'number' ? msg.callId : null;
        const reqId = REQ_SEQ++;
        PENDING_DELIVER.set(reqId, { ctx: sandbox.ctx, token });
        if (msg.target === 'botCallApi') {
          send({
            t: 'callApi',
            id: reqId,
            invokeId: callId,
            api: String(msg.name),
            params: args[0] ?? {},
          });
        } else {
          send({
            t: 'callBuiltin',
            id: reqId,
            invokeId: callId,
            kind: String(msg.name),
            kwargs: args[0] ?? {},
          });
        }
        return 'null';
      }
      default:
        return 'null';
    }
  };
}

/** 建一个 kind 的沙箱（源码稍后由 register 编译进来） */
function createSandbox(kind: string): SandboxEntry {
  const sandbox: SandboxEntry = { ctx: null as unknown as vmType.Context, invoker: null, timers: new Map() };
  sandbox.ctx = createHardenedContext(makeBridge(kind, sandbox), { name: 'dynamic-node:' + kind });
  return sandbox;
}

/** 释放一个 kind 的沙箱资源 */
function disposeSandbox(kind: string): void {
  const sb = SANDBOXES.get(kind);
  if (!sb) return;
  for (const handle of sb.timers.values()) clearTimeout(handle);
  sb.timers.clear();
  SANDBOXES.delete(kind);
}

function replyControl(id: unknown, ok: boolean, value?: unknown, error?: string): void {
  if (typeof id !== 'number') return;
  send({ t: 'reply', id, ok, value, error });
}

function handleRegister(msg: ProtocolMessage): void {
  const kind = String(msg.kind ?? '');
  const source = typeof msg.source === 'string' ? msg.source : '';
  try {
    if (!kind || !source.trim()) throw new Error('register 需要 kind 与非空 source');
    disposeSandbox(kind);
    const sandbox = createSandbox(kind);
    sandbox.invoker = compileInSandbox(sandbox.ctx, source, {
      filename: 'dynamic-node:' + kind,
      timeoutMs: INVOKE_TIMEOUT_MS,
    });
    SANDBOXES.set(kind, sandbox);
    replyControl(msg.id, true);
  } catch (e) {
    disposeSandbox(kind);
    replyControl(msg.id, false, undefined, '节点代码编译失败: ' + errorMessage(e));
  }
}

function handleUnregister(msg: ProtocolMessage): void {
  disposeSandbox(String(msg.kind ?? ''));
  replyControl(msg.id, true);
}

function handleUnregisterPrefix(msg: ProtocolMessage): void {
  const prefix = String(msg.prefix ?? '');
  for (const kind of [...SANDBOXES.keys()]) {
    if (kind.startsWith(prefix)) disposeSandbox(kind);
  }
  replyControl(msg.id, true);
}

function handleList(msg: ProtocolMessage): void {
  replyControl(msg.id, true, [...SANDBOXES.keys()]);
}

function handleInfo(msg: ProtocolMessage): void {
  replyControl(msg.id, true, { pid: process.pid, ppid: process.ppid, node: process.version });
}

/**
 * 外层 realm 逃逸自查（测试/诊断专用）：用 handler 的逃逸向量在**子进程外层**求值。
 *
 * 它证明的是第一层边界：同样的表达式在主进程能拿到主进程，在这里只拿到**子进程**，
 * 所以"逃逸成功"也够不到主进程。它不是 handler 能触及的能力 —— 只走主 → 子的
 * 信任方向，且只回子进程自己的 pid/version，不执行任何传进来的代码。
 */
function handleSelfProbe(msg: ProtocolMessage): void {
  let pid = -1;
  let version = '';
  try {
    const proc = (setTimeout.constructor as (src: string) => () => NodeJS.Process)('return process')();
    pid = proc.pid;
    version = proc.version;
  } catch {
    // 被沙箱/引擎挡住就回 -1，不抛
  }
  replyControl(msg.id, true, { pid, version });
}

async function handleInvoke(msg: ProtocolMessage): Promise<void> {
  const id = msg.id;
  const kind = String(msg.kind ?? '');
  const sandbox = SANDBOXES.get(kind);
  if (!sandbox) {
    if (typeof id === 'number') {
      send({ t: 'error', id, message: 'handler 未在 worker 中注册: ' + kind });
    }
    return;
  }
  try {
    const payloadJson = JSON.stringify(msg.payload ?? {});
    const result = await sandbox.invoker?.(payloadJson);
    const envelope = JSON.parse(String(result));
    if (envelope && envelope.ok === true) {
      send({ t: 'result', id, value: envelope.value });
    } else {
      send({
        t: 'error',
        id,
        message: typeof envelope?.error === 'string' ? envelope.error : '节点执行失败',
      });
    }
  } catch (e) {
    let message = errorMessage(e);
    if (typeof e === 'string' && e.startsWith('{')) {
      try {
        const env = JSON.parse(e) as { error?: unknown };
        if (typeof env?.error === 'string') message = env.error;
      } catch {
        // 不是 JSON 就保留原始错误文案
      }
    }
    send({ t: 'error', id, message });
  }
}

/** 主进程回答 callBuiltin / callApi → 投回沙箱 */
function handleReply(msg: ProtocolMessage): void {
  const id = Number(msg.id);
  const slot = PENDING_DELIVER.get(id);
  if (!slot) return;
  PENDING_DELIVER.delete(id);
  try {
    deliverToSandbox(
      slot.ctx,
      JSON.stringify({
        kind: '__call-result',
        token: slot.token,
        ok: msg.ok === true,
        value: msg.value,
        error: msg.error,
      }),
    );
  } catch {
    // 沙箱已销毁：迟到结果丢弃
  }
}

function handleLine(line: string): void {
  let msg: ProtocolMessage;
  try {
    msg = JSON.parse(line) as ProtocolMessage;
  } catch {
    process.stderr.write('[untrustedWorker] 无法解析的协议行\n');
    return;
  }
  switch (msg.t) {
    case 'register':
      handleRegister(msg);
      break;
    case 'unregister':
      handleUnregister(msg);
      break;
    case 'unregisterPrefix':
      handleUnregisterPrefix(msg);
      break;
    case 'list':
      handleList(msg);
      break;
    case 'info':
      handleInfo(msg);
      break;
    case 'selfProbe':
      handleSelfProbe(msg);
      break;
    case 'invoke':
      void handleInvoke(msg);
      break;
    case 'reply':
      handleReply(msg);
      break;
    default:
      break;
  }
}

/** console.* 一律转 stderr：stdout 是协议通道，混进日志会让主进程解析失败 */
const toStderr = (...args: unknown[]): void => {
  process.stderr.write(args.map((a) => String(a)).join(' ') + '\n');
};
console.log = toStderr;
console.info = toStderr;
console.warn = toStderr;
console.error = toStderr;

process.on('uncaughtException', (e: unknown) => {
  process.stderr.write('[untrustedWorker] uncaughtException: ' + errorMessage(e) + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write('[untrustedWorker] unhandledRejection: ' + errorMessage(reason) + '\n');
});

process.stdin.setEncoding('utf8');
let stdinBuf = '';
process.stdin.on('data', (chunk: string) => {
  stdinBuf += chunk;
  let idx: number;
  while ((idx = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, idx).trim();
    stdinBuf = stdinBuf.slice(idx + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));
