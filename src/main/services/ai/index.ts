// src/main/services/ai/index.ts
//
// 只剩**不跑对话**的那一层：模型配置、批处理事务状态、清空记忆。
//
// 对话本身只有一条路 —— `src/main/ipc/aiAgentCore.ts` 的 agent-core 循环（2026-10-25 起）。
// 这里原来还有 processAiChat / runOneRound / lanes / scout / verifierLlm / autoTx 一整套
// 「助手引擎」，与循环是两套并行实现（同一件事写了两遍，行为还各有各的偏差）。
// 开荒（没有工作区）也在 2026-10-25 接进同一条循环后，那一整套失去最后一个调用方，已删除。
// 改动记录见 docs/ai/agent-core-wiring.md §39/§40。
import { BrowserWindow } from 'electron'
import { AI_BATCH_TIMEOUT_MS } from '@shared/types/ai'
import { type LlmConfig } from './llm'
import { logger } from '../infra/logger'
import { existsSync, rmSync } from 'node:fs'
import { historyFilePath } from './historyStore'
import { providerRegistry, type AIProviderConfig } from '@shared/types/ai-provider'

let aiConfig: LlmConfig | null = null

export function setAiConfig(config: LlmConfig): void {
  aiConfig = config
  // 同步更新 Provider 注册表
  if (config) {
    const providerConfig: AIProviderConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    }
    providerRegistry.getOrCreate(config.provider, providerConfig)
    providerRegistry.setCurrent(config.provider)
  }
}

export function getAiConfig(): LlmConfig | null {
  return aiConfig
}

// ====== Batch 事务状态管理 ======

/** 与渲染层共用同一个值（见 @shared/types/ai 的 AI_BATCH_TIMEOUT_MS） */
const BATCH_TIMEOUT_MS = AI_BATCH_TIMEOUT_MS

/**
 * 批处理状态**按项目**存（2026-10-01 修）。
 *
 * ## 修之前是什么样（一个真会咬人的 bug）
 *
 * 批处理的语义是"**这个项目的这次会话是一个事务**"（30 秒自动提交），但它被实现成
 * **进程级标志**，而且 API 与 IPC 连 `projectPath` 都没有。于是**用户切换项目就会串**：
 * ① A 里开一批 → 全局 `isBatchMode = true`；② 切到 B 干活 → B 也被当成在批处理里；
 * ③ B 里任一工具失败 → 回滚的是 A 的批次；④ 或 A 的超时到了 → 把 B 这轮当 A 的处置。
 *
 * 现在与 `writeGuard.observed` 一致：**按 projectPath 存**。
 *
 * 旧引擎删除后这里只剩**状态机**本身：写方是渲染层（`ai:beginBatch/commitBatch/rollbackBatch`），
 * 读方是取消路径（`ai:cancelChat` —— 取消就得收掉挂着的批次，否则 30 秒定时器照跑）。
 */
interface BatchState {
  active: boolean
  timeoutId: ReturnType<typeof setTimeout> | null
  /** batch 开始时关联的窗口（保留给将来的失败通知用） */
  win: BrowserWindow | null
}

const batches = new Map<string, BatchState>()

function batchOf(projectPath: string): BatchState {
  let s = batches.get(projectPath)
  if (!s) {
    s = { active: false, timeoutId: null, win: null }
    batches.set(projectPath, s)
  }
  return s
}

/** 清掉定时器但不改 active（commit/rollback 共用） */
function clearBatchTimer(state: BatchState): void {
  if (state.timeoutId !== null) {
    clearTimeout(state.timeoutId)
    state.timeoutId = null
  }
}

export function beginBatch(projectPath: string, win: BrowserWindow): void {
  const state = batchOf(projectPath)
  // 清除**这个项目**的旧超时（别的项目的定时器不归这里管 —— 这正是按项目存的意义）
  clearBatchTimer(state)

  state.active = true
  state.win = win

  // 30 秒超时自动 commit（防死锁）
  state.timeoutId = setTimeout(() => {
    if (state.active) {
      state.active = false
      state.win = null
      logger.info(`[Batch] ${projectPath} 超时自动 commit`)
    }
    state.timeoutId = null
  }, BATCH_TIMEOUT_MS)
}

export function commitBatch(projectPath: string): void {
  const state = batchOf(projectPath)
  state.active = false
  state.win = null
  clearBatchTimer(state)
}

export function handleRollbackBatch(projectPath: string): void {
  const state = batchOf(projectPath)
  state.active = false
  state.win = null
  clearBatchTimer(state)
}

/** 该项目当前是否处于批处理（取消路径据此收掉挂着的批次） */
export function isBatchModeFor(projectPath: string): boolean {
  return batches.get(projectPath)?.active ?? false
}

/**
 * 清空某个项目的对话记忆（默认那份 ai-history.jsonl；传 file 清指定线程）。
 *
 * 为什么**同步**：调用方通常是「先清空、紧接着跑一轮」的测试/重开对话路径，
 * 异步删文件会和后续的 loadHistory 竞态 —— 读到已删但还没删完的旧内容。
 * 删失败只记日志：记忆是锦上添花，不该让调用方失败。
 */
export function clearAiHistory(projectPath: string, file?: string): void {
  if (!projectPath) return
  try {
    const target = file ?? historyFilePath(projectPath)
    if (existsSync(target)) rmSync(target, { force: true })
  } catch (e) {
    logger.warn(`[ai] 清空对话记忆失败（忽略）: ${String(e)}`)
  }
}
