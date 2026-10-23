// tests/main/services/plugins/market.test.ts
//
// 插件市场：官方离线源 → 安装（真沙箱）→ 完整性/更新 → 卸载 → 启动恢复。
// 每个用例用独立 mkdtemp 作为市场根，不碰真实 userData。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addMarketSource,
  installMarketPlugin,
  listInstalledMarketPlugins,
  listMarketPlugins,
  listMarketSources,
  normalizeMarketSource,
  removeMarketSource,
  restoreInstalledMarketPlugins,
  uninstallMarketPlugin,
} from '@main/services/plugins/market';
import { BUNDLED_SOURCE } from '@main/services/plugins/marketBundledIndex';
import { listMainPlugins, unregisterMainPlugin } from '@main/services/plugins/host';
import { listTools } from '@main/services/agent-core/core';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-market-'));
  roots.push(dir);
  return dir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  for (const p of listMainPlugins()) unregisterMainPlugin(p.id);
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function localIndex(): Record<string, unknown> {
  return {
    format: 1,
    title: 'Local test market',
    plugins: [
      {
        id: 'local-demo',
        name: 'local-demo',
        description: 'A local test plugin',
        versions: [
          {
            version: '1.0.0',
            files: [
              {
                path: 'manifest.json',
                text: JSON.stringify({
                  name: 'local-demo',
                  version: '1.0.0',
                  entry: 'index.js',
                  ai: true,
                }),
              },
              {
                path: 'index.js',
                text:
                  'module.exports = { activate: function (api) {\n' +
                  '  api.contributeTool({ name: "local_ping", description: "d", category: "query" });\n' +
                  '  api.handleTool("local_ping", function () { return "pong"; });\n' +
                  '} };',
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('市场清单', () => {
  it('官方离线源默认存在，且有 3 个可装插件', async () => {
    const root = await makeRoot();
    const list = await listMarketPlugins(root);
    expect(list.sources[0]?.source).toBe(BUNDLED_SOURCE);
    expect(list.plugins.map((p) => p.id).sort()).toEqual(['clock', 'coin', 'text-stats']);
    for (const item of list.plugins) {
      expect(item.latestVersion).toBe('1.0.0');
      expect(item.installed).toBeUndefined();
    }
  });

  it('坏来源只影响自己：错误按来源列出，其他源照常展示', async () => {
    const root = await makeRoot();
    await addMarketSource(join(root, 'missing-market.json'), root);
    const list = await listMarketPlugins(root);
    expect(list.plugins).toHaveLength(3);
    expect(list.sources.some((s) => s.source.includes('missing-market.json') && s.error)).toBe(
      true,
    );
  });
});

describe('安装 / 卸载', () => {
  it('★ 安装官方插件 → 工具可执行 → 记录落盘 → 卸载后目录与工具都消失', async () => {
    const root = await makeRoot();
    const install = await installMarketPlugin('clock', root);
    expect(install.ok).toBe(true);
    if (install.ok) {
      expect(install.value.pluginId).toBe('ai.market-clock');
      expect(install.value.version).toBe('1.0.0');
    }
    const tool = listTools().find((t) => t.name === 'market_now');
    expect(tool).toBeTruthy();
    const output = await tool?.run({}, { workspace: 'D:/ws' });
    expect(typeof output).toBe('string');
    expect(String(output)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const dir = join(root, 'plugins', 'clock');
    expect(await exists(join(dir, 'manifest.json'))).toBe(true);
    const records = await listInstalledMarketPlugins(root);
    expect(records.map((r) => r.id)).toEqual(['clock']);
    expect(records[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);

    const list = await listMarketPlugins(root);
    expect(list.plugins.find((p) => p.id === 'clock')?.installed).toEqual({
      version: '1.0.0',
      modified: false,
      missing: false,
    });

    const removed = await uninstallMarketPlugin('clock', root);
    expect(removed.ok).toBe(true);
    expect(await exists(dir)).toBe(false);
    expect(await listInstalledMarketPlugins(root)).toEqual([]);
    expect(listTools().map((t) => t.name)).not.toContain('market_now');
  });

  it('重复安装同一版本被拒绝', async () => {
    const root = await makeRoot();
    await installMarketPlugin('coin', root);
    const again = await installMarketPlugin('coin', root);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain('已安装版本');
  });

  it('本地修改过的安装不会被覆盖，也不会被静默重装', async () => {
    const root = await makeRoot();
    await installMarketPlugin('text-stats', root);
    const entry = join(root, 'plugins', 'text-stats', 'index.js');
    await writeFile(entry, (await readFile(entry, 'utf8')) + '\n// local edit\n', 'utf8');

    const list = await listMarketPlugins(root);
    expect(list.plugins.find((p) => p.id === 'text-stats')?.installed?.modified).toBe(true);

    const reinstall = await installMarketPlugin('text-stats', root);
    expect(reinstall.ok).toBe(false);
    if (!reinstall.ok) expect(reinstall.error).toContain('本地修改');
  });

  it('安装不存在的 id → 明确失败', async () => {
    const root = await makeRoot();
    const r = await installMarketPlugin('no-such-plugin', root);
    expect(r.ok).toBe(false);
  });
});

describe('来源管理', () => {
  it('添加本地来源后清单合并；删除后只剩官方源', async () => {
    const root = await makeRoot();
    const indexPath = join(root, 'local-market.json');
    await writeFile(indexPath, JSON.stringify(localIndex()), 'utf8');

    const added = await addMarketSource(indexPath, root);
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.value).toEqual([BUNDLED_SOURCE, indexPath]);

    const list = await listMarketPlugins(root);
    expect(list.plugins.map((p) => p.id)).toContain('local-demo');
    expect(list.plugins.find((p) => p.id === 'local-demo')?.source).toBe(indexPath);

    const install = await installMarketPlugin('local-demo', root);
    expect(install.ok).toBe(true);
    expect(listTools().map((t) => t.name)).toContain('local_ping');

    const removed = await removeMarketSource(indexPath, root);
    expect(removed.ok).toBe(true);
    expect(await listMarketSources(root)).toEqual([BUNDLED_SOURCE]);
  });

  it('拒绝 bundled: 前缀、其他协议与重复来源', async () => {
    expect(normalizeMarketSource('bundled://official')).toBeNull();
    expect(normalizeMarketSource('ftp://example.com/m.json')).toBeNull();
    expect(normalizeMarketSource('https://example.com/market.json')).toBe(
      'https://example.com/market.json',
    );
    const root = await makeRoot();
    expect((await removeMarketSource(BUNDLED_SOURCE, root)).ok).toBe(false);
    await addMarketSource('https://example.com/market.json', root);
    expect((await addMarketSource('https://example.com/market.json', root)).ok).toBe(false);
  });
});

describe('启动恢复', () => {
  it('哈希对得上的装回去；被改过的只标记 changed、不加载', async () => {
    const root = await makeRoot();
    await installMarketPlugin('coin', root);
    await installMarketPlugin('clock', root);
    for (const p of listMainPlugins()) unregisterMainPlugin(p.id);

    const entry = join(root, 'plugins', 'clock', 'index.js');
    await writeFile(entry, (await readFile(entry, 'utf8')) + '\n// drift\n', 'utf8');

    const restored = await restoreInstalledMarketPlugins(root);
    expect(restored.restored).toEqual(['coin']);
    expect(restored.changed).toEqual(['clock']);
    expect(listTools().map((t) => t.name)).toContain('market_coin');
    expect(listTools().map((t) => t.name)).not.toContain('market_now');
  });

  it('目录缺失 → missing；坏的记录不炸启动', async () => {
    const root = await makeRoot();
    await installMarketPlugin('coin', root);
    await rm(join(root, 'plugins', 'coin'), { recursive: true, force: true });
    const restored = await restoreInstalledMarketPlugins(root);
    expect(restored.missing).toEqual(['coin']);
    expect(restored.restored).toEqual([]);
  });
});
