// src/shared/types/preview.ts
//
// 本地测试（flow:preview）的请求/响应契约。main 侧实现是 runtime/previewRunner.ts
// （从 10/18 编译产物还原、@ts-nocheck），本文件按它的真实返回字段重建，
// renderer 的 LocalTestDialog 与 preload 都引用这一份，避免各自 any。
import type { FlowGraph } from './flow'
import type { FlowIssue } from '../nodes/flowNormalize'

/** 预览事件类型：前四种是消息触发，后两种是生命周期触发（走 fireLifecycle）。 */
export type PreviewTriggerType = 'command' | 'text' | 'at_me' | 'button' | 'scheduled' | 'on_ready'

/** 界面「本地测试」表单填的东西；数字统一用字符串传（表单输入天然是字符串）。 */
export interface PreviewEventInput {
  triggerType: PreviewTriggerType
  /** command 模式：指令名（不含前缀） */
  command?: string
  /** command 模式：指令前缀，默认 '/' */
  prefix?: string
  /** text / at_me 模式：消息正文 */
  text?: string
  /** 模拟发送者 QQ；缺省 123456 */
  userId?: string | number
  /** 模拟群号；at_me / button 时生效，缺省 654321 */
  groupId?: string | number
  /** button 模式：按钮回传数据 */
  buttonData?: string
}

export interface PreviewRequest {
  projectPath: string
  /** 编辑器当前图（未保存改动也能预览）；不传则读 .qqbat/flow.json */
  graph?: FlowGraph
  event: PreviewEventInput
  /** 超时毫秒；main 侧夹在 1s–30s，默认 8s */
  timeoutMs?: number
}

/** 预览里被拦下的一个副作用调用（发消息 / 调接口），只记录不真发。 */
export interface PreviewActionRecord {
  api: string
  params: Record<string, unknown>
  /** 调用序号，从 1 开始，UI 用它做 key */
  seq: number
}

/** 一次节点执行的轨迹（enter / exit / error）。 */
export interface PreviewNodeRecord {
  nodeId: string
  status: string
  durationMs?: number
  message?: string
}

export interface PreviewResult {
  /** 没有 error 级问题且执行未抛错 */
  ok: boolean
  /** 是否命中触发器 */
  matched: boolean
  durationMs: number
  /** 被拦下的动作（按发生顺序） */
  actions: PreviewActionRecord[]
  /** 节点执行轨迹 */
  nodes: PreviewNodeRecord[]
  /** 运行结束时的变量快照（键含作用域前缀，如 `sys:x`） */
  variables: Record<string, unknown>
  errors: string[]
  /** normalizeFlow 之后 validateFlow 的问题清单 */
  issues: FlowIssue[]
  /** 归一化补全的端口数 */
  normalizedNodes: number
  timedOut: boolean
}
