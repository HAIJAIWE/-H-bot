// tests/renderer/components/ai/TurnBoundary.test.tsx
//
// 「本轮边界」一行要说的是**主进程真正生效的边界**，不是界面自己的状态：
// 角色从哪来、工具被收窄到几个、审批还问不问、是不是只读的先计划。
// 钉住两点：默认态一个字都不显示（不制造噪音）；非默认态每一项都在文字里。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TurnBoundary } from '@renderer/components/ai/TurnBoundary'
import { t } from '@renderer/i18n'

afterEach(cleanup)

const text = (): string => screen.getByRole('status').textContent ?? ''

describe('本轮边界', () => {
  it('默认态（跟随页面 + 全部工具 + 逐次问）不显示', () => {
    render(<TurnBoundary mode="blocks" source="page" approval="ask" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('预设固定角色 + 收窄工具 + 预设授予完全放行：三条都说出来', () => {
    render(
      <TurnBoundary
        mode="code"
        source="preset"
        presetName="只读巡检"
        toolCount={2}
        approval="full-preset"
      />,
    )
    expect(text()).toContain(t('ai.boundary.sourcePreset', { name: '只读巡检' }))
    expect(text()).toContain(t('ai.boundary.tools', { n: 2 }))
    expect(text()).toContain(t('ai.boundary.approvalFullPreset'))
    // 角色名走的是角色按钮表那一份文案，不是另写一遍
    expect(text()).toContain(t('ai.mode.coder'))
    expect(text()).not.toContain(t('ai.boundary.approvalAsk'))
  })

  it('手动点选 + 先计划：说出手动与只读一轮，且不说"完全放行"', () => {
    render(<TurnBoundary mode="blocks" source="manual" approval="ask" planFirst />)
    expect(text()).toContain(t('ai.boundary.sourceManual'))
    expect(text()).toContain(t('ai.boundary.plan'))
    expect(text()).not.toContain(t('ai.boundary.approvalFull'))
  })

  it('工具数与插件数分开算：0 或 undefined 都不显示（空集=不限制，不能说成 0）', () => {
    const { rerender } = render(
      <TurnBoundary mode="duo" source="preset" presetName="p" toolCount={0} approval="ask" />,
    )
    expect(text()).not.toContain(t('ai.boundary.tools', { n: 0 }))
    rerender(
      <TurnBoundary
        mode="duo"
        source="preset"
        presetName="p"
        toolCount={3}
        pluginCount={2}
        approval="full"
      />,
    )
    expect(text()).toContain(t('ai.boundary.tools', { n: 3 }))
    expect(text()).toContain(t('ai.boundary.plugins', { n: 2 }))
    expect(text()).toContain(t('ai.boundary.approvalFull'))
  })
})
