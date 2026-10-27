// src/main/services/ai/parallelToolCallsSettings.ts
//
// 「一批工具调用里最多几个同时在跑」的用户设置（第 59 批，照 budgetSettings.ts 的形状）。
//
// ## 为什么需要这个设置项
//
// 循环层早就有这个能力（`agent-core/core.ts` 的 `LoopOptions.maxParallelToolCalls`，
// 默认 `MAX_PARALLEL_TOOL_CALLS_DEFAULT = 10`），但**三层都不传**：
// `RunTurnInput` 没字段、`runAgentTurn` 不透传、`aiAgentCore` 不传值 ——
// 于是生产上永远跑默认 10，用户既看不到也改不了。这个文件是设置链路的落盘那一半。
//
// ## 为什么单独一个文件
//
// `ai-config.json` 是**整份覆盖写**的（`writeAppAiConfig`），和别的设置共用一个文件
// 迟早互相抹掉 —— 与 `ai-tool-budget.json` 同一个理由，同一套「双读单写」形状。
import { z } from 'zod'
import * as electron from 'electron'
import * as fs from 'fs'
import * as fs_promises from 'fs/promises'
import { existingUserDataPath, userDataPathOrThrow } from '../infra/paths'
import { logger } from '../infra/logger'
import { atomicWrite } from '../infra/fileOps'

/** 与 `core.ts` 的 `MAX_PARALLEL_TOOL_CALLS_DEFAULT` 含义一致；这里不 import 它（避免服务层反向依赖 agent-core） */
export const MAX_PARALLEL_DEFAULT = 10
/** 上限：再多也不是「并行」了，是一口气把模型能调的都调完 —— 反而更容易触发厂商限流 */
export const MAX_PARALLEL_LIMIT = 50
export const MIN_PARALLEL = 1

export const parallelToolCallsSchema = z.object({
  /** false = 不启用并行（等价于 maxParallel: 1，全串行） */
  enabled: z.boolean(),
  /** 同时跑几个 */
  maxParallel: z.number().int().min(MIN_PARALLEL).max(MAX_PARALLEL_LIMIT),
})

export type ParallelToolCallsSetting = z.infer<typeof parallelToolCallsSchema>

export const DEFAULT_PARALLEL_SETTING: ParallelToolCallsSetting = {
  enabled: true,
  maxParallel: MAX_PARALLEL_DEFAULT,
}

/** 当前生效的设置（运行期唯一真相；`applyParallelToolCallsSetting` 写它） */
let active: ParallelToolCallsSetting = { ...DEFAULT_PARALLEL_SETTING }

/** 设置文件的绝对路径（**写入位置**） */
function parallelSettingPath(): string {
  return userDataPathOrThrow('aiParallelToolCalls', electron.app)
}

/** **读取位置**：新位置优先，否则回落旧位置（双读单写，理由同 budgetSettings） */
function parallelReadPath(): string {
  return existingUserDataPath('aiParallelToolCalls', electron.app) ?? parallelSettingPath()
}

/**
 * 读设置。
 *
 * 文件不存在 / 字段非法 → 返回**默认值**（不是抛错，也不是"未配置"）：
 * 这是"有个合理默认"的设置，不是"必须用户填"的配置。
 * 但非法时留一条 warn —— 用户手改坏了文件，得能从日志看出来。
 */
export async function readParallelToolCallsSetting(): Promise<ParallelToolCallsSetting> {
  const path = parallelReadPath()
  try {
    if (!fs.existsSync(path)) return { ...DEFAULT_PARALLEL_SETTING }
    const raw = await fs_promises.readFile(path, 'utf-8')
    const result = parallelToolCallsSchema.safeParse(JSON.parse(raw))
    if (!result.success) {
      logger.warn('[ai] 并行工具数设置没通过校验，改用默认值:', result.error.message)
      return { ...DEFAULT_PARALLEL_SETTING }
    }
    return result.data
  } catch (e) {
    logger.warn('[ai] 读取并行工具数设置失败，改用默认值:', e)
    return { ...DEFAULT_PARALLEL_SETTING }
  }
}

/** 写设置（幂等覆盖） */
export async function writeParallelToolCallsSetting(
  setting: ParallelToolCallsSetting,
): Promise<void> {
  await atomicWrite(parallelSettingPath(), JSON.stringify(setting, null, 2))
}

/** 把设置应用到运行时（后续的轮次读 `currentParallelToolCallsSetting()`） */
export function applyParallelToolCallsSetting(setting: ParallelToolCallsSetting): void {
  active = { ...setting }
}

/** 启动时调用：读设置并应用。读失败也**不阻断启动**。 */
export async function loadAndApplyParallelToolCalls(): Promise<ParallelToolCallsSetting> {
  const setting = await readParallelToolCallsSetting()
  applyParallelToolCallsSetting(setting)
  return setting
}

/** 当前生效的设置（同步；agent 轮次里每轮读它） */
export function currentParallelToolCallsSetting(): ParallelToolCallsSetting {
  return { ...active }
}

/**
 * 这一轮该传给循环的并行数（`undefined` = 让循环用它自己的默认值）。
 *
 * 关掉时返回 **1**（全串行）而不是 `undefined`：`undefined` 会让循环回落到默认 10，
 * 那正是"用户在界面上关了、实际却还在并行"的静默失败。
 */
export function effectiveMaxParallelToolCalls(): number {
  return active.enabled ? active.maxParallel : 1
}
