// tests/main/services/plugins/aiPluginLoader.test.ts
//
// AI 插件装载：清单 + 入口 → 沙箱 activate → 贡献工具进宿主注册表 → 卸载后消失。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAiPluginPackage } from '@main/services/plugins/aiPluginLoader';
import {
  listMainPlugins,
  pluginOwnedToolNames,
  unregisterMainPlugin,
} from '@main/services/plugins/host';
import { getLivePluginSettings } from '@main/services/plugins/pluginSettingsStore';
import { listTools } from '@main/services/agent-core/core';

afterEach(() => {
  for (const p of listMainPlugins()) unregisterMainPlugin(p.id);
});

async function makePluginDir(source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-ai-plugin-'));
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({ name: 'demo-ai', version: '1.0.0', entry: 'index.js', ai: true }),
    'utf-8',
  );
  await writeFile(join(dir, 'index.js'), source, 'utf-8');
  return dir;
}

describe('★ AI 插件装载（真沙箱）', () => {
  it('★ 装载 → 工具出现并可执行 → 卸载后消失', async () => {
    const dir = await makePluginDir(
      'module.exports = { activate: function (api) {\n' +
        '  api.contributeTool({ name: "ai_add", description: "d", category: "query" });\n' +
        '  api.handleTool("ai_add", function (args) { return String(args.a + args.b); });\n' +
        '} };',
    );
    const loaded = await loadAiPluginPackage(dir, {
      name: 'demo-ai',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(listTools().map((t) => t.name)).toContain('ai_add');

    const tool = listTools().find((t) => t.name === 'ai_add');
    await expect(tool?.run({ a: 4, b: 6 }, { workspace: 'D:/ws' })).resolves.toBe('10');

    unregisterMainPlugin(loaded.pluginId);
    expect(listTools().map((t) => t.name)).not.toContain('ai_add');
  });

  it('★ 清单声明权限与参数：权限按声明过滤，参数规范化后进宿主清单，默认值随装载进热缓存', async () => {
    const dir = await makePluginDir(
      'module.exports = { activate: function (api) {\n' +
        '  api.contributeTool({ name: "ai_settings_demo", description: "d", category: "query" });\n' +
        '} };',
    );
    const loaded = await loadAiPluginPackage(dir, {
      name: 'demo-ai-settings',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
      permissions: ['tool'],
      settings: [
        { key: 'greeting', label: 'Greeting', type: 'string', default: 'hi' },
        { key: 'bad key', label: 'x', type: 'string' },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const row = listMainPlugins().find((p) => p.id === loaded.pluginId);
    // 声明的权限被原样带上（没声明 prompt，就没有 prompt）
    expect(row?.permissions).toEqual(['tool']);
    // 坏声明被丢掉，只剩一条合法设置
    expect(row?.settings?.map((s) => s.key)).toEqual(['greeting']);
    // 出厂值在激活时就进了热缓存 —— 插件 activate 里 api.getSetting 立刻能读到
    expect(getLivePluginSettings(loaded.pluginId)).toEqual({ greeting: 'hi' });
    expect(pluginOwnedToolNames(loaded.pluginId)).toContain('ai_settings_demo');
  });

  it('清单没声明 permissions → 两类都算声明（老包不因升级宿主突然全报权限错）', async () => {
    const dir = await makePluginDir('module.exports = { activate: function () {} };');
    const loaded = await loadAiPluginPackage(dir, {
      name: 'demo-ai-legacy',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const row = listMainPlugins().find((p) => p.id === loaded.pluginId);
    expect(row?.permissions).toEqual(['tool', 'prompt']);
    expect(row?.settings).toBeUndefined();
  });

  it('入口读不到 → 明确失败（不注册空插件）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qqbat-ai-missing-'));
    const res = await loadAiPluginPackage(dir, {
      name: 'missing',
      version: '1.0.0',
      entry: 'nope.js',
      ai: true,
    });
    expect(res.ok).toBe(false);
    expect(listMainPlugins().map((p) => p.id)).not.toContain('ai.missing');
  });
});
