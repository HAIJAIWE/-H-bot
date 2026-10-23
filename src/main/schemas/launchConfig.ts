// src/main/schemas/launchConfig.ts
import { z } from 'zod'

export const listConfigCategoriesSchema = z.tuple([z.string().min(1)])

export const previewConfigTablesSchema = z.tuple([
  z.union([z.literal('functional'), z.literal('game')]),
  z.string().min(1).optional()
])

export const listLayerTemplatesSchema = z.tuple([z.string().min(1)])

export const getConfigTableSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.number().int().min(1),
  z.number().int().min(1)
])

export const getConfigSchemaSchema = z.tuple([
  z.string().min(1),
  z.string().min(1)
])

export const updateConfigRecordSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.number().int().nonnegative(),
  z.record(z.string(), z.unknown())
])

export const insertConfigRecordSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.record(z.string(), z.unknown())
])

export const deleteConfigRecordSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.number().int().nonnegative()
])

const fieldDefinitionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['integer', 'real', 'text', 'boolean', 'json', 'enum']),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  notNull: z.boolean().optional(),
  enumValues: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional()
})

export const createConfigTableSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.array(fieldDefinitionSchema)
])

export const dropConfigTableSchema = z.tuple([
  z.string().min(1),
  z.string().min(1)
])

export const renameConfigTableSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1)
])

export const alterConfigTableSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.object({
    addFields: z.array(fieldDefinitionSchema).optional(),
    dropFields: z.array(z.string().min(1)).optional(),
    updateFields: z.array(fieldDefinitionSchema).optional()
  })
])
