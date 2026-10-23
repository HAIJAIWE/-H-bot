// tests/shared/plugins/market.test.ts
//
// 市场索引解析 + 版本挑选的契约。这里钉的是"什么算合法索引"：
// 路径越界、重复、缺 manifest、超大文件都必须整体拒绝（fail-closed）。
import { describe, it, expect } from 'vitest';
import {
  MARKET_FORMAT,
  MARKET_MAX_FILE_BYTES,
  isSafeMarketPath,
  latestCompatibleVersion,
  parseMarketIndex,
  type MarketVersion,
} from '@shared/plugins/market';

function manifest(name = 'demo-plugin'): string {
  return JSON.stringify({ name, version: '1.0.0', entry: 'index.js', ai: true });
}

function indexPath(path = 'index.js'): string {
  return path;
}

function validIndex(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: MARKET_FORMAT,
    title: 'Test market',
    plugins: [
      {
        id: 'demo',
        name: 'demo-pack',
        description: 'demo',
        versions: [
          {
            version: '1.0.0',
            files: [
              { path: 'manifest.json', text: manifest() },
              { path: indexPath(), text: 'module.exports = {};' },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('isSafeMarketPath', () => {
  it('accepts nested posix relative paths', () => {
    expect(isSafeMarketPath('index.js')).toBe(true);
    expect(isSafeMarketPath('lib/util/strings.js')).toBe(true);
  });

  it('rejects traversal and absolute forms', () => {
    for (const bad of ['', '.', '..', '../x', 'a/../b', 'a//b', '/abs', 'C:/x', 'a\\b', 'a/./b']) {
      expect(isSafeMarketPath(bad), bad).toBe(false);
    }
  });
});

describe('parseMarketIndex', () => {
  it('normalizes a valid index', () => {
    const r = parseMarketIndex(validIndex(), 'test');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.format).toBe(MARKET_FORMAT);
    expect(r.value.plugins[0].name).toBe('demo-pack');
    expect(r.value.plugins[0].versions[0].files).toHaveLength(2);
  });

  it('rejects the wrong format and missing title', () => {
    const badFormat = parseMarketIndex({ ...validIndex(), format: 2 }, 'src');
    expect(badFormat.ok).toBe(false);
    if (!badFormat.ok) expect(badFormat.error).toContain('src: $.format');

    const noTitle = parseMarketIndex({ ...validIndex(), title: '' }, 'src');
    expect(noTitle.ok).toBe(false);
  });

  it('rejects traversal in a file path', () => {
    const index = validIndex();
    (index.plugins as Record<string, unknown>[])[0] = {
      id: 'demo',
      name: 'demo-pack',
      description: 'demo',
      versions: [
        {
          version: '1.0.0',
          files: [
            { path: 'manifest.json', text: manifest() },
            { path: '../evil.js', text: 'x' },
          ],
        },
      ],
    };
    const r = parseMarketIndex(index, 'src');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('safe relative POSIX path');
  });

  it('requires manifest.json inside every version', () => {
    const index = validIndex();
    (index.plugins as Record<string, unknown>[])[0] = {
      id: 'demo',
      name: 'demo-pack',
      description: 'demo',
      versions: [{ version: '1.0.0', files: [{ path: 'index.js', text: 'x' }] }],
    };
    const r = parseMarketIndex(index, 'src');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('must include manifest.json');
  });

  it('rejects duplicate plugin ids, versions and file paths', () => {
    const dupId = validIndex();
    const plugins = dupId.plugins as Record<string, unknown>[];
    plugins.push(plugins[0]);
    expect(parseMarketIndex(dupId, 'src').ok).toBe(false);

    const dupVersion = validIndex();
    const versioned = (dupVersion.plugins as Record<string, unknown>[])[0];
    const versions = versioned.versions as Record<string, unknown>[];
    versions.push(versions[0]);
    expect(parseMarketIndex(dupVersion, 'src').ok).toBe(false);

    const dupFile = validIndex();
    const files = ((dupFile.plugins as Record<string, unknown>[])[0].versions as Record<string, unknown>[])[0]
      .files as Record<string, unknown>[];
    files.push({ path: 'index.js', text: 'again' });
    expect(parseMarketIndex(dupFile, 'src').ok).toBe(false);
  });

  it('rejects oversized inline files', () => {
    const index = validIndex();
    const files = ((index.plugins as Record<string, unknown>[])[0].versions as Record<string, unknown>[])[0]
      .files as Record<string, unknown>[];
    files.push({ path: 'big.js', text: 'x'.repeat(MARKET_MAX_FILE_BYTES + 1) });
    const r = parseMarketIndex(index, 'src');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('exceeds');
  });
});

describe('latestCompatibleVersion', () => {
  const versions: MarketVersion[] = [
    { version: '1.0.0', requires: '>=0.1.0', files: [] },
    { version: '1.2.0', requires: '>=0.1.0', files: [] },
    { version: '2.0.0', requires: '>=9.0.0', files: [] },
  ];

  it('picks the highest version the host satisfies', () => {
    expect(latestCompatibleVersion(versions, '0.1.0')?.version).toBe('1.2.0');
  });

  it('returns null when nothing is compatible', () => {
    expect(latestCompatibleVersion(versions, '0.0.1')).toBeNull();
  });
});
