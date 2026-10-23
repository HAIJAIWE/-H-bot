// src/main/schemas/launchTransfer.ts
import { z } from 'zod'

const dbPathSchema = z.string().min(1)
const tableNameSchema = z.string().min(1)
const externalPathSchema = z.string().min(1)

export const dataExportJsonSchema = z.tuple([dbPathSchema, tableNameSchema, externalPathSchema])
export const dataExportCsvSchema = z.tuple([dbPathSchema, tableNameSchema, externalPathSchema])
export const dataImportJsonSchema = z.tuple([dbPathSchema, tableNameSchema, externalPathSchema])
export const dataImportCsvSchema = z.tuple([dbPathSchema, tableNameSchema, externalPathSchema])
