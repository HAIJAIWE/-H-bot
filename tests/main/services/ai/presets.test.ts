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
