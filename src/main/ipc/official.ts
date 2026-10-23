// src/main/ipc/official.ts
import { ipcMain, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import {
  startOfficial, stopOfficial, getOfficialStatus, testOfficialConnection,
  sendOfficialMessage, uploadOfficialFile, sendOfficialMedia, recallOfficialMessage,
  onOfficialStatusChange, onOfficialMessage,
  saveOfficialConfig, loadOfficialConfig
} from '../services/official'
import { logger } from '../services/logger'
import {
  startOfficialSchema, stopOfficialSchema, getOfficialStatusSchema, saveOfficialConfigSchema,
  testOfficialConnectionSchema, sendOfficialMessageSchema,
  uploadOfficialFileSchema, sendOfficialMediaSchema, recallOfficialMessageSchema,
  startOfficialTranslatorSchema, stopOfficialTranslatorSchema
} from '../schemas/official'
import { projectPathSchema } from '../schemas/project'
import { startTranslator, stopTranslator, getTranslatorStatus, findFreePort } from '../services/onebot-translator'
import { atomicWrite } from '../services/fileOps'
import { tryIpc, tryIpcAsync } from './_shared'

/** 获取或自动分配翻译器端口（独立于 NapCat 端口） */
async function getTranslatorPort(projectPath: string): Promise<number> {
  try {
    const projectJsonPath = join(projectPath, '.qqbat', 'project.json')
    const projectJson = JSON.parse(await readFile(projectJsonPath, 'utf-8'))
    if (projectJson.translatorPort && projectJson.translatorPort > 0) {
      return projectJson.translatorPort
    }
    // 自动分配并保存
    const port = await findFreePort(8080)
    projectJson.translatorPort = port
    await atomicWrite(projectJsonPath, JSON.stringify(projectJson, null, 2))
    return port
  } catch {
    return findFreePort(8080)
  }
}

export function registerOfficialIpc(): void {
  onOfficialStatusChange((projectPath, status, appId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('official:statusChange', { projectPath, status, appId })
      }
    }
  })

  onOfficialMessage((projectPath, message) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('official:message', { projectPath, message })
      }
    }
  })

  /** official:start — 启动官方机器人及翻译器 */
  ipcMain.handle('official:start', async (_event, args: unknown) => {
    const parsed = startOfficialSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      await startOfficial(parsed.data.projectPath)
      startTranslator(parsed.data.projectPath, await getTranslatorPort(parsed.data.projectPath)).catch((e) => {
        logger.error('[official] 翻译器启动失败:', e)
      })
      return null
    })
  })

  /** official:stop — 停止官方机器人及翻译器 */
  ipcMain.handle('official:stop', async (_event, args: unknown) => {
    const parsed = stopOfficialSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      stopOfficial(parsed.data.projectPath)
      stopTranslator(parsed.data.projectPath)
      return null
    })
  })

  /** official:status — 查询官方机器人运行状态 */
  ipcMain.handle('official:status', async (_event, args: unknown) => {
    const parsed = getOfficialStatusSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => getOfficialStatus(parsed.data.projectPath))
  })

  /** official:saveConfig — 保存官方机器人配置（appId/appSecret/sandbox/wsUrl） */
  ipcMain.handle('official:saveConfig', async (_event, args: unknown) => {
    const parsed = saveOfficialConfigSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      await saveOfficialConfig(parsed.data.projectPath, {
        appId: parsed.data.appId,
        appSecret: parsed.data.appSecret,
        sandbox: parsed.data.sandbox,
        wsUrl: parsed.data.wsUrl
      })
      return null
    })
  })

  /** official:getConfig — 读取官方机器人配置 */
  ipcMain.handle('official:getConfig', async (_event, projectPath: string) => {
    const parsed = projectPathSchema.safeParse(projectPath)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => loadOfficialConfig(parsed.data))
  })

  /** official:testConnection — 测试官方机器人连接是否可达 */
  ipcMain.handle('official:testConnection', async (_event, args: unknown) => {
    const parsed = testOfficialConnectionSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const ok = await testOfficialConnection(parsed.data.appId, parsed.data.appSecret)
      if (!ok) throw new Error('连接失败')
      return { connected: true }
    })
  })

  /** official:sendMessage — 发送官方机器人消息 */
  ipcMain.handle('official:sendMessage', async (_event, args: unknown) => {
    const parsed = sendOfficialMessageSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      sendOfficialMessage(
        parsed.data.projectPath, parsed.data.chatType, parsed.data.chatId, parsed.data.content ?? '', {
          msgType: parsed.data.msgType,
          eventId: parsed.data.eventId,
          msgId: parsed.data.msgId,
          msgSeq: parsed.data.msgSeq,
          media: parsed.data.media,
          markdown: parsed.data.markdown,
          keyboard: parsed.data.keyboard,
          messageReference: parsed.data.messageReference
        }
      )
    )
  })

  /** official:uploadFile — 上传文件到官方群聊/私聊 */
  ipcMain.handle('official:uploadFile', async (_event, args: unknown) => {
    const parsed = uploadOfficialFileSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      uploadOfficialFile(
        parsed.data.projectPath, parsed.data.chatType, parsed.data.chatId,
        parsed.data.fileType, parsed.data.url, parsed.data.fileName
      )
    )
  })

  /** official:sendMedia — 发送媒体消息（图片/视频/语音等） */
  ipcMain.handle('official:sendMedia', async (_event, args: unknown) => {
    const parsed = sendOfficialMediaSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      sendOfficialMedia(
        parsed.data.projectPath, parsed.data.chatType, parsed.data.chatId,
        parsed.data.mediaUrl, parsed.data.fileType, parsed.data.fileName,
        { eventId: parsed.data.eventId, msgId: parsed.data.msgId }
      )
    )
  })

  /** official:recallMessage — 撤回已发送的官方机器人消息 */
  ipcMain.handle('official:recallMessage', async (_event, args: unknown) => {
    const parsed = recallOfficialMessageSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      await recallOfficialMessage(
        parsed.data.projectPath, parsed.data.chatType, parsed.data.chatId, parsed.data.msgId
      )
      return null
    })
  })

  /** official:startTranslator — 启动 OneBot 翻译器 */
  ipcMain.handle('official:startTranslator', async (_event, args: unknown) => {
    const parsed = startOfficialTranslatorSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => startTranslator(parsed.data.projectPath, parsed.data.port))
  })

  ipcMain.handle('official:stopTranslator', async (_event, args: unknown) => {
    const parsed = stopOfficialTranslatorSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      stopTranslator()
      return null
    })
  })

  /** official:getTranslatorStatus — 查询翻译器运行状态 */
  ipcMain.handle('official:getTranslatorStatus', async (_event) => {
    return tryIpcAsync(() => getTranslatorStatus())
  })
}
