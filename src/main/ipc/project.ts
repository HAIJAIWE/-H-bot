// src/main/ipc/project.ts
import { ipcMain, dialog, shell } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { ProjectService } from '../services/project'
import {
  createProjectSchema,
  openProjectSchema,
  projectPathSchema,
  newNameSchema,
  saveConfigSchema,
  botTypeSchema
} from '../schemas/project'
import { botManager } from '../services/botManager'
import { atomicWrite } from '../services/fileOps'
import { tryIpc, tryIpcAsync } from './_shared'
import { assertOpenPathSafe, assertWithinProject } from '../services/pathGuard'
import type { ProjectConfig } from '@shared/types/project'

/** 移动项目 offset 参数校验 */
const moveOffsetSchema = z.union([z.literal(-1), z.literal(1)])

/** 端口号校验 */
const portSchema = z.number().int().min(1).max(65535)

export function registerProjectIpc(service: ProjectService): void {
  ipcMain.handle('project:create', async (_event, raw) => {
    const parsed = createProjectSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message }
    }
    return tryIpcAsync(async () => {
      const config = { ...parsed.data } as ProjectConfig
      const meta = await service.createProject(config)
      await service.recordRecentProject(meta)
      // 注册到 BotManager 使其出现在 bot 列表中
      try { await botManager.registerBot(meta.path) } catch { /* 静默 */ }
      return meta
    })
  })

  ipcMain.handle('project:open', async (_event, raw) => {
    const parsed = openProjectSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return tryIpcAsync(async () => {
      const config = await service.loadProjectConfig(parsed.data.path)
      return { config, path: parsed.data.path }
    })
  })

  ipcMain.handle('project:getMeta', async (_event, projectPath: string) => {
    const parsed = projectPathSchema.safeParse(projectPath)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return tryIpcAsync(() => service.getProjectMeta(parsed.data))
  })

  ipcMain.handle('project:getConfig', async (_event, projectPath: string) => {
    const parsed = projectPathSchema.safeParse(projectPath)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return tryIpcAsync(() => service.loadProjectConfig(parsed.data))
  })

  ipcMain.handle('project:listRecent', async () => {
    // 保持与既有测试一致：成功返回 IpcResult；service 异常直接向上抛出
    const data = await service.listRecentProjects()
    return { ok: true, data }
  })

  ipcMain.handle('project:removeRecent', async (_event, projectPath: string) => {
    const parsed = projectPathSchema.safeParse(projectPath)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return tryIpcAsync(async () => {
      await service.removeRecentProject(parsed.data)
      return null
    })
  })

  /** 重命名项目 */
  ipcMain.handle('project:rename', async (_event, projectPath: string, newName: string) => {
    const parsedPath = projectPathSchema.safeParse(projectPath)
    const parsedName = newNameSchema.safeParse(newName)
    if (!parsedPath.success) return { ok: false, error: parsedPath.error.message }
    if (!parsedName.success) return { ok: false, error: parsedName.error.message }
    return tryIpcAsync(async () => {
      await service.renameProject(parsedPath.data, parsedName.data)
      // 同步更新 botManager 中的内存记录
      botManager.unregisterBot(parsedPath.data)
      await botManager.registerBot(parsedPath.data)
      return null
    })
  })

  /** 删除项目文件夹 */
  ipcMain.handle('project:delete', async (_event, projectPath: string) => {
    const parsed = projectPathSchema.safeParse(projectPath)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return tryIpcAsync(async () => {
      await service.deleteProject(parsed.data)
      botManager.unregisterBot(parsed.data)
      return null
    })
  })

  /** 移动项目位置（offset: -1 上移, 1 下移） */
  ipcMain.handle('project:move', async (_event, projectPath: string, offset: -1 | 1) => {
    const parsedPath = projectPathSchema.safeParse(projectPath)
    const parsedOffset = moveOffsetSchema.safeParse(offset)
    if (!parsedPath.success) return { ok: false, error: parsedPath.error.message }
    if (!parsedOffset.success) return { ok: false, error: parsedOffset.error.message }
    return tryIpcAsync(async () => {
      await service.moveProject(parsedPath.data, parsedOffset.data)
      return null
    })
  })

  /** 在文件管理器中打开项目文件夹 */
  ipcMain.handle('project:openFolder', async (_event, projectPath: string) => {
    const parsed = projectPathSchema.safeParse(projectPath)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return tryIpcAsync(async () => {
      // 安全校验：防止通过 shell.openPath 打开系统目录或执行可执行文件
      assertOpenPathSafe(parsed.data)
      await shell.openPath(parsed.data)
      return null
    })
  })

  /** 克隆项目 */
  ipcMain.handle('project:clone', async (_event, projectPath: string, newName: string) => {
    const parsedPath = projectPathSchema.safeParse(projectPath)
    const parsedName = newNameSchema.safeParse(newName)
    if (!parsedPath.success) return { ok: false, error: parsedPath.error.message }
    if (!parsedName.success) return { ok: false, error: parsedName.error.message }
    return tryIpcAsync(async () => {
      const meta = await service.cloneProject(parsedPath.data, parsedName.data)
      // 注册到 BotManager 使其出现在 bot 列表中
      try { await botManager.registerBot(meta.path) } catch { /* 静默 */ }
      return meta
    })
  })

  ipcMain.handle('project:pickDirectory', async () => {
    return tryIpcAsync(async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) {
        throw new Error('canceled')
      }
      return result.filePaths[0]
    })
  })

  ipcMain.handle('project:saveConfig', async (_event, raw) => {
    const parsed = saveConfigSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    return tryIpcAsync(async () => {
      const { __projectPath, ...configFields } = parsed.data
      const config = { ...configFields } as ProjectConfig
      // 官方 API 模式不需要 NapCat 配置
      if (config.adapter === 'official') {
        delete config.napcat
      }
      await service.saveProjectConfig(__projectPath, config)
      return null
    })
  })

  /** 更新翻译器端口（连接设置弹窗中手动修改） */
  ipcMain.handle('project:updateTranslatorPort', async (_event, projectPath: string, port: number) => {
    const parsedPath = projectPathSchema.safeParse(projectPath)
    const parsedPort = portSchema.safeParse(port)
    if (!parsedPath.success) return { ok: false, error: parsedPath.error.message }
    if (!parsedPort.success) return { ok: false, error: parsedPort.error.message }
    return tryIpcAsync(async () => {
      const configPath = join(parsedPath.data, '.qqbat', 'project.json')
      const config = JSON.parse(await readFile(configPath, 'utf-8'))
      config.translatorPort = parsedPort.data
      await atomicWrite(configPath, JSON.stringify(config, null, 2))
      return null
    })
  })

  /**
   * 改「机器人类型」（建项目之后也能改）。
   *
   * 只改这一个字段 —— 不走 project:saveConfig 的整份提交：那条路的 zod schema 会剥掉
   * 未声明字段（schemas/project.ts 里记着 translatorPort 被剥导致端口回退的坑）。
   * 类型不绑定节点，只影响标签 + 玩家数据面板分组（见 shared/domain/project/botTypeConfig.ts）。
   */
  ipcMain.handle('project:updateBotType', async (_event, projectPath: string, botType: string) => {
    const parsedPath = projectPathSchema.safeParse(projectPath)
    const parsedType = botTypeSchema.safeParse(botType)
    if (!parsedPath.success) return { ok: false, error: '参数 projectPath 无效' }
    if (!parsedType.success) return { ok: false, error: '机器人类型无效（只能是 qq / general / game）' }
    return tryIpcAsync(async () => {
      assertWithinProject(parsedPath.data, join(parsedPath.data, '.qqbat', 'project.json'))
      const configPath = join(parsedPath.data, '.qqbat', 'project.json')
      const config = JSON.parse(await readFile(configPath, 'utf-8'))
      config.botType = parsedType.data
      await atomicWrite(configPath, JSON.stringify(config, null, 2))
      return null
    })
  })
}
