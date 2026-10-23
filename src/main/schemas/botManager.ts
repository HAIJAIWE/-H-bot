// src/main/schemas/botManager.ts
import { z } from 'zod'

export const botManagerProjectPathSchema = z.object({
  projectPath: z.string().min(1)
})
