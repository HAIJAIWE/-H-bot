// src/main/schemas/resourceMonitor.ts
import { z } from 'zod'

export const resourceMonitorStartSchema = z.object({
  pid: z.number().int().positive({ message: 'pid 必须是正整数' })
})

export const resourceMonitorSetConfigSchema = z.object(
  {
    maxMemoryMB: z.number().int().positive().optional(),
    maxCPUPercent: z.number().min(0).max(100).optional()
  },
  { message: 'config 必须是对象' }
)
