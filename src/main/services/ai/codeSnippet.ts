// src/main/services/ai/codeSnippet.ts
//
// **代码片段的沙箱执行**（2026-10-18，CodeAct 闭环的地基）。
//
// 为什么要它：在它之前，模型写的代码**没人跑** —— 写完就进提案，对错由用户当测试机。
// 现在代码可以「写 → 跑 → 看报错 → 改」，和 DSH 那种编码 agent 的闭环一致。
//
// ## 隔离边界（node:vm）
//
//   · 没有 require / process / fs / net —— 上下文里只给纯计算能用的内建对象；
//   · `codeGeneration.strings = false` —— 禁止 eval / new Function 逃逸；
//   · 同步超时兜底（死循环抛错，不会卡住主进程）。
//
// ⚠️ 这是**第一版**：后续接进工具层时，强隔离应换成 runtime/untrustedWorkerHost（独立线程 +
// 真实超时可杀）。vm 适合「纯函数片段」，不适合「跑一个完整插件」。
import { createContext, runInContext } from 'node:vm';

export interface SnippetResult {
  /** 跑通了没有（抛错 = false） */
  ok: boolean;
  /** console.log 的输出 + 返回值（`=> …`） */
  output: string;
  /** 失败原文（带错误类型，便于模型自己改） */
  error: string;
  ms: number;
}

export const SNIPPET_MAX_TIMEOUT_MS = 5000;
export const SNIPPET_DEFAULT_TIMEOUT_MS = 2000;

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.name + ': ' + value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 在沙箱里跑一段代码片段。
 *
 * 代码体可直接用 `args`；`console.log` 会进 output；返回值会以 `=> …` 附在最后。
 */
export function runCodeSnippet(input: {
  code: string;
  args?: unknown;
  timeoutMs?: number;
}): SnippetResult {
  const code = String(input.code ?? '');
  if (!code.trim()) {
    return { ok: false, output: '', error: '空的代码片段', ms: 0 };
  }
  const timeout = Math.min(
    Math.max(input.timeoutMs ?? SNIPPET_DEFAULT_TIMEOUT_MS, 100),
    SNIPPET_MAX_TIMEOUT_MS,
  );
  const logs: string[] = [];
  const push = (...values: unknown[]): void => {
    logs.push(values.map(format).join(' '));
  };
  const sandbox = {
    console: { log: push, info: push, warn: push, error: push, debug: push },
    args: input.args,
    JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Error, Map, Set,
  };
  const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const startedAt = Date.now();
  try {
    /**
     * 必须**在 runInContext 里调用**：timeout 只约束"这次脚本执行"；
     * 若先返回函数再在外面调用，函数体里的死循环不受超时保护（第一版踩过：测试进程挂死）。
     */
    const wrapped = '(function(args){ "use strict"; ' + code + '\n})(args)';
    const returned = runInContext(wrapped, context, { timeout }) as unknown;
    const suffix = returned === undefined ? '' : '=> ' + format(returned);
    return {
      ok: true,
      output: [...logs, suffix].filter(Boolean).join('\n'),
      error: '',
      ms: Date.now() - startedAt,
    };
  } catch (e) {
    const error = e instanceof Error ? e.name + ': ' + e.message : String(e);
    return { ok: false, output: logs.join('\n'), error, ms: Date.now() - startedAt };
  }
}
