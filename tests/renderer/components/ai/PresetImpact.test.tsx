// tests/renderer/components/ai/PresetImpact.test.tsx
//
// 预览只做翻译：能写什么必须问 mayRoleWritePath（与主进程闸门同一个函数），
// 所以这里的用例盯的是"翻译得对不对"，不是"规则对不对"（规则在 shared 的测试里）。
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PresetImpact } from '@renderer/components/ai/PresetImpact'

const TOOLS = [
  { name: 'read_file', category: 'query' as const },
  { name: 'list_dir', category: 'query' as const },
  { name: 'write_file', category: 'mutation' as const },
]

function text(): string {
  return document.body.textContent ?? ''
}

describe('PresetImpact', () => {
  it('搭建者：界面能写、代码不能写（两句话都要出现，不能只说一句）', () => {
    render(
      <PresetImpact
        role="builder"
        allowedTools={[]}
        tools={TOOLS}
        permissionMode="ask"
        plugins={[]}
      />,
    )
    expect(text()).toContain('界面（流程 / 面板 / 模板）：能写')
    expect(text()).toContain('代码（src/、plugins/、*.ts）：不能写')
  })

  it('开发者：反过来 —— 代码能写、界面不能写', () => {
    render(
      <PresetImpact
        role="coder"
        allowedTools={[]}
        tools={TOOLS}
        permissionMode="ask"
        plugins={[]}
      />,
    )
    expect(text()).toContain('界面（流程 / 面板 / 模板）：不能写')
    expect(text()).toContain('代码（src/、plugins/、*.ts）：能写')
  })

  it('双向两边都能写 —— 不能把"能写"写死成一边', () => {
    render(
      <PresetImpact role="duo" allowedTools={[]} tools={TOOLS} permissionMode="ask" plugins={[]} />,
    )
    expect(text()).toContain('界面（流程 / 面板 / 模板）：能写')
    expect(text()).toContain('代码（src/、plugins/、*.ts）：能写')
  })

  it('没固定角色：说"跟着页签"，不假装知道哪边能写', () => {
    render(
      <PresetImpact
        role={null}
        allowedTools={[]}
        tools={TOOLS}
        permissionMode="ask"
        plugins={[]}
      />,
    )
    expect(text()).toContain('跟着页签')
    expect(text()).not.toContain('不能写')
  })

  it('工具：不勾 = 全部 N 个；勾了 = 只留 N 个，并给出改写/查询拆分', () => {
    const { unmount } = render(
      <PresetImpact
        role="coder"
        allowedTools={[]}
        tools={TOOLS}
        permissionMode="ask"
        plugins={[]}
      />,
    )
    expect(text()).toContain('全部 3 个')
    expect(text()).toContain('改 1 · 查 2')
    unmount()
    render(
      <PresetImpact
        role="coder"
        allowedTools={['read_file']}
        tools={TOOLS}
        permissionMode="ask"
        plugins={[]}
      />,
    )
    expect(text()).toContain('只留 1 个')
    expect(text()).toContain('改 0 · 查 1')
  })

  it('白名单里有工具注册表不认识的：单独提示，不静默算进统计', () => {
    render(
      <PresetImpact
        role="coder"
        allowedTools={['read_file', 'made_up_tool']}
        tools={TOOLS}
        permissionMode="ask"
        plugins={[]}
      />,
    )
    expect(text()).toContain('只留 2 个')
    expect(text()).toContain('白名单里 1 个不认识：made_up_tool')
    expect(text()).toContain('改 0 · 查 1')
  })

  it('完全放行：打徽标并说清\"不问\"，同时仍把白名单说清', () => {
    render(
      <PresetImpact
        role="builder"
        allowedTools={['write_file']}
        tools={TOOLS}
        permissionMode="full"
        plugins={[]}
      />,
    )
    expect(screen.getAllByText('完全放行').length).toBeGreaterThan(0)
    expect(text()).toContain('完全放行（不问，直接做）')
    expect(text()).toContain('只留 1 个')
  })

  it('插件限定只在写了 plugins 时出现', () => {
    const { unmount } = render(
      <PresetImpact
        role="coder"
        allowedTools={[]}
        tools={TOOLS}
        permissionMode="ask"
        plugins={[]}
      />,
    )
    expect(text()).not.toContain('只留 market')
    unmount()
    render(
      <PresetImpact
        role="coder"
        allowedTools={[]}
        tools={TOOLS}
        permissionMode="ask"
        plugins={['market-clock']}
      />,
    )
    expect(text()).toContain('只留 market-clock')
  })

  it('常驻那句提醒必须在：白名单只管工具、完全放行绕不过角色', () => {
    render(
      <PresetImpact
        role="builder"
        allowedTools={[]}
        tools={TOOLS}
        permissionMode="full"
        plugins={[]}
      />,
    )
    expect(text()).toContain('白名单只收窄工具')
    expect(text()).toContain('完全放行也绕不过去')
  })
})
