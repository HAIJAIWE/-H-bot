// tests/renderer/stores/aiStoreConversations.test.ts
//
// # 一个面板、多个项目的对话
//
// 渲染层只渲染"当前项目"的视图（组件一行不用改），但每个项目各有一份存档
// `conversations[项目]`：切换项目 = 存回旧的 + 装载新的。
// 不变式：**扁平字段 ≡ conversations[conversationPath]**。
//
// 2026-10-23 恢复说明：原文件在 vi.mock('@renderer/stores/projectStore') 的
// 工厂体中间被裁掉（只剩 onAgentState 尾巴），磁带里没有完整快照；
// 下面按 `aiStore.ts:713-734 routeTo` / `:798-812 switchConversation` 的现状重写。
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@renderer/stores/flowStore', () => ({
  useFlowStore: { getState: () => ({ snapshot: () => null, rollback: vi.fn() }) },
}));

vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ currentProject: { path: '/p/当前' } }),
    subscribe: () => () => {},
  },
}));

import { useAiStore, emptyConversation } from '@renderer/stores/aiStore';

const listeners: Record<string, (data: never) => void> = {};
const noopUnsub = () => () => {};

function installBridge(): void {
  (globalThis as unknown as { window: { qqbat: unknown } }).window.qqbat = {
    ai: {
      chat: vi.fn(async () => ({ ok: true, data: {} })),
      cancelChat: vi.fn(async () => ({ ok: true, data: { cancelled: true } })),
      onToolCall: () => noopUnsub(),
      onChunk: () => noopUnsub(),
      onResponse: () => noopUnsub(),
      onProposal: () => noopUnsub(),
      onAgentState: (cb: (d: never) => void) => {
        listeners.agentState = cb;
        return noopUnsub();
      },
      onClientInstruction: () => noopUnsub(),
      onNeedRollback: () => noopUnsub(),
    },
  };
}

beforeEach(() => {
  installBridge();
  for (const k of Object.keys(listeners)) delete listeners[k];
  useAiStore.setState({
    ...emptyConversation(),
    conversations: {},
    conversationPath: '',
  });
  // 监听器要真的注册上 —— 本文件一半的用例测的是"事件怎么路由"
  useAiStore.getState().init();
});

describe('切换项目 = 切换对话记录', () => {
  it('★ 两个项目的对话互不覆盖，切回去还在', () => {
    const s = () => useAiStore.getState();

    s().switchConversation('/p/A');
    s().addMessage({ role: 'user', content: 'A 的问题' });
    expect(s().messages).toHaveLength(1);

    s().switchConversation('/p/B');
    expect(s().messages, 'B 应当从空白开始').toEqual([]);
    expect(s().conversationPath).toBe('/p/B');
    s().addMessage({ role: 'user', content: 'B 的问题' });

    s().switchConversation('/p/A');
    expect(
      s().messages.map((m) => m.content),
      '切回 A 必须拿回 A 自己的记录',
    ).toEqual(['A 的问题']);

    s().switchConversation('/p/B');
    expect(s().messages.map((m) => m.content)).toEqual(['B 的问题']);
  });

  it('切到同一个项目是 no-op（不会把自己刚存的东西又清掉）', () => {
    const s = () => useAiStore.getState();
    s().switchConversation('/p/A');
    s().addMessage({ role: 'user', content: 'A 的问题' });
    s().switchConversation('/p/A');
    expect(s().messages.map((m) => m.content)).toEqual(['A 的问题']);
  });

  it('空路径不绑定（面板还没挂载时 projectStore 可能先给空串）', () => {
    useAiStore.getState().switchConversation('');
    expect(useAiStore.getState().conversationPath).toBe('');
  });

  it('存档里已有的项目：切过去直接装载，不重置', () => {
    useAiStore.setState({
      conversations: {
        '/p/C': { ...emptyConversation(), messages: [{ role: 'user', content: 'C 的旧记录' }] },
      },
    });
    useAiStore.getState().switchConversation('/p/C');
    expect(useAiStore.getState().messages.map((m) => m.content)).toEqual(['C 的旧记录']);
  });
});

describe('主进程事件按项目路由', () => {
  it('★ 别的项目的事件进它自己的存档，不碰当前视图', () => {
    const s = () => useAiStore.getState();
    s().switchConversation('/p/A');
    expect(s().agentState.state).toBe('idle');

    listeners.agentState({ state: 'thinking', projectPath: '/p/B' } as never);

    expect(s().agentState.state, '当前项目的视图不能被别人的状态改掉').toBe('idle');
    expect(s().conversations['/p/B']?.agentState.state).toBe('thinking');
  });

  it('当前项目的事件更新视图', () => {
    const s = () => useAiStore.getState();
    s().switchConversation('/p/A');
    listeners.agentState({ state: 'thinking', projectPath: '/p/A' } as never);
    expect(s().agentState.state).toBe('thinking');
  });

  it('还没绑定项目时，事件把视图绑到当前打开的项目（首帧）', () => {
    const s = () => useAiStore.getState();
    expect(s().conversationPath).toBe('');
    listeners.agentState({ state: 'thinking', projectPath: '/p/当前' } as never);
    expect(s().conversationPath).toBe('/p/当前');
    expect(s().agentState.state).toBe('thinking');
  });

  it('事件没带 projectPath（老主进程）→ 更新当前视图', () => {
    const s = () => useAiStore.getState();
    s().switchConversation('/p/A');
    listeners.agentState({ state: 'thinking' } as never);
    expect(s().agentState.state).toBe('thinking');
  });

  it('切到 B 之后，B 的存档里已经有 A 期间收到的那条状态', () => {
    useAiStore.getState().switchConversation('/p/A');
    listeners.agentState({ state: 'thinking', projectPath: '/p/B' } as never);
    useAiStore.getState().switchConversation('/p/B');
    expect(useAiStore.getState().agentState.state).toBe('thinking');
  });
});
