// src/main/ipc/codegen.ts
// 「生成代码快照」通道。
//
// 10/18 起只有一条通道 codegen:generate：CodegenService（src/main/services/flow/codegen.ts）
// 把流程写成人可读的 TypeScript 快照 src/plugins/generated/flow.generated.ts。
// 运行时不加载这个文件（FlowInterpreter 直接读 .qqbat/flow.json）。
//
// 旧的 codegen:exportReadable（导出可读 Python）随 ADR-003 一起下线：
// 解释执行后不再生成 .py，preload 也早已没有这条方法，能力层从未登记过它。
import { ipcMain } from 'electron'
import { CodegenService } from '../services/flow/codegen'
import { codegenGenerateSchema } from '../schemas/codegen'
import { tryIpcAsync } from './_shared'

export function registerCodegenIpc(service: InstanceType<typeof CodegenService>): void {
  ipcMain.handle(
    'codegen:generate',
    async (
      _event,
      projectPath: string,
      flow: unknown,
      debugMode?: boolean,
      version?: { name?: string; message?: string } | null
    ) => {
      const parsed = codegenGenerateSchema.safeParse({ projectPath, flow, debugMode, version })
      if (!parsed.success) {
        return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
      }
      // version 是**三态**：undefined=自动命名；null=只生成不打版本；对象=用用户填的名字。
      // 这里必须原样透传，不能 ?? null —— 那会把「自动命名」变成「不打版本」。
      return tryIpcAsync(() =>
        service.generate(parsed.data.projectPath, parsed.data.flow, parsed.data.debugMode ?? false, parsed.data.version),
      )
    },
  )
}
