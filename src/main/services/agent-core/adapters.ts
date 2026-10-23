// src/main/services/agent-core/adapters.ts
//
// **契约适配器**：把现有实现挂到 5 个服务接口后面（2026-10-18）。
//
// 为什么用工厂 + 注入，而不是直接 import 内部模块：
//   · 循环只认契约，不认 historyStore/toolApproval/trace 的具体路径；
//   · 测试可以塞替身，不用 mock 一堆模块；
//   · 将来换实现（比如 trace 换 OTEL）只改装配处。
import { runCommand } from './core';
import { runCodeSnippet } from '../ai/codeSnippet';
import type {
  AgentServices,
  ApprovalRequest,
  ApprovalService,
  ContextService,
  SandboxService,
  SessionStore,
  TraceEvent,
  TraceSink,
} from './contracts';

/**
 * 沙箱服务：命令走白名单子进程，片段默认走 vm（纯计算、无 fs/net）。
 * 传入 runSnippet 可换成**独立线程**实现（untrustedWorkerHost）——
 * 循环只认接口，不需要知道片段跑在哪。
 */
export function makeSandboxService(opts: {
  runSnippet?: SandboxService['runSnippet'];
} = {}): SandboxService {
  const snippet = opts.runSnippet;
  return {
    async runCommand(input, cmdOpts) {
      return runCommand(input, { workspace: cmdOpts.cwd, commandTimeoutMs: cmdOpts.timeoutMs });
    },
    async runSnippet(input) {
      return snippet ? snippet(input) : runCodeSnippet(input);
    },
  };
}

/** 现有 trace 写入函数 → TraceSink（注入，不直接依赖 trace.ts） */
export function makeTraceSink(
  record: (projectPath: string, event: TraceEvent) => void,
): TraceSink {
  return {
    record(projectPath, event) {
      record(projectPath, event);
    },
  };
}

/** 现有审批函数 → ApprovalService（提案路径另算，这里只做动作许可） */
export function makeApprovalService(
  request: (req: ApprovalRequest, signal?: AbortSignal) => Promise<boolean>,
): ApprovalService {
  return {
    request(req, signal) {
      return request(req, signal);
    },
  };
}

/**
 * 现有压缩/落盘实现 → ContextService。
 *
 * 三个函数都由调用方注入：循环不知道 tokenBudget 怎么算、压缩用哪套摘要、
 * 溢出文件写到哪里 —— 这些在不同宿主里差别很大，硬编码进循环就换不动了。
 */
export function makeContextService(opts: {
  estimate: (text: string) => number;
  compact: (messages: readonly unknown[], budgetTokens: number) => Promise<readonly unknown[]>;
  spill: (text: string) => Promise<string>;
}): ContextService {
  return {
    estimate(text) {
      return opts.estimate(text);
    },
    compact(messages, budgetTokens) {
      return opts.compact(messages, budgetTokens);
    },
    spill(text) {
      return opts.spill(text);
    },
  };
}

/** 现有历史存储 → SessionStore（append 写一轮、load 读最近 N 轮） */
export function makeSessionStore(opts: {
  append: SessionStore['append'];
  load: SessionStore['load'];
}): SessionStore {
  return {
    append(projectPath, turn) {
      return opts.append(projectPath, turn);
    },
    load(projectPath, limit) {
      return opts.load(projectPath, limit);
    },
  };
}

/**
 * 装配：把五个服务装成一个 `AgentServices`。
 *
 * 看着像废话（就是返回入参），但它把"缺一个服务"从**运行时 undefined** 变成**编译期报错** ——
 * 循环里有五处 `services.xxx`，少配一个只会在跑到那一步时炸。
 */
export function assembleAgentServices(parts: AgentServices): AgentServices {
  return parts;
}
