// tests/renderer/lib/plugins.test.ts
//
// 插件 API v0.1（树内插件）：清单校验 + 激活时贡献插槽（id 自动带插件前缀）+ 重复注册拒绝。
import { describe, it, expect } from 'vitest';
import {
  definePlugin,
  listPlugins,
  registerPlugin,
  setPluginEnabled,
} from '@renderer/lib/plugins/api';
import { listAiSlot } from '@renderer/lib/ai/uiSlots';

describe('★ 插件 API（树内插件 v0.1）', () => {
  it('清单缺字段 → 定义时直接拒', () => {
    expect(() =>
      definePlugin({ manifest: { id: '', name: 'x', version: '1' }, activate: () => {} }),
    ).toThrow(/id/);
    expect(() =>
      definePlugin({ manifest: { id: 'p', name: '', version: '1' }, activate: () => {} }),
    ).toThrow(/name/);
    expect(() =>
      definePlugin({ manifest: { id: 'p', name: 'n', version: '' }, activate: () => {} }),
    ).toThrow(/version/);
  });

  it('★ 激活时贡献的插槽 id 自动带插件前缀（跨插件不会撞 id）', () => {
    registerPlugin(
      definePlugin({
        manifest: { id: 'test.plugin', name: 'Test', version: '0.1.0', permissions: ['slot'] },
        activate(api) {
          api.contributeSlot({ id: 'row', slot: 'composer.toolbar', order: 5, render: () => null });
        },
      }),
    );
    expect(listAiSlot('composer.toolbar').map((e) => e.id)).toContain('test.plugin.row');
    expect(listPlugins().map((m) => m.id)).toContain('test.plugin');
  });

  it('★ 停用 = 撤销贡献（插槽里立刻没有它），启用 = 重新贡献', () => {
    expect(listAiSlot('composer.toolbar').map((e) => e.id)).toContain('test.plugin.row');
    setPluginEnabled('test.plugin', false);
    expect(listAiSlot('composer.toolbar').map((e) => e.id)).not.toContain('test.plugin.row');
    expect(listPlugins().find((p) => p.id === 'test.plugin')?.enabled).toBe(false);
    setPluginEnabled('test.plugin', true);
    expect(listAiSlot('composer.toolbar').map((e) => e.id)).toContain('test.plugin.row');
    expect(() => setPluginEnabled('nope', true)).toThrow(/not found/);
  });

  it('★ 没声明 slot 权限却贡献插槽 → 激活时直接拒（能力声明是真的闸门）', () => {
    expect(() =>
      registerPlugin(
        definePlugin({
          manifest: { id: 'test.no-perm', name: 'NoPerm', version: '0.1.0' },
          activate(api) {
            api.contributeSlot({ id: 'x', slot: 'panel.aside', render: () => null });
          },
        }),
      ),
    ).toThrow(/permission/);
  });

  it('插件 id 重复 → 直接拒（不许两个插件悄悄覆盖）', () => {
    expect(() =>
      registerPlugin(
        definePlugin({
          manifest: { id: 'test.plugin', name: 'Again', version: '0.1.0', permissions: ['slot'] },
          activate: () => {},
        }),
      ),
    ).toThrow(/already registered/);
  });
});
