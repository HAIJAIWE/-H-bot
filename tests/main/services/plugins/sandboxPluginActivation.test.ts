// tests/main/services/plugins/sandboxPluginActivation.test.ts
//
// 完整闭环（真沙箱）：activate → contributeTool + handleTool → 宿主代理调用 →
// inbound 派发到沙箱函数 → 结果经桥回传 → 代理 resolve。
import { describe, it, expect } from 'vitest';
import { createHardenedContext, deliverToSandbox } from '@main/runtime/sandbox';
import { createSandboxPluginBridge } from '@main/services/plugins/sandboxPluginBridge';
import { activateSandboxPlugin } from '@main/services/plugins/sandboxPluginActivator';
import type { Tool } from '@main/services/agent-core/core';

describe('★ 沙箱插件激活（真实 vm）', () => {
  it('★ 贡献 + 执行闭环：插件函数在沙箱里跑，结果回到宿主', async () => {
    const tools: Tool[] = [];
    let ctx: ReturnType<typeof createHardenedContext>;
    const bridge = createSandboxPluginBridge({
      pluginId: 'test.sandbox',
      permissions: ['tool'],
      timeoutMs: 500,
      host: { contributeTool: (t) => tools.push(t), contributePrompt: () => undefined },
      sendToSandbox: (m) => deliverToSandbox(ctx, JSON.stringify(m)),
    });
    ctx = createHardenedContext((json) => bridge.handleBridgeMessage(json));
    activateSandboxPlugin(
      ctx,
      'module.exports = { activate: function (api) {\n' +
        '  api.contributeTool({ name: "remote_add", description: "d", category: "query" });\n' +
        '  api.handleTool("remote_add", function (args) { return String(args.a + args.b); });\n' +
        '} };',
      { filename: 'plugin.js' },
    );
    expect(tools.map((t) => t.name)).toContain('remote_add');
    await expect(tools[0].run({ a: 2, b: 3 }, { workspace: 'D:/ws' })).resolves.toBe('5');
  });

  it('没有 activate 导出 → 直接抛', () => {
    const bridge = createSandboxPluginBridge({
      pluginId: 'test.bad',
      permissions: [],
      host: { contributeTool: () => undefined, contributePrompt: () => undefined },
      sendToSandbox: () => undefined,
    });
    const ctx = createHardenedContext((json) => bridge.handleBridgeMessage(json));
    expect(() => activateSandboxPlugin(ctx, 'module.exports = {};', { filename: 'bad.js' })).toThrow(
      /activate/,
    );
  });
});
