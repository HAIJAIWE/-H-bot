/**
 * 流式 chunk / 组装后内容块的类型（纯类型，无运行时）。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 * @upstream packages/llm/llm/src/types.ts
 * @upstream https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：只取组装器真正用到的四种块（text / reasoning / tool-call）与三种结束原因
 * （stop / tool-calls / max-tokens），去掉 image / file / tool-addition / tool-removal、
 * abort/error 的 `LlmFailure` 载荷，以及上游的内存式 `ReplayEnvelope`（我们没有 chunk 回放）。
 */

/** 给用户看的正文 */
export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** 思考过程：与正文分开存，界面折叠显示、不回灌给模型 */
export interface ReasoningBlock {
  readonly type: 'reasoning'
  readonly text: string
}

/** 模型要求的一次工具调用；`arguments` 是**没解析的 JSON 字符串**（上游原样保留） */
export interface ToolCallBlock {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly arguments: string
}

export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock
export type ContentBlockType = ContentBlock['type']

/**
 * 结束原因。
 *
 * 只留三种：它们全都影响**组装结果本身**（`max-tokens` 要丢掉被截断的工具调用），
 * 上游的 `aborted`/`error` 由调用方的取消与异常路径处理，不进组装状态。
 */
export interface FinishReasonMap {
  stop: { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
}

export type FinishReason = FinishReasonMap[keyof FinishReasonMap]

/**
 * 一次调用的用量（与上游同口径：缓存命中单独计，不混进 `inputTokens`）。
 * 我们不消费这几个字段，只是原样转交给调用方，所以全部可选。
 */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** 组装器的输入：流里的一个原始 chunk */
export type StreamChunk =
  | { readonly type: 'block-start'; readonly index: number; readonly blockType: ContentBlockType }
  | { readonly type: 'text-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'reasoning-delta'; readonly index: number; readonly text: string }
  | {
      readonly type: 'tool-call-delta'
      readonly index: number
      readonly id: string
      readonly name?: string
      readonly argumentsDelta: string
    }
  | { readonly type: 'block-end'; readonly index: number; readonly block: ContentBlock }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'finish'; readonly reason: FinishReason }
