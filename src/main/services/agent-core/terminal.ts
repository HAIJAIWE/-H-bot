// src/main/services/agent-core/terminal.ts
//
// **持久 shell 会话**（2026-10-18，对齐主流 harness 的 terminal/subprocess）。
//
// 和 run_command 的区别：那个是一次性子进程（起→跑→退），这个是**一条开着的 shell**：
// 可以连续跑命令、保留 cd/环境变量/变量，适合「先 cd 再 build 再看日志」这种连续操作。
//
// 实现要点：每条命令后追加一个唯一 marker，读到 marker 就算这条命令结束 ——
// 不猜输出边界，也不靠等待固定时长（那种写法在慢命令上必错）。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface ShellRunResult {
  ok: boolean;
  output: string;
  /** 超时被杀（与「命令返回非 0」不同，调用方要分开处理） */
  timedOut?: boolean;
}

export class ShellSession {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';

  constructor(private readonly opts: { cwd: string; shell?: string }) {}

  start(): void {
    if (this.proc) return;
    this.proc = spawn(this.opts.shell ?? 'powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-'], {
      cwd: this.opts.cwd,
      windowsHide: true,
      stdio: 'pipe',
    }) as ChildProcessWithoutNullStreams;
    this.proc.stdout.on('data', (d) => {
      this.buffer += String(d);
    });
    this.proc.stderr.on('data', (d) => {
      this.buffer += String(d);
    });
  }

  /**
   * 跑一条命令等它结束（靠 marker，不靠 sleep）。
   * 超时会杀掉整个会话 —— 卡住的 shell 不能继续复用。
   */
  async run(command: string, timeoutMs = 20000): Promise<ShellRunResult> {
    this.start();
    const proc = this.proc;
    if (!proc) return { ok: false, output: '会话没有起来' };
    const marker = '__DSH_DONE_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '__';
    this.buffer = '';
    proc.stdin.write(command + '\n');
    proc.stdin.write('Write-Output "' + marker + '"\n');
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const at = this.buffer.indexOf(marker);
      if (at >= 0) {
        const output = this.buffer.slice(0, at).replace(/\r/g, '').trimEnd();
        const cleaned = output.split('\n').filter((l) => !l.startsWith('PS ') && l.trim() !== '').join('\n');
        return { ok: true, output: cleaned };
      }
      if (proc.exitCode !== null) {
        return { ok: false, output: this.buffer };
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    this.kill();
    return { ok: false, output: this.buffer, timedOut: true };
  }

  kill(): void {
    try {
      this.proc?.kill();
    } catch {
      // 已经退了
    }
    this.proc = null;
    this.buffer = '';
  }
}
