// src/main/schemas/plugins.ts
import { z } from 'zod'
import {
  PLUGIN_DIR_NAME_RE,
  PLUGIN_NAME_MAX_LENGTH,
} from '../services/plugins/pluginNamingContract'

export const pluginScanSchema = z.object({
  projectPath: z.string().min(1),
})

export const pluginLoadSchema = z.object({
  pluginPath: z.string().min(1),
})

/** plugin:loadAi —— 装载一个 **AI 插件**包（清单 ai:true，入口导出 activate(api)） */
export const pluginLoadAiSchema = z.object({
  pluginPath: z.string().min(1),
})

/** plugin:setHostEnabled —— 启停宿主插件（builtin 默认层里可寻址的才允许） */
export const pluginSetHostEnabledSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
})

/**
 * plugin:getSettings —— 读一个已装载宿主插件的**设置声明 + 当前值**。
 * 声明来自插件清单（`settings`），值来自内存热缓存（没有则回落磁盘）。
 */
export const pluginGetSettingsSchema = z.object({
  id: z.string().min(1).max(120),
})

/**
 * plugin:saveSettings —— 保存宿主插件的设置。
 *
 * 这里只挡**形状**（标量值），每个键该是数字还是布尔由插件自己的声明决定；
 * 类型校验在 handler 里用 `coerceSettingValues` 做（它需要声明，schema 拿不到）。
 */
export const pluginSaveSettingsSchema = z.object({
  id: z.string().min(1).max(120),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
})

/** plugin:marketAddSource / plugin:marketRemoveSource —— 一个来源（http(s) 或本地路径） */
export const pluginMarketSourceSchema = z.object({
  source: z.string().min(1).max(500),
})

/** plugin:marketInstall / plugin:marketUninstall —— 市场插件 id */
export const pluginMarketInstallSchema = z.object({
  id: z.string().min(1).max(120),
})

/** plugin:marketInspect —— 只读的安装前检查 */
export const pluginMarketInspectSchema = pluginMarketInstallSchema

/** plugin:marketInstall —— 可以带上确认时看到的摘要，装之前再对一次 */
export const pluginMarketInstallConfirmedSchema = pluginMarketInstallSchema.extend({
  expectDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})

export const pluginUnloadSchema = z.object({
  pluginName: z.string().min(1),
})

export const pluginInstallSchema = z.object({
  projectPath: z.string().min(1),
})

/**
 * plugin:createNode —— 新建一个**人可编辑**的自定义节点骨架。
 *
 * 名字规则走**唯一实现**（pluginNamingContract 的包名规则）：
 * 它会成为目录名，也会拼进节点 kind —— 非法字符在这里就挡住。
 * 不直接写字母表：那正是「同一规则抄四遍、其中两处字母表不同」的来源（P0-12）。
 */
export const pluginCreateNodeSchema = z.object({
  projectPath: z.string().min(1),
  name: z.string().min(1).max(PLUGIN_NAME_MAX_LENGTH).regex(PLUGIN_DIR_NAME_RE),
  label: z.string().max(60).optional(),
})

export const pluginSetEnabledSchema = z.object({
  pluginName: z.string().min(1),
  enabled: z.boolean(),
})

// IPC-1 修复：从 launchData schema 迁移至此，与 plugin:* 命名空间对齐
export const saveSchemaSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.record(z.string(), z.unknown()),
])
