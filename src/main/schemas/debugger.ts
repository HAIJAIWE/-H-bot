// src/main/schemas/debugger.ts
import { z } from 'zod'

export const setBreakpointsSchema = z.array(
  z.object({
    nodeId: z.string().min(1),
    enabled: z.boolean(),
    condition: z.string().optional()
  })
)
