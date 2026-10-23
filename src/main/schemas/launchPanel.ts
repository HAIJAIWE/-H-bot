// src/main/schemas/launchPanel.ts
import { z } from 'zod'

export const panelListRegisteredSchema = z.tuple([z.string().min(1)])

export const panelGetSchemaSchema = z.tuple([
  z.string().min(1),
  z.string().min(1)
])

export const panelQueryTableSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.number().int().min(1),
  z.number().int().min(1),
  z.number().int().nonnegative().optional()
])

export const panelSavePanelSchema = z.tuple([
  z.string().min(1),
  z.object({
    panelId: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    dataSource: z.string().optional(),
    tableName: z.string().optional()
  })
])
