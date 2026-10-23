// src/main/ipc/debugger.ts
import { ipcMain } from 'electron'
import { debuggerService } from '../services/debugger'
import { tryIpc } from './_shared'
import { setBreakpointsSchema } from '../schemas/debugger'

export function registerDebuggerIpc(): void {
  // ---- 断点管理 ----
  ipcMain.handle('debug:setBreakpoints', async (_event, args: unknown) => {
    const parsed = setBreakpointsSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数必须是 Breakpoint 数组' }
    return tryIpc(() => {
      debuggerService.setBreakpoints(parsed.data)
    })
  })

  // ---- 调试会话控制 ----
  ipcMain.handle('debug:start', async () => {
    return tryIpc(() => {
      debuggerService.start()
      return null
    })
  })

  ipcMain.handle('debug:stepOver', async () => {
    return tryIpc(() => {
      debuggerService.stepOver()
      return null
    })
  })

  ipcMain.handle('debug:stepInto', async () => {
    return tryIpc(() => {
      debuggerService.stepInto()
      return null
    })
  })

  ipcMain.handle('debug:stepOut', async () => {
    return tryIpc(() => {
      debuggerService.stepOut()
      return null
    })
  })

  ipcMain.handle('debug:continue', async () => {
    return tryIpc(() => {
      debuggerService.continue()
      return null
    })
  })

  ipcMain.handle('debug:pause', async () => {
    return tryIpc(() => {
      debuggerService.pause()
      return null
    })
  })

  ipcMain.handle('debug:stop', async () => {
    return tryIpc(() => {
      debuggerService.stop()
      return null
    })
  })

  // ---- 状态查询 ----
  ipcMain.handle('debug:getState', async () => {
    return tryIpc(() => debuggerService.getState())
  })

  ipcMain.handle('debug:getVariables', async () => {
    return tryIpc(() => {
      const state = debuggerService.getState()
      return state.variables
    })
  })
}
