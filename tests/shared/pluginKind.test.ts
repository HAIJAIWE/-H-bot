// tests/shared/pluginKind.test.ts
import { describe, it, expect } from 'vitest';
import { detectPluginKind } from '../../src/shared/plugins/kind';

describe('★ 插件包类型判别', () => {
  it('ai: true → AI 插件', () => {
    expect(detectPluginKind({ ai: true })).toEqual({ kind: 'ai' });
    // 带 entry 的那份属于「同时声明」，见下一条
  });

  it('有 nodes / entry、没有 ai 标记 → 节点插件（保持现状）', () => {
    expect(detectPluginKind({ nodes: [] })).toEqual({ kind: 'node' });
    expect(detectPluginKind({ entry: 'index.js' })).toEqual({ kind: 'node' });
  });

  it('★ 同时声明 ai + nodes → 无效（不许一个包两种身份）', () => {
    expect(detectPluginKind({ ai: true, nodes: [] }).kind).toBe('invalid');
  });

  it('★ entry 是两类包共有字段，不能当身份标记', () => {
    // manifest 对节点插件和 AI 插件都强制 entry（pluginScanner.validateManifest）；
    // 若把 entry 算成节点身份，所有带 entry 的 AI 插件都会被误判成"身份冲突"。
    expect(detectPluginKind({ ai: true, entry: 'index.js' })).toEqual({ kind: 'ai' });
  });

  it('非对象 → 无效', () => {
    expect(detectPluginKind(null).kind).toBe('invalid');
  });
});
