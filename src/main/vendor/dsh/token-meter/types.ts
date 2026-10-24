/**
 * 上游 `estimate.ts` 用到的块形状。
 *
 * 上游从 `@deepseek-ai/dsh-llm` 与 `dsh-session` 取类型；本仓库不用 Cordis、也不做
 * Session 重放，所以这里只保留**定价真正碰到**的几个块。字段形状与上游一致，
 * 范围按本仓库需要裁剪。
 *
 * 这是**本仓库适配层**，不是上游文件（见同目录 README 的「本仓库适配层」）。
 */

export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

export interface ReasoningBlock {
  readonly type: 'reasoning'
  readonly text: string
}

export interface ToolCallBlock {
  readonly type: 'tool-call'
  readonly name: string
  /** 参数的 JSON 字符串（上游同样是字符串，不是对象） */
  readonly arguments: string
}

export interface ImageBlock {
  readonly type: 'image'
  /** 图片已被 offload 成引用时置真（上游 `estimateStructuralBlock` 会把它剔掉再算） */
  readonly offloaded?: true
}

/**
 * 合并扩展位：上游的 `ContentBlockMap` 是可扩展的，未知块走结构 JSON 兜底价。
 * 本仓库目前不产生这种块，留着只为保住上游 default 分支的语义。
 */
export interface ExtensionBlock {
  readonly type: 'extension'
  readonly [key: string]: unknown
}

export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | ImageBlock | ExtensionBlock

export interface Message {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: readonly ContentBlock[]
}
