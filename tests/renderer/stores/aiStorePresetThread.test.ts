// tests/renderer/stores/aiStorePresetThread.test.ts
//
// 预设是**线程级**选择：切线程恢复各自的选择，不互相覆盖。
import { describe, it, expect, beforeEach } from 'vitest';
import { useAiStore } from '@renderer/stores/aiStore';

beforeEach(() => {
  useAiStore.setState({ activeThreadId: 'default', preset: null, presetByThread: {} });
});

describe('★ 会话预设按线程绑定', () => {
  it('★ A 选预设 → 切到 B（不限制）→ 切回 A 仍是原预设', () => {
    useAiStore.getState().setActiveThread('thread-a');
    useAiStore.getState().setPreset('只读巡检');
    expect(useAiStore.getState().preset).toBe('只读巡检');

    useAiStore.getState().setActiveThread('thread-b');
    expect(useAiStore.getState().preset, 'B 线程不该继承 A 的预设').toBeNull();

    useAiStore.getState().setPreset('全权调试');
    useAiStore.getState().setActiveThread('thread-a');
    expect(useAiStore.getState().preset).toBe('只读巡检');
    useAiStore.getState().setActiveThread('thread-b');
    expect(useAiStore.getState().preset).toBe('全权调试');
  });

  it('选「不限制」也会记住（null 是一个真实选择，不是"没选过"）', () => {
    useAiStore.getState().setActiveThread('t');
    useAiStore.getState().setPreset('只读巡检');
    useAiStore.getState().setPreset(null);
    useAiStore.getState().setActiveThread('other');
    useAiStore.getState().setActiveThread('t');
    expect(useAiStore.getState().preset).toBeNull();
    // 存储键是 `conversationPath + '::' + threadId`（conversationPath 初始为 ''）。
    // 不能直接按线程名取；null 是一份**真实记录**，不能被"没选过"混淆。
    expect(Object.values(useAiStore.getState().presetByThread)).toContain(null);
  });
});
