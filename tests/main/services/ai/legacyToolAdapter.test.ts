// tests/main/services/ai/legacyToolAdapter.test.ts
//
// **旧工具 → 循环工具**的桥（合并双引擎第 2 步）。
//
// 2026-10-24 恢复注：本文件早先测的是「迁移阶段 1 的诊断」版 —— 那时适配器签名是
// `adaptLegacyTool(def, executorFn)`，mutation 还要过一道 `ctx.gate`。现在的实现已进到
// 阶段 2（见 src/main/services/agent-core/legacyTools.ts 文件头）：
//   · 第二参是 bridge 对象（projectPath / pendingOperations / execute / dispatch / role）；
//   · mutation **不走闸门、也不执行**，只转成提案操作攒进 pendingOperations，等用户确认；
//   · query 走 `executeTool`（唯一入口），需要界面执行的走 clientInstruction + 等回执。
// 因此下面按阶段 2 的语义重写：闸门那件事由提案（用户确认）承担，不再是 ToolContext.gate。
import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adaptLegacyTool, adaptLegacyTools } from '@main/services/agent-core/legacyTools'
import { ALL_TOOL_DEFINITIONS } from '@main/services/ai/tools/defs'
import { runAgentLoop } from '@main/services/agent-core/core'
import type { AiToolDefinition } from '@shared/types/ai'
import type { GateRequest } from '@main/services/agent-core/core'
import type { ProposalOperation } from '@shared/types/proposal'

const queryDef: AiToolDefinition = {
  name: 'legacy_query',
  description: '查点东西（桥接诊断）',
  parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  category: 'query',
}

const mutationDef: AiToolDefinition = { ...queryDef, name: 'legacy_mutate', category: 'mutation' }

/** 最小 bridge：诊断用，execute 可注入假执行器 */
function makeBridge(
  projectPath: string,
  execute?: (call: {
    id: string
    name: string
    args: Record<string, unknown>
  }) => Promise<{ result: unknown }>,
) {
  const pendingOperations: ProposalOperation[] = []
  return {
    bridge: {
      projectPath,
      pendingOperations,
      ...(execute ? { execute: execute as never } : {}),
    },
    pendingOperations,
  }
}

describe('★ 旧工具适配器（合并双引擎第 2 步）', () => {
  it('形态逐字段透传：name / description / parameters / category', () => {
    const { bridge } = makeBridge('/p')
    const tool = adaptLegacyTool(queryDef, bridge)
    expect(tool.name).toBe('legacy_query')
    expect(tool.description).toBe(queryDef.description)
    expect(tool.parameters).toBe(queryDef.parameters)
    expect(tool.category).toBe('query')
  })

  it('★ 新循环能驱动它：模型点名的旧工具真的被执行，结果回灌', async () => {
    const seen: Array<Record<string, unknown>> = []
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-adapter-'))
    const { bridge } = makeBridge(ws, async call => {
      seen.push(call.args)
      return { result: '结果:' + String(call.args.q) }
    })
    const tool = adaptLegacyTool(queryDef, bridge)
    let round = 0
    const res = await runAgentLoop({
      workspace: ws,
      tools: [tool],
      model: async () => {
        round += 1
        return round === 1
          ? { calls: [{ id: 'c1', name: 'legacy_query', args: { q: '签到' } }] }
          : { text: 'done' }
      },
    })
    expect(seen).toEqual([{ q: '签到' }])
    expect(res.toolResults[0].output).toBe('结果:签到')
    expect(res.finalText).toBe('done')
  })

  it('query 工具不触发审批闸门（读操作不该弹审批）', async () => {
    const gates: GateRequest[] = []
    const { bridge } = makeBridge('/p', async () => ({ result: 'ok' }))
    const tool = adaptLegacyTool(queryDef, bridge)
    const out = await tool.run(
      { q: 'x' },
      {
        workspace: '/p',
        gate: async req => {
          gates.push(req)
          return true
        },
      },
    )
    expect(String(out)).toBe('ok')
    expect(gates).toEqual([])
  })

  it('★ mutation 不执行、转提案：执行器一次都没跑，操作进入待确认队列', async () => {
    let ran = 0
    const { bridge, pendingOperations } = makeBridge('/p', async () => {
      ran += 1
      return { result: 'ok' }
    })
    const tool = adaptLegacyTool(mutationDef, bridge)
    // legacy_mutate 没有对应的提案转换器 → 明确的失败，而不是静默成功
    const out = await tool.run({ q: 'x' }, { workspace: '/p' })
    expect(String(out)).toContain('[工具失败]')
    expect(String(out)).toContain('没有可用的提案转换')
    expect(ran).toBe(0)
    expect(pendingOperations).toEqual([])
  })

  it('★ 有提案转换的 mutation：转成操作并可交给用户确认', async () => {
    const addNodeDef: AiToolDefinition = {
      name: 'add_node',
      description: '加节点',
      parameters: { type: 'object', properties: {} },
      category: 'mutation',
    }
    const { bridge, pendingOperations } = makeBridge('/p', async () => {
      throw new Error('mutation 不该走执行器（它只转提案）')
    })
    const tool = adaptLegacyTool(addNodeDef, bridge)
    const out = await tool.run(
      { nodeKind: 'message_send', config: { text: 'hi' }, id: 'n1' },
      { workspace: '/p' },
    )
    expect(String(out)).toContain('待确认计划')
    expect(pendingOperations.length).toBeGreaterThan(0)
  })

  it('★ 适配出来的工具声明 approval: () => null（提案制已经确认过，别再问一遍）', () => {
    const { bridge } = makeBridge('/p')
    for (const def of [queryDef, mutationDef]) {
      const tool = adaptLegacyTool(def, bridge)
      // 第 46 批：审批搬进 toolPipeline.prepare 后，mutation 的默认推断会变成"要问人"；
      // 旧工具的 mutation 是提案制（用户点确认才落盘），这里必须显式豁免，否则重复审批。
      expect(tool.approval?.({ q: 'x' }, { workspace: '/p' })).toBeNull()
    }
  })

  it('★ 盘点：现有全部旧工具都能被适配（没有哪种形态漏掉）', () => {
    const { bridge } = makeBridge('/p')
    const adapted = adaptLegacyTools(bridge)
    expect(adapted.length).toBeGreaterThan(20)
    for (const [i, tool] of adapted.entries()) {
      const def = ALL_TOOL_DEFINITIONS[i]
      expect(tool.name).toBe(def.name)
      expect(['query', 'mutation']).toContain(tool.category)
    }
  })
})
