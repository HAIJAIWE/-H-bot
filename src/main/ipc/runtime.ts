// src/main/ipc/runtime.ts
//
// 运行时**观测**通道（TS 运行时）。
//
// 10/18 之后机器人不再 spawn Python 子进程：启动/停止/重启/状态查询统一走
// `botManager:*`（`src/main/ipc/botManager.ts`），这条通道只留三件事——
// 批量转发日志、转发节点执行事件、给流程测试注入一条即时消息。
// 旧的 `runtime:start/stop/status/sendCommand/restart/listRunning` 直连
// `services/botProcess`（Python 时代的 stdout 总线），在 TS 运行时下永远收不到
// 事件（界面日志/节点高亮因此是死的），已随本轮一并下线。
import { ipcMain, BrowserWindow } from 'electron'
import { injectTestMessage } from '../services/runner/eventBus'
import { injectTestMessageSchema } from '../schemas/runtime'
import { onBotLog, onNodeEvent } from '../services/runtimeEvents'
import type { BotLogEntry } from '@shared/types/runtime'
import { BatchAccumulator } from '../services/batcher'
import { tryIpc } from './_shared'

/** 日志攒批窗口（毫秒）：高频日志合成一批走一次 IPC，避免每行都唤醒渲染进程 */
const LOG_BATCH_WINDOW_MS = 100

export function registerRuntimeIpc(): void {
  // 通道名写字面量（闸门 ipcEventDelivery 靠静态扫描对账）：不要抽成通用 broadcast(name)
  const logBatcher = new BatchAccumulator<{ projectPath: string; entry: BotLogEntry }>(
    LOG_BATCH_WINDOW_MS,
    (items) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('runtime:batchLog', items)
      }
    },
  )

  onBotLog((projectPath, entry) => {
    logBatcher.add({ projectPath, entry })
  })

  onNodeEvent((projectPath, event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('runtime:executeNode', { projectPath, event })
    }
  })

  /** runtime:injectTestMessage — 注入测试消息到翻译器（用于调试） */
  ipcMain.handle('runtime:injectTestMessage', async (_event, args: unknown) => {
    const parsed = injectTestMessageSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      // 透传 chatType / chatId，原实现硬编码 group 导致私聊调试无效
      const ok = injectTestMessage(
        parsed.data.projectPath,
        parsed.data.message,
        parsed.data.chatType,
        parsed.data.chatId,
      )
      if (!ok) throw new Error('翻译器未运行或无客户端连接')
      return { sent: true }
    })
  })
}
