// src/main/schemas/stateStore.ts
import { z } from 'zod'

/**
 * stateStore key 命名空间规则。
 *
 * P1 修复（2026-07-24）：禁止任意 key 写入，要求 key 必须符合
 * `<namespace>:<name>` 格式。namespace 限定为白名单，防止不同模块
 * 之间的 key 冲突或被恶意覆盖内部状态。
 */
const ALLOWED_NAMESPACES = [
  'bot',        // bot 运行状态
  'ui',         // 前端 UI 状态
  'user',       // 用户自定义状态
  'plugin',     // 插件状态
  'runtime',    // 运行时状态
  'session',    // 会话状态（保留，实际由 setSessionVar 使用）
] as const

const stateKeyRegex = /^[a-zA-Z_][a-zA-Z0-9_]*:[a-zA-Z_][a-zA-Z0-9_]*$/

export const stateKeySchema = z.string()
  .min(1)
  .regex(
    stateKeyRegex,
    "key 必须符合 '<namespace>:<name>' 格式，且只能包含字母、数字、下划线"
  )
  .refine(
    (key) => {
      const namespace = key.split(':')[0]
      return ALLOWED_NAMESPACES.includes(namespace as typeof ALLOWED_NAMESPACES[number])
    },
    { message: `key namespace 必须是以下之一：${ALLOWED_NAMESPACES.join(', ')}` }
  )

export const stateStoreSetSchema = z.object({
  projectPath: z.string().min(1),
  key: stateKeySchema,
  value: z.unknown(),
})

export const stateStoreGetSchema = z.object({
  projectPath: z.string().min(1),
  key: stateKeySchema,
})

export const stateStoreDeleteSchema = z.object({
  projectPath: z.string().min(1),
  key: stateKeySchema,
})

export const stateStoreListKeysSchema = z.object({
  projectPath: z.string().min(1),
  prefix: z.string().optional(),
  // IPC-7 修复：添加分页支持
  limit: z.number().int().min(1).max(10000).optional(),
  offset: z.number().int().min(0).optional(),
})

export const stateStoreSetSessionVarSchema = z.object({
  projectPath: z.string().min(1),
  sessionId: z.string().min(1),
  varName: z.string().min(1),
  value: z.unknown(),
})

export const stateStoreGetSessionVarSchema = z.object({
  projectPath: z.string().min(1),
  sessionId: z.string().min(1),
  varName: z.string().min(1),
})

export const stateStoreClearSessionSchema = z.object({
  projectPath: z.string().min(1),
  sessionId: z.string().min(1),
})

export const stateStoreProjectOnlySchema = z.object({
  projectPath: z.string().min(1),
})

// IPC-7 修复：getAllStateEntries 支持分页
export const stateStoreGetAllEntriesSchema = z.object({
  projectPath: z.string().min(1),
  limit: z.number().int().min(1).max(10000).optional(),
  offset: z.number().int().min(0).optional(),
})
