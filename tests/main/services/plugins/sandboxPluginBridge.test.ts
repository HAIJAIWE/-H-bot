// tests/main/services/plugins/sandboxPluginBridge.test.ts
//
// 沙箱插件桥：**函数过不了 JSON**，所以工具是代理 —— 调用时转发回沙箱，结果按 token 回来。
import { describe, it, expect } from 'vitest';
import { createSandboxPluginBridge } from '@main/services/plugins/sandboxPluginBridge';
import type { Tool } from '@main/services/agent-core/core';
import type { PromptSection } from '@main/services/agent-core/prompt';

function setup(
  permissions: string[] = ['tool', 'prompt'],
  timeoutMs = 50,
  settings?: () => Record<string, string | number | boolean> | undefined,
) {
  const tools: Tool[] = [];
  const prompts: PromptSection[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const bridge = createSandboxPluginBridge({
    pluginId: 'test.sandbox',
    permissions,
    timeoutMs,
    host: {
      contributeTool: (t) => tools.push(t),
      contributePrompt: (s) => prompts.push(s),
    },
    sendToSandbox: (m) => sent.push(m),
    ...(settings ? { settings } : {}),
  });
  return { bridge, tools, prompts, sent };
}

describe('★ 沙箱插件桥（代理工具）', () => {
  it('★ 贡献工具 → 调用时转发沙箱 → 迟到结果按 token 回来', async () => {
    const { bridge, tools, sent } = setup();
    const res = bridge.handleBridgeMessage(
      JSON.stringify({
        kind: 'aiPlugin',
        action: 'contributeTool',
        payload: { name: 'remote_echo', description: 'x', category: 'query' },
      }),
    );
    expect(JSON.parse(res).ok).toBe(true);
    expect(tools.map((t) => t.name)).toContain('remote_echo');

    const running = tools[0].run({ q: 1 }, { workspace: 'D:/ws' });
    expect(sent[0]).toMatchObject({ kind: 'call', target: 'aiPlugin', name: 'remote_echo' });
    const token = sent[0].token as number;
    // 沙箱回传结果
    bridge.handleBridgeMessage(
      JSON.stringify({ kind: '__call-result', token, ok: true, value: 'pong' }),
    );
    await expect(running).resolves.toBe('pong');
  });

  it('超时 → 按 [工具失败] 返回（循环不会再挂住）', async () => {
    const { bridge, tools } = setup(['tool'], 20);
    bridge.handleBridgeMessage(
      JSON.stringify({
        kind: 'aiPlugin',
        action: 'contributeTool',
        payload: { name: 'hang', description: 'x' },
      }),
    );
    await expect(tools[0].run({}, { workspace: 'D:/ws' })).resolves.toContain('超时');
  });

  it('没声明能力就贡献 → 返回错误信封，宿主什么也没注册', () => {
    const { bridge, tools } = setup(['prompt']);
    const res = JSON.parse(
      bridge.handleBridgeMessage(
        JSON.stringify({
          kind: 'aiPlugin',
          action: 'contributeTool',
          payload: { name: 'sneaky', description: 'x' },
        }),
      ),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('permission');
    expect(tools).toHaveLength(0);
  });

  it('提示段落：静态文本直接注册（render 返回原文）', () => {
    const { bridge, prompts } = setup(['prompt']);
    bridge.handleBridgeMessage(
      JSON.stringify({ kind: 'aiPlugin', action: 'contributePrompt', payload: { id: 'hint', text: 'hi' } }),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0].render({ workspace: 'D:/ws', toolNames: [] })).toBe('hi');
  });

  it('★ getSetting / getSettings：每次读都现取宿主值（保存即生效，不用重载插件）', () => {
    let values: Record<string, string | number | boolean> = { timezone: 'UTC', loud: false };
    const { bridge } = setup(['tool'], 50, () => values);
    const read = (key: string) =>
      JSON.parse(
        bridge.handleBridgeMessage(
          JSON.stringify({ kind: 'aiPlugin', action: 'getSetting', payload: { key } }),
        ),
      ) as { ok: boolean; value: unknown };
    expect(read('timezone')).toEqual({ ok: true, value: 'UTC' });
    // 宿主改值后**下一次调用**就能读到新的（桥里存的是 getter，不是快照）
    values = { timezone: 'Asia/Shanghai', loud: true };
    expect(read('timezone').value).toBe('Asia/Shanghai');
    expect(read('nope').value).toBeNull();
    const all = JSON.parse(
      bridge.handleBridgeMessage(JSON.stringify({ kind: 'aiPlugin', action: 'getSettings', payload: {} })),
    ) as { ok: boolean; value: unknown };
    expect(all).toEqual({ ok: true, value: { timezone: 'Asia/Shanghai', loud: true } });
  });

  it('没提供 settings（老插件/无参数插件）→ 单项 null、全部空对象', () => {
    const { bridge } = setup(['tool']);
    const one = JSON.parse(
      bridge.handleBridgeMessage(
        JSON.stringify({ kind: 'aiPlugin', action: 'getSetting', payload: { key: 'k' } }),
      ),
    ) as { ok: boolean; value: unknown };
    expect(one.value).toBeNull();
    const all = JSON.parse(
      bridge.handleBridgeMessage(JSON.stringify({ kind: 'aiPlugin', action: 'getSettings', payload: {} })),
    ) as { ok: boolean; value: unknown };
    expect(all.value).toEqual({});
  });

  it('停用（dispose）→ 挂起的调用按失败收尾', async () => {
    const { bridge, tools } = setup(['tool'], 5000);
    bridge.handleBridgeMessage(
      JSON.stringify({
        kind: 'aiPlugin',
        action: 'contributeTool',
        payload: { name: 'pending_tool', description: 'x' },
      }),
    );
    const running = tools[0].run({}, { workspace: 'D:/ws' });
    bridge.dispose();
    await expect(running).resolves.toContain('已停用');
  });
});
