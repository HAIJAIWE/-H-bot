// tests/renderer/components/ai/PresetSelect.test.tsx
//
// 下拉的 value 必须是**预设名**：主进程 readPreset(projectPath, name) 只按 name 查。
// 2026-10-25 之前这里把文件里的 id 当 value —— 写了 id 的预设选中后主进程查不到，
// 白名单与角色全部静默失效（界面看起来一切正常，这是最难发现的一类错）。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { parsePresetOptions } from '@renderer/components/ai/PresetSelect'

describe('parsePresetOptions', () => {
  it('★ 键用 name，文件里写了 id 也不改变选项的值', () => {
    const { options, meta } = parsePresetOptions([
      { name: '只读巡检', id: 'readonly-patrol', role: 'coder', permissionMode: 'ask' },
    ])
    expect(options).toEqual([{ name: '只读巡检' }])
    expect(meta['只读巡检']).toEqual({ role: 'coder', permissionMode: 'ask' })
  })

  it('同名只留第一条（主进程写盘时后者覆盖前者，界面不该列出两个）', () => {
    const { options } = parsePresetOptions([
      { name: 'a', role: 'builder' },
      { name: 'a', role: 'coder' },
    ])
    expect(options).toEqual([{ name: 'a' }])
  })

  it('没名字的跳过；未知 role / permissionMode 只丢那一项，不连坐整条', () => {
    const { options, meta } = parsePresetOptions([
      { role: 'coder' },
      { name: '   ' },
      { name: '半成品', role: 'wizard', permissionMode: 'sometimes' },
    ])
    expect(options).toEqual([{ name: '半成品' }])
    expect(meta['半成品']).toEqual({})
  })

  it('名字两端空白会去掉（与主进程 writePresets 的归一一致）', () => {
    const { options } = parsePresetOptions([{ name: '  巡检  ' }])
    expect(options).toEqual([{ name: '巡检' }])
  })

  it('不是数组 = 空表（坏文件不能把界面搞崩）', () => {
    expect(parsePresetOptions({ name: 'x' })).toEqual({ options: [], meta: {} })
    expect(parsePresetOptions(null)).toEqual({ options: [], meta: {} })
    expect(parsePresetOptions('nope')).toEqual({ options: [], meta: {} })
  })

  it('工具白名单与插件限定按主进程同一条规则归一：只留非空字符串、去重', () => {
    const { meta } = parsePresetOptions([
      { name: 'a', allowedTools: ['read_file', 'read_file', '', 3, null, 'list_dir'] },
      { name: 'b', plugins: ['market-clock', ' '] },
    ])
    expect(meta.a.allowedTools).toEqual(['read_file', 'list_dir'])
    expect(meta.b.plugins).toEqual(['market-clock'])
  })

  it('★ 空数组当"没写"（主进程里空集=不限制，界面不能显示成"工具只留 0 个"）', () => {
    const { meta } = parsePresetOptions([{ name: 'a', allowedTools: [], plugins: [] }])
    expect(meta.a.allowedTools).toBeUndefined()
    expect(meta.a.plugins).toBeUndefined()
  })
})
