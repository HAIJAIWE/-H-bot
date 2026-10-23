// tests/renderer/lib/commandWizard.test.ts
//
// 「新建指令」向导生成的节点链。
//
// 为什么要测纯数据：端口名（next/in/out/result/var1）写错一个，生成出来的链就是**断的**，
// 而界面上完全看不出来（节点都在、连线也画了，只是数据到不了）。这里把契约钉死。
// 真机验证见 docs/pending-design.md 的 D5 验收动作（生成后跑「问题」面板应为 0 问题）。
import { describe, it, expect } from 'vitest'
import {
  buildCommandChain,
  isCommandWizardReady,
  isValidDataKey,
  normalizeCommand,
} from '../../../src/renderer/src/lib/commandWizard'

describe('命令词归一化', () => {
  it('去掉用户顺手带的斜杠与首尾空白', () => {
    expect(normalizeCommand(' /签到 ')).toBe('签到')
    expect(normalizeCommand('签到')).toBe('签到')
    expect(normalizeCommand('//签到')).toBe('签到')
  })
})

describe('数据名的合法性（与 variable_persist 的校验同一套）', () => {
  it('只收英文/数字/下划线，且以字母或下划线开头', () => {
    expect(isValidDataKey('score')).toBe(true)
    expect(isValidDataKey('score_2')).toBe(true)
    expect(isValidDataKey('_tmp')).toBe(true)
    // 真机踩到：默认给中文「积分」时，生成的链跑起来报「非法变量名」
    expect(isValidDataKey('积分')).toBe(false)
    expect(isValidDataKey('2score')).toBe(false)
    expect(isValidDataKey('score-2')).toBe(false)
    expect(isValidDataKey('')).toBe(false)
  })
})

describe('向导就绪判定', () => {
  it('命令词与回复都填了才算就绪（避免生成空指令）', () => {
    expect(isCommandWizardReady({ command: '签到', reply: '✅ 好了' })).toBe(true)
    expect(isCommandWizardReady({ command: '', reply: '✅ 好了' })).toBe(false)
    expect(isCommandWizardReady({ command: '签到', reply: '   ' })).toBe(false)
  })

  it('记数据时数据名不合法也不算就绪（提前拦住"非法变量名"的运行期报错）', () => {
    const base = { command: '签到', reply: '✅ {var1}', dataMode: 'increment' as const }
    expect(isCommandWizardReady({ ...base, dataKey: '积分' })).toBe(false)
    expect(isCommandWizardReady({ ...base, dataKey: 'jifen' })).toBe(true)
  })
})

describe('buildCommandChain：不记数据', () => {
  it('两个节点（触发器 + 发送），一条 next→in 控制线', () => {
    const { nodes, edges } = buildCommandChain({ command: '/菜单', reply: '你好～' })
    expect(nodes.map((n) => n.kind)).toEqual(['message_received', 'message_send'])
    expect(nodes[0].config).toMatchObject({
      match: 'command',
      command: '菜单',
      prefix: '/',
      message_type: 'any',
    })
    expect(nodes[1].config).toMatchObject({ mode: 'text', text: '你好～' })
    expect(edges).toEqual([{ from: 0, fromPort: 'next', to: 1, toPort: 'in' }])
  })
})

describe('buildCommandChain：记数据', () => {
  it('每次 +1：数值经 result→var1 数据线直接接进发送节点（不再需要文本模板节点）', () => {
    const { nodes, edges } = buildCommandChain({
      command: '签到',
      reply: '✅ 当前积分 {var1}',
      dataMode: 'increment',
      dataKey: 'jifen',
    })
    // 10/18 起 increment 走 `incr_variable`（原子自增），不再借用 variable_persist 的 mode
    expect(nodes.map((n) => n.kind)).toEqual(['message_received', 'incr_variable', 'message_send'])
    expect(nodes[1].config).toMatchObject({
      key: 'jifen',
      scope: 'user',
      amount: 1,
      default: 0,
      auto_save: true,
    })
    expect(edges).toEqual([
      { from: 0, fromPort: 'next', to: 1, toPort: 'in' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'var1' },
    ])
  })

  it('只读取：用 load_or_default（首次读到默认值并落库）', () => {
    const { nodes } = buildCommandChain({
      command: '积分',
      reply: '💰 你的积分：{var1}',
      dataMode: 'read',
      dataKey: 'jifen',
    })
    expect(nodes[1].config).toMatchObject({
      mode: 'load_or_default',
      key: 'jifen',
      default: 0,
      auto_save: true,
    })
  })

  it('数据名留空时回落到默认键名；命令词带斜杠也能对上', () => {
    const { nodes } = buildCommandChain({
      command: '/签到',
      reply: 'x',
      dataMode: 'increment',
      dataKey: '   ',
    })
    expect(nodes[1].config?.key).toBe('score')
    expect(nodes[0].config?.command).toBe('签到')
  })
})