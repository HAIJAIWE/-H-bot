// src/main/schemas/linter.ts
import { z } from 'zod'

/** linter:check 入参 schema */
export const lintSchema = z.object({
  projectPath: z.string().min(1),
  filePath: z.string().min(1),
  content: z.string()
})

/** linter:checkPyright 入参 schema */
export const pyrightSchema = z.object({
  projectPath: z.string().min(1),
  filePath: z.string().min(1)
})
