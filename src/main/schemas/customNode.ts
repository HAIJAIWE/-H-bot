// src/main/schemas/customNode.ts
import { z } from 'zod'

export const customNodeProjectPathSchema = z.object({
  projectPath: z.string().min(1)
})

export const customNodeForkSchema = z.object({
  projectPath: z.string().min(1),
  builtinKind: z.string().min(1),
  newName: z.string().min(1)
})
