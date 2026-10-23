import { ipcMain, BrowserWindow } from 'electron'
import { createTerminal, writeTerminal, killTerminal, registerTerminalDataHandler } from '../services/terminal'
import { createTerminalSchema, writeTerminalSchema, killTerminalSchema } from '../schemas/terminal'
import { BatchAccumulator } from '../services/batcher'
import { tryIpc } from './_shared'

/** 终端数据批处理大小：累积 N 条后一次性发送到渲染层 */
const TERMINAL_BATCH_SIZE = 100

// 每个终端会话对应一个批处理器
const terminalBatchers = new Map<string, BatchAccumulator<{ id: string; data: string }>>()

export function registerTerminalIpc(): void {
  /** terminal:create — 创建终端会话，返回会话 ID */
  ipcMain.handle('terminal:create', async (event, args: unknown) => {
    const parsed = createTerminalSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const id = createTerminal(parsed.data.projectPath)
      // 注册数据推送 → 渲染层（批量发送 terminal:batchData）
      const win = BrowserWindow.fromWebContents(event.sender)
      const batcher = new BatchAccumulator<{ id: string; data: string }>(TERMINAL_BATCH_SIZE, (items) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('terminal:batchData', items)
        }
      })
      terminalBatchers.set(id, batcher)
      registerTerminalDataHandler(id, (data: string) => {
        batcher.add({ id, data })
      })
      return id
    })
  })

  /** terminal:write — 向终端会话写入数据（键盘输入） */
  ipcMain.handle('terminal:write', async (_event, args: unknown) => {
    const parsed = writeTerminalSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      writeTerminal(parsed.data.id, parsed.data.data)
      return null
    })
  })

  /** terminal:kill — 终止终端会话并清理批处理器 */
  ipcMain.handle('terminal:kill', async (_event, args: unknown) => {
    const parsed = killTerminalSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      killTerminal(parsed.data.id)
      // 清理批处理器
      const batcher = terminalBatchers.get(parsed.data.id)
      if (batcher) {
        batcher.destroy()
        terminalBatchers.delete(parsed.data.id)
      }
      return null
    })
  })
}
