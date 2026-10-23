// src/main/schemas/codegen.ts
import { z } from 'zod'

/** codegen:generate 参数 schema */
export const codegenGenerateSchema = z.object({
  projectPath: z.string().min(1),
  flow: z.unknown(),
  debugMode: z.boolean().optional(),
  /**
   * 版本三态：
   * - 缺省 / undefined：生成后按节点数自动命名一个版本
   * - null：只生成，不打版本（调试构建走这条）
   * - 对象：用户填的版号/说明
   */
  version: z
    .object({ name: z.string().max(64).optional(), message: z.string().max(200).optional() })
    .nullable()
    .optional()
})
