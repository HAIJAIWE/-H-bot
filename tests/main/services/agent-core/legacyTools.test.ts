// tests/main/services/agent-core/legacyTools.test.ts
//
// # 旧工具接进循环（2026-10-20，合并双引擎第 2 步）
//
// 要钉死的四条：
//   ① mutation **只入队不落盘**，喂给用户的是"待确认"而不是"已完成"；
//   ② 没有提案转换的工具**明确失败**，不许装作成功；
//   ③ query 需要渲染层执行时**必须等回执**，回执不是 applied 就是失败；
//   ④ 并行/独占由 category 推出来（27 个工具不靠手工标注）。
import { describe, it, expect, vi } from 'vitest'
import {
  adaptLegacyTool,
  adaptLegacyTools,
  type LegacyToolBridge,
} from '@main/services/agent-core/legacyTools'
import { executionModeOf } from '@main/services/agent-core/core'
import { ALL_TOOL_DEFINITIONS } from '@main/services/ai/tools/defs'
import type { AiToolDefinition } from '@shared/types/ai'
import type { ToolContext } from '@main/services/agent-core/core'

// 默认执行器（不传 execute 的那条路）走的是真 executeTool —— 这里换成 spy，
// 好断言上下文到底有没有传进去（2026-10-25 修的那个洞：以前只给 signal，
// bridge.context 被静默忽略）。
const h = vi.hoisted(() => ({ executeTool: vi.fn() }))
vi.mock('@main/services/ai/tools/execute', () => ({ executeTool: h.executeTool }))

/** Tool 契约要求 (args, ctx)；这批用例只关心提案/回执，ctx 里给个 workspace 占位 */
const ctx: ToolContext = { workspace: 'C:/proj' }

function bridgeOf(extra: Partial<LegacyToolBridge> = {}): LegacyToolBridge {
  return { projectPath: 'C:/proj', pendingOperations: [], ...extra }
}

/** 只取真正能转换的那条：add_node（nodeKind 是必填，给全就能过） */
const addNodeDef = ALL_TOOL_DEFINITIONS.find(d => d.name === 'add_node')!

describe('★ mutation：攒提案，不落盘', () => {
  it('★ add_node 进待确认队列，并且回给模型的是"待确认"', async () => {
    const bridge = bridgeOf()
    const tool = adaptLegacyTool(addNodeDef, bridge)
    const text = await tool.run({ nodeKind: 'action', label: '打招呼' }, ctx)

    expect(bridge.pendingOperations).toHaveLength(1)
    expect(bridge.pendingOperations[0].kind).toBe('add_node')
    expect(text).toContain('待确认')
    // 反向断言：没有替模型宣布"已完成"
    expect(text).not.toContain('已完成')
  })

  it('★ 同一个工具调两次 = 两条操作（不静默合并）', async () => {
    const bridge = bridgeOf()
    const tool = adaptLegacyTool(addNodeDef, bridge)
    await tool.run({ nodeKind: 'action' }, ctx)
    await tool.run({ nodeKind: 'action' }, ctx)
    expect(bridge.pendingOperations).toHaveLength(2)
  })

  it('★ 没有提案转换 → 明确失败，队列不涨', async () => {
    const def: AiToolDefinition = {
      name: 'not_a_real_tool',
      description: 'none',
      parameters: { type: 'object', properties: {} },
      category: 'mutation',
    }
    const bridge = bridgeOf()
    const text = await adaptLegacyTool(def, bridge).run({}, ctx)
    expect(text).toContain('[工具失败]')
    expect(bridge.pendingOperations).toHaveLength(0)
  })
})

describe('★ query：要等回执', () => {
  const def: AiToolDefinition = {
    name: 'fake_query',
    description: 'query',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  }

  it('★ 普通查询直接把结果文本交回模型', async () => {
    const execute = vi.fn(async () => ({ result: { ok: 1 } }))
    const text = await adaptLegacyTool(def, bridgeOf({ execute })).run({ a: 1 }, ctx)
    expect(text).toBe('{"ok":1}')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('★ 需要界面执行的：回执 applied 才算成功', async () => {
    const execute = vi.fn(async () => ({
      result: null,
      needsClientExecution: true,
      clientInstruction: { name: 'focusNode', args: { id: 'n1' } },
    }))
    const dispatch = vi.fn(async () => ({ status: 'applied' }))
    const text = await adaptLegacyTool(def, bridgeOf({ execute, dispatch })).run({}, ctx)
    expect(dispatch).toHaveBeenCalledWith({ name: 'focusNode', args: { id: 'n1' } })
    expect(text).toContain('回执')
  })

  it('★ 回执不是 applied = 失败（禁止发完就当成功）', async () => {
    const execute = vi.fn(async () => ({
      result: null,
      needsClientExecution: true,
      clientInstruction: { name: 'focusNode', args: {} },
    }))
    const dispatch = vi.fn(async () => ({ status: 'failed', reason: '没有窗口' }))
    const text = await adaptLegacyTool(def, bridgeOf({ execute, dispatch })).run({}, ctx)
    expect(text).toContain('[工具失败]')
    expect(text).toContain('没有窗口')
  })

  it('★ 没有界面通道 → 说清原因，不是默默成功', async () => {
    const execute = vi.fn(async () => ({
      result: null,
      needsClientExecution: true,
      clientInstruction: { name: 'x', args: {} },
    }))
    const text = await adaptLegacyTool(def, bridgeOf({ execute })).run({}, ctx)
    expect(text).toContain('[工具失败]')
  })
})

describe('★ 默认执行器：上下文与信号都要传到位', () => {
  const def: AiToolDefinition = {
    name: 'fake_query',
    description: 'query',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  }

  it('★ 上下文（待确认预览图）并进执行上下文，signal 也照样带上', async () => {
    h.executeTool.mockReset().mockResolvedValue({ result: 'ok' })
    const signal = new AbortController().signal
    const context = vi.fn(async () => ({ pendingNote: '这是确认后的样子' }))
    const text = await adaptLegacyTool(def, bridgeOf({ context, signal })).run({}, ctx)
    expect(context).toHaveBeenCalledOnce()
    const passed = h.executeTool.mock.calls[0][2]
    expect(passed.pendingNote).toBe('这是确认后的样子')
    expect(passed.signal).toBe(signal)
    expect(text).toBe('ok')
  })

  it('没有 context 时也要带 signal（以前是二选一）', async () => {
    h.executeTool.mockReset().mockResolvedValue({ result: 'ok' })
    const signal = new AbortController().signal
    await adaptLegacyTool(def, bridgeOf({ signal })).run({}, ctx)
    expect(h.executeTool.mock.calls[0][2]).toEqual({ signal })
  })
})

describe('★ 工具表对账', () => {
  it('★ 旧工具一个不少、一个不多（顺序与真源定义表一致）', () => {
    const tools = adaptLegacyTools(bridgeOf())
    expect(tools.map(t => t.name)).toEqual(ALL_TOOL_DEFINITIONS.map(d => d.name))
  })

  it('★ executionMode 全部由 category 推出：query 并行、mutation 独占', () => {
    const tools = adaptLegacyTools(bridgeOf())
    for (const [i, tool] of tools.entries()) {
      const expected = ALL_TOOL_DEFINITIONS[i].category === 'query' ? 'parallel' : 'exclusive'
      expect(executionModeOf(tool), tool.name).toBe(expected)
    }
  })
})

describe('★ 第 55 批：旧域工具的超时预算', () => {
  it('★ query 工具统一 120s；mutation 不声明（攒提案是同步的，给超时只会造假失败）', () => {
    for (const def of ALL_TOOL_DEFINITIONS) {
      const tool = adaptLegacyTool(def, bridgeOf())
      if (def.category === 'query') {
        expect(tool.timeoutMs, def.name).toBe(120_000)
      } else {
        expect(tool.timeoutMs, def.name).toBeUndefined()
      }
    }
  })
})
