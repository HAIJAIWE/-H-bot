// tests/main/services/ai/contextCompaction.test.ts
//
// # 上下文压缩（P2-5）
//
// 以前撞 80k 预算只有一条路：提前收尾。对"一条消息就是一个大任务"是硬失败。
// 本文件钉住结构性压缩的三条纪律：
//   ① system / 原始需求 / 最近现场必须留；② 中间压成索引；③ 没收益就不压。
// 刻意**不用 LLM 摘要**：摘要会失真，而失真的地方正是"模型以为自己做过什么"。
import { describe, it, expect } from 'vitest';
import { compactMessages } from '@main/services/ai/tokenBudget';

type M = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };
const msg = (role: M['role'], content: string): M => ({ role, content });

describe('★ 上下文压缩：撞预算前先压，而不是直接收尾', () => {
  it('★ 保留 system + 原始需求 + 最近若干条；中间压成要点索引', () => {
    const messages: M[] = [
      msg('system', 'S'.repeat(3000)),
      msg('user', '给 /打怪 加一个查看背包的按钮'),
      ...Array.from({ length: 16 }, (_, i) => msg(i % 2 ? 'assistant' : 'tool', 'X'.repeat(2000))),
    ];
    const out = compactMessages(messages as never);

    expect(out.compacted).toBe(true);
    expect(out.messages[0].content, 'system 一个字都不许动').toHaveLength(3000);
    expect(String(out.messages[1].content)).toContain('打怪');
    const joined = out.messages.map((m: { content: unknown }) => String(m.content)).join('\n');
    expect(joined).toContain('【早期对话已压缩】');
    expect(
      out.messages.slice(-2).every((m: { content: unknown }) => String(m.content).includes('X')),
      '最近的现场必须留着',
    ).toBe(true);

    const before = messages.reduce((n: number, m) => n + m.content.length, 0);
    const after = out.messages.reduce((n: number, m: { content?: unknown }) => n + String(m.content ?? '').length, 0);
    expect(after).toBeLessThan(before);
  });

  it('短对话不压（没有收益就别动）', () => {
    const out = compactMessages(
      [msg('system', 's'), msg('user', 'u'), msg('assistant', 'a')] as never,
    );
    expect(out.compacted).toBe(false);
    expect(out.messages).toHaveLength(3);
  });

  it('★ 尾部单条过长 ⇒ 截断并指向溢出文件（一条工具结果不能独占预算）', () => {
    const messages: M[] = [
      msg('system', 's'),
      msg('user', '需求'),
      ...Array.from({ length: 10 }, () => msg('assistant', 'y'.repeat(500))),
      msg('tool', 'Z'.repeat(9000)),
    ];
    const out = compactMessages(messages as never, { keepTail: 2, maxTailChars: 500 });
    expect(out.compacted).toBe(true);
    const last = String(out.messages[out.messages.length - 1].content);
    expect(last.length).toBeLessThan(9000);
    expect(last).toContain('ai-spill');
  });
});
