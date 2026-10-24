// tests/renderer/components/ai/PresetEditor.test.tsx
//
// 预设编辑从 JSON 换成表单（2026-10-25）之后要钉住的是：**写回磁盘的那份数组**。
// 表单只是壳，契约在 .qqbat/agent-presets.json 里 —— 少写一个键、多写一个空串，
// 主进程解析出来的权限边界就悄悄变了。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { PresetEditor } from '@renderer/components/ai/PresetEditor'
import { t } from '@renderer/i18n'

const FILE = [
  {
    name: '只读巡检',
    role: 'coder',
    description: '只看不改',
    allowedTools: ['read_file'],
    // 老文件里的 id 已经不再参与选择，但保存时不许丢
    id: 'ro',
    // 表单不认识的字段：必须原样带回去
    legacyNote: 'keep-me',
  },
  { name: '全放行', permissionMode: 'full' },
]

let read: ReturnType<typeof vi.fn>
let toolsMock: ReturnType<typeof vi.fn>
let savePresets: ReturnType<typeof vi.fn>

beforeEach(() => {
  read = vi.fn().mockResolvedValue({ ok: true, data: JSON.stringify(FILE) })
  toolsMock = vi.fn().mockResolvedValue({
    ok: true,
    data: [
      { name: 'read_file', description: '读文件', parameters: {}, category: 'query' },
      { name: 'write_file', description: '写文件', parameters: {}, category: 'mutation' },
    ],
  })
  savePresets = vi.fn().mockResolvedValue({ ok: true, data: { saved: 2, warnings: [] } })
  window.qqbat = { file: { read }, ai: { tools: toolsMock, savePresets } } as never
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as never as { qqbat?: unknown }).qqbat
})

const save = (): void => {
  fireEvent.click(screen.getByRole('button', { name: t('common.save') }))
}

function savedPresets(): Array<Record<string, unknown>> {
  return savePresets.mock.calls[0][1] as Array<Record<string, unknown>>
}

describe('预设编辑（表单）', () => {
  it('★ 打开就列出全部预设，字段铺的是选中的那一条', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByRole('button', { name: '只读巡检' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全放行' })).toBeInTheDocument()
    expect(screen.getByLabelText(t('ai.agentCore.presetFieldName'))).toHaveValue('只读巡检')
    expect(screen.getByLabelText(t('ai.agentCore.presetFieldDescription'))).toHaveValue('只看不改')
    expect(screen.getByLabelText(t('ai.agentCore.presetFieldRole'))).toHaveValue('coder')
    expect(screen.getByLabelText(t('ai.agentCore.presetFieldApproval'))).toHaveValue('')
  })

  it('★ 改角色 + 勾工具：写回新值，未知字段原样保留', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('button', { name: '只读巡检' })
    fireEvent.change(screen.getByLabelText(t('ai.agentCore.presetFieldRole')), {
      target: { value: 'builder' },
    })
    fireEvent.click(await screen.findByRole('checkbox', { name: /write_file/ }))
    save()
    await waitFor(() => expect(savePresets).toHaveBeenCalledTimes(1))
    expect(savePresets.mock.calls[0][0]).toBe('/p')
    const first = savedPresets()[0]
    expect(first.role).toBe('builder')
    expect(first.allowedTools).toEqual(['read_file', 'write_file'])
    expect(first.id).toBe('ro')
    expect(first.legacyNote).toBe('keep-me')
  })

  it('★ 清空可选字段 = 那个键从文件里消失（不写空串）', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('button', { name: '只读巡检' })
    fireEvent.change(screen.getByLabelText(t('ai.agentCore.presetFieldDescription')), {
      target: { value: '' },
    })
    save()
    await waitFor(() => expect(savePresets).toHaveBeenCalledTimes(1))
    expect('description' in savedPresets()[0]).toBe(false)
  })

  it('没勾工具的那条不写 allowedTools（= 不限制，而不是空数组）', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('button', { name: '全放行' })
    fireEvent.click(screen.getByRole('button', { name: '全放行' }))
    save()
    await waitFor(() => expect(savePresets).toHaveBeenCalledTimes(1))
    expect('allowedTools' in savedPresets()[1]).toBe(false)
    expect(savedPresets()[1].permissionMode).toBe('full')
  })

  it('★ 名字为空不提交（主进程只会静默跳过，界面必须先拦）', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('button', { name: '只读巡检' })
    fireEvent.change(screen.getByLabelText(t('ai.agentCore.presetFieldName')), {
      target: { value: '   ' },
    })
    save()
    expect(
      await screen.findByText(t('ai.agentCore.presetNameRequired', { index: 1 })),
    ).toBeInTheDocument()
    expect(savePresets).not.toHaveBeenCalled()
  })

  it('重名不提交', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('button', { name: '全放行' })
    fireEvent.click(screen.getByRole('button', { name: '全放行' }))
    fireEvent.change(screen.getByLabelText(t('ai.agentCore.presetFieldName')), {
      target: { value: '只读巡检' },
    })
    save()
    expect(
      await screen.findByText(t('ai.agentCore.presetDuplicateName', { name: '只读巡检' })),
    ).toBeInTheDocument()
    expect(savePresets).not.toHaveBeenCalled()
  })

  it('删除预设后保存的数组里就没有它', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('button', { name: '只读巡检' })
    fireEvent.click(screen.getByRole('button', { name: t('ai.agentCore.presetDelete') }))
    save()
    await waitFor(() => expect(savePresets).toHaveBeenCalledTimes(1))
    expect(savedPresets().map(p => p.name)).toEqual(['全放行'])
  })

  it('有 warnings 时不关窗，但 onSaved 已经通知外面刷新', async () => {
    savePresets.mockResolvedValue({
      ok: true,
      data: { saved: 2, warnings: ['预设「只读巡检」引用了不存在的工具: ghost_tool'] },
    })
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<PresetEditor open projectPath="/p" onClose={onClose} onSaved={onSaved} />)
    await screen.findByRole('button', { name: '只读巡检' })
    save()
    expect(await screen.findByText(/ghost_tool/)).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('★ 坏文件：原样进 JSON 模式并报错，改好后能直接保存', async () => {
    read.mockResolvedValue({ ok: true, data: '{ 这不是 JSON' })
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    const box = (await screen.findByRole('textbox', {
      name: t('ai.agentCore.presetRawToggle'),
    })) as HTMLTextAreaElement
    expect(box.value).toBe('{ 这不是 JSON')
    expect(screen.getByText(t('ai.agentCore.presetLoadBroken'))).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '[{"name": "修好的"}]' } })
    save()
    await waitFor(() => expect(savePresets).toHaveBeenCalledTimes(1))
    expect(savedPresets()).toEqual([{ name: '修好的' }])
  })

  it('JSON 模式解析失败不吞内容：留在 JSON 模式并报错', async () => {
    render(<PresetEditor open projectPath="/p" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('button', { name: '只读巡检' })
    fireEvent.click(screen.getByRole('checkbox', { name: t('ai.agentCore.presetRawToggle') }))
    const box = screen.getByRole('textbox', {
      name: t('ai.agentCore.presetRawToggle'),
    }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('checkbox', { name: t('ai.agentCore.presetRawToggle') }))
    // 同一条错误可能同时出现在错误区与无障碍播报区，这里只要求「报了」
    expect((await screen.findAllByText(/JSON 解析失败/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: t('ai.agentCore.presetRawToggle') })).toHaveValue(
      'nope',
    )
  })

  it('没有项目路径：明说没地方存，保存按钮禁用（不许静默失败）', async () => {
    render(<PresetEditor open projectPath={undefined} onClose={() => {}} onSaved={() => {}} />)
    // 提示走两处：说明区一条，空态一条；两处都得说「先打开项目」
    expect((await screen.findAllByText(t('ai.agentCore.presetNoProject'))).length).toBeGreaterThan(
      0,
    )
    // 不读盘：没有项目就没有文件可读
    expect(read).not.toHaveBeenCalled()
    const btn = screen.getByRole('button', { name: t('common.save') }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    await Promise.resolve()
    expect(savePresets).not.toHaveBeenCalled()
  })
})
