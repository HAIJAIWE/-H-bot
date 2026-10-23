// src/main/ipc/flow.ts
import { ipcMain } from 'electron'
import { FlowService } from '../services/flow'
import type { FlowGraph } from '@shared/types/flow'
import { normalizeFlow, validateFlow } from '@shared/nodes/flowNormalize'
import { runPreview } from '../runtime/previewRunner'
import { tryIpcAsync } from './_shared'
import { flowLoadSchema, flowSaveSchema } from '../schemas/flowIpc'

export function registerFlowIpc(service: InstanceType<typeof FlowService>): void {
  ipcMain.handle('flow:load', async (_event, projectPath: string) => {
    const parsed = flowLoadSchema.safeParse([projectPath])
    if (!parsed.success) return { ok: false, error: '参数 projectPath 无效' }
    return tryIpcAsync(() => service.loadFlow(parsed.data[0]))
  })

  ipcMain.handle(
    'flow:save',
    async (_event, projectPath: string, flow: FlowGraph, reason?: string) => {
      const parsed = flowSaveSchema.safeParse([projectPath, flow])
      if (!parsed.success) return { ok: false, error: '参数 projectPath 无效' }
      // reason 只影响 git 自动提交的说明（编辑中 / 生成代码 / 运行前…），不参与校验
      const why = typeof reason === 'string' && reason ? reason : 'other'
      return tryIpcAsync(() => service.saveFlow(parsed.data[0], parsed.data[1] as FlowGraph, why))
    }
  )

  /**
   * flow:preview —— 本地测试：**跑真解释器**，但把副作用全部挡在临时克隆内。
   *
   * 取代渲染层的 mockRunner（那套平行实现必然与真解释器漂移，出现「预览骗人」）。
   * 传入编辑器当前图（含未保存改动），所以在画布上改一处就能立刻预览，不必先保存。
   */
  ipcMain.handle('flow:preview', async (_event, request: unknown) => {
    const req = request as { projectPath?: unknown; event?: unknown } | null
    if (!req?.projectPath || typeof req.projectPath !== 'string') {
      return { ok: false, error: '参数 projectPath 无效' }
    }
    if (!req.event || typeof req.event !== 'object') return { ok: false, error: '参数 event 无效' }
    return tryIpcAsync(() => runPreview(request))
  })

  /**
   * flow:validate —— 运行前问题清单（不执行流程）。
   *
   * 与 flow:preview 共用同一套统一真相层：先 normalizeFlow 补端口，再 validateFlow
   * 产出一致的问题列表。这类全局校验（必填为空 / 端口不存在 / 节点不可达）过去只在
   * 连线时局部检查，用户往往到运行时才踩坑。
   */
  ipcMain.handle('flow:validate', async (_event, projectPath: unknown, graph: unknown) => {
    if (!projectPath || typeof projectPath !== 'string') {
      return { ok: false, error: '参数 projectPath 无效' }
    }
    if (!graph || typeof graph !== 'object') return { ok: false, error: '参数 graph 无效' }
    return tryIpcAsync(() => {
      const normalized = normalizeFlow(graph as Parameters<typeof normalizeFlow>[0])
      return {
        issues: validateFlow(normalized.graph),
        normalizedNodes: normalized.changes.length,
        graph: normalized.graph
      }
    })
  })
}
