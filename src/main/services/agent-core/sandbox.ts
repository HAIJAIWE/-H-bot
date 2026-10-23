// src/main/services/agent-core/sandbox.ts
//
// **命令沙箱的提供者契约**（2026-10-18，对齐 DSH 的 sandbox seam）。
//
// 现在只有一种实现：本地白名单子进程（node/pnpm/git/npx + 禁元字符 + 超时 + 不走 shell）。
// 抽出来的意义不是"现在有第二个实现"，而是**以后换隔离方式（容器 / 受限账户 / 远程）
// 时不用改循环** —— 循环只调 `runInSandbox()`。
//
// 白名单与禁元字符留在**本地实现**里，不抬到契约层：换个沙箱不代表规则一样
// （容器里可以放开权限，受限账户可能要更严）。
import { spawn } from 'node:child_process';

export interface CommandRequest {
  /** 整条命令行（会被按空白切分，不走 shell） */
  command: string;
  /** 工作目录（必须在工作区内 —— 由调用方保证） */
  cwd: string;
  /** 超时（毫秒）；实现自己夹到合理区间 */
  timeoutMs?: number;
}

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SandboxProvider {
  /** 名字：日志/诊断里要说清是哪一种隔离 */
  name: string;
  run(req: CommandRequest): Promise<CommandResult>;
}

const ALLOWED_COMMANDS = new Set(['node', 'pnpm', 'pnpm.cmd', 'git', 'npx', 'npx.cmd']);
/**
 * 禁用的元字符。
 *
 * 引号也算：命令不走 shell（`spawn(..., { shell: false })`），所以 `node -e "1"` 里的引号
 * **不会被 shell 解释**，只会当成字面参数原样递给程序 —— 模型按 shell 的直觉写引号，
 * 拿到的是「退出码 0 但什么也没干」或莫名其妙的参数错误。与其让它以为跑通了，
 * 不如在入口就说清「这条命令的表达方式在这里不成立」。
 */
const FORBIDDEN = /[;&|><`$()"']/;
const MAX_STREAM_CHARS = 8000;

/** 本地沙箱：白名单 + 禁元字符 + 超时 + 不走 shell */
export const localSandbox: SandboxProvider = {
  name: 'local',
  run(req) {
    const line = String(req.command ?? '').trim();
    if (!line) return Promise.resolve({ ok: false, code: null, stdout: '', stderr: '缺少 command' });
    if (FORBIDDEN.test(line)) {
      return Promise.resolve({ ok: false, code: null, stdout: '', stderr: '命令包含不允许的元字符' });
    }
    const [cmd, ...args] = line.split(/\s+/);
    if (!ALLOWED_COMMANDS.has(cmd)) {
      return Promise.resolve({ ok: false, code: null, stdout: '', stderr: '命令不在白名单: ' + cmd });
    }
    const timeout = Math.min(Math.max(req.timeoutMs ?? 15000, 1000), 60000);
    return new Promise((resolvePromise) => {
      const child = spawn(cmd, args, { cwd: req.cwd, shell: false });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
      child.stdout.on('data', (d) => {
        stdout += String(d);
      });
      child.stderr.on('data', (d) => {
        stderr += String(d);
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolvePromise({ ok: false, code: null, stdout, stderr: String(e) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolvePromise({
          ok: code === 0,
          code,
          stdout: stdout.slice(0, MAX_STREAM_CHARS),
          stderr: stderr.slice(0, MAX_STREAM_CHARS),
        });
      });
    });
  },
};

let current: SandboxProvider = localSandbox;

/** 当前沙箱（默认本地） */
export function getSandboxProvider(): SandboxProvider {
  return current;
}

/**
 * 换一个沙箱实现（测试/未来的容器实现用）。
 * 传 null 恢复默认 —— 免得测试之间互相污染。
 */
export function setSandboxProvider(provider: SandboxProvider | null): void {
  current = provider ?? localSandbox;
}

/** 循环调这个：不关心底下是本地还是容器 */
export function runInSandbox(req: CommandRequest): Promise<CommandResult> {
  return current.run(req);
}
