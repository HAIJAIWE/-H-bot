// tests/renderer/lib/turnGrouping.test.ts
//
// 「按轮折叠」的数据部分：切轮边界、计数、摘要截断。
// 这些错了不会崩，只会让折叠行说假话（"1 条回复"其实两条）—— 所以要钉住。
import { describe, it, expect } from 'vitest';
import { groupIntoTurns, turnPreview } from '@renderer/lib/ai/turnGrouping';

const u = (content = '问') => ({ role: 'user', content });
const a = (trace: unknown[] = [], content = '答') => ({ role: 'assistant', content, trace });
const s = (content = '系统') => ({ role: 'system', content });

describe('★ 切轮', () => {
  it('每条用户消息开一轮，之后的消息都归它', () => {
    const turns = groupIntoTurns([u('一'), a(), u('二'), a(), a()]);
    expect(turns.map((t) => [t.start, t.end])).toEqual([
      [0, 2],
      [2, 5],
    ]);
    expect(turns.map((t) => t.userIndex)).toEqual([0, 2]);
  });

  it('开场没有用户消息（比如先报错）也单独成一轮', () => {
    const turns = groupIntoTurns([s(), a(), u('一')]);
    expect(turns).toHaveLength(2);
    expect(turns[0].userIndex).toBeNull();
    expect(turns[1].userIndex).toBe(2);
  });

  it('计数：回复条数 + 工具条数（工具在 trace 里）', () => {
    const turns = groupIntoTurns([u(), a([{}, {}]), a([]), u('二'), a([{}])]);
    expect(turns[0].replies).toBe(2);
    expect(turns[0].tools).toBe(2);
    expect(turns[1].replies).toBe(1);
    expect(turns[1].tools).toBe(1);
  });

  it('系统消息不计数（它不是"回复"）', () => {
    const turns = groupIntoTurns([u(), s(), a()]);
    expect(turns[0].replies).toBe(1);
    expect(turns[0].end).toBe(3);
  });

  it('空数组 = 没有轮（不造一个空轮）', () => {
    expect(groupIntoTurns([])).toEqual([]);
  });
});

describe('★ 折叠行的摘要', () => {
  it('只取第一行（用户常贴一大段代码/日志）', () => {
    expect(turnPreview('第一行\n第二行\n第三行')).toBe('第一行');
  });

  it('超长截断并补省略号', () => {
    const long = 'a'.repeat(60);
    expect(turnPreview(long, 10)).toBe('a'.repeat(10) + '…');
  });

  it('空白消息返回空串（折叠行不该显示"undefined"）', () => {
    expect(turnPreview('   \n  ')).toBe('');
  });
});
