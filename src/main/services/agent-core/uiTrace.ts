// 界面回看用的过程痕迹：把一次运行的产物折成能落进历史 JSONL 的三样东西。
//
// 为什么单独一个文件：aiAgentCore.ts 贴着 800 行闸门，接线处只该看见一行调用。
// 这三样（思考 / 工具行 / 耗时）**只给界面**：historyStore 的读侧默认不取，模型上下文里没有。

import type { RunTurnResult } from './runTurn'

/** 历史 JSONL 里一条工具行（形状与渲染层的 ToolCallRecord 对齐） */
export interface UiTraceEntry {
  name: string
  args: Record<string, unknown>
  status: 'done' | 'error'
  result: string
}

/** 历史 JSONL 里一条 assistant 记录（role/content 之外的字段全部可选） */
export interface AssistantHistoryEntry {
  /** 稳定 id（第 58 批，消息反作用在它上面）；由调用方生成，append 原样落盘 */
  id?: string
  ts: string
  role: 'assistant'
  content: string
  reasoning?: string
  trace?: UiTraceEntry[]
  turnMs: number
}

/** 工具失败在循环里是**返回值**（"[工具失败] …"）而不是抛异常，只能按前缀判 */
function traceOfToolResults(rows: RunTurnResult['toolResults']): UiTraceEntry[] {
  return rows.map(t => ({
    name: t.name,
    args: t.args,
    status: t.output.startsWith('[工具失败]') ? 'error' : 'done',
    result: t.output,
  }))
}

/** 一轮的答案 + 痕迹。空思考不给字段（写进 JSONL 的空串会让读侧以为有内容） */
export function assistantHistoryEntry(input: {
  /** 稳定 id：收尾时会随 `ai:response` 发给渲染层，界面靠它把反馈挂到这条回答上 */
  id: string
  content: string
  reasoning: string
  toolResults: RunTurnResult['toolResults']
  startedAt: number
}): AssistantHistoryEntry {
  return {
    id: input.id,
    ts: new Date().toISOString(),
    role: 'assistant',
    content: input.content,
    ...(input.reasoning.trim() ? { reasoning: input.reasoning } : {}),
    ...(input.toolResults.length > 0 ? { trace: traceOfToolResults(input.toolResults) } : {}),
    turnMs: Date.now() - input.startedAt,
  }
}
