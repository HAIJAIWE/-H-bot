// tests/main/services/plugins/aiPluginLoader.test.ts
//
// AI 插件装载：清单 + 入口 → 沙箱 activate → 贡献工具进宿主注册表 → 卸载后消失。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAiPluginPackage } from '@main/services/plugins/aiPluginLoader';
import { listMainPlugins, unregisterMainPlugin } from '@main/services/plugins/host';
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
