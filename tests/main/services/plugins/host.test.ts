// tests/main/services/plugins/host.test.ts
//
// 主进程插件宿主 v0.1：插件贡献**工具**与**提示段落**；停用 = 真的撤销（不是藏起来）。
import { describe, it, expect, afterEach } from 'vitest';
import {
  listMainPlugins,
  registerMainPlugin,
  setMainPluginEnabled,
  unregisterMainPlugin,
} from '@main/services/plugins/host';
import { listTools } from '@main/services/agent-core/core';
import { buildSystemPrompt } from '@main/services/agent-core/prompt';

afterEach(() => {
  for (const p of listMainPlugins()) unregisterMainPlugin(p.id);
});

describe('★ 主进程插件：贡献工具与提示', () => {
  it('★ 贡献工具后，循环的注册表里立刻有它；停用后消失、启用后回来', () => {
    registerMainPlugin({
      manifest: { id: 'test.tool-plugin', name: 'ToolPlugin', version: '0.1.0', permissions: ['tool'] },
      activate(api) {
        api.contributeTool({
          name: 'plugin_echo',
          description: '插件贡献的工具（测试）',
          category: 'query',
          async run() {
            return 'echo';
          },
        });
      },
    });
    expect(listTools().map((t) => t.name)).toContain('plugin_echo');
    setMainPluginEnabled('test.tool-plugin', false);
    expect(listTools().map((t) => t.name)).not.toContain('plugin_echo');
    setMainPluginEnabled('test.tool-plugin', true);
    expect(listTools().map((t) => t.name)).toContain('plugin_echo');
  });

  it('贡献提示段落：默认出现在系统提示里，停用后不再出现', () => {
    registerMainPlugin({
      manifest: { id: 'test.prompt-plugin', name: 'P', version: '0.1.0', permissions: ['prompt'] },
      activate(api) {
        api.contributePrompt({
          id: 'test.prompt-section',
          order: 5,
          render: () => '插件贡献的提示段落',
        });
      },
    });
    expect(buildSystemPrompt('D:/ws')).toContain('插件贡献的提示段落');
    setMainPluginEnabled('test.prompt-plugin', false);
    expect(buildSystemPrompt('D:/ws')).not.toContain('插件贡献的提示段落');
  });

  it('没声明能力就贡献 → 激活时抛错，并且不留半截（已注册的会回滚）', () => {
    expect(() =>
      registerMainPlugin({
        manifest: { id: 'test.no-perm', name: 'N', version: '0.1.0', permissions: ['prompt'] },
        activate(api) {
          api.contributeTool({
            name: 'sneaky_tool',
            description: 'x',
            async run() {
              return 'x';
            },
          });
        },
      }),
    ).toThrow(/permission/);
    expect(listTools().map((t) => t.name)).not.toContain('sneaky_tool');
    expect(listMainPlugins().map((p) => p.id)).not.toContain('test.no-perm');
  });
});
