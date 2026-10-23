import { z } from 'zod'

export const startOfficialSchema = z.object({
  projectPath: z.string().min(1)
})

export const stopOfficialSchema = z.object({
  projectPath: z.string().min(1)
})

export const getOfficialStatusSchema = z.object({
  projectPath: z.string().min(1)
})

export const saveOfficialConfigSchema = z.object({
  projectPath: z.string().min(1),
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  sandbox: z.boolean().optional(),
  wsUrl: z.string().optional()
})

export const testOfficialConnectionSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1)
})

export const sendOfficialMessageSchema = z.object({
  projectPath: z.string().min(1),
  chatType: z.enum(['c2c', 'group']),
  chatId: z.string().min(1),
  content: z.string().optional().default(''),
  msgType: z.number().optional(),
  eventId: z.string().optional(),
  msgId: z.string().optional(),
  msgSeq: z.number().optional(),
  media: z.object({ fileInfo: z.string() }).optional(),
  markdown: z.object({ content: z.string() }).optional(),
  keyboard: z.record(z.string(), z.unknown()).optional(),
  messageReference: z.object({ message_id: z.string() }).optional()
})

export const uploadOfficialFileSchema = z.object({
  projectPath: z.string().min(1),
  chatType: z.enum(['c2c', 'group']),
  chatId: z.string().min(1),
  fileType: z.number().int().min(1).max(4),
  url: z.string().min(1),
  fileName: z.string().optional()
})

export const sendOfficialMediaSchema = z.object({
  projectPath: z.string().min(1),
  chatType: z.enum(['c2c', 'group']),
  chatId: z.string().min(1),
  mediaUrl: z.string().min(1),
  fileType: z.number().int().min(1).max(4),
  fileName: z.string().optional(),
  eventId: z.string().optional(),
  msgId: z.string().optional()
})

export const recallOfficialMessageSchema = z.object({
  projectPath: z.string().min(1),
  chatType: z.enum(['c2c', 'group']),
  chatId: z.string().min(1),
  msgId: z.string().min(1)
})

export const startOfficialTranslatorSchema = z.object({
  projectPath: z.string().min(1),
  port: z.number().int().min(1).max(65535)
})

export const stopOfficialTranslatorSchema = z.object({})

export const getOfficialTranslatorStatusSchema = z.object({})
