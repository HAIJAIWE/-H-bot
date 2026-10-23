// tests/renderer/lib/pluginCompat.test.ts
//
// **兼容性声明**：宿主版本不满足 requires 的插件注册但不激活，也不允许强行启用。
import { describe, it, expect } from 'vitest';
import {
  AI_PLUGIN_HOST_VERSION,
  definePlugin,
  listPlugins,
  parsePluginVersion,
  registerPlugin,
  satisfiesPluginRange,
  setPluginEnabled,
} from '@renderer/lib/plugins/api';
import { listAiSlot } from '@renderer/lib/ai/uiSlots';

describe('★ 插件兼容性（requires 范围）', () => {
  it('版本解析与范围判断', () => {
    expect(parsePluginVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parsePluginVersion('1.2')).toBeNull();
    expect(satisfiesPluginRange('0.1.0', undefined)).toBe(true);
    expect(satisfiesPluginRange('0.1.0', '>=0.1.0')).toBe(true);
    expect(satisfiesPluginRange('0.1.0', '>=0.2.0')).toBe(false);
    expect(satisfiesPluginRange('0.1.0', '^0.1.0')).toBe(true);
    expect(satisfiesPluginRange('0.2.0', '^0.9.0')).toBe(false);
    expect(satisfiesPluginRange('1.2.5', '~1.2.0')).toBe(true);
    expect(satisfiesPluginRange('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfiesPluginRange('1.2.3', '1.2.3')).toBe(true);
    // 看不懂的范围 fail-closed
    expect(satisfiesPluginRange('0.1.0', 'latest')).toBe(false);
  });

  it('★ 不兼容：注册但不激活，插槽里没有它，也不允许启用', () => {
    registerPlugin(
      definePlugin({
        manifest: {
          id: 'compat.newer',
          name: 'Needs newer host',
          version: '0.0.1',
          permissions: ['slot'],
          requires: '>=9.9.9',
        },
        activate(api) {
          api.contributeSlot({ id: 'row', slot: 'panel.aside', render: () => null });
        },
      }),
    );
    expect(listAiSlot('panel.aside').map((e) => e.id)).not.toContain('compat.newer.row');
    const listed = listPlugins().find((p) => p.id === 'compat.newer');
    expect(listed).toMatchObject({ compatible: false, enabled: false });
    expect(() => setPluginEnabled('compat.newer', true)).toThrow(/not compatible/);
  });

  it('兼容的插件照常激活（宿主版本满足）', () => {
    registerPlugin(
      definePlugin({
        manifest: {
          id: 'compat.ok',
          name: 'Fine',
          version: '0.1.0',
          permissions: ['slot'],
          requires: '>=' + AI_PLUGIN_HOST_VERSION,
        },
        activate(api) {
          api.contributeSlot({ id: 'row', slot: 'panel.aside', render: () => null });
        },
      }),
    );
    expect(listAiSlot('panel.aside').map((e) => e.id)).toContain('compat.ok.row');
    expect(listPlugins().find((p) => p.id === 'compat.ok')?.compatible).toBe(true);
  });
});
