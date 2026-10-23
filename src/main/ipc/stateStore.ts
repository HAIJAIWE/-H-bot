// src/main/ipc/stateStore.ts
// IPC handlers for bot state persistence (F3)

import { ipcMain, app } from 'electron'
import { StateStore } from '../services/stateStore'
import { tryIpc, errorMessage } from './_shared'
import {
  stateStoreSetSchema,
  stateStoreGetSchema,
  stateStoreDeleteSchema,
  stateStoreListKeysSchema,
  stateStoreSetSessionVarSchema,
  stateStoreGetSessionVarSchema,
  stateStoreClearSessionSchema,
  stateStoreProjectOnlySchema,
  stateStoreGetAllEntriesSchema,
} from '../schemas/stateStore'

const store = StateStore.getInstance()

export function registerStateStoreIpc(): void {
  // ---- bot_state ---------------------------------------------------------

  ipcMain.handle('stateStore:set', async (_event, args: unknown) => {
    const parsed = stateStoreSetSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      store.set(parsed.data.key, parsed.data.value, parsed.data.projectPath)
      return null
    })
  })

  ipcMain.handle('stateStore:get', async (_event, args: unknown) => {
    const parsed = stateStoreGetSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => store.get(parsed.data.key, parsed.data.projectPath))
  })

  ipcMain.handle('stateStore:delete', async (_event, args: unknown) => {
    const parsed = stateStoreDeleteSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => store.delete(parsed.data.key, parsed.data.projectPath))
  })

  ipcMain.handle('stateStore:listKeys', async (_event, args: unknown) => {
    const parsed = stateStoreListKeysSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    // IPC-7 修复：传递分页参数
    return tryIpc(() => store.listKeys(parsed.data.prefix, parsed.data.projectPath, parsed.data.limit, parsed.data.offset))
  })

  // ---- session_vars ------------------------------------------------------

  ipcMain.handle('stateStore:setSessionVar', async (_event, args: unknown) => {
    const parsed = stateStoreSetSessionVarSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      store.setSessionVar(
        parsed.data.sessionId,
        parsed.data.varName,
        parsed.data.value,
        parsed.data.projectPath
      )
      return null
    })
  })

  ipcMain.handle('stateStore:getSessionVar', async (_event, args: unknown) => {
    const parsed = stateStoreGetSessionVarSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => store.getSessionVar(parsed.data.sessionId, parsed.data.varName, parsed.data.projectPath))
  })

  ipcMain.handle('stateStore:clearSession', async (_event, args: unknown) => {
    const parsed = stateStoreClearSessionSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      store.clearSession(parsed.data.sessionId, parsed.data.projectPath)
      return null
    })
  })

  // ---- 统计与维护 --------------------------------------------------------

  ipcMain.handle('stateStore:stats', async (_event, args: unknown) => {
    const parsed = stateStoreProjectOnlySchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      const stateCount = store.getStateCount(parsed.data.projectPath)
      const sessionCount = store.getSessionCount(parsed.data.projectPath)
      const dbSize = store.getDbSize(parsed.data.projectPath)
      return { stateCount, sessionCount, dbSize }
    })
  })

  // IPC-7 修复：使用 stateStoreGetAllEntriesSchema 支持分页
  ipcMain.handle('stateStore:getAllStateEntries', async (_event, args: unknown) => {
    const parsed = stateStoreGetAllEntriesSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => store.getAllStateEntries(parsed.data.projectPath, parsed.data.limit, parsed.data.offset))
  })

  ipcMain.handle('stateStore:clearAll', async (_event, args: unknown) => {
    const parsed = stateStoreProjectOnlySchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      store.clearAll(parsed.data.projectPath)
      return null
    })
  })

  // 应用退出时清理
  app.on('before-quit', () => {
    store.close()
  })
}
