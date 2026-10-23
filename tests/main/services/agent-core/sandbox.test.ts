// tests/main/services/agent-core/sandbox.test.ts
//
// 命令沙箱的**提供者缝**：默认是本地白名单实现；换一个提供者时循环不改一行。
// 这条缝的意义不是"现在有两个实现"，而是以后换容器/受限账户时循环不用动。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CORE_TOOLS,
  runAgentLoop,
  runCommand,
  setSandboxProvider,
  getSandboxProvider,
  localSandbox,
} from '@main/services/agent-core/core';

afterEach(() => setSandboxProvider(null)); // 每个用例后恢复默认，别污染别的文件

describe('★ 沙箱提供者：可替换', () => {
  it('默认是本地实现', () => {
    expect(getSandboxProvider().name).toBe('local');
  });

  it('本地实现仍然守白名单与元字符（原有的护栏没被抽走）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-sbx-'));
    const bad = await runCommand('rm -rf /', { workspace: ws });
    expect(bad.stderr).toContain('白名单');
    const meta = await runCommand('node -e "1"', { workspace: ws });
    expect(meta.stderr).toContain('元字符');
  });

  it('★ 换提供者：runCommand 与 run_command 工具都走它（循环一行没改）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-sbx-'));
    const seen: string[] = [];
    setSandboxProvider({
      name: 'fake',
      async run(req) {
        seen.push(req.command);
        return { ok: true, code: 0, stdout: 'FAKE:' + req.command, stderr: '' };
      },
    });
    expect((await runCommand('pnpm test', { workspace: ws })).stdout).toBe('FAKE:pnpm test');
    const cmdTool = CORE_TOOLS.find((t) => t.name === 'run_command')!;
    const out = await cmdTool.run({ command: 'git status' }, { workspace: ws, gate: async () => true });
    expect(out).toContain('FAKE:git status');
    expect(seen).toEqual(['pnpm test', 'git status']);

    // 循环里的工具调用同样走提供者（不是只有直连入口走）
    let round = 0;
    const result = await runAgentLoop({
      workspace: ws,
      gate: async () => true,
      model: async () => {
        round += 1;
        return round === 1
          ? { calls: [{ id: 'c1', name: 'run_command', args: { command: 'pnpm build' } }] }
          : { text: 'done' };
      },
    });
    expect(result.toolResults[0].output).toContain('FAKE:pnpm build');
  });

  it('传 null 恢复默认（测试之间不许互相污染）', () => {
    setSandboxProvider({ name: 'x', run: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }) });
    setSandboxProvider(null);
    expect(getSandboxProvider()).toBe(localSandbox);
  });
});
