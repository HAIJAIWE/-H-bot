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
  listAgentSurfaces,
} from '@renderer/lib/ai/agentSurface'

describe('★ 智能体窗口（agent surface 贡献点）', () => {
  it('★ 注册即可接管：order 更小的窗口生效，撤销后回落到内置窗口', () => {
    const builtin = registerAgentSurface({
      id: 'test.chat',
      order: 1000,
      label: () => '内建对话窗口',
      render: () => null,
    })
    expect(getAgentSurface()?.id).toBe('test.chat')

    const takeover = registerAgentSurface({
      id: 'test.alt',
      order: 10,
      label: () => '第三方窗口',
      render: () => null,
    })
    expect(getAgentSurface()?.id).toBe('test.alt')
    expect(getAgentSurface()?.label?.()).toBe('第三方窗口')

    takeover()
    expect(getAgentSurface()?.id).toBe('test.chat')
    builtin()
    expect(getAgentSurface()).toBeUndefined()
  })

  it('同 order 时先注册的优先（顺序稳定，不会随机跳）', () => {
    const a = registerAgentSurface({
      id: 'test.order.a',
      order: 5,
      label: () => 'A',
      render: () => null,
    })
    const b = registerAgentSurface({
      id: 'test.order.b',
      order: 5,
      label: () => 'B',
      render: () => null,
    })
    expect(getAgentSurface()?.id).toBe('test.order.a')
    a()
    expect(getAgentSurface()?.id).toBe('test.order.b')
    b()
  })

  it('重名 / 空 id → 注册时直接拒', () => {
    const dispose = registerAgentSurface({ id: 'test.dup', label: () => 'dup', render: () => null })
    expect(() =>
      registerAgentSurface({ id: 'test.dup', label: () => 'dup', render: () => null }),
    ).toThrow(/already registered/)
    expect(() => registerAgentSurface({ id: ' ', label: () => 'x', render: () => null })).toThrow(
      /id/,
    )
    dispose()
  })

  it('订阅：注册和撤销都会通知（界面靠它重渲染）', () => {
    let calls = 0
    const unsubscribe = subscribeAgentSurfaces(() => {
      calls += 1
    })
    const dispose = registerAgentSurface({ id: 'test.sub', label: () => 'sub', render: () => null })
    expect(calls).toBe(1)
    dispose()
    expect(calls).toBe(2)
    unsubscribe()
  })

  it('★ 指定 preferredId：即使 order 更大也用它；它被撤销后回落默认', () => {
    const a = registerAgentSurface({
      id: 'test.pick.a',
      order: 1000,
      label: () => 'A',
      render: () => null,
    })
    const b = registerAgentSurface({
      id: 'test.pick.b',
      order: 10,
      label: () => 'B',
      render: () => null,
    })
    // 用户选了 order 更大的那个：仍然听用户的
    expect(getAgentSurface('test.pick.a')?.id).toBe('test.pick.a')
    b()
    expect(getAgentSurface('test.pick.a')?.id).toBe('test.pick.a')
    a()
  })

  it('preferredId 指向不存在的窗口 → 自动回落 order 默认（不白屏）', () => {
    const only = registerAgentSurface({ id: 'test.pick.only', order: 5, render: () => null })
    expect(getAgentSurface('test.gone')?.id).toBe('test.pick.only')
    only()
  })

  it('listAgentSurfaces 按 order 排序（设置页下拉用）', () => {
    const c = registerAgentSurface({ id: 'test.list.c', order: 30, render: () => null })
    const d = registerAgentSurface({ id: 'test.list.d', order: 20, render: () => null })
    const ids = listAgentSurfaces().map(s => s.id)
    expect(ids.indexOf('test.list.d')).toBeLessThan(ids.indexOf('test.list.c'))
    c()
    d()
  })

  it('★ 挂载点：右侧面板真的渲染 agent surface（写死 ChatPanel 会红）', () => {
    const panel = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/layout/RightPanel.tsx'),
      'utf8',
    )
    expect(panel).toContain('<AgentSurfaceHost')
    // 第 69 批：设置页选过的窗口要真的传进来，否则下拉形同虚设
    expect(panel).toContain('preferredId={agentSurfaceId}')
    expect(panel).not.toContain('<ChatPanel />')
  })
})
