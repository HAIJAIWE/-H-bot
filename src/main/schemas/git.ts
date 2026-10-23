// src/main/schemas/git.ts
import { z } from 'zod'

export const gitInitSchema = z.object({
  projectPath: z.string().min(1)
})

export const gitLogSchema = z.object({
  projectPath: z.string().min(1),
  maxCount: z.number().int().positive().optional().default(20)
})

export const gitStatusSchema = z.object({
  projectPath: z.string().min(1)
})

export const gitDiffSchema = z.object({
  projectPath: z.string().min(1),
  hash: z.string().min(1)
})


/**
 * 读档：hash 只允许十六进制（git 短/长 hash），避免被当成任意 revision 表达式注入
 */
export const gitRestoreFlowSchema = z.object({
  projectPath: z.string().min(1),
  hash: z.string().min(4).max(64).regex(/^[0-9a-fA-F]+$/, 'hash 必须是十六进制提交号')
})

export const gitClearHistorySchema = z.object({
  projectPath: z.string().min(1)
})

/**
 * 删除若干条提交（可单条、可多条）。
 *
 * 上限 200：历史列表最多展示 50 条，给足余量；同时避免一次传进来一个巨长数组。
 */
export const gitDeleteCommitsSchema = z.object({
  projectPath: z.string().min(1),
  hashes: z
    .array(z.string().min(4).max(64).regex(/^[0-9a-fA-F]+$/, 'hash 必须是十六进制提交号'))
    .min(1)
    .max(200)
})

/** 版本名：交给 git 之前的语法把关（语义校验在服务层，因为要查重名） */
export const tagNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\s~^:?*[\\]+$/, '版本名不能含空格或 ~ ^ : ? * [ \\ 等字符')
  .refine((n) => !n.startsWith('-') && !n.includes('..'), {
    message: '版本名不能以 - 开头，也不能含 ..'
  })

export const gitListVersionTagsSchema = z.object({
  projectPath: z.string().min(1)
})

/** 打版本：name 省略时由服务按已有标签自动取下一个（v1.0 → v1.1） */
export const gitTagVersionSchema = z.object({
  projectPath: z.string().min(1),
  name: tagNameSchema.optional(),
  message: z.string().max(2000).optional()
})

export const gitRenameVersionTagSchema = z.object({
  projectPath: z.string().min(1),
  oldName: tagNameSchema,
  newName: tagNameSchema
})

export const gitDeleteVersionTagSchema = z.object({
  projectPath: z.string().min(1),
  name: tagNameSchema
})

/** 重命名一条提交的说明（只改正文） */
export const gitRewordCommitSchema = z.object({
  projectPath: z.string().min(1),
  hash: z.string().min(4).max(64).regex(/^[0-9a-fA-F]+$/, 'hash 必须是十六进制提交号'),
  message: z.string().min(1).max(5000)
})
