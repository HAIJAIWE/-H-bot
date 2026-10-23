// src/main/schemas/napcatDownload.ts
import { z } from 'zod'

/** napcat:download —— 只需项目路径（下载到 {projectPath}/napcat） */
export const downloadNapcatSchema = z.object({ projectPath: z.string().min(1) })
