// tests/main/services/plugins/pluginKindGate.test.ts
//
// 装载器先判包类型：AI 插件（未接入装载器）与"两种身份"的包都要**明确拒绝**，
// 不能当成节点插件去跑入口然后给一个看不懂的报错。
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPluginPackage } from '@main/services/plugins/pluginScanner';

async function dirWithManifest(manifest: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-plugin-kind-'));
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
  await writeFile(join(dir, 'index.js'), 'module.exports = {};', 'utf-8');
  return dir;
}

describe('★ 装载器包类型闸门', () => {
  it('AI 插件 → 明确拒绝（说明"尚未接入装载器"）', async () => {
    const dir = await dirWithManifest({
      name: 'ai-demo',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
    });
    const res = await loadPluginPackage(dir);
    expect(res.package).toBeNull();
    expect(res.errors.map((e) => e.message).join(' ')).toContain('AI 插件尚未接入装载器');
  });

  it('同时声明 ai + nodes → 按身份冲突拒绝', async () => {
    const dir = await dirWithManifest({
      name: 'both',
      version: '1.0.0',
      entry: 'index.js',
      ai: true,
      nodes: [],
    });
    const res = await loadPluginPackage(dir);
    expect(res.package).toBeNull();
    expect(res.errors.map((e) => e.message).join(' ')).toContain('身份冲突');
  });
});
