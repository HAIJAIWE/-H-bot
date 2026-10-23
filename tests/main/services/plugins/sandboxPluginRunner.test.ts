// tests/main/services/plugins/sandboxPluginRunner.test.ts
//
// 端到端：**真的沙箱**里跑插件脚本 → activate(api) → 贡献工具 → 调用时转发回沙箱。
import { describe, it, expect } from 'vitest';
import { createHardenedContext, deliverToSandbox } from '@main/runtime/sandbox';
import { createSandboxPluginBridge } from '@main/services/plugins/sandboxPluginBridge';
import { activateSandboxPlugin } from '@main/services/plugins/sandboxPluginRunner';
import type { Tool } from '@main/services/agent-core/core';

describe('★ 沙箱插件 runner（真实 vm）', () => {
  it('★ 插件在沙箱里 activate → 贡献工具 → 调用回流沙箱 → 结果回来', async () => {
    const tools: Tool[] = [];
    const sent: Array<Record<string, unknown>> = [];
    // sendToSandbox 必须真的把调用送进沙箱（生产实现就是这个函数）：
    // 沙箱 inbound 按 name 找 __qqbatAiHandlers 里的函数，执行后经桥回 __call-result。
    let ctx: import('node:vm').Context;
    const bridge = createSandboxPluginBridge({
      pluginId: 'test.sandbox',
      permissions: ['tool'],
      timeoutMs: 200,
      host: {
        contributeTool: (t) => tools.push(t),
        contributePrompt: () => undefined,
      },
      sendToSandbox: (m) => {
        sent.push(m);
        deliverToSandbox(ctx, JSON.stringify(m));
      },
    });
    ctx = createHardenedContext((json) => bridge.handleBridgeMessage(json));

    activateSandboxPlugin(
      ctx,
      "module.exports = { activate: function (api) { api.contributeTool({ name: 'remote_echo', description: 'd', category: 'query' }); api.handleTool('remote_echo', function (args) { return 'pong:' + String(args && args.q); }); } };",
      { filename: 'plugin.js' },
    );
    expect(tools.map((t) => t.name)).toContain('remote_echo');

    // 调用回流沙箱 → handleTool 注册的函数真的跑 → 结果经桥回来
    await expect(tools[0].run({ q: 1 }, { workspace: 'D:/ws' })).resolves.toBe('pong:1');
    expect(sent[0]).toMatchObject({ kind: 'call', target: 'aiPlugin', name: 'remote_echo' });
  });

  it('没有 activate 导出 → 直接抛（不要静默装一个空插件）', () => {
    const bridge = createSandboxPluginBridge({
      pluginId: 'test.bad',
      permissions: [],
      host: { contributeTool: () => undefined, contributePrompt: () => undefined },
      sendToSandbox: () => undefined,
    });
    const ctx = createHardenedContext((json) => bridge.handleBridgeMessage(json));
    expect(() =>
      activateSandboxPlugin(ctx, 'module.exports = {};', { filename: 'bad.js' }),
    ).toThrow(/activate/);
  });
});
