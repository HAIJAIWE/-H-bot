// tests/renderer/components/ai/AgentPresetMenu.test.tsx
//
// 角色与预设合并成**一个菜单**（2026-10-25，对齐 DSH ui-agent-preset 的形状）之后要钉住：
//   · 跟随页面 / 内置角色 / 自定义预设三件事都能选，且回调收到的是**主进程认的值**
//     （角色是 mode：blocks/code/…，预设是 name —— 不是文件里的 id）；
//   · 当前项只有一个高亮（角色与预设互斥，跟随页面在两者都没有时才算）；
//   · 预设文件读不到/为空时菜单不崩，并明说"这个项目还没有预设"。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AgentPresetMenu } from '@renderer/components/ai/AgentPresetMenu'
import { t } from '@renderer/i18n'
import type { AgentMode } from '@shared/ai/roleDomains'
import type { PresetMeta } from '@renderer/components/ai/presetOptions'

const FILE = [
  { name: '只读巡检', id: 'ro', role: 'coder' },
  { name: '全放行', permissionMode: 'full' },
]

let read: ReturnType<typeof vi.fn>

beforeEach(() => {
  read = vi.fn().mockResolvedValue({ ok: true, data: JSON.stringify(FILE) })
  window.qqbat = { file: { read } } as never
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as never as { qqbat?: unknown }).qqbat
})

function setup(
  props: {
    override?: AgentMode | null
    preset?: string | null
    projectPath?: string | undefined
  } = {},
) {
  // 回调按真实签名声明：给 vi.fn() 留默认的 Procedure 类型，tsc 会说它不是
  // (mode: AgentMode) => void（vitest 的 mock 是"可构造的过程"，签名对不上）
  const spies = {
    onPickPage: vi.fn<() => void>(),
    onPickRole: vi.fn<(mode: AgentMode) => void>(),
    onPickPreset: vi.fn<(name: string) => void>(),
    onEditPresets: vi.fn<() => void>(),
    onResolve: vi.fn<(meta: PresetMeta | null) => void>(),
  }
  render(
    <AgentPresetMenu
      projectPath={'projectPath' in props ? props.projectPath : '/p'}
      override={props.override ?? null}
      preset={props.preset ?? null}
      onResolve={spies.onResolve}
      onPickPage={spies.onPickPage}
      onPickRole={spies.onPickRole}
      onPickPreset={spies.onPickPreset}
      onEditPresets={spies.onEditPresets}
    />,
  )
  return spies
}

describe('角色/预设菜单', () => {
  it('什么都没选时触发器写"跟页面"，且三项高亮里只有跟随页面亮', () => {
    setup()
    // details 收起时内容仍渲染在 DOM 里（只是不可见），断言直接查文案
    // 两处都有这个文案：触发器（当前值）+ 菜单第一行
    expect(screen.getAllByText(t('ai.mode.followPage')).length).toBeGreaterThan(0)
    const pressed = screen
      .getAllByRole('button')
      .filter(b => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].textContent).toContain(t('ai.mode.followPage'))
  })

  it('★ 点角色回调收到的是 mode（blocks/code/…），并清掉预设那一份', () => {
    const s = setup()
    fireEvent.click(screen.getByTitle(t('ai.mode.coderHint')))
    expect(s.onPickRole).toHaveBeenCalledWith('code')
  })

  it('★ 预设从项目文件读出来，点了回调收到**名字**（不是文件里的 id）', async () => {
    const s = setup()
    fireEvent.click(await screen.findByText('只读巡检'))
    expect(s.onPickPreset).toHaveBeenCalledWith('只读巡检')
    expect(s.onPickPreset).not.toHaveBeenCalledWith('ro')
  })

  it('选中的预设高亮、角色行同时不亮（两件事互斥）', async () => {
    setup({ preset: '只读巡检' })
    await screen.findByText('只读巡检')
    const pressed = screen
      .getAllByRole('button')
      .filter(b => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    // 触发器上也写着当前预设名
    expect(screen.getByTitle(t('ai.preset.title')).textContent).toContain('只读巡检')
  })

  it('选中预设会把它的元信息报给调用方（角色写死在预设里）', async () => {
    const s = setup({ preset: '只读巡检' })
    await waitFor(() => expect(s.onResolve).toHaveBeenCalledWith({ role: 'coder' }))
  })

  it('「编辑预设…」是另一个入口，点了回调', () => {
    const s = setup()
    fireEvent.click(screen.getByText(t('ai.agentCore.presetEdit')))
    expect(s.onEditPresets).toHaveBeenCalled()
  })

  it('没有项目 / 文件为空：不崩，明说还没有预设', async () => {
    read.mockResolvedValue({ ok: true, data: '[]' })
    setup({ projectPath: undefined })
    expect(await screen.findByText(t('ai.preset.empty'))).toBeInTheDocument()
    // 没有项目时根本不去读盘（读也读不到）
    expect(read).not.toHaveBeenCalled()
  })

  it('坏 JSON 不把菜单搞崩（当空表处理）', async () => {
    read.mockResolvedValue({ ok: true, data: '{oops' })
    setup()
    expect(await screen.findByText(t('ai.preset.empty'))).toBeInTheDocument()
  })
})
