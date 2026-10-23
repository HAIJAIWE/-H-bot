// tests/main/services/plugins/scoping.test.ts
import { describe, it, expect } from 'vitest';
import { scopeToolsByPlugins } from '@main/services/plugins/scoping';

const ALL = [{ name: 'read_file' }, { name: 'a_tool' }, { name: 'b_tool' }];
const OWNED = new Map([
  ['a_tool', 'ai.a'],
  ['b_tool', 'ai.b'],
]);

describe('★ 会话预设的插件集限定', () => {
  it('缺省/空集 → 不限定（含内置工具）', () => {
    expect(scopeToolsByPlugins(ALL, OWNED, undefined)).toHaveLength(3);
    expect(scopeToolsByPlugins(ALL, OWNED, [])).toHaveLength(3);
  });

  it('★ 只保留集合内插件贡献的工具；内置工具不受影响', () => {
    const kept = scopeToolsByPlugins(ALL, OWNED, ['ai.a']).map((t) => t.name);
    expect(kept).toEqual(['read_file', 'a_tool']);
  });

  it('集合里没有的插件 → 它的工具被排除（不是禁用它，只是这一轮看不到）', () => {
    expect(scopeToolsByPlugins(ALL, OWNED, ['ai.b']).map((t) => t.name)).toEqual([
      'read_file',
      'b_tool',
    ]);
  });
});
