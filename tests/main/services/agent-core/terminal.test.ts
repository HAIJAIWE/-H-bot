// tests/main/services/agent-core/terminal.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellSession } from '@main/services/agent-core/terminal';

describe('★ 持久 shell 会话', () => {
  it('能跑命令并拿到输出', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'));
    const shell = new ShellSession({ cwd });
    const r = await shell.run('Write-Output (2 + 3)');
    shell.kill();
    expect(r.ok, r.output).toBe(true);
    expect(r.output).toContain('5');
  }, 15000);

  it('★ 会话保留状态（第二次能看到第一次设的变量）', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'));
    const shell = new ShellSession({ cwd });
    await shell.run('$x = 41');
    const r = await shell.run('Write-Output ($x + 1)');
    shell.kill();
    expect(r.output).toContain('42');
  }, 15000);
});
