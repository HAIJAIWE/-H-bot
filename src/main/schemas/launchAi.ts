// src/main/schemas/launchAi.ts
import { z } from 'zod'

export const executeAiToolSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.record(z.string(), z.unknown())
])
