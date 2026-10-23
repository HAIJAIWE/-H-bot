// tests/renderer/lib/aiSlots.test.ts
//
// 界面插槽的注册表：能注册、能排序、重名直接拒 —— 内容由贡献方给，ChatPanel 只留位置。
import { describe, it, expect } from 'vitest';
import { listAiSlot, registerAiSlot } from '@renderer/lib/ai/uiSlots';

describe('★ 界面插槽（插件内容的位置）', () => {
  it('★ 注册即出现在对应插槽，order 决定顺序', () => {
    registerAiSlot({ id: 'test.b', slot: 'composer.toolbar', order: 20, render: () => null });
    registerAiSlot({ id: 'test.a', slot: 'composer.toolbar', order: 10, render: () => null });
    expect(listAiSlot('composer.toolbar').map((e) => e.id)).toEqual(['test.a', 'test.b']);
  });

  it('不同插槽互不串台', () => {
    expect(listAiSlot('panel.aside').some((e) => e.id === 'test.a')).toBe(false);
  });

  it('重名 / 空 id → 注册时直接拒', () => {
    expect(() =>
      registerAiSlot({ id: 'test.a', slot: 'composer.toolbar', render: () => null }),
    ).toThrow(/already registered/);
    expect(() => registerAiSlot({ id: ' ', slot: 'panel.aside', render: () => null })).toThrow(/id/);
  });
});
