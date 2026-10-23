// src/main/schemas/flowIpc.ts
import { z } from 'zod'

/** IPC 层 projectPath 参数校验（错误信息需与测试对齐） */
const projectPathSchema = z.string().min(1, { message: '参数 projectPath 无效' })

export const flowLoadSchema = z.tuple([projectPathSchema])

/**
 * IPC 层 flow:save 参数校验。
 * 注意：flow 对象在 IPC 层只做宽松校验，完整业务结构校验由 FlowService.saveFlow
 * 负责，避免 IPC schema 与测试/历史最小对象不兼容。
 */
export const flowSaveSchema = z.tuple([
  projectPathSchema,
  z.any()
])
