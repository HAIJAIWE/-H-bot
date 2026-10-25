// src/shared/ai/streamAssembler.ts
//
// # 一条流的组装算法（三家 provider 共用）
//
// 在这之前，GLM / OpenAI 兼容 / Ollama 三份 `chat()` 各自手写了同一件事：
// 按行切 SSE、拼正文、按 index 攒 tool_calls、最后一次性回调。三份实现，
// 三份"忽略坏帧"的细节，而且**都不知道自己被截断了** —— `finish_reason === 'length'`
// 时那半个工具调用照样被当成可执行的调用交出去。
//
// 组装算法本身不自己发明：搬 DSH 的 `BlockAssembler`（见 `../vendor/dsh/llm-assembler/`）。
// 这个文件只做**协议翻译**：把厂商帧翻成上游的 chunk，再按上游的规则取出块。
//
// 边界：
//   · 不认厂商字段以外的语义（谁家叫 `reasoning_content`、谁家叫 `thinking` 在下面的
//     `deltaOf` 里翻译，别的地方不许再分叉）；
//   · 不做重试、不碰网络请求（那是 `llmRetry` / provider 自己的事）。

import { BlockAssembler } from '../vendor/dsh/llm-assembler/assembler'
import type { FinishReason, StreamChunk } from '../vendor/dsh/llm-assembler/types'
import type { LlmUsage } from '../types/ai'

/** 流的两种帧格式：OpenAI 系 SSE（`data: {...}`）与 Ollama 的 NDJSON（一行一个对象） */
export type StreamProtocol = 'openai' | 'ollama'

/**
 * 一个块的稳定 index。
 *
 * 上游用 index 关联交错的 delta；我们**不需要**交错（同一时刻只会吐一种），
 * 但要保证「正文 / 思考 / 每个工具调用」各自落进不同的块：
 * 正文与思考各占一个固定 index，工具调用从 2 起按厂商给的 `tc.index` 排。
 * （不用 0/1 给工具调用，否则正文流到一半来了工具调用会串块。）
 */
const TEXT_INDEX = 0
const REASONING_INDEX = 1
const TOOL_INDEX_BASE = 2

export interface AssembleCallbacks {
  onChunk: (chunk: { type: 'text' | 'reasoning'; content: string }) => void
  onComplete: (text: string) => void
  /** provider 回调的是**原始 OpenAI 形状**（见 toolMessages.normalizeToolCalls 的说明） */
  onToolCalls?: (calls: unknown[]) => void | Promise<void>
  onUsage?: (usage: LlmUsage) => void
}

export interface AssembleOptions {
  callbacks: AssembleCallbacks
  /**
   * 用量归一。**不搬进这里**：各家字段名不同（`prompt_tokens` / `prompt_cache_hit_tokens` /
   * `cached_tokens`），归一函数本来就在 provider 层，注入进来即可，别在组装器里再写一份。
   */
  mapUsage?: (raw: unknown) => LlmUsage | undefined
}

export interface AssembledStream {
  /** 正文（不含思考） */
  text: string
  /** 思考过程；厂商没回就是空串 */
  reasoning: string
  /** 交出去的原始调用（与旧实现同形状：`{index,id,type,function:{name,arguments}}`） */
  toolCalls: unknown[]
  /** 被截断丢弃的工具调用数（`finish_reason === 'length'` 时 > 0，调用方可以据此提示） */
  droppedToolCalls: number
  finish: FinishReason
}

/**
 * 读完一整条流，边读边回调，返回组装后的结果。
 *
 * 坏帧（`JSON.parse` 失败）**跳过**：一条流里出现半截 JSON 不该让整轮对话失败，
 * 这与三份旧实现的行为一致。真正的失败（HTTP 非 2xx、读到超时）在更外层抛出。
 */
export async function assembleStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  protocol: StreamProtocol,
  options: AssembleOptions,
): Promise<AssembledStream> {
  const { callbacks, mapUsage } = options
  const assembler = new BlockAssembler()
  const decoder = new TextDecoder()
  const toolIndexes = new Set<number>()
  /** 厂商不给 `tc.index` 时按"新调用出现顺序"分配（见下方注释） */
  let anonymousToolCall = -1
  let anonymousToolCalls = 0
  let buffer = ''
  let sawFinish = false

  const push = (chunk: StreamChunk): void => {
    if (chunk.type === 'finish') sawFinish = true
    assembler.push(chunk)
  }

  const feed = (payload: string): void => {
    if (protocol === 'openai') {
      if (payload === '[DONE]') return
      let parsed: any
      try {
        parsed = JSON.parse(payload)
      } catch {
        return
      }
      const usage = mapUsage?.(parsed.usage ?? parsed)
      if (usage) {
        push({ type: 'usage', usage: {} })
        callbacks.onUsage?.(usage)
      }
      const choice = parsed.choices?.[0]
      const delta = choice?.delta
      const reasoning = deltaOf(delta, 'reasoning')
      if (reasoning) {
        push({ type: 'reasoning-delta', index: REASONING_INDEX, text: reasoning })
        callbacks.onChunk({ type: 'reasoning', content: reasoning })
      }
      const content = deltaOf(delta, 'text')
      if (content) {
        push({ type: 'text-delta', index: TEXT_INDEX, text: content })
        callbacks.onChunk({ type: 'text', content })
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const call of delta.tool_calls) {
          // 厂商给了 index 就用它；没给时**不能**用本帧的数组下标顶替 —— 每个分片都是从 0 开始，
          // 两个调用分两帧到达时都会被算成同一个块（旧实现用"已见调用数"兜住了，这里照旧）。
          // 判据：带 id 或 name 的帧是**新调用**，只有 arguments 的帧是上一个调用的续片。
          let index: number
          if (typeof call?.index === 'number') {
            index = TOOL_INDEX_BASE + call.index
            anonymousToolCall = index
          } else if (call?.id || call?.function?.name || anonymousToolCall < 0) {
            index = TOOL_INDEX_BASE + anonymousToolCalls++
            anonymousToolCall = index
          } else {
            index = anonymousToolCall
          }
          toolIndexes.add(index)
          push({
            type: 'tool-call-delta',
            index,
            id: typeof call?.id === 'string' ? call.id : '',
            ...(typeof call?.function?.name === 'string' && call.function.name
              ? { name: call.function.name }
              : {}),
            argumentsDelta:
              typeof call?.function?.arguments === 'string' ? call.function.arguments : '',
          })
        }
      }
      if (choice?.finish_reason) push({ type: 'finish', reason: finishOf(choice.finish_reason) })
      return
    }
    // ollama：一行一个 JSON，没有 `data: ` 前缀，也没有 `[DONE]`
    let parsed: any
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    const usage = mapUsage?.(parsed.usage ?? parsed)
    if (usage) {
      push({ type: 'usage', usage: {} })
      callbacks.onUsage?.(usage)
    }
    const content = parsed.message?.content ?? parsed.response
    if (typeof content === 'string' && content) {
      push({ type: 'text-delta', index: TEXT_INDEX, text: content })
      callbacks.onChunk({ type: 'text', content })
    }
    const thinking = parsed.message?.thinking ?? parsed.thinking
    if (typeof thinking === 'string' && thinking) {
      push({ type: 'reasoning-delta', index: REASONING_INDEX, text: thinking })
      callbacks.onChunk({ type: 'reasoning', content: thinking })
    }
    if (parsed.done === true) push({ type: 'finish', reason: { kind: 'stop' } })
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (protocol === 'openai') {
        if (!trimmed.startsWith('data:')) continue
        feed(trimmed.slice(5).trim())
      } else {
        feed(trimmed)
      }
    }
  }
  // 尾巴里可能还剩最后一帧（服务端最后一帧没有换行）
  const tail = buffer.trim()
  if (tail) {
    if (protocol === 'openai' && tail.startsWith('data:')) feed(tail.slice(5).trim())
    else if (protocol === 'ollama') feed(tail)
  }
  // 流里没给结束原因：按正常结束算（上游同样的默认）
  if (!sawFinish) push({ type: 'finish', reason: { kind: 'stop' } })

  const blocks = assembler.blocks()
  let text = ''
  let reasoning = ''
  const toolCalls: unknown[] = []
  let dropped = 0
  for (const block of blocks) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'reasoning') reasoning += block.text
  }
  // 被 max-tokens 丢掉的调用不在 blocks 里（组装器已过滤），数额单独算给调用方看
  dropped = assembler.finish.kind === 'max-tokens' ? toolIndexes.size : 0
  for (const block of blocks) {
    if (block.type !== 'tool-call') continue
    toolCalls.push({
      index: toolCalls.length,
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    })
  }
  if (toolCalls.length > 0) await callbacks.onToolCalls?.(toolCalls)
  callbacks.onComplete(text)
  return {
    text,
    reasoning,
    toolCalls,
    droppedToolCalls: dropped,
    finish: assembler.finish,
  }
}

/** 各家推理字段名不同（DeepSeek：`reasoning_content`；GLM/OpenAI 系：`reasoning`）—— 只在这里分叉 */
function deltaOf(delta: any, kind: 'text' | 'reasoning'): string {
  if (!delta) return ''
  if (kind === 'text') return typeof delta.content === 'string' ? delta.content : ''
  const raw = delta.reasoning_content ?? delta.reasoning
  return typeof raw === 'string' ? raw : ''
}

/** 厂商的 `finish_reason` → 上游的结束原因（只认影响组装的那一种：截断） */
function finishOf(reason: unknown): FinishReason {
  if (reason === 'length') return { kind: 'max-tokens' }
  if (reason === 'tool_calls' || reason === 'function_call') return { kind: 'tool-calls' }
  return { kind: 'stop' }
}
