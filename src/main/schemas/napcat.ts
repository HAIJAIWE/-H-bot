// src/main/schemas/napcat.ts
// NapCat 生命周期 IPC 的参数校验。全部只按项目路径操作（一个项目一套 NapCat 实例）。
import { z } from 'zod'

const projectPath = z.object({ projectPath: z.string().min(1) })

export const startNapcatSchema = projectPath
export const stopNapcatSchema = projectPath
export const getNapcatStatusSchema = projectPath

/** napcat:setPath —— 自定义 NapCat 可执行文件/目录路径 */
export const setNapcatPathSchema = z.object({ path: z.string().min(1) })
