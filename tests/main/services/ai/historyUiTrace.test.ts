// tests/main/services/ai/historyUiTrace.test.ts
//
// **界面回看用的过程痕迹**（2026-10-25）：思考 / 工具行 / 耗时落进历史 JSONL。
//
// 为什么单独一条：这三样只给界面，**模型历史读侧不收**。混进去等于把"日志当记忆"——
// 模型下一轮会看到上一轮的工具回执，还会被几千字的思考占掉预算。
// 所以这里钉住三件事：
//   1. 写进去能读回来（includeUi:true）；
//   2. 默认读（模型侧）**看不到**它们；
//   3. 三条上界都生效（条数 12 / 结果 600 字 / 思考 2000 字）—— 记忆文件不是日志仓库。
import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendHistoryEntries,
  historyToMessages,
  loadHistory,
  readHistoryForUi,
} from '@main/services/ai/historyStore'

type UiEntry = {
  ts: string
  role: string
  content: string
  reasoning?: string
  turnMs?: number
  trace?: Array<{ name: string; args: Record<string, unknown>; status: string; result?: string }>
}

/** historyStore 是 @ts-nocheck 的编译产物：读侧字段只能在这里声明（生产侧由它的注释约束） */
async function readUi(ws: string): Promise<UiEntry[]> {
  return (await loadHistory(ws, undefined, { includeUi: true })) as unknown as UiEntry[]
}

function toolRow(name: string, padding = 0) {
  return {
    name,
    args: { path: '.' },
    status: 'done' as const,
    result: 'x'.repeat(padding),
  }
}

describe('★ 过程痕迹：写进去、只在界面侧读回来', () => {
  it('思考 / 工具行 / 耗时能原样读回（includeUi），模型历史里没有', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-uitrace-'))
    await appendHistoryEntries(ws, [
      { ts: new Date().toISOString(), role: 'user', content: '看一眼' },
      {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: '看完了',
        reasoning: '先 list_dir',
        trace: [toolRow('list_dir')],
        turnMs: 4200,
      },
    ])

    const ui = await readUi(ws)
    const answer = ui.at(-1)!
    expect(answer.content).toBe('看完了')
    expect(answer.reasoning).toBe('先 list_dir')
    expect(answer.turnMs).toBe(4200)
    expect(answer.trace).toEqual([
      { name: 'list_dir', args: { path: '.' }, status: 'done', result: '' },
    ])

    // 模型侧：只有 role/content（痕迹进了上下文就是"日志当记忆"）
    const model = (await loadHistory(ws)) as unknown as UiEntry[]
    expect(model.at(-1)!.reasoning).toBeUndefined()
    expect(model.at(-1)!.trace).toBeUndefined()
    expect(model.at(-1)!.turnMs).toBeUndefined()
    expect(historyToMessages(model).messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '看完了',
    })
  })

  it('readHistoryForUi 就是 includeUi 那条路', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-uitrace-'))
    await appendHistoryEntries(ws, [
      {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: '好',
        reasoning: '想了',
        turnMs: 1200,
      },
    ])
    const ui = (await readHistoryForUi(ws, undefined as unknown as string)) as unknown as UiEntry[]
    expect(ui.at(-1)).toMatchObject({ reasoning: '想了', turnMs: 1200 })
  })

  it('★ 三条上界：工具行 12 条、结果 600 字、思考 2000 字', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-uitrace-'))
    await appendHistoryEntries(ws, [
      {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: '收',
        reasoning: 'r'.repeat(3000),
        trace: Array.from({ length: 20 }, (_, i) => toolRow('t' + i, 1000)),
        turnMs: 999,
      },
    ])
    const ui = (await readUi(ws)).at(-1)!
    expect(ui.reasoning).toHaveLength(2000)
    expect(ui.trace).toHaveLength(12)
    expect(ui.trace![0].result).toHaveLength(600)
  })

  it('空思考 / 空痕迹不写字段（读侧别把空串当"有内容"）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-uitrace-'))
    await appendHistoryEntries(ws, [
      {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: '就这样',
        reasoning: '   ',
        trace: [],
        turnMs: 0,
      },
    ])
    const ui = (await readUi(ws)).at(-1)!
    expect(ui.reasoning).toBeUndefined()
    expect(ui.trace).toBeUndefined()
    expect(ui.turnMs).toBeUndefined()
  })
})
