// src/main/ipc/aiPresets.ts
//
// **会话预设的导入导出**（2026-10-26，第 53 批）。
//
// 为什么单独一个文件：aiAgentCore.ts 已经贴着行数红线；这三条通道只做"文件选择 +
// 读写"，和跑循环的 handler 没有共享状态，分开更容易看清边界。
//
// 三条通道的分工：
//   · ai:exportPresets   —— 选保存位置，把当前项目自定义预设写成分享文件；
//   · ai:pickPresetShare —— 选一个分享文件，只读并回预览（不写项目）；
//   · ai:importPresets   —— 用户在界面上确认后，把原文交给服务层合并。
// 关键：选完文件不等于导入。写盘只发生在第三条，且服务层会重新解析一次原文
// （界面上的预览只是给人看的，不能当授权凭证）。
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'
import { basename } from 'path'
import { PRESET_SHARE_MAX_BYTES } from '@shared/ai/presetShare'
import { aiPresetImportSchema, aiProjectPathSchema } from '../schemas/ai'
import {
  buildPresetShare,
  importPresetShare,
  previewPresetImport,
} from '../services/ai/presetShare'
import { tryIpcAsync } from './_shared'

function parentWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function registerAiPresetsIpc(): void {
  ipcMain.handle('ai:exportPresets', async (event, args: unknown) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数校验失败: ' + parsed.error.message }
    return tryIpcAsync(async () => {
      const share = await buildPresetShare(parsed.data.projectPath)
      const options = {
        title: '导出会话预设',
        defaultPath: (basename(parsed.data.projectPath) || 'project') + '-agent-presets.json',
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      }
      const win = parentWindow(event)
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) throw new Error('用户取消')
      await writeFile(result.filePath, share.text, 'utf-8')
      return {
        filePath: result.filePath,
        count: share.count,
        warnings: share.warnings,
      }
    })
  })

  ipcMain.handle('ai:pickPresetShare', async (event, args: unknown) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数校验失败: ' + parsed.error.message }
    return tryIpcAsync(async () => {
      const options = {
        title: '导入会话预设',
        properties: ['openFile' as const],
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      }
      const win = parentWindow(event)
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const filePath = result.filePaths[0]
      if (result.canceled || !filePath) throw new Error('用户取消')
      const info = await stat(filePath)
      if (!info.isFile()) throw new Error('选中的不是文件')
      if (info.size > PRESET_SHARE_MAX_BYTES) {
        throw new Error(
          '这个文件太大（' +
            Math.round(info.size / 1024) +
            ' KB，上限 ' +
            Math.round(PRESET_SHARE_MAX_BYTES / 1024) +
            ' KB）',
        )
      }
      const text = await readFile(filePath, 'utf-8')
      const preview = await previewPresetImport(parsed.data.projectPath, text)
      return { filePath, fileName: basename(filePath), text, preview }
    })
  })

  ipcMain.handle('ai:importPresets', async (_event, args: unknown) => {
    const parsed = aiPresetImportSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: '参数校验失败: ' + parsed.error.message }
    return tryIpcAsync(() =>
      importPresetShare(parsed.data.projectPath, parsed.data.text, parsed.data.overwrite),
    )
  })
}
