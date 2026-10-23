// src/main/schemas/launchBackup.ts
import { z } from 'zod'

export const backupCreateSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1)
])

export const backupListSchema = z.tuple([z.string().min(1)])

export const backupRestoreSchema = z.tuple([
  z.string().min(1),
  z.string().min(1)
])

export const backupSnapshotSchema = z.tuple([
  z.string().min(1),
  z.string().min(1).optional()
])
