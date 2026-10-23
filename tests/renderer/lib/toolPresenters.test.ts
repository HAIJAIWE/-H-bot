// tests/renderer/lib/toolPresenters.test.ts
import { describe, it, expect } from 'vitest';
import {
  getToolPresenter,
  registerToolPresenter,
  toolResultText,
} from '@renderer/lib/ai/toolPresenters';

describe('★ 工具呈现器注册表', () => {
  it('★ 内置 diff/files 已注册（write_file 的 resultKind 靠它渲染）', () => {
    expect(typeof getToolPresenter('diff')).toBe('function');
    expect(typeof getToolPresenter('files')).toBe('function');
  });

  it('注册后可按名取到；dispose 后取不到；未注册返回 undefined', () => {
    const dispose = registerToolPresenter('test.presenter', () => null);
    expect(getToolPresenter('test.presenter')).toBeTypeOf('function');
    dispose();
    expect(getToolPresenter('test.presenter')).toBeUndefined();
  });

  it('重名直接抛（两个工具抢一个名字比显示错了更难查）', () => {
    const dispose = registerToolPresenter('dup.presenter', () => null);
    expect(() => registerToolPresenter('dup.presenter', () => null)).toThrow(/already registered/);
    dispose();
  });

  it('toolResultText：字符串原样，对象 JSON 展开，不可序列化不抛', () => {
    expect(toolResultText('abc')).toBe('abc');
    expect(toolResultText({ a: 1 })).toBe('{\n  "a": 1\n}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toolResultText(circular)).toBe('');
  });
});
