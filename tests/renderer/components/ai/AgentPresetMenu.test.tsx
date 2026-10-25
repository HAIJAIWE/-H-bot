// tests/renderer/components/ai/AgentPresetMenu.test.tsx
//
// 角色与预设合并成**一个菜单**（2026-10-25，对齐 DSH ui-agent-preset 的形状）；
// 第 48 批起菜单只显示主进程的注册表（`ai:getPresets`），不再自己解析 JSON。
// 钉住：
//   · 跟随页面 / 内置角色 / 自定义预设三件事都能选，且回调收到的是**主进程认的值**
//     （角色是 mode：blocks/code/…，预设是 name —— 不是文件里的 id）；
//   · 当前项只有一个高亮（角色与预设互斥，跟随页面在两者都没有时才算）；
//   · 坏条目**显示原因且不可选**、字段被忽略的条目可选中但在 title 里说明差异、
//     文件级问题直接说出来 —— 与主进程同一份裁决，菜单里看得到的就是跑起来会发生的。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AgentPresetMenu } from '@renderer/components/ai/AgentPresetMenu'
import { t } from '@renderer/i18n'
import type { AgentMode } from '@shared/ai/roleDomains'
import type { AgentPresetRoster, AgentPresetRow } from '@shared/ai/presetRoster'

const ROSTER: AgentPresetRoster = {
  presets: [
    { name: '只读巡检', role: 'coder' },
    { name: '全放行', permissionMode: 'full' },
  ],
}

let getPresets: ReturnType<typeof vi.fn>

beforeEach(() => {
  getPresets = vi.fn().mockResolvedValue({ ok: true, data: ROSTER })
  window.qqbat = { ai: { getPresets } } as never
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
    onResolve: vi.fn<(meta: AgentPresetRow | null) => void>(),
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

  it('★ 预设来自注册表，点了回调收到**名字**（不是文件里的 id）', async () => {
    const s = setup()
    fireEvent.click(await screen.findByText('只读巡检'))
    expect(s.onPickPreset).toHaveBeenCalledWith('只读巡检')
  })

  it('选中的预设高亮、角色行同时不亮（两件事互斥）', async () => {
    setup({ preset: '只读巡检' })
    // 触发器上也写着当前预设名 ⇒ 用 findAll 等列表到位，再按 aria-pressed 认行
    await screen.findAllByText('只读巡检')
    const pressed = screen
      .getAllByRole('button')
      .filter(b => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    // 触发器上也写着当前预设名
    expect(screen.getByTitle(t('ai.preset.title')).textContent).toContain('只读巡检')
  })

  it('选中预设会把它的元信息报给调用方（角色写死在预设里）', async () => {
    const s = setup({ preset: '只读巡检' })
    await waitFor(() =>
      expect(s.onResolve).toHaveBeenCalledWith({ name: '只读巡检', role: 'coder' }),
    )
  })

  it('「编辑预设…」是另一个入口，点了回调', () => {
    const s = setup()
    fireEvent.click(screen.getByText(t('ai.agentCore.presetEdit')))
    expect(s.onEditPresets).toHaveBeenCalled()
  })

  it('没有项目 / 表为空：不崩，明说还没有预设', async () => {
    getPresets.mockResolvedValue({ ok: true, data: { presets: [] } })
    setup({ projectPath: undefined })
    expect(await screen.findByText(t('ai.preset.empty'))).toBeInTheDocument()
    // 没有项目时根本不去读注册表（读也读不到）
    expect(getPresets).not.toHaveBeenCalled()
  })

  it('文件级问题要说出来（否则用户只看到"我的预设没了"）', async () => {
    getPresets.mockResolvedValue({
      ok: true,
      data: { presets: [], fileProblem: 'JSON 解析失败：Unexpected end' },
    })
    setup()
    expect(
      await screen.findByText(
        t('ai.preset.fileProblem', { reason: 'JSON 解析失败：Unexpected end' }),
      ),
    ).toBeInTheDocument()
  })

  it('坏条目显示原因、禁用、且选中它时触发器带 ⚠（与运行时 fail-closed 一致）', async () => {
    getPresets.mockResolvedValue({
      ok: true,
      data: {
        presets: [
          { name: '只读巡检', role: 'coder' },
          { name: '全放行', broken: '与前面的「只读巡检」重名（这一条不生效）' },
        ],
      },
    })
    setup({ preset: '全放行' })
    const row = await screen.findByTitle('与前面的「只读巡检」重名（这一条不生效）')
    expect(row).toBeDisabled()
    expect(row.textContent).toContain(t('ai.preset.brokenTag'))
    expect(screen.getByTitle(t('ai.preset.title')).textContent).toContain('⚠')
  })

  it('字段被忽略的条目可选中，title 里说明差异', async () => {
    getPresets.mockResolvedValue({
      ok: true,
      data: {
        presets: [{ name: '半坏预设', notes: ['role 不认识，已忽略'] }],
      },
    })
    const s = setup()
    // notes 小字和行本身都带这条 title，取按钮那一行
    const row = (await screen.findAllByTitle(/role 不认识，已忽略/)).find(
      el => el.tagName === 'BUTTON',
    )!
    expect(row).toBeTruthy()
    expect(row).not.toBeDisabled()
    fireEvent.click(row)
    expect(s.onPickPreset).toHaveBeenCalledWith('半坏预设')
  })
})
