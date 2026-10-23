// src/main/ipc/customNode.ts
//
// 本文件按 10/18 编译产物 region `src/main/ipc/customNode.ts` 复原。
// 恢复树里的旧版只有 customNode:scan / scanV2 / watch / unwatch / fork，
// 而 10/18 的界面（NodePalette / nodeCatalog）调的是 **customNode:scanAiGenerated**，
// 于是打开项目后在节点库上直接冒出
// "自定义节点加载失败：No handler registered for 'customNode:scanAiGenerated'"。
//
// 与旧版的差别：
//   · scanAiGenerated 是 10/18 才有的通道，默认实现 = 扫描 plugins/ai-* 插件包；
//   · 没有 scanV2（10/18 已由 scanAiGenerated 取代，渲染层不再调它）。
import { existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import { scanCustomNodes } from '../services/customNodeScanner'
import { scanAiGeneratedNodes } from '../services/aiGeneratedScanner'
import { forkBuiltinNode } from '../services/forkNode'
import type { NodeSpecV2 } from '@shared/types/nodeV2'
import { tryIpc, tryIpcAsync } from './_shared'
import { customNodeProjectPathSchema, customNodeForkSchema } from '../schemas/customNode'
import { assertWithinProject } from '../services/infra/pathGuard'

/**
 * aiGeneratedScanner 注入槽：默认实现为 scanAiGeneratedNodes（扫描 plugins/ai-* 插件包）。
 * 测试用 setAiGeneratedScanner 注入 stub 验证 IPC 行为。
 */
export type AiScannerFn = (projectPath: string) => Promise<NodeSpecV2[]>

const aiScannerSlot: { fn: AiScannerFn | null } = { fn: null }

/** 注入 AI 生成节点的扫描器（传 null 还原默认实现）。 */
export function setAiGeneratedScanner(fn: AiScannerFn | null): void {
  aiScannerSlot.fn = fn
}

interface WatchEntry {
  watcher: FSWatcher
  senderWebContentsId: number
  onClosed: () => void
}

/** 按插件根目录（{project}/plugins）索引的监听器。 */
const watchers = new Map<string, WatchEntry>()

/** 测试用：关掉所有监听器（生产路径只会在窗口关闭时逐个关）。 */
export function closeAllWatchersForTesting(): void {
  for (const entry of watchers.values()) {
    try {
      entry.watcher.close()
    } catch {
      // 关不掉也不影响后续断言：watch 只是个通知通道
    }
  }
  watchers.clear()
}

/**
 * 监听插件根目录 {project}/plugins。
 *
 * 插件包布局是 plugins/<pluginName>/{manifest.json,index.js}，改动发生在包内，
 * 因此优先使用递归监听；平台/Node 不支持 recursive 时退化为只监听该目录本身。
 *
 * @returns FSWatcher；调用方负责 close（见 closeAllWatchersForTesting）
 */
function watchPluginsDir(dir: string, listener: () => void): FSWatcher {
  const onEvent = (): void => listener()
  try {
    return watch(dir, { recursive: true }, onEvent)
  } catch {
    return watch(dir, onEvent)
  }
}

function findWindowByWebContentsId(id: number): BrowserWindow | null {
  const hit = BrowserWindow.getAllWindows().find((w) => w.webContents.id === id)
  return hit && !hit.isDestroyed() ? hit : null
}

/** 关掉某个插件目录上的监听器，并摘掉挂在旧窗口上的 closed 回调。 */
function closeEntry(pluginsDir: string): void {
  const entry = watchers.get(pluginsDir)
  if (!entry) return
  try {
    entry.watcher.close()
  } catch {
    // 同上：关不掉不影响后续
  }
  findWindowByWebContentsId(entry.senderWebContentsId)?.off('closed', entry.onClosed)
  watchers.delete(pluginsDir)
}

export function registerCustomNodeIpc(baseDir?: string): void {
  const guardProjectPath = (projectPath: string): void => {
    if (baseDir) assertWithinProject(baseDir, projectPath)
  }

  ipcMain.handle('customNode:scan', async (_event, payload: unknown) => {
    const parsed = customNodeProjectPathSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    guardProjectPath(parsed.data.projectPath)
    return tryIpcAsync(() => scanCustomNodes(parsed.data.projectPath))
  })

  /**
   * 扫描"AI 生成的节点"（plugins/ai-*）。
   *
   * 与 customNode:scan 分开是**有意的**：扫描用户手写的插件包是廉价的，
   * 而 AI 生成的节点要额外读 manifest、校验来源与版本，慢得多 ——
   * 界面可以先用 scan 把列表画出来，再异步补上这一块。
   */
  ipcMain.handle('customNode:scanAiGenerated', async (_event, payload: unknown) => {
    const parsed = customNodeProjectPathSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    guardProjectPath(parsed.data.projectPath)
    return tryIpcAsync(() =>
      (aiScannerSlot.fn ?? scanAiGeneratedNodes)(parsed.data.projectPath),
    )
  })

  ipcMain.handle('customNode:watch', async (event, payload: unknown) => {
    const parsed = customNodeProjectPathSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    guardProjectPath(parsed.data.projectPath)
    const pluginsDir = join(parsed.data.projectPath, 'plugins')
    if (!existsSync(pluginsDir)) return { ok: true, data: null }
    return tryIpc(() => {
      const senderWin = BrowserWindow.fromWebContents(event.sender)
      if (!senderWin) return null
      // 同一项目重复 watch：先收掉旧的，否则改动会推给两个窗口/两次
      closeEntry(pluginsDir)
      const watcher = watchPluginsDir(pluginsDir, () => {
        if (!senderWin.isDestroyed()) {
          senderWin.webContents.send('customNode:changed', {
            projectPath: parsed.data.projectPath,
          })
        }
      })
      const onClosed = (): void => closeEntry(pluginsDir)
      senderWin.on('closed', onClosed)
      watchers.set(pluginsDir, {
        watcher,
        senderWebContentsId: event.sender.id,
        onClosed,
      })
      return null
    })
  })

  ipcMain.handle('customNode:unwatch', async (_event, payload: unknown) => {
    const parsed = customNodeProjectPathSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    guardProjectPath(parsed.data.projectPath)
    closeEntry(join(parsed.data.projectPath, 'plugins'))
    return { ok: true, data: null }
  })

  ipcMain.handle('customNode:fork', async (_event, payload: unknown) => {
    const parsed = customNodeForkSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    guardProjectPath(parsed.data.projectPath)
    return tryIpcAsync(async () => {
      const result = await forkBuiltinNode(
        parsed.data.projectPath,
        parsed.data.builtinKind,
        parsed.data.newName,
      )
      if (!result.success) throw new Error(result.error ?? 'fork 失败')
      return { newKind: result.newKind }
    })
  })
}
