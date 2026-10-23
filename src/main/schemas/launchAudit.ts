// src/main/schemas/launchAudit.ts
import { z } from 'zod'

// audit:log 的 entry 字段保持宽松校验：service 层负责具体字段约束，
// schema 层仅确保入参是对象，避免破坏测试/调用方传入的扩展字段。
export const auditLogSchema = z.tuple([
  z.string().min(1),
  z.record(z.string(), z.unknown())
])

export const auditListSchema = z.tuple([
  z.string().min(1),
  z.number().int().min(1),
  z.number().int().min(1)
])

export const auditSearchSchema = z.tuple([
  z.string().min(1),
  z.string().min(1)
])
