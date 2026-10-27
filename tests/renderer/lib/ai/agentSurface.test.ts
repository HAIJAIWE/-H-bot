// tests/renderer/lib/ai/agentSurface.test.ts
//
// 智能体窗口贡献点：能注册、能接管、能撤销 —— 界面按 order 取第一个（内置对话窗口是 1000）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  registerAgentSurface,
  getAgentSurface,
  subscribeAgentSurfaces,
} from '@renderer/lib/ai/agentSurface'

describe('★ 智能体窗口（agent surface 贡献点）', () => {
  it('★ 注册即可接管：order 更小的窗口生效，撤销后回落到内置窗口', () => {
    const builtin = registerAgentSurface({
      id: 'test.chat',
      order: 1000,
      label: '内建对话窗口',
      render: () => null,
    })
    expect(getAgentSurface()?.id).toBe('test.chat')

    const takeover = registerAgentSurface({
      id: 'test.alt',
      order: 10,
      label: '第三方窗口',
      render: () => null,
    })
    expect(getAgentSurface()?.id).toBe('test.alt')
    expect(getAgentSurface()?.label).toBe('第三方窗口')

    takeover()
    expect(getAgentSurface()?.id).toBe('test.chat')
    builtin()
    expect(getAgentSurface()).toBeUndefined()
  })

  it('同 order 时先注册的优先（顺序稳定，不会随机跳）', () => {
    const a = registerAgentSurface({ id: 'test.order.a', order: 5, label: 'A', render: () => null })
    const b = registerAgentSurface({ id: 'test.order.b', order: 5, label: 'B', render: () => null })
    expect(getAgentSurface()?.id).toBe('test.order.a')
    a()
    expect(getAgentSurface()?.id).toBe('test.order.b')
    b()
  })

  it('重名 / 空 id → 注册时直接拒', () => {
    const dispose = registerAgentSurface({ id: 'test.dup', label: 'dup', render: () => null })
    expect(() =>
      registerAgentSurface({ id: 'test.dup', label: 'dup', render: () => null }),
    ).toThrow(/already registered/)
    expect(() => registerAgentSurface({ id: ' ', label: 'x', render: () => null })).toThrow(/id/)
    dispose()
  })

  it('订阅：注册和撤销都会通知（界面靠它重渲染）', () => {
    let calls = 0
    const unsubscribe = subscribeAgentSurfaces(() => {
      calls += 1
    })
    const dispose = registerAgentSurface({ id: 'test.sub', label: 'sub', render: () => null })
    expect(calls).toBe(1)
    dispose()
    expect(calls).toBe(2)
    unsubscribe()
  })

  it('★ 挂载点：右侧面板真的渲染 agent surface（写死 ChatPanel 会红）', () => {
    const panel = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/layout/RightPanel.tsx'),
      'utf8',
    )
    expect(panel).toContain('<AgentSurfaceHost />')
    expect(panel).not.toContain('<ChatPanel />')
  })
})
