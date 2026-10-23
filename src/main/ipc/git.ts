// src/main/ipc/git.ts
import { ipcMain } from 'electron'
import { gitService } from '../services/git'
import {
  gitInitSchema,
  gitLogSchema,
  gitStatusSchema,
  gitDiffSchema,
  gitRestoreFlowSchema,
  gitClearHistorySchema,
  gitDeleteCommitsSchema,
  gitListVersionTagsSchema,
  gitTagVersionSchema,
  gitRenameVersionTagSchema,
  gitDeleteVersionTagSchema,
  gitRewordCommitSchema
} from '../schemas/git'
import { tryIpcAsync } from './_shared'

export function registerGitIpc(): void {
  ipcMain.handle('git:init', async (_event, args: unknown) => {
    const parsed = gitInitSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const ok = await gitService.gitInit(parsed.data.projectPath)
      return ok
    })
  })

  ipcMain.handle('git:log', async (_event, args: unknown) => {
    const parsed = gitLogSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => gitService.log(parsed.data.projectPath, parsed.data.maxCount))
  })

  ipcMain.handle('git:status', async (_event, args: unknown) => {
    const parsed = gitStatusSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => gitService.status(parsed.data.projectPath))
  })

  ipcMain.handle('git:diff', async (_event, args: unknown) => {
    const parsed = gitDiffSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => gitService.diff(parsed.data.projectPath, parsed.data.hash))
  })

  ipcMain.handle('git:restoreFlow', async (_event, args: unknown) => {
    const parsed = gitRestoreFlowSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      gitService.restoreFlow(parsed.data.projectPath, parsed.data.hash)
    )
  })

  ipcMain.handle('git:clearHistory', async (_event, args: unknown) => {
    const parsed = gitClearHistorySchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => gitService.clearHistory(parsed.data.projectPath))
  })

  ipcMain.handle('git:deleteCommits', async (_event, args: unknown) => {
    const parsed = gitDeleteCommitsSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      gitService.deleteCommits(parsed.data.projectPath, parsed.data.hashes)
    )
  })

  ipcMain.handle('git:listVersionTags', async (_event, args: unknown) => {
    const parsed = gitListVersionTagsSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => gitService.listVersionTags(parsed.data.projectPath))
  })

  ipcMain.handle('git:tagVersion', async (_event, args: unknown) => {
    const parsed = gitTagVersionSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      gitService.tagVersion(parsed.data.projectPath, parsed.data.name, parsed.data.message)
    )
  })

  ipcMain.handle('git:renameVersionTag', async (_event, args: unknown) => {
    const parsed = gitRenameVersionTagSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      gitService.renameVersionTag(parsed.data.projectPath, parsed.data.oldName, parsed.data.newName)
    )
  })

  ipcMain.handle('git:deleteVersionTag', async (_event, args: unknown) => {
    const parsed = gitDeleteVersionTagSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      gitService.deleteVersionTag(parsed.data.projectPath, parsed.data.name)
    )
  })

  ipcMain.handle('git:rewordCommit', async (_event, args: unknown) => {
    const parsed = gitRewordCommitSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      gitService.rewordCommit(parsed.data.projectPath, parsed.data.hash, parsed.data.message)
    )
  })
}
