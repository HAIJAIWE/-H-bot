// src/main/schemas/aiProvider.ts
import { z } from 'zod'

const aiProviderConfigSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().optional()
})

export const aiProviderTestSchema = aiProviderConfigSchema

export const aiProviderSwitchSchema = z.object({
  provider: z.string().min(1),
  config: aiProviderConfigSchema
})
