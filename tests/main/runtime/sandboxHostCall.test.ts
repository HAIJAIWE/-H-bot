// tests/main/runtime/sandboxHostCall.test.ts
//
// 隔离诊断：沙箱里到底有没有 __qqbatHostCall、它把什么送给了宿主。
import { describe, it, expect } from 'vitest';
import { runInContext } from 'node:vm';
import { createHardenedContext } from '@main/runtime/sandbox';

describe('★ 沙箱 JSON 桥（__qqbatHostCall）', () => {
  it('沙箱内可见，且把入参原样交给宿主', () => {
    const seen: string[] = [];
    const ctx = createHardenedContext((json) => {
      seen.push(json);
      return '{"ok":true}';
    });
    expect(runInContext('typeof __qqbatHostCall', ctx)).toBe('function');
    const reply = runInContext('__qqbatHostCall(JSON.stringify({ kind: "probe" }))', ctx);
    expect(reply).toBe('{"ok":true}');
    expect(seen).toEqual(['{"kind":"probe"}']);
  });
});
