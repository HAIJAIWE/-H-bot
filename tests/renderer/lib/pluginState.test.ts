// tests/renderer/lib/pluginState.test.ts
//
// **插件启停状态落盘**：坏配置当空集合（不能因为一条坏 JSON 让所有插件消失）；
// 停用/启用会写进 localStorage；重启后按它恢复（注册但不激活）。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  definePlugin,
  listPlugins,
  parseDisabledPlugins,
  registerPlugin,
  setPluginEnabled,
} from '@renderer/lib/plugins/api';
import { listAiSlot } from '@renderer/lib/ai/uiSlots';

beforeEach(() => {
  localStorage.clear();
});

describe('★ 插件启停状态落盘', () => {
  it('坏 JSON / 非数组 → 空集合（不因为配置坏了让插件全消失）', () => {
    expect(parseDisabledPlugins(null).size).toBe(0);
    expect(parseDisabledPlugins('{oops').size).toBe(0);
    expect(parseDisabledPlugins('"str"').size).toBe(0);
    expect([...parseDisabledPlugins('["a","b",1]')]).toEqual(['a', 'b']);
  });

  it('★ 停用后写进 localStorage；启用后从里面移除', () => {
    registerPlugin(
      definePlugin({
        manifest: {
          id: 'state.plugin',
          name: 'State',
          version: '0.1.0',
          permissions: ['slot'],
        },
        activate(api) {
          api.contributeSlot({ id: 'row', slot: 'composer.hint', render: () => null });
        },
      }),
    );
    setPluginEnabled('state.plugin', false);
    expect(JSON.parse(localStorage.getItem('qqbat.plugins.disabled') ?? '[]')).toContain(
      'state.plugin',
    );
    expect(listAiSlot('composer.hint').map((e) => e.id)).not.toContain('state.plugin.row');

    setPluginEnabled('state.plugin', true);
    expect(JSON.parse(localStorage.getItem('qqbat.plugins.disabled') ?? '[]')).not.toContain(
      'state.plugin',
    );
    expect(listAiSlot('composer.hint').map((e) => e.id)).toContain('state.plugin.row');
    expect(listPlugins().find((p) => p.id === 'state.plugin')?.enabled).toBe(true);
  });
});
