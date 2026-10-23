// src/main/schemas/launchDashboard.ts
import { z } from 'zod'

export const launchDashboardProjectPathSchema = z.tuple([z.string().min(1)])
