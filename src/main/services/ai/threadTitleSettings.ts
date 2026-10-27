// src/main/services/ai/threadTitleSettings.ts
//
// 「每轮自动刷新会话标题」的用户设置（第 60 批，形状照 parallelToolCallsSettings.ts）。
//
// ## 为什么需要这个开关
//
// 自动改标题已经接在轮次末尾（`services/ai/threadTitles.ts`），每轮多一次**很小的模型调用**。
// 再小的调用也是用户的钱、也是延迟，所以必须能关；但默认开着 —— 标题是会话列表里唯一的
// 辨识手段，默认关掉的话新线程会一直叫「新会话」，用户第一步就得自己去改名。
//
// ## 为什么单独一个文件
//
// `ai-config.json` 是**整份覆盖写**的（`writeAppAiConfig`），和别的设置共用一个文件
// 迟早互相抹掉 —— 与 `ai-tool-budget.json` / `ai-parallel-tool-calls.json` 同一个理由，
// 同一套「双读单写」形状。
import { z } from 'zod'
import * as electron from 'electron'
import * as fs from 'fs'
import * as fs_promises from 'fs/promises'
import { existingUserDataPath, userDataPathOrThrow } from '../infra/paths'
import { logger } from '../infra/logger'
import { atomicWrite } from '../infra/fileOps'

/**
 * 只有两档：`off` = 标题保持不动，`auto` = 每轮结束后重写一次。
 *
 * 为什么不做「每 N 轮」这种细档位：调用点只有一处（轮次末尾），档位越细，越容易变成
 * 「界面上一堆档位、代码里只认其中一个」—— 那种设置比没有设置更坏。
 */
export const threadTitleRefreshSchema = z.object({
  mode: z.enum(['off', 'auto']),
})

export type ThreadTitleRefreshSetting = z.infer<typeof threadTitleRefreshSchema>

/**
 * 默认 `auto`。
 *
 * 出处：与 `threadTitles.ts` 接线时的默认行为一致（第 60 批）—— 开关是**后加的**，
 * 加之前标题每轮都会自动刷新，所以默认值必须保持那个行为，否则等于"升级悄悄改了默认"。
 */
export const DEFAULT_THREAD_TITLE_REFRESH: ThreadTitleRefreshSetting = { mode: 'auto' }

/** 当前生效的设置（运行期唯一真相；`applyThreadTitleRefreshSetting` 写它） */
let active: ThreadTitleRefreshSetting = { ...DEFAULT_THREAD_TITLE_REFRESH }

/** 设置文件的绝对路径（**写入位置**） */
function threadTitleRefreshPath(): string {
  return userDataPathOrThrow('aiThreadTitleRefresh', electron.app)
}

/** **读取位置**：新位置优先，否则回落旧位置（双读单写，理由同 budgetSettings） */
function threadTitleRefreshReadPath(): string {
  return existingUserDataPath('aiThreadTitleRefresh', electron.app) ?? threadTitleRefreshPath()
}

/**
 * 读设置。
 *
 * 文件不存在 / 字段非法 → 返回**默认值**（不是抛错，也不是"未配置"）：
 * 这是"有个合理默认"的设置，不是"必须用户填"的配置。
 * 但非法时留一条 warn —— 用户手改坏了文件，得能从日志看出来。
 */
export async function readThreadTitleRefreshSetting(): Promise<ThreadTitleRefreshSetting> {
  const path = threadTitleRefreshReadPath()
  try {
    if (!fs.existsSync(path)) return { ...DEFAULT_THREAD_TITLE_REFRESH }
    const raw = await fs_promises.readFile(path, 'utf-8')
    const result = threadTitleRefreshSchema.safeParse(JSON.parse(raw))
    if (!result.success) {
      logger.warn('[ai] 会话标题刷新设置没通过校验，改用默认值:', result.error.message)
      return { ...DEFAULT_THREAD_TITLE_REFRESH }
    }
    return result.data
  } catch (e) {
    logger.warn('[ai] 读取会话标题刷新设置失败，改用默认值:', e)
    return { ...DEFAULT_THREAD_TITLE_REFRESH }
  }
}

/** 写设置（幂等覆盖） */
export async function writeThreadTitleRefreshSetting(
  setting: ThreadTitleRefreshSetting,
): Promise<void> {
  await atomicWrite(threadTitleRefreshPath(), JSON.stringify(setting, null, 2))
}

/** 把设置应用到运行时（后续的轮次读 `currentThreadTitleRefreshSetting()`） */
export function applyThreadTitleRefreshSetting(setting: ThreadTitleRefreshSetting): void {
  active = { ...setting }
}

/** 启动时调用：读设置并应用。读失败也**不阻断启动**。 */
export async function loadAndApplyThreadTitleRefresh(): Promise<ThreadTitleRefreshSetting> {
  const setting = await readThreadTitleRefreshSetting()
  applyThreadTitleRefreshSetting(setting)
  return setting
}

/** 当前生效的设置（同步；轮次末尾判断要不要刷新标题时读它） */
export function currentThreadTitleRefreshSetting(): ThreadTitleRefreshSetting {
  return { ...active }
}

/**
 * 这一轮要不要自动刷新标题。
 *
 * 为什么给一个布尔出口而不是让调用方自己比 `current().mode === 'auto'`：
 * 判断只该有一种写法 —— 两处各写一遍 `mode` 比较，迟早有一处写成只认 `'on'`。
 */
export function threadTitleAutoRefreshEnabled(): boolean {
  return active.mode === 'auto'
}
