// tests/main/services/agent-core/uiTrace.test.ts
//
// 把一次运行的产物折成"能落进历史 JSONL 的三样东西"（2026-10-25）。
// 这里的错误判定沿用循环的口径：工具失败是**返回值**（"[工具失败] …"），不是抛异常。
import { describe, it, expect } from 'vitest'
import { assistantHistoryEntry } from '@main/services/agent-core/uiTrace'

describe('assistantHistoryEntry：答案 + 界面回看的痕迹', () => {
  it('工具失败按前缀记成 error，成功的记 done', () => {
    const entry = assistantHistoryEntry({
      content: '做完了',
      reasoning: '想了想',
      toolResults: [
        { name: 'read_file', args: { path: 'a.ts' }, output: 'export const a = 1' },
        { name: 'run_command', args: { command: 'ls' }, output: '[工具失败] 命令不在白名单: ls' },
      ],
      startedAt: Date.now() - 1500,
    })
    expect(entry.role).toBe('assistant')
    expect(entry.content).toBe('做完了')
    expect(entry.reasoning).toBe('想了想')
    expect(entry.trace?.map(t => t.status)).toEqual(['done', 'error'])
    expect(entry.turnMs).toBeGreaterThanOrEqual(1500)
  })

  it('没思考、没工具 → 不留那两个字段（空数组会让读侧长出一条空过程行）', () => {
    const entry = assistantHistoryEntry({
      content: '嗯',
      reasoning: '   ',
      toolResults: [],
      startedAt: Date.now(),
    })
    expect('reasoning' in entry).toBe(false)
    expect('trace' in entry).toBe(false)
  })
})
