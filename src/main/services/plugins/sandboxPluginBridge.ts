// src/main/services/plugins/sandboxPluginBridge.ts
//
// **沙箱插件的宿主桥**（2026-10-19）：把桥消息变成宿主能力。
//
// 为什么需要代理：桥只能过 JSON 字符串，函数过不去（见 docs/ai/plugin-system.md §12）。
// 所以沙箱插件贡献的"工具"只有描述；真正的执行在调用时**转发回沙箱**，宿主这边是个代理 Tool。
//
// 协议（沙箱 → 宿主，JSON 字符串）：
//   { kind:'aiPlugin', action:'contributeTool',   payload:{ name, description, parameters?, category? } }
//   { kind:'aiPlugin', action:'contributePrompt', payload:{ id, order?, text } }
// 宿主 → 沙箱（调用期）：
//   { kind:'call', token, callId:null, target:'aiPlugin', name:'<toolName>', args:[args] }
// 沙箱 → 宿主（迟到结果）：
//   { kind:'__call-result', token, ok, value?, error? }
//
// 超时：默认 5s（与沙箱脚本超时一致）；超时按 `[工具失败] …` 返回，插件不必自己实现。
import type { Tool } from '../agent-core/core';
import type { PromptSection } from '../agent-core/prompt';

export interface SandboxBridgeHost {
  contributeTool(tool: Tool): void;
  contributePrompt(section: PromptSection): void;
}

export interface SandboxBridgeOptions {
  pluginId: string;
  permissions: readonly string[];
  host: SandboxBridgeHost;
  /** 把调用消息送进沙箱（真实实现是 deliverToSandbox / invoker） */
  sendToSandbox: (message: Record<string, unknown>) => void;
  /** 调用超时（毫秒） */
  timeoutMs?: number;
}

interface PendingCall {
  resolve: (value: string) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_CALL_TIMEOUT_MS = 5_000;

/** 桥返回的 JSON 信封（与沙箱 bootstrap 的 envelope 形状一致） */
function envelopeOk(value: unknown): string {
  return JSON.stringify({ ok: true, value });
}
function envelopeErr(error: string): string {
  return JSON.stringify({ ok: false, error });
}

export function createSandboxPluginBridge(opts: SandboxBridgeOptions): {
  handleBridgeMessage: (payloadJson: string) => string;
  resolveCall: (token: number, ok: boolean, value?: unknown, error?: string) => void;
  dispose: () => void;
} {
  const allowed = new Set(opts.permissions);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const pending = new Map<number, PendingCall>();
  let nextToken = 1;
  let disposed = false;

  const callSandbox = (toolName: string, args: Record<string, unknown>): Promise<string> =>
    new Promise<string>((resolve) => {
      if (disposed) {
        resolve('[工具失败] 插件已停用');
        return;
      }
      const token = nextToken;
      nextToken += 1;
      const timer = setTimeout(() => {
        pending.delete(token);
        resolve('[工具失败] 插件工具超时（' + timeoutMs + 'ms）');
      }, timeoutMs);
      pending.set(token, { resolve, timer });
      try {
        opts.sendToSandbox({
          kind: 'call',
          token,
          callId: null,
          target: 'aiPlugin',
          name: toolName,
          args: [args],
        });
      } catch (e) {
        clearTimeout(timer);
        pending.delete(token);
        resolve('[工具失败] 无法调用沙箱：' + (e instanceof Error ? e.message : String(e)));
      }
    });

  const requirePermission = (perm: string): void => {
    if (!allowed.has(perm)) {
      throw new Error('plugin ' + opts.pluginId + ' did not declare the "' + perm + '" permission');
    }
  };

  const handleBridgeMessage = (payloadJson: string): string => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(payloadJson)) as Record<string, unknown>;
    } catch {
      return envelopeErr('bridge message is not valid JSON');
    }
    if (msg.kind === '__call-result') {
      // 迟到结果：按 token 找回等待中的调用
      const token = typeof msg.token === 'number' ? msg.token : -1;
      const entry = pending.get(token);
      if (!entry) return envelopeOk(null); // 已超时/已取消：丢弃，不报错（避免插件侧炸掉）
      clearTimeout(entry.timer);
      pending.delete(token);
      entry.resolve(msg.ok === true ? String(msg.value ?? '') : '[工具失败] ' + String(msg.error ?? '插件执行失败'));
      return envelopeOk(null);
    }
    if (msg.kind !== 'aiPlugin') return envelopeErr('unsupported bridge message kind: ' + String(msg.kind));
    const action = msg.action;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    try {
      if (action === 'contributeTool') {
        requirePermission('tool');
        const name = String(payload.name ?? '');
        const description = String(payload.description ?? '');
        if (!name || !description) return envelopeErr('tool contribution requires name and description');
        const descriptor: Tool = {
          name,
          description,
          ...(payload.parameters && typeof payload.parameters === 'object'
            ? { parameters: payload.parameters as Record<string, unknown> }
            : {}),
          category: payload.category === 'query' ? 'query' : 'mutation',
          timeoutMs: timeoutMs + 500,
          run: async (args) => callSandbox(name, args),
        };
        opts.host.contributeTool(descriptor);
        return envelopeOk(null);
      }
      if (action === 'contributePrompt') {
        requirePermission('prompt');
        const id = String(payload.id ?? '');
        const text = String(payload.text ?? '');
        if (!id || !text) return envelopeErr('prompt contribution requires id and text');
        opts.host.contributePrompt({
          id,
          ...(typeof payload.order === 'number' ? { order: payload.order } : {}),
          render: () => text,
        });
        return envelopeOk(null);
      }
      return envelopeErr('unsupported aiPlugin action: ' + String(action));
    } catch (e) {
      return envelopeErr(e instanceof Error ? e.message : String(e));
    }
  };

  const resolveCall = (token: number, ok: boolean, value?: unknown, error?: string): void => {
    const entry = pending.get(token);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(token);
    entry.resolve(ok ? String(value ?? '') : '[工具失败] ' + String(error ?? '插件执行失败'));
  };

  const dispose = (): void => {
    disposed = true;
    for (const [token, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(token);
      entry.resolve('[工具失败] 插件已停用');
    }
  };

  return { handleBridgeMessage, resolveCall, dispose };
}
