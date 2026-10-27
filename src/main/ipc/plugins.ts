// src/main/ipc/plugins.ts
import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { access, mkdir, readFile, copyFile, readdir } from 'fs/promises'
import { join, basename } from 'path'
import { constants } from 'fs'
import { scanPlugins, loadPluginPackage } from '../services/plugins/pluginScanner'
import {
  readWindowPackageSource,
  scanWindowPackages,
} from '../services/plugins/windowPackageScanner'
import { pluginReadWindowEntrySchema } from '../schemas/plugins'
import { detectPluginKind } from '@shared/plugins/kind'
import {
  aiPluginIdOf,
  loadAiPluginPackage,
  setAiPluginEnabledByName,
  unloadAiPluginByName,
} from '../services/plugins/aiPluginLoader'
import {
  listMainPlugins,
  pluginOwnedToolNames,
  setMainPluginEnabled,
} from '../services/plugins/host'
import {
  readPluginSettingsView,
  savePluginSettingsValues,
} from '../services/plugins/settingsService'
import { addressabilityOf } from '../services/plugins/layers'
import { DEFAULT_HOST_PLUGINS } from '../services/plugins/defaults'
import { saveSchema } from '../services/project/dataService'
import {
  registerPlugin,
  unregisterPlugin,
  setPluginEnabled,
  getPluginInfos,
  getAllPluginSpecs,
} from '../services/plugins/pluginLoader'
import { tryIpc, tryIpcAsync, errorMessage } from './_shared'
import { assertOpenPathSafe, assertWithinProject } from '../services/infra/pathGuard'
import { createCustomNode } from '../services/plugins/customNodeScaffold'
import {
  addMarketSource,
  inspectMarketPlugin,
  installMarketPlugin,
  listMarketPlugins,
  removeMarketSource,
  uninstallMarketPlugin,
  type MarketResult,
} from '../services/plugins/market'
import {
  pluginScanSchema,
  pluginCreateNodeSchema,
  pluginLoadSchema,
  pluginLoadAiSchema,
  pluginUnloadSchema,
  pluginInstallSchema,
  pluginSetEnabledSchema,
  pluginSetHostEnabledSchema,
  pluginGetSettingsSchema,
  pluginSaveSettingsSchema,
  pluginMarketSourceSchema,
  pluginMarketInstallSchema,
  pluginMarketInspectSchema,
  pluginMarketInstallConfirmedSchema,
  saveSchemaSchema,
} from '../schemas/plugins'

export function registerPluginIpc(): void {
  /** plugin:scan — 扫描已安装插件 */
  ipcMain.handle('plugin:scan', async (_event, payload: { projectPath: string }) => {
    const parsed = pluginScanSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    try {
      const result = await scanPlugins(parsed.data.projectPath)
      // data 保持为插件数组（向后兼容），errors 透传给 UI 层展示
      return { ok: true, data: result.plugins, errors: result.errors }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  /**
   * plugin:createNode — 新建一个可编辑的自定义节点骨架（plugins/<名>/{manifest.json,index.js}）。
   * 给**人**用的入口：代码面板原来只有只读文件，用户"没地方写代码"（2026-10-02 反馈）。
   */
  ipcMain.handle(
    'plugin:createNode',
    async (_event, payload: { projectPath: string; name: string; label?: string }) => {
      const parsed = pluginCreateNodeSchema.safeParse(payload)
      if (!parsed.success) {
        return { ok: false, error: '节点名只能是小写字母开头、含小写字母/数字/连字符' }
      }
      return tryIpcAsync(() =>
        createCustomNode(parsed.data.projectPath, parsed.data.name, parsed.data.label),
      )
    },
  )

  /** plugin:load — 加载指定插件 */
  ipcMain.handle('plugin:load', async (_event, payload: { pluginPath: string }) => {
    const parsed = pluginLoadSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const result = await loadPluginPackage(parsed.data.pluginPath)
      if (!result.package) {
        // 将结构化错误信息合并后返回给 UI
        const errMsg = result.errors.map(e => e.message).join('; ') || '加载插件失败：无效的插件包'
        throw new Error(errMsg)
      }
      const pkg = result.package
      const success = registerPlugin(pkg, parsed.data.pluginPath)
      if (!success) {
        throw new Error(`插件 "${pkg.name}" 加载失败（可能已加载）`)
      }
      return pkg
    })
  })

  /**
   * plugin:loadAi — 装载 **AI 插件**包（清单 ai:true，入口导出 activate(api)）。
   *
   * 与 plugin:load 分开：节点插件走 PluginPackage/节点注册表；AI 插件走沙箱 activate，
   * 贡献的工具注册进 agent-core 的工具表。两条装载路径返回形状不同，不硬塞进一个通道。
   */
  ipcMain.handle('plugin:loadAi', async (_event, payload: { pluginPath: string }) => {
    const parsed = pluginLoadAiSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const manifestPath = join(parsed.data.pluginPath, 'manifest.json')
      let manifest: unknown
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      } catch {
        throw new Error('读不到插件清单: ' + manifestPath)
      }
      const kind = detectPluginKind(manifest)
      if (kind.kind !== 'ai') {
        throw new Error('这不是 AI 插件包（清单需要 "ai": true）')
      }
      const m = manifest as {
        name?: string
        version?: string
        entry?: string
        description?: string
        /** 透传给装载器：能力声明与参数表单都在清单里，少传一项界面就少一块 */
        permissions?: unknown
        settings?: unknown
      }
      if (!m.name || !m.entry) throw new Error('AI 插件清单缺少 name/entry')
      /**
       * 幂等：界面启动时会按"安装记录"逐个重放装载（重启后列表还在）。
       * 已装过的直接返回成功，不重复 activate（否则会撞 "already registered"）。
       */
      const existingId = aiPluginIdOf(m.name)
      if (listMainPlugins().some(p => p.id === existingId)) {
        return { pluginId: existingId, name: m.name }
      }
      const result = await loadAiPluginPackage(parsed.data.pluginPath, {
        name: m.name,
        version: m.version ?? '0.0.0',
        entry: m.entry,
        ai: true,
        ...(m.description ? { description: m.description } : {}),
        // 手工装载（plugin:loadAi）也必须带上这两项：市场装载走的是另一条路，
        // 少了它们，「权限徽标 / 设置按钮」只在市场装的插件上出现，手工装的一律没有
        ...(m.permissions !== undefined ? { permissions: m.permissions } : {}),
        ...(m.settings !== undefined ? { settings: m.settings } : {}),
      })
      if (!result.ok) throw new Error(result.error)
      // 带上清单里的 name：界面要按名字启停（plugin:setEnabled 的入参是插件名）
      return { pluginId: result.pluginId, name: m.name }
    })
  })

  /** plugin:unload — 卸载指定插件 */
  ipcMain.handle('plugin:unload', async (_event, payload: { pluginName: string }) => {
    const parsed = pluginUnloadSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      // 卸载同样先找 AI 插件（撤销贡献 + 桥/上下文 cleanup），找不到再回落节点插件
      if (unloadAiPluginByName(parsed.data.pluginName)) {
        return { name: parsed.data.pluginName }
      }
      const success = unregisterPlugin(parsed.data.pluginName)
      if (!success) {
        throw new Error(`插件 "${parsed.data.pluginName}" 未加载`)
      }
      return { name: parsed.data.pluginName }
    })
  })

  /** plugin:install — 从本地目录安装插件 */
  ipcMain.handle('plugin:install', async (event, payload: { projectPath: string }) => {
    const parsed = pluginInstallSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const openResult = win
        ? await dialog.showOpenDialog(win, {
            title: '选择插件目录',
            properties: ['openDirectory'],
          })
        : await dialog.showOpenDialog({
            title: '选择插件目录',
            properties: ['openDirectory'],
          })

      if (openResult.canceled || openResult.filePaths.length === 0) {
        throw new Error('用户取消')
      }

      const sourceDir = openResult.filePaths[0]
      const sourceName = basename(sourceDir)

      // 路径安全校验：sourceDir 不在系统关键目录
      assertOpenPathSafe(sourceDir)

      // IPC-8 修复：检查是否有 manifest.json（异步）
      const manifestPath = join(sourceDir, 'manifest.json')
      try {
        await access(manifestPath, constants.F_OK)
      } catch {
        throw new Error('所选目录中没有 manifest.json，不是有效的插件包')
      }

      // 验证 manifest（异步读取）
      try {
        const raw = await readFile(manifestPath, 'utf-8')
        const manifest = JSON.parse(raw)
        if (!manifest.name || !manifest.version) {
          throw new Error('manifest.json 缺少 name 或 version 字段')
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('manifest.json')) {
          throw e
        }
        throw new Error(`读取 manifest.json 失败: ${e instanceof Error ? e.message : String(e)}`)
      }

      // 复制到项目 plugins 目录（异步）
      const pluginsDir = join(parsed.data.projectPath, 'plugins')
      try {
        await access(pluginsDir, constants.F_OK)
      } catch {
        await mkdir(pluginsDir, { recursive: true })
      }

      const targetDir = join(pluginsDir, sourceName)

      // 路径安全校验：targetDir 必须在项目内
      assertWithinProject(parsed.data.projectPath, targetDir)
      try {
        await access(targetDir, constants.F_OK)
        throw new Error(`插件目录 "${sourceName}" 已存在`)
      } catch (e) {
        // access 抛出错误说明目录不存在，这是期望的
        if (e instanceof Error && e.message.includes('已存在')) {
          throw e
        }
        // 目录不存在，继续
      }

      // 递归复制目录（异步）
      await copyDir(sourceDir, targetDir)

      // 尝试加载
      const result = await loadPluginPackage(targetDir)
      if (!result.package) {
        // 将结构化错误信息合并后返回给 UI
        const errMsg = result.errors.map(e => e.message).join('; ') || '插件加载失败'
        throw new Error(errMsg)
      }
      const pkg = result.package
      registerPlugin(pkg, targetDir)

      return { name: pkg.name, version: pkg.version, path: targetDir }
    })
  })

  /** plugin:listInstalled — 列出已加载插件 */
  ipcMain.handle('plugin:listInstalled', async () => {
    return tryIpc(() => getPluginInfos())
  })

  /**
   * plugin:listWindows — **外部窗口包**清单（第 73 批，P4 加载器 v1）。
   *
   * 只扫盘 + 校验声明，**不执行任何第三方代码**：清单里的 layout/parts 由渲染层用
   * 宿主自己的组件画出来。目录：`<userData>/plugins/windows/<目录>/manifest.json`。
   * 坏清单进 `issues` 而不是让整个调用失败 —— 一个坏包不该让全部窗口消失。
   */
  ipcMain.handle('plugin:listWindows', async () => {
    return tryIpcAsync(() =>
      scanWindowPackages(join(app.getPath('userData'), 'plugins', 'windows')),
    )
  })

  /**
   * plugin:readWindowEntry — 读**可执行窗口包**的入口源码（第 74 批，P4b-1）。
   *
   * 主进程只负责"把包里的一个文件按规则读成字符串"：路径穿越、符号链接逃逸、
   * 体积上限都在 `readWindowPackageSource` 里挡住；执行发生在渲染层的 Blob worker 里，
   * 主进程不 eval、不 require。
   */
  ipcMain.handle('plugin:readWindowEntry', async (_event, payload: unknown) => {
    const parsed = pluginReadWindowEntrySchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() =>
      readWindowPackageSource(join(app.getPath('userData'), 'plugins', 'windows'), parsed.data.id),
    )
  })

  /** plugin:setEnabled — 启用/禁用插件 */
  ipcMain.handle(
    'plugin:setEnabled',
    async (_event, payload: { pluginName: string; enabled: boolean }) => {
      const parsed = pluginSetEnabledSchema.safeParse(payload)
      if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
      return tryIpcAsync(async () => {
        const { pluginName, enabled } = parsed.data
        /**
         * **可寻址才可写**（Phase A，语义对齐 DSH plugin-manager）：
         * 启停的本质是往覆盖层写一行 `{ id, disabled }` —— 没有可写的 patchId，
         * 就没有"改哪一行"，只能只读。可写集合 = 内置宿主插件默认层（随应用构建）
         * + 运行时插件层（装载时登记，例如 AI 插件）。
         *
         * AI 插件回传的是**插件名**（manifest.name），落到覆盖层的 id 是派生的
         * `ai.<slug>`；运行时插件不在默认清单里，所以这里把它的运行时 id 显式并进层
         * 集合 —— 这不是"默认可写"，而是"它由装载流程登记、属于可管理的运行时层"。
         * 今天所有宿主插件都落在这两层里；将来若出现管理端托管/本地只读的插件，
         * 这条检查会按结构原因拒绝（下面的 unaddressable），而不是让调用像成功一样。
         */
        const runtimeId = aiPluginIdOf(pluginName)
        const addressability = addressabilityOf(runtimeId, [
          ...DEFAULT_HOST_PLUGINS,
          { id: runtimeId },
        ])
        if ('readOnlyReason' in addressability) {
          /**
           * IpcErr 的 `error` 是 string（见 ipc/_shared.ts），不能嵌套 `{ code }`；
           * 把闭合枚举的 code 写进文案，调用方仍可按 code 匹配、按原因给不同动作。
           */
          throw new Error(
            `插件 "${pluginName}" 不可寻址（${addressability.readOnlyReason}）：` +
              '没有可写的 patchId，只能只读',
          )
        }
        /**
         * AI 插件与节点插件共用这一个启停入口：先按 AI 插件找（id = ai.<name>），
         * 找到就走主进程插件宿主（会调 cleanup：桥与沙箱上下文一起收掉）+ 写应用级覆盖；
         * 找不到再回落节点插件。
         */
        if (await setAiPluginEnabledByName(pluginName, enabled)) {
          return { name: pluginName, enabled }
        }
        const success = setPluginEnabled(pluginName, enabled)
        if (!success) {
          throw new Error(`插件 "${pluginName}" 未加载`)
        }
        return { name: pluginName, enabled }
      })
    },
  )

  /** plugin:getAllSpecs — 获取所有已加载插件的 NodeSpec */
  ipcMain.handle('plugin:getAllSpecs', async () => {
    return tryIpc(() => getAllPluginSpecs())
  })

  /**
   * plugin:listHost — **宿主插件**清单（只读展示用）。
   *
   * 与节点包分开：宿主插件是应用级能力（工具/提示），界面只展示"有哪些、什么来源、
   * 为什么不能停"；runtime 的 AI 插件由 plugin:loadAi 那条链管理。
   */
  ipcMain.handle('plugin:listHost', async () => {
    return tryIpc(() =>
      listMainPlugins().map(p => {
        const address = addressabilityOf(p.id, DEFAULT_HOST_PLUGINS)
        return {
          id: p.id,
          name: p.name,
          version: p.version,
          enabled: p.enabled,
          source: p.source,
          // 权限声明 / 参数表单 / 它贡献了哪些工具：都来自清单，界面只负责展示
          permissions: p.permissions ?? [],
          settings: p.settings ?? [],
          tools: pluginOwnedToolNames(p.id),
          ...('readOnlyReason' in address ? { readOnlyReason: address.readOnlyReason } : {}),
        }
      }),
    )
  })

  /**
   * plugin:setHostEnabled — 启停**宿主插件**（2026-10-20）。
   *
   * 只在默认层里"可寻址"的插件才允许（not-removable 的由 setMainPluginEnabled 拒绝，
   * 界面无需再判一次；错误沿 ApiResult 返回）。停用 = 内核级卸载：它贡献的工具真的消失。
   */
  ipcMain.handle('plugin:setHostEnabled', async (_e, payload: { id: string; enabled: boolean }) => {
    const parsed = pluginSetHostEnabledSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpc(() => {
      setMainPluginEnabled(parsed.data.id, parsed.data.enabled)
      return null
    })
  })

  /**
   * plugin:getSettings — 读一个宿主插件的设置声明与当前值（2026-10-25，插件表单化）。
   *
   * 顺序有意：**内存热缓存优先**（那是正在生效的值），缓存空才回落磁盘。
   * 运行时插件没激活时缓存是空的，这时读磁盘至少能让表单显示上次存过的值。
   */
  ipcMain.handle('plugin:getSettings', async (_e, payload: { id: string }) => {
    const parsed = pluginGetSettingsSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    return tryIpcAsync(() => readPluginSettingsView(parsed.data.id))
  })

  /**
   * plugin:saveSettings — 保存宿主插件的设置。
   *
   * 写盘 + 更新内存缓存；缓存就是沙箱桥每次调用读的那份，所以**保存即生效**，
   * 不需要停用/重载插件。写盘失败会让整个调用失败（不能让用户以为存住了）。
   */
  ipcMain.handle(
    'plugin:saveSettings',
    async (_e, payload: { id: string; values: Record<string, unknown> }) => {
      const parsed = pluginSaveSettingsSchema.safeParse(payload)
      if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
      return tryIpcAsync(() => savePluginSettingsValues(parsed.data.id, parsed.data.values))
    },
  )

  /**
   * plugin:marketList — 插件市场清单（官方离线源 + 用户来源合并）。
   *
   * 来源读取失败**不整体失败**：错误按来源放进 sources[].error，
   * 其他来源照常展示 —— 一个坏源不该让整个市场变空。
   */
  ipcMain.handle('plugin:marketList', async () => {
    return tryIpcAsync(() => listMarketPlugins())
  })

  /** plugin:marketAddSource — 添加一个市场来源（不在这里联网校验，列表时按源报错） */
  ipcMain.handle('plugin:marketAddSource', async (_e, payload: { source: string }) => {
    const parsed = pluginMarketSourceSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: '来源不能为空，且不超过 500 字符' }
    return tryIpcAsync(() => unwrapMarket(addMarketSource(parsed.data.source)))
  })

  /** plugin:marketRemoveSource — 删除用户来源（官方离线源不可删） */
  ipcMain.handle('plugin:marketRemoveSource', async (_e, payload: { source: string }) => {
    const parsed = pluginMarketSourceSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: '来源不能为空，且不超过 500 字符' }
    return tryIpcAsync(() => unwrapMarket(removeMarketSource(parsed.data.source)))
  })

  /**
   * plugin:marketInspect — 安装前检查（只读）：版本、来源、文件、摘要、清单、更新关系。
   * 界面拿到这些才让用户点"确认安装"。
   */
  ipcMain.handle('plugin:marketInspect', async (_e, payload: { id: string }) => {
    const parsed = pluginMarketInspectSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: '插件 id 不合法' }
    return tryIpcAsync(() => unwrapMarket(inspectMarketPlugin(parsed.data.id)))
  })

  /**
   * plugin:marketInstall — 安装一个市场插件。
   * 装进来的是**第三方代码**，与 plugin:install 同级：AI 不能直接调用（不进附录 C）。
   * expectDigest 是用户确认时看到的摘要；索引在确认后变了就拒绝，防止 TOCTOU。
   */
  ipcMain.handle(
    'plugin:marketInstall',
    async (_e, payload: { id: string; expectDigest?: string }) => {
      const parsed = pluginMarketInstallConfirmedSchema.safeParse(payload)
      if (!parsed.success) return { ok: false, error: '插件 id 或确认摘要不合法' }
      return tryIpcAsync(() =>
        unwrapMarket(installMarketPlugin(parsed.data.id, undefined, parsed.data.expectDigest)),
      )
    },
  )

  /** plugin:marketUninstall — 卸载市场插件（撤销贡献 + 删目录 + 删记录 + 清覆盖层） */
  ipcMain.handle('plugin:marketUninstall', async (_e, payload: { id: string }) => {
    const parsed = pluginMarketInstallSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: '插件 id 不合法' }
    return tryIpcAsync(() => unwrapMarket(uninstallMarketPlugin(parsed.data.id)))
  })

  /** plugin:saveSchema — 保存插件数据表结构声明 */
  // IPC-1 修复：从 launchData.ts 迁移至此，与 plugin:* 命名空间对齐
  ipcMain.handle(
    'plugin:saveSchema',
    async (_e, projectPath: string, tableName: string, fields: Record<string, unknown>) => {
      const parsed = saveSchemaSchema.safeParse([projectPath, tableName, fields])
      if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
      return tryIpc(() => saveSchema(parsed.data[0], parsed.data[1], parsed.data[2]))
    },
  )
}

/** 市场服务的内部结果 → IPC 的 ApiResult（错误变成 throw，交给 tryIpcAsync 归一） */
async function unwrapMarket<T>(pending: Promise<MarketResult<T>>): Promise<T> {
  const result = await pending
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** 递归复制目录（异步，IPC-8 修复） */
async function copyDir(src: string, dest: string): Promise<void> {
  try {
    await access(dest, constants.F_OK)
  } catch {
    await mkdir(dest, { recursive: true })
  }
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await copyFile(srcPath, destPath)
    }
  }
}
