// src/main/schemas/templates.ts
import { z } from 'zod'
import { flowNodeSchema, flowEdgeSchema } from './flow'

export const templateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  botCategory: z.enum(['functional', 'game']),
  category: z.enum(['入群', '定时', '指令', '消息', '管理', '教学', '其他']),
  tags: z.array(z.string()),
  author: z.string(),
  thumbnail: z.string().optional(),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
  createdAt: z.string(),
  version: z.string()
})

export const templateListSchema = z.tuple([z.string().min(1).optional()])

export const templateByIdSchema = z.tuple([z.string().min(1)])

/**
 * IPC 层 template:save 参数校验。
 * template 对象在 IPC 层只做宽松校验，完整结构校验由 TemplateService 负责，
 * 避免测试/历史最小对象无法通过 IPC schema。
 */
export const templateSaveSchema = z.tuple([
  z.string().min(1),
  z.any()
])

export const templateDeleteSchema = z.tuple([
  z.string().min(1),
  z.string().min(1).optional()
])

/**
 * IPC 层 template:export 参数校验。
 * 同 templateSaveSchema，IPC 层宽松、业务层严格。
 */
export const templateExportSchema = z.tuple([z.any()])
