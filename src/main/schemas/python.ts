// src/main/schemas/python.ts
// IPC 参数校验（zod）。字段与 src/renderer/src/types/ipc.ts 的 python 段一一对应。
import { z } from 'zod'

/** python:createVenv —— 渲染层传入项目路径与要使用的解释器路径 */
export const createVenvSchema = z.object({
  projectPath: z.string().min(1),
  pythonPath: z.string().min(1)
})

export const installDepsSchema = z.object({
  projectPath: z.string().min(1)
})

/** checkUpdates / updateDeps / verify 只按项目路径操作 */
export const updateDepsSchema = z.object({
  projectPath: z.string().min(1)
})

export const verifyVenvSchema = z.object({
  projectPath: z.string().min(1)
})

/** python:setPath —— 自定义解释器路径（由 pathGuard.assertPythonPathSafe 再做安全校验） */
export const setPythonPathSchema = z.object({
  path: z.string().min(1)
})
