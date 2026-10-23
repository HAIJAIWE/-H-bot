// tests/main/services/plugins/layers.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addressabilityOf, composeLayer, writeOverride } from '@main/services/plugins/layers';
import { readPluginPatch, writePluginPatch } from '@main/services/plugins/patchFile';

const DEFAULTS = [
  { id: 'builtin.core-tools' },
  { id: 'builtin.enter-hint' },
  { id: 'ai.demo', disabled: true },
];

describe('★ 插件层模型（Phase A）', () => {
  it('★ 组合：覆盖优先；不在默认集合的覆盖被忽略（不能凭空造插件）', () => {
    const map = composeLayer(DEFAULTS, [
      { id: 'builtin.core-tools', disabled: true },
      { id: 'ghost', disabled: false },
    ]);
    expect(map.get('builtin.core-tools')).toBe(false);
    expect(map.get('builtin.enter-hint')).toBe(true);
    expect(map.get('ai.demo')).toBe(false);
    expect(map.has('ghost')).toBe(false);
  });

  it('★ 最小化：设成默认值 → 删掉覆盖；设成非默认 → 只留一条', () => {
    const off = writeOverride(DEFAULTS, [], 'builtin.core-tools', false);
    expect(off).toEqual([{ id: 'builtin.core-tools', disabled: true }]);
    const back = writeOverride(DEFAULTS, off, 'builtin.core-tools', true);
    expect(back).toEqual([]); // 与默认相同 → 覆盖消失
    // 默认就是禁用的插件：启用才需要覆盖
    expect(writeOverride(DEFAULTS, [], 'ai.demo', false)).toEqual([]);
    expect(writeOverride(DEFAULTS, [], 'ai.demo', true)).toEqual([
      { id: 'ai.demo', disabled: false },
    ]);
  });

  it('不可寻址 → 只读且给出结构原因；writeOverride 不改写', () => {
    expect(addressabilityOf('builtin.core-tools', DEFAULTS)).toEqual({
      patchId: 'builtin.core-tools',
    });
    expect(addressabilityOf('ghost', DEFAULTS)).toEqual({ readOnlyReason: 'unaddressable' });
    expect(writeOverride(DEFAULTS, [], 'ghost', false)).toEqual([]);
  });

  it('patch 文件：写入可读回；坏文件 → 空（回默认）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qqbat-patch-'));
    expect(await readPluginPatch(dir)).toEqual([]);
    await writePluginPatch(dir, [{ id: 'builtin.core-tools', disabled: true }, { id: 'x' }]);
    expect(await readPluginPatch(dir)).toEqual([
      { id: 'builtin.core-tools', disabled: true },
      { id: 'x' },
    ]);
    const bad = await mkdtemp(join(tmpdir(), 'qqbat-patch-bad-'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, 'plugins.patch.json'), '{not json', 'utf-8');
    expect(await readPluginPatch(bad)).toEqual([]);
  });
});
