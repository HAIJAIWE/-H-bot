// tests/main/services/ai/codeSnippet.test.ts
//
// # 代码片段沙箱（CodeAct 闭环的地基）
//
// 三条纪律：能跑通、能在报错时给出可改的原文、**逃逸与死循环要被挡住**。
import { describe, it, expect } from 'vitest';
import { runCodeSnippet, SNIPPET_MAX_TIMEOUT_MS } from '@main/services/ai/codeSnippet';

describe('★ 代码片段沙箱', () => {
  it('能拿到 args、console.log 与返回值', () => {
    const r = runCodeSnippet({ code: 'console.log("hi", args.x); return args.x * 2;', args: { x: 21 } });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('hi 21');
    expect(r.output).toContain('=> 42');
  });

  it('★ 抛错 ⇒ ok=false，错误原文带类型（模型才能据此改）', () => {
    const r = runCodeSnippet({ code: 'throw new TypeError("单位错了")' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('TypeError');
    expect(r.error).toContain('单位错了');
  });

  it('★ 死循环被超时挡住（不会卡住主进程）', () => {
    const r = runCodeSnippet({ code: 'while (true) {}', timeoutMs: 150 });
    expect(r.ok).toBe(false);
    expect(r.ms).toBeLessThan(SNIPPET_MAX_TIMEOUT_MS);
  });

  it('★ 逃逸被封死：拿不到 process / require / eval / Function', () => {
    expect(runCodeSnippet({ code: 'return typeof process' }).output).toContain('undefined');
    expect(runCodeSnippet({ code: 'return typeof require' }).output).toContain('undefined');
    expect(runCodeSnippet({ code: 'return typeof globalThis.process' }).output).toContain('undefined');
    const fnEscape = runCodeSnippet({ code: 'return typeof (() => {}).constructor' });
    expect(fnEscape.ok).toBe(true);
    const evalEscape = runCodeSnippet({ code: 'return eval("1")' });
    expect(evalEscape.ok).toBe(false);
  });

  it('空代码直接拒绝（不浪费一次执行）', () => {
    const r = runCodeSnippet({ code: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('空');
  });
});
