// tests/renderer/stores/aiStoreCompactNotice.test.ts
//
// # 循环内压缩 → 界面留一条提示（2026-10-25）
//
// 主进程压缩完会发 `ai:compact`（dropped / tokensBefore / tokensAfter）。
// 渲染层要做三件小事：把数字变成人话、挂成一条 `system` 消息、**不碰会话状态**
// （不能顺手把 streaming 之类的字段改了 —— 那是收尾路径的活）。
//
// 顺带钉住"别的项目在压"的路由：写进它的存档，不污染当前对话。
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

const noopUnsub = () => () => {};
let compactCb: ((d: {
  projectPath?: string;
  dropped: number;
  tokensBefore: number;
  tokensAfter: number;
}) => void) | null = null;

function installBridge(): void {
  (globalThis as unknown as { window: { qqbat: unknown } }).window.qqbat = {
    ai: {
      chat: vi.fn(async () => ({ ok: true, data: {} })),
      cancelChat: vi.fn(async () => ({ ok: true, data: { cancelled: true } })),
      onToolCall: () => noopUnsub(),
      onChunk: () => noopUnsub(),
      onResponse: () => noopUnsub(),
      onProposal: () => noopUnsub(),
      onAgentState: () => noopUnsub(),
      onCompact: (cb: (d: never) => void) => {
        compactCb = cb as never;
        return noopUnsub();
      },
      onClientInstruction: () => noopUnsub(),
      onNeedRollback: () => noopUnsub(),
    },
  };
}

beforeEach(() => {
  compactCb = null;
  installBridge();
  useAiStore.setState({
    ...emptyConversation(),
    conversations: {},
    conversationPath: '',
  });
  useAiStore.getState().init();
});

describe('循环内压缩的界面提示', () => {
  it('★ 挂成一条 system 消息，带 notice:compaction 与两个 token 估算', () => {
    useAiStore.getState().switchConversation('/p/当前');
    expect(compactCb, 'ai:compact 必须有人在听').toBeTruthy();

    compactCb!({ projectPath: '/p/当前', dropped: 7, tokensBefore: 91234, tokensAfter: 12045 });

    const s = useAiStore.getState();
    expect(s.messages).toHaveLength(1);
    const msg = s.messages[0];
    expect(msg.role).toBe('system');
    // 渲染层靠 notice 决定画成"分隔线"而不是琥珀色警告横幅
    expect(msg.notice).toBe('compaction');
    // 数字要进文案（不必钉死整句 —— 文案会改，数字不会）
    expect(msg.content).toContain('7');
    expect(msg.content).toContain('91k');
    expect(msg.content).toContain('12k');
  });

  it('不碰会话状态：不把界面从"没收尾"改成"已收尾"', () => {
    useAiStore.getState().switchConversation('/p/当前');
    useAiStore.setState({ streaming: true, currentChunk: '正在写' });

    compactCb!({ projectPath: '/p/当前', dropped: 2, tokensBefore: 900, tokensAfter: 300 });

    const s = useAiStore.getState();
    expect(s.streaming, '压缩发生在循环中间，流式状态与它无关').toBe(true);
    expect(s.currentChunk).toBe('正在写');
    expect(s.messages).toHaveLength(1);
  });

  it('别的项目在压缩 → 写它的存档，不污染当前对话', () => {
    useAiStore.getState().switchConversation('/p/当前');
    useAiStore.getState().addMessage({ role: 'user', content: '我这句还在' });

    compactCb!({ projectPath: '/p/别的', dropped: 3, tokensBefore: 5000, tokensAfter: 800 });

    const s = useAiStore.getState();
    expect(s.messages.map((m) => m.content)).toEqual(['我这句还在']);
    const other = s.conversations['/p/别的'];
    expect(other, '别的项目的存档应当被建出来').toBeTruthy();
    expect(other.messages).toHaveLength(1);
    expect(other.messages[0].notice).toBe('compaction');
  });
});
