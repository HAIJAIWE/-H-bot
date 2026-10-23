// tests/main/services/agent-core/adapters.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApprovalService, makeSandboxService, makeTraceSink } from '@main/services/agent-core/adapters';

describe('★ 契约适配器', () => {
  it('沙箱：命令能跑、片段能跑', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-adapter-'));
    const sandbox = makeSandboxService();
    const cmd = await sandbox.runCommand('node -e 1', { cwd: ws });
    expect(cmd.ok, cmd.stderr).toBe(true);
    const snippet = await sandbox.runSnippet({ code: 'return args.x + 1', args: { x: 1 } });
    expect(snippet.ok).toBe(true);
    expect(snippet.output).toContain('2');
  });

  it('trace：原样转发（事件不加工）', () => {
    const spy = vi.fn();
    const sink = makeTraceSink(spy);
    sink.record('/p', { kind: 'tool', name: 'read_file', ms: 3, ok: true });
    expect(spy).toHaveBeenCalledWith('/p', expect.objectContaining({ name: 'read_file' }));
  });

  it('审批：原样转发，拒绝时返回 false', async () => {
    const approval = makeApprovalService(async () => false);
    expect(await approval.request({ kind: 'write', summary: '写 a.txt' })).toBe(false);
  });
});
