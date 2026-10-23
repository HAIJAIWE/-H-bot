// src/main/schemas/adapter.ts
import { z } from 'zod'

export const adapterSwitchSchema = z.object({
  type: z.string().min(1)
})
