// src/main/ipc/adapter.ts
import { ipcMain } from 'electron'
import { adapterRegistry } from '@shared/types/adapter'
import { tryIpc } from './_shared'
import { adapterSwitchSchema } from '../schemas/adapter'

/**
 * 当前活动的适配器类型。
 *
 * 10/18 基线起 shared/types/adapter.ts 只注册 official（NapCat 的网关通道已退役、
 * 也没有任何 napcat:* IPC 注册），这里的默认值必须跟着收敛 —— 否则 adapter:current
 * 会报一个永远切不回去的假类型，界面上就成了「当前用的是 NapCat」。
 */
let currentAdapterType = 'official'

export function registerAdapterIpc(): void {
  ipcMain.handle('adapter:list', async () => {
    return tryIpc(() => adapterRegistry.list())
  })

  ipcMain.handle('adapter:switch', async (_event, args: unknown) => {
    const parsed = adapterSwitchSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      if (!adapterRegistry.has(parsed.data.type)) {
        throw new Error(`未知的适配器类型: ${parsed.data.type}`)
      }
      currentAdapterType = parsed.data.type
      return currentAdapterType
    })
  })

  ipcMain.handle('adapter:current', async () => {
    return tryIpc(() => currentAdapterType)
  })
}

export function getCurrentAdapterType(): string {
  return currentAdapterType
}
