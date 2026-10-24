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
import {
  startTranslator, stopTranslator, getTranslatorStatus, resolveUsableTranslatorPort
} from '../services/runner/eventBus'
import { persistTranslatorPort } from '../services/project/translatorPort'
import { tryIpc, tryIpcAsync } from './_shared'

/**
 * 获取或分配翻译器端口（translatorPort = 1000 + portBlock，专属段 43100–43199）。
 *
 * 与 10/18 产物一致：端口一律交给 `resolveUsableTranslatorPort` 决定 ——
 * 旧实现回退 `findFreePort(8080)`，而 8080 极易被第三方软件占用（本机实测 Steam web helper），
 * 会把运行时指向别人的服务。解析出的端口回写 project.json，避免下次漂移。
 */
async function getTranslatorPort(projectPath: string): Promise<number> {
  const projectJsonPath = join(projectPath, '.qqbat', 'project.json')
  let projectJson: Record<string, unknown> | null = null
  try {
    projectJson = JSON.parse(await readFile(projectJsonPath, 'utf-8')) as Record<string, unknown>
  } catch {
    projectJson = null
  }
  const port = await resolveUsableTranslatorPort(projectJson, projectPath)
  if (projectJson && projectJson.translatorPort !== port) await persistTranslatorPort(projectPath, port)
  return port
}

export function registerOfficialIpc(): void {
  onOfficialStatusChange((projectPath: string, status: string, appId: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('official:statusChange', { projectPath, status, appId })
      }
    }
  })

  onOfficialMessage((projectPath: string, message: unknown) => {
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
      const projectPath = parsed.data.projectPath
      await startOfficial(projectPath)
      // startTranslator 返回**实际绑定**端口：可能因端口被占换块，必须回写，否则下次又抢同一个号
      startTranslator(projectPath, await getTranslatorPort(projectPath))
        .then((actualPort) => persistTranslatorPort(projectPath, actualPort))
        .catch((e) => {
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

  /** official:startTranslator — 启动翻译器 */
  ipcMain.handle('official:startTranslator', async (_event, args: unknown) => {
    const parsed = startOfficialTranslatorSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const projectPath = parsed.data.projectPath
      const requested = parsed.data.port
      const actualPort = await startTranslator(projectPath, requested)
      if (actualPort !== requested) await persistTranslatorPort(projectPath, actualPort)
      return null
    })
  })

  ipcMain.handle('official:stopTranslator', async (_event, args: unknown) => {
    const parsed = stopOfficialTranslatorSchema.safeParse(args)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      stopTranslator(parsed.data.projectPath)
      return null
    })
  })

  /** official:getTranslatorStatus — 查询翻译器运行状态 */
  ipcMain.handle('official:getTranslatorStatus', async (_event) => {
    return tryIpcAsync(() => getTranslatorStatus())
  })
}
