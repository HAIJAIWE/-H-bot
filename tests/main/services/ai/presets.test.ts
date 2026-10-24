// tests/main/services/ai/presets.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPresets, resolvePresetTools, writePresets } from '@main/services/ai/presets';

async function project(withFile?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-presets-'));
  if (withFile !== undefined) {
    await mkdir(join(dir, '.qqbat'), { recursive: true });
    await writeFile(join(dir, '.qqbat', 'agent-presets.json'), JSON.stringify(withFile), 'utf-8');
  }
  return dir;
}

describe('★ 会话预设（.qqbat/agent-presets.json）', () => {
  it('★ 写入后可读回；重名后者覆盖前者、工具去重', async () => {
    const dir = await project();
    await writePresets(dir, [
      { name: '只读', allowedTools: ['read_file', 'read_file', 'list_dir'] },
      { name: '只读', allowedTools: ['read_file'] },
      { name: '  ' },
    ]);
    const list = await readPresets(dir);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: '只读', allowedTools: ['read_file'] });
  });

  it('坏文件 / 非数组 → 空表（永不抛）', async () => {
    const dir = await project({ not: 'an array' });
    expect(await readPresets(dir)).toEqual([]);
    const missing = await mkdtemp(join(tmpdir(), 'qqbat-presets-empty-'));
    expect(await readPresets(missing)).toEqual([]);
  });

  it('★ role / prompt：写时归一（不认识的角色当没写、附加要求去空白并截断）', async () => {
    const dir = await project();
    await writePresets(dir, [
      { name: '巡检', role: 'coder', prompt: '  只读不改  ' },
      { name: '瞎写', role: 'nope' as never, prompt: 42 as never },
      { name: '超长', prompt: 'x'.repeat(2100) },
      { name: '空附加', prompt: '   ' },
    ]);
    const byName = new Map((await readPresets(dir)).map((p) => [p.name, p]));
    expect(byName.get('巡检')).toMatchObject({ role: 'coder', prompt: '只读不改' });
    // 拼错的角色不能猜，也不能让整条预设失效
    expect(byName.get('瞎写')).toEqual({ name: '瞎写' });
    expect(byName.get('超长')?.prompt).toHaveLength(2000);
    expect(byName.get('空附加')).toEqual({ name: '空附加' });
  });

  it('★ 读也归一：手写的坏 role / 坏 prompt 只丢字段，不丢整条预设', async () => {
    const dir = await project([
      { name: 'a', role: 'Builder', prompt: ' 帮我  ' },
      { name: 'b', role: ['coder'], prompt: { text: 'x' } },
    ]);
    const list = await readPresets(dir);
    expect(list[0]).toEqual({ name: 'a', prompt: '帮我' });
    expect(list[1]).toEqual({ name: 'b' });
  });

  it('resolvePresetTools：找不到 / 没白名单 → undefined；找到 → 白名单', async () => {
    const dir = await project([
      { name: '只读', allowedTools: ['read_file'] },
      { name: '不限' },
    ]);
    expect(await resolvePresetTools(dir, '只读')).toEqual(['read_file']);
    expect(await resolvePresetTools(dir, '不限')).toBeUndefined();
    expect(await resolvePresetTools(dir, '不存在')).toBeUndefined();
  });
});
