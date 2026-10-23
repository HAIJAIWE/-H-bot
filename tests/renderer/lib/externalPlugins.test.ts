// tests/renderer/lib/externalPlugins.test.ts
//
// 外部插件安装记录（v0）：清单校验 + 记录 + 卸载；这一版**不执行**任何外部代码。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  installExternalPlugin,
  listExternalPlugins,
  parseExternalManifest,
  uninstallExternalPlugin,
} from '@renderer/lib/plugins/external';

beforeEach(() => {
  localStorage.clear();
});

describe('★ 外部插件安装记录（v0：看清单、记录、卸载）', () => {
  it('清单校验：缺字段/坏 JSON/未知能力/未知插槽都拒', () => {
    expect(parseExternalManifest('{oops')).toEqual({ ok: false, error: 'not valid JSON' });
    expect(parseExternalManifest('{}').ok).toBe(false);
    expect(
      parseExternalManifest(JSON.stringify({ id: 'bad id!', name: 'x', version: '1.0.0' })).ok,
    ).toBe(false);
    expect(
      parseExternalManifest(JSON.stringify({ id: 'a.b', name: 'x', version: 'nope' })).ok,
    ).toBe(false);
    expect(
      parseExternalManifest(
        JSON.stringify({ id: 'a.b', name: 'x', version: '1.0.0', permissions: ['ipc'] }),
      ).ok,
    ).toBe(false);
    expect(
      parseExternalManifest(
        JSON.stringify({ id: 'a.b', name: 'x', version: '1.0.0', slots: ['nowhere'] }),
      ).ok,
    ).toBe(false);
  });

  it('★ 合法清单能安装，落盘后可列出、可卸载', () => {
    const parsed = parseExternalManifest(
      JSON.stringify({
        id: 'demo.plugin',
        name: 'Demo',
        version: '0.2.0',
        permissions: ['slot'],
        slots: ['composer.hint'],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    installExternalPlugin(parsed.manifest, parsed.slots);
    const listed = listExternalPlugins();
    expect(listed).toHaveLength(1);
    expect(listed[0].manifest.id).toBe('demo.plugin');
    expect(listed[0].executable).toBe(false);

    uninstallExternalPlugin('demo.plugin');
    expect(listExternalPlugins()).toHaveLength(0);
  });
});
