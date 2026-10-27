// tests/main/ipc/aiAgentCoreApproval.test.ts
//
// 第 60 批：审批闸门抽成独立模块后的**单元**测试。
//
// 为什么还要单独测：`aiAgentCore-ipc` 那条用例走的是整条 IPC（窗口永远存在），
// 钉不住"窗口不在 = 没有通道"这种分支，也不好断言规则表是否被就地追加。
// 这里只 mock 弹窗那一层（`requestApproval`），其余（角色写域、规则匹配）全用真的。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ApprovalRequest } from '@main/services/agent-core/contracts'
import type { AllowRule } from '@main/services/ai/allowRules'

const h = vi.hoisted(() => ({ requestApproval: vi.fn() }))

vi.mock('@main/services/ai/toolApproval', () => ({
  requestApproval: h.requestApproval,
  APPROVAL_TIMEOUT_MS: 5 * 60 * 1000,
}))
vi.mock('@main/services/infra/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { createApprovalGate } from '@main/ipc/aiAgentCoreApproval'

const PROJECT = 'D:/p'

function fakeWindow(): BrowserWindow {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } } as unknown as BrowserWindow
}

/** 一套默认上下文：coder（可以写 src/）、ask 口径、空规则表 */
function makeGate(overrides: Partial<Parameters<typeof createApprovalGate>[0]> = {}) {
  const allowRules: AllowRule[] = []
  const approved = new Set<string>()
  const addRule = vi.fn(async () => {})
  const gate = createApprovalGate({
    projectPath: PROJECT,
    role: 'coder',
    effectiveFullAccess: false,
    allowRules,
    approved,
    window: fakeWindow(),
    addRule,
    ...overrides,
  })
  return { gate, allowRules, approved, addRule }
}

function write(summary = 'src/a.ts'): ApprovalRequest {
  return { kind: 'write', summary }
}

beforeEach(() => {
  h.requestApproval.mockReset().mockResolvedValue({ decision: 'allow', reason: 'user' })
})

describe('★ 闸门：没有窗口 = 没有通道（M2 unavailable）', () => {
  it('直接拒绝并说明是环境问题，不白等 5 分钟', async () => {
    const { gate } = makeGate({ window: null })
    await expect(gate(write())).rejects.toThrow(/没有可用的审批通道/)
    await expect(gate(write())).rejects.toThrow(/打开主窗口/)
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('窗口已销毁也算不在', async () => {
    const destroyed = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    const { gate } = makeGate({ window: destroyed as unknown as BrowserWindow })
    await expect(gate(write())).rejects.toThrow(/没有可用的审批通道/)
    expect(h.requestApproval).not.toHaveBeenCalled()
  })
})

describe('★ 闸门：放行口径', () => {
  it('完全权限 → 直接放行，不弹窗、不写规则', async () => {
    const { gate, addRule } = makeGate({ effectiveFullAccess: true })
    await expect(gate(write('src/a.ts'))).resolves.toBe(true)
    expect(h.requestApproval).not.toHaveBeenCalled()
    expect(addRule).not.toHaveBeenCalled()
  })

  it('本轮已选"别再问" → 直接放行', async () => {
    const approved = new Set<string>(['write'])
    const { gate } = makeGate({ approved })
    await expect(gate(write())).resolves.toBe(true)
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('以前记过的规则 → 直接放行（不弹窗）', async () => {
    const allowRules: AllowRule[] = [
      { kind: 'write', match: 'src/a.ts', addedAt: '2026-10-27T00:00:00.000Z' },
    ]
    const { gate } = makeGate({ allowRules })
    await expect(gate(write('src/a.ts'))).resolves.toBe(true)
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('always → 记进本轮集合并落规则（界面可撤销）', async () => {
    h.requestApproval.mockResolvedValue({ decision: 'always', reason: 'user' })
    const { gate, allowRules, approved, addRule } = makeGate()
    await expect(gate(write('src/a.ts'))).resolves.toBe(true)
    expect(approved.has('write')).toBe(true)
    expect(addRule).toHaveBeenCalledWith({ kind: 'write', match: 'src/a.ts' })
    expect(allowRules).toHaveLength(1)
  })
})

describe('★ 闸门：拒绝的四种结局（M2）', () => {
  it('用户拒绝 / 超时 / 取消 → 三句不同的话', async () => {
    const { gate } = makeGate()
    h.requestApproval.mockResolvedValue({ decision: 'deny', reason: 'user' })
    await expect(gate(write())).rejects.toThrow(/被用户拒绝了/)
    await expect(gate(write())).rejects.toThrow(/不要原地重试/)

    h.requestApproval.mockResolvedValue({ decision: 'deny', reason: 'timeout' })
    await expect(gate(write())).rejects.toThrow(/没人点「允许」/)
    await expect(gate(write())).rejects.toThrow(/先把不依赖它的部分做完/)

    h.requestApproval.mockResolvedValue({ decision: 'deny', reason: 'aborted' })
    await expect(gate(write())).rejects.toThrow(/被取消了/)
  })
})

describe('★ 闸门：角色写域在最前', () => {
  it('builder 写 src/ → 直接拒，连弹窗都不弹（点"允许"不能绕过角色边界）', async () => {
    const { gate } = makeGate({ role: 'builder' })
    await expect(gate(write('src/a.ts'))).rejects.toThrow(/不能写它/)
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('builder 写流程文件 → 放行流程照走', async () => {
    const { gate } = makeGate({ role: 'builder' })
    await expect(gate(write('.qqbat/flow.json'))).resolves.toBe(true)
    expect(h.requestApproval).toHaveBeenCalledTimes(1)
  })
})
