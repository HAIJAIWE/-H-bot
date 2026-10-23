// src/main/schemas/buttonPanel.ts
import { z } from 'zod'

const projectPathOnlySchema = z.tuple([z.string().min(1)])

const projectPathAndPanelIdSchema = z.tuple([z.string().min(1), z.string().min(1)])

const buttonSchema = z.object({
  id: z.string(),
  render_data: z.object({
    label: z.string(),
    visited_label: z.string().optional(),
    style: z.union([z.literal(0), z.literal(1)]).optional()
  }),
  action: z.object({
    type: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    permission: z.object({
      type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      specify_role_ids: z.array(z.string()).optional(),
      specify_user_ids: z.array(z.string()).optional()
    }),
    click_limit: z.number().optional(),
    data: z.string(),
    at_bot_show_channel_list: z.boolean().optional()
  })
})

const inlineKeyboardSchema = z.object({
  rows: z.array(z.object({ buttons: z.array(buttonSchema) }))
})

const createPayloadSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  keyboard: inlineKeyboardSchema.optional()
})

const updatePayloadSchema = z.object({
  panelId: z.string().min(1),
  patch: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    keyboard: inlineKeyboardSchema.optional()
  }).optional()
})

export const buttonPanelListSchema = projectPathOnlySchema
export const buttonPanelGetSchema = projectPathAndPanelIdSchema
export const buttonPanelCreateSchema = z.tuple([z.string().min(1), createPayloadSchema])
export const buttonPanelUpdateSchema = z.tuple([z.string().min(1), updatePayloadSchema])
export const buttonPanelDeleteSchema = projectPathAndPanelIdSchema
export const buttonPanelDuplicateSchema = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1).optional()])
export const buttonPanelImportBuiltinSchema = z.tuple([z.string().min(1), z.array(z.string()).optional()])
