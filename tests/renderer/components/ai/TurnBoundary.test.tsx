// tests/renderer/components/ai/TurnBoundary.test.tsx
//
// 「本轮边界」一行要说的是**主进程真正生效的边界**，不是界面自己的状态：
// 工具被收窄到几个、插件限定了几个、审批还问不问、是不是只读的先计划。
// 钉住三点：默认态一个字都不显示（不制造噪音）；非默认态每一项都在文字里；
// **不再写角色**（角色/预设合并成一个选择器后，这里再写一遍就是同一件事说两遍）。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TurnBoundary } from '@renderer/components/ai/TurnBoundary'
import { t } from '@renderer/i18n'

afterEach(cleanup)

const text = (): string => screen.getByRole('status').textContent ?? ''

describe('本轮边界', () => {
  it('默认态（全部工具 + 逐次问 + 不是先计划）不显示', () => {
    render(<TurnBoundary approval="ask" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('收窄工具 + 预设授予完全放行：两条都说出来，且不提角色', () => {
    render(<TurnBoundary toolCount={2} approval="full-preset" />)
    expect(text()).toContain(t('ai.boundary.tools', { n: 2 }))
    expect(text()).toContain(t('ai.boundary.approvalFullPreset'))
    expect(text()).not.toContain(t('ai.boundary.approvalAsk'))
    // 角色不复述：选择器已经写着现在是谁
    expect(text()).not.toContain(t('ai.mode.coder'))
    expect(text()).not.toContain(t('ai.mode.blocks'))
  })

  it('先计划：说出口径，且不说"完全放行"', () => {
    render(<TurnBoundary approval="ask" planFirst />)
    expect(text()).toContain(t('ai.boundary.plan'))
    expect(text()).not.toContain(t('ai.boundary.approvalFull'))
  })

  it('工具数与插件数分开算：0 或 undefined 都不显示（空集=不限制，不能说成 0）', () => {
    const { rerender } = render(<TurnBoundary toolCount={0} approval="ask" />)
    // 0 个工具 = 不限制，不显示；ash 也不该冒出来
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<TurnBoundary toolCount={3} pluginCount={2} approval="full" />)
    expect(text()).toContain(t('ai.boundary.tools', { n: 3 }))
    expect(text()).toContain(t('ai.boundary.plugins', { n: 2 }))
    expect(text()).toContain(t('ai.boundary.approvalFull'))
  })
})
