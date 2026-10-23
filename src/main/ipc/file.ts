// src/main/ipc/file.ts
//
// 本文件按 10/18 编译产物 region `src/main/ipc/file.ts`（out/main/index.js）复刻：
// 恢复树里的旧版只有 read/write/list 三条通道，缺了「框架开发模式」那三条
// （getDevMode / setDevMode / restoreDevBackup），界面一开就报
// "No handler registered for 'file:getDevMode'"。
import { ipcMain } from 'electron'
import {
  readProjectFile,
  writeProjectFile,
  listProjectFiles,
} from '../services/infra/fileOps'
import { readFileSchema, writeFileSchema, listFilesSchema } from '../schemas/file'
import { tryIpcAsync } from './_shared'
import { isWithinProject } from '../services/infra/pathGuard'
import { activeProjectRegistry } from '../services/project/activeProject'
import {
  devModeRequestSchema,
  frameworkRoot,
  isFrameworkDevModeEnabled,
  setFrameworkDevModeEnabled,
} from '../services/devBackup/devMode'
import {
  backupsUsage,
  listDevBackups,
  restoreDevBackup,
  restoreRequestSchema,
} from '../services/devBackup/devBackup'
import { listSecurityCriticalWrites } from '../services/devBackup/securityCriticalWrites'

/**
 * 计算这次文件操作要用的**基准目录**。
 *
 * 框架开发模式**关着**时它恒等于 `baseDir` —— 也就是与改动前**同一次调用、同一个参数**，
 * 所以行为逐字节不变（这是规则①，有测试钉着）。
 *
 * 开着时，只有"目标落在框架根内"的那一类请求改成以**框架根**为基准；
 * 访问机器人项目（`projects/…`）仍然以项目根为基准，走原来的那条路。
 */
function baseDirFor(projectPath: string, baseDir: string | undefined): string | undefined {
  if (!baseDir) return baseDir
  if (isFrameworkDevModeEnabled() && isWithinProject(frameworkRoot(), projectPath)) {
    return frameworkRoot()
  }
  return baseDir
}

export function registerFileIpc(baseDir?: string): void {
  ipcMain.handle('file:read', async (_event, args: unknown) => {
    const parsed = readFileSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    return tryIpcAsync(() => {
      const { projectPath, relativePath } = parsed.data
      const base = baseDirFor(projectPath, baseDir)
      return base
        ? readProjectFile(projectPath, relativePath, base)
        : readProjectFile(projectPath, relativePath)
    })
  })

  /**
   * 写文件。
   *
   * 返回 `{ securityCritical: {...} | null }`：**写到了护栏文件**时带上那条记录
   * （2026-10-16 的护栏可见性），调用方据此给出与普通写入**不同**的警告。
   * 形状是往后兼容的扩展（以前是 `null`），既有调用方忽略 `data` 也不受影响。
   */
  ipcMain.handle('file:write', async (_event, args: unknown) => {
    const parsed = writeFileSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    return tryIpcAsync(async () => {
      const { projectPath, relativePath, content } = parsed.data
      const base = baseDirFor(projectPath, baseDir)
      return {
        securityCritical: await (base
          ? writeProjectFile(projectPath, relativePath, content, base)
          : writeProjectFile(projectPath, relativePath, content)),
      }
    })
  })

  ipcMain.handle('file:list', async (_event, args: unknown) => {
    const parsed = listFilesSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    return tryIpcAsync(() => {
      const { projectPath, relativeDir } = parsed.data
      const base = baseDirFor(projectPath, baseDir)
      return base
        ? listProjectFiles(projectPath, relativeDir, base)
        : listProjectFiles(projectPath, relativeDir)
    })
  })

  /**
   * 读开关 + 框架根 + 现有回退点 + 占用 + **本次会话动过的护栏文件**。
   *
   * 一次给全是有意的：界面要在**同一个渲染帧**里知道"开着吗 / 边界在哪 / 能回滚到哪 /
   * 回退点占了多少 / 我这几轮有没有动到护栏"，分几次读会出现自相矛盾的中间态。
   */
  ipcMain.handle('file:getDevMode', async () =>
    tryIpcAsync(async () => ({
      enabled: isFrameworkDevModeEnabled(),
      frameworkRoot: frameworkRoot(),
      backups: await listDevBackups(),
      usage: await backupsUsage(),
      securityCriticalWrites: listSecurityCriticalWrites(),
    })),
  )

  /**
   * 切换开关。
   *
   * ⚠️ **落盘失败 = 状态不变**（fail-closed，见 devMode.ts 文件头）：
   * 服务只在"写盘 + 读回核对"都成功时才改内存状态；失败时返回 ok:false + 可读原因，
   * 界面刷新后看到的仍是**原状态** —— 绝不允许"界面说关、磁盘说开"。
   */
  ipcMain.handle('file:setDevMode', async (_event, args: unknown) => {
    const parsed = devModeRequestSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const result = setFrameworkDevModeEnabled(parsed.data.enabled)
    if (result.error) return { ok: false, error: result.error }
    /**
     * 关掉模式时：如果主进程镜像里的"当前项目"正指着框架根，把它清掉。
     *
     * 为什么要在主进程做：那个镜像是**隐式保存闸门**（flowSaveGuard）的输入，
     * 留着一个"已失去授权的当前项目"会让闸门继续按框架工作区放行。
     * 渲染层拿到 `leftFrameworkWorkspace` 之后负责把界面退回一个普通项目。
     */
    let leftFrameworkWorkspace = false
    if (!result.enabled) {
      const active = activeProjectRegistry.getActivePath()
      if (active && isWithinProject(frameworkRoot(), active)) {
        activeProjectRegistry.clear()
        leftFrameworkWorkspace = true
      }
    }
    return { ok: true, data: { ...result, leftFrameworkWorkspace } }
  })

  /**
   * 从某个回退点恢复。
   *
   * ⚠️ 服务端会**先把当前内容备份一份**再还原（否则回滚本身成了不可逆操作），
   * 返回的 `rollbackPoint` 就是那份 —— 界面上要告诉用户"你还能再回滚回来"。
   */
  ipcMain.handle('file:restoreDevBackup', async (_event, args: unknown) => {
    const parsed = restoreRequestSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    return tryIpcAsync(() =>
      restoreDevBackup(parsed.data.revisionId, parsed.data.relativePath),
    )
  })
}
