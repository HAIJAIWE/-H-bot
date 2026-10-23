// tests/renderer/stores/aiStore-proposal.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Proposal, ProposalOperation } from '@shared/types/proposal'

// 使用 vi.hoisted 保证 vi.fn 引用在 vi.mock 工厂中稳定（vi.mock 会被提升）
const mocks = vi.hoisted(() => {
  return {
    flow: {
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateNodeConfig: vi.fn(),
      removeNode: vi.fn(),
      autoLayout: vi.fn(),
      snapshot: vi.fn(() => ({ nodes: [], edges: [] })),
      rollback: vi.fn(),
      generateCode: vi.fn().mockResolvedValue(true),
      // 阶段 3：applyProposal 会读 useFlowStore.getState().nodes/edges 做自动布局判定
      nodes: [] as unknown[],
      edges: [] as unknown[],
      updateNodePosition: vi.fn(),
      // 阶段 6：applyProposal 完成后调用 highlightNodes 高亮新增节点
      highlightNodes: vi.fn(),
      // 阶段 7：新增节点落画布后跑一次整体校验（读回 errorNodeIds/nodeErrors 标红）
      validateAllNodes: vi.fn(),
      errorNodeIds: new Set<string>(),
      nodeErrors: {} as Record<string, unknown>
    },
    project: {
      currentProject: null as { path: string } | null
    },
    // applyProposal 用一个撤销单元包整批操作（src/renderer/src/stores/aiStore.ts:1473 beginHistoryBatch）
    historyBatch: {
      beginHistoryBatch: vi.fn(),
      endHistoryBatch: vi.fn(),
      pushHistoryPoint: vi.fn()
    }
  }
})

// 必须在 import aiStore 之前 mock flowStore（vi.mock 会自动提升到文件顶部）
vi.mock('@renderer/stores/flowStore', () => ({
  useFlowStore: {
    getState: () => mocks.flow
  },
  beginHistoryBatch: mocks.historyBatch.beginHistoryBatch,
  endHistoryBatch: mocks.historyBatch.endHistoryBatch,
  pushHistoryPoint: mocks.historyBatch.pushHistoryPoint
}))

vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => mocks.project
  }
}))

import { useAiStore } from '@renderer/stores/aiStore'

/** 设置 window.qqbat mock，返回 listeners 与各 spy */
function setupQqbat() {
  const listeners: Record<string, ((payload: unknown) => void) | undefined> = {}
  const fileWrite = vi.fn().mockResolvedValue({ ok: true })
  const fileRead = vi.fn().mockResolvedValue({ ok: false, error: 'not found' })
  const terminalCreate = vi.fn().mockResolvedValue({ ok: true, data: 't1' })
  const terminalWrite = vi.fn().mockResolvedValue({ ok: true })

  const makeListener = (key: string) => (cb: (payload: unknown) => void) => {
    listeners[key] = cb
    return () => {
      delete listeners[key]
    }
  }

  ;(window as unknown as { qqbat: unknown }).qqbat = {
    file: { write: fileWrite, read: fileRead, list: vi.fn() },
    terminal: { create: terminalCreate, write: terminalWrite, kill: vi.fn() },
    runtime: { start: vi.fn(), stop: vi.fn() },
    ai: {
      onChunk: makeListener('chunk'),
      onResponse: makeListener('response'),
      onNeedRollback: makeListener('needRollback'),
      onClientInstruction: makeListener('clientInstruction'),
      onAgentState: makeListener('agentState'),
      onProposal: makeListener('proposal'),
      chat: vi.fn().mockResolvedValue({ ok: true }),
      beginBatch: vi.fn().mockResolvedValue({ ok: true }),
      commitBatch: vi.fn().mockResolvedValue({ ok: true }),
      rollbackBatch: vi.fn().mockResolvedValue({ ok: true })
    }
  }
  return { listeners, fileWrite, fileRead, terminalCreate, terminalWrite }
}

beforeEach(() => {
  // 重置 flow mock
  mocks.flow.addNode = vi.fn()
  mocks.flow.addEdge = vi.fn()
  mocks.flow.updateNodeConfig = vi.fn()
  mocks.flow.removeNode = vi.fn()
  mocks.flow.autoLayout = vi.fn()
  mocks.flow.snapshot = vi.fn(() => ({ nodes: [], edges: [] }))
  mocks.flow.rollback = vi.fn()
  mocks.flow.generateCode = vi.fn().mockResolvedValue(true)
  mocks.flow.nodes = []
  mocks.flow.edges = []
  mocks.flow.updateNodePosition = vi.fn()
  mocks.flow.highlightNodes = vi.fn()
  mocks.flow.validateAllNodes = vi.fn()
  mocks.flow.errorNodeIds = new Set<string>()
  mocks.flow.nodeErrors = {}
  // 重置 project mock
  mocks.project.currentProject = null
  // 重置 store 状态
  useAiStore.setState({
    currentProposal: null,
    messages: [],
    streaming: false,
    currentChunk: '',
    toolCalls: [],
    agentState: { state: 'idle' },
    isBatchMode: false
  })
  // 默认设置 window.qqbat
  setupQqbat()
})

describe('aiStore proposal', () => {
  it('setProposal 设置当前 proposal', () => {
    const p: Proposal = { id: '1', summary: 'test', operations: [], riskLevel: 'low', createdAt: 0 }
    useAiStore.getState().setProposal(p)
    expect(useAiStore.getState().currentProposal?.id).toBe('1')
  })

  it('setProposal(null) 清空当前 proposal', () => {
    const p: Proposal = { id: '1', summary: 'test', operations: [], riskLevel: 'low', createdAt: 0 }
    useAiStore.getState().setProposal(p)
    useAiStore.getState().setProposal(null)
    expect(useAiStore.getState().currentProposal).toBeNull()
  })

  it('applyProposal 执行后清空 currentProposal', async () => {
    const p: Proposal = {
      id: '1',
      summary: 'test',
      riskLevel: 'low',
      createdAt: 0,
      operations: [{ kind: 'add_node', tempRef: 'new_n1', nodeKind: 'message_received' }]
    }
    useAiStore.getState().setProposal(p)
    await useAiStore.getState().applyProposal(p.operations)
    expect(useAiStore.getState().currentProposal).toBeNull()
  })

  it('rejectProposal 清空 currentProposal', () => {
    const p: Proposal = {
      id: '2',
      summary: 'reject me',
      operations: [],
      riskLevel: 'low',
      createdAt: 0
    }
    useAiStore.getState().setProposal(p)
    useAiStore.getState().rejectProposal()
    expect(useAiStore.getState().currentProposal).toBeNull()
  })
})

// ====== Issue 1: 事务性回滚失败后 currentProposal 未清理 ======
describe('aiStore applyProposal 事务性回滚', () => {
  it('画布操作失败时回滚并清理 currentProposal + 设置 error 状态', async () => {
    mocks.flow.addNode.mockImplementation(() => {
      throw new Error('addNode 失败')
    })
    const p: Proposal = {
      id: 'rollback-1',
      summary: 'rollback test',
      riskLevel: 'low',
      createdAt: 0,
      operations: [
        { kind: 'add_node', tempRef: 'new_n1', nodeKind: 'message_received' }
      ]
    }
    useAiStore.getState().setProposal(p)
    await useAiStore.getState().applyProposal(p.operations)

    expect(mocks.flow.rollback).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(useAiStore.getState().agentState.state).toBe('error')
  })

  it('成功路径不调用 rollback', async () => {
    const p: Proposal = {
      id: 'ok-1',
      summary: 'ok',
      riskLevel: 'low',
      createdAt: 0,
      operations: [{ kind: 'add_node', tempRef: 'new_n1', nodeKind: 'message_received' }]
    }
    useAiStore.getState().setProposal(p)
    await useAiStore.getState().applyProposal(p.operations)
    expect(mocks.flow.rollback).not.toHaveBeenCalled()
    expect(useAiStore.getState().currentProposal).toBeNull()
  })
})

// ====== Issue 2: write_code/generate_code 不可回滚 ======
describe('aiStore applyProposal 磁盘操作两阶段回滚', () => {
  it('write_code 失败时恢复已写入文件的原内容（按备份逆序）', async () => {
    mocks.project.currentProject = { path: '/proj' }
    const { fileWrite, fileRead } = setupQqbat()

    // file.read 返回原内容
    fileRead.mockResolvedValue({ ok: true, data: 'oldA' })
    // 第一个 write 成功，第二个失败
    fileWrite
      .mockResolvedValueOnce({ ok: true }) // a.py write 成功
      .mockRejectedValueOnce(new Error('disk full')) // b.py write 失败
    // 恢复 a.py 的 write
    fileWrite.mockResolvedValue({ ok: true })

    const ops: ProposalOperation[] = [
      { kind: 'write_code', filePath: 'a.py', content: 'newA', riskLevel: 'low' },
      { kind: 'write_code', filePath: 'b.py', content: 'newB', riskLevel: 'low' }
    ]
    await useAiStore.getState().applyProposal(ops)

    // 验证 file.read 被调用于备份
    expect(fileRead).toHaveBeenCalledWith('/proj', 'a.py')
    expect(fileRead).toHaveBeenCalledWith('/proj', 'b.py')
    // 验证恢复：a.py 的原内容 'oldA' 被写回
    const writeCalls = fileWrite.mock.calls
    const restoreCall = writeCalls.find(
      (c) => c[1] === 'a.py' && c[2] === 'oldA'
    )
    expect(restoreCall).toBeTruthy()
    // currentProposal 被清理
    expect(useAiStore.getState().currentProposal).toBeNull()
  })

  it('generate_code 失败时回滚画布并清理 currentProposal', async () => {
    mocks.project.currentProject = { path: '/proj' }
    mocks.flow.generateCode.mockRejectedValue(new Error('codegen 失败'))

    const ops: ProposalOperation[] = [
      { kind: 'add_node', tempRef: 'new_n1', nodeKind: 'message_received' },
      { kind: 'generate_code' }
    ]
    await useAiStore.getState().applyProposal(ops)

    expect(mocks.flow.rollback).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(useAiStore.getState().agentState.state).toBe('error')
  })
})

// ====== Issue 4: write_code filePath 路径校验 ======
describe('aiStore applyProposal filePath 校验', () => {
  beforeEach(() => {
    mocks.project.currentProject = { path: '/proj' }
  })

  it('filePath 含 .. 时抛错', async () => {
    const ops: ProposalOperation[] = [
      { kind: 'write_code', filePath: '../etc/passwd', content: 'x', riskLevel: 'low' }
    ]
    await useAiStore.getState().applyProposal(ops)
    // 应回滚并清理
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(useAiStore.getState().agentState.state).toBe('error')
  })

  it('filePath 为绝对路径（Windows 盘符）时抛错', async () => {
    const ops: ProposalOperation[] = [
      { kind: 'write_code', filePath: 'C:\\Windows\\system32\\evil.dll', content: 'x', riskLevel: 'low' }
    ]
    await useAiStore.getState().applyProposal(ops)
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(useAiStore.getState().agentState.state).toBe('error')
  })

  it('filePath 为绝对路径（Unix）时抛错', async () => {
    const ops: ProposalOperation[] = [
      { kind: 'write_code', filePath: '/etc/passwd', content: 'x', riskLevel: 'low' }
    ]
    await useAiStore.getState().applyProposal(ops)
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(useAiStore.getState().agentState.state).toBe('error')
  })

  it('合法相对路径正常执行', async () => {
    const { fileWrite } = setupQqbat()
    const ops: ProposalOperation[] = [
      { kind: 'write_code', filePath: 'src/plugins/foo.py', content: 'x', riskLevel: 'low' }
    ]
    await useAiStore.getState().applyProposal(ops)
    expect(fileWrite).toHaveBeenCalledWith('/proj', 'src/plugins/foo.py', 'x')
    expect(useAiStore.getState().currentProposal).toBeNull()
  })
})

// ====== Issue 6: clearMessages 未清理 currentProposal ======
describe('aiStore clearMessages', () => {
  it('clearMessages 清理 currentProposal', () => {
    const p: Proposal = { id: 'c1', summary: 'clear', operations: [], riskLevel: 'low', createdAt: 0 }
    useAiStore.getState().setProposal(p)
    expect(useAiStore.getState().currentProposal).not.toBeNull()
    useAiStore.getState().clearMessages()
    expect(useAiStore.getState().currentProposal).toBeNull()
  })
})

// ====== Issue 7: applyProposal 空 ops 仍触发 autoLayout ======
describe('aiStore applyProposal 空 ops', () => {
  it('空 ops 时清理 currentProposal 且不调用 autoLayout', async () => {
    const p: Proposal = { id: 'empty', summary: 'empty', operations: [], riskLevel: 'low', createdAt: 0 }
    useAiStore.getState().setProposal(p)
    await useAiStore.getState().applyProposal([])
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(mocks.flow.autoLayout).not.toHaveBeenCalled()
  })
})

// ====== Issue 8: projectPath 默认空字符串 ======
describe('aiStore applyProposal projectPath 校验', () => {
  it('磁盘操作时无 projectPath 抛错', async () => {
    // currentProject 为 null
    const ops: ProposalOperation[] = [
      { kind: 'write_code', filePath: 'a.py', content: 'x', riskLevel: 'low' }
    ]
    await useAiStore.getState().applyProposal(ops)
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(useAiStore.getState().agentState.state).toBe('error')
  })
})

// ====== Issue 10: 未知 kind 默认分支 ======
describe('aiStore applyProposal 未知 kind', () => {
  it('未知 kind 抛错并回滚', async () => {
    const ops = [{ kind: 'unknown_op' }] as unknown as ProposalOperation[]
    await useAiStore.getState().applyProposal(ops)
    expect(mocks.flow.rollback).toHaveBeenCalledTimes(1)
    expect(mocks.flow.autoLayout).not.toHaveBeenCalled()
    expect(useAiStore.getState().currentProposal).toBeNull()
    expect(useAiStore.getState().agentState.state).toBe('error')
  })
})

// ====== Issue 3: ai:proposal 事件过滤 projectPath ======
describe('aiStore init projectPath 过滤', () => {
  it('onProposal 过滤其他项目的 proposal', () => {
    mocks.project.currentProject = { path: '/projA' }
    const { listeners } = setupQqbat()
    useAiStore.getState().init()

    // 触发其他项目的 proposal
    const otherProposal: Proposal = {
      id: 'other',
      summary: 'other proj',
      operations: [],
      riskLevel: 'low',
      createdAt: 0
    }
    listeners.proposal?.({ projectPath: '/projB', proposal: otherProposal })
    expect(useAiStore.getState().currentProposal).toBeNull()

    // 触发当前项目的 proposal
    const myProposal: Proposal = {
      id: 'mine',
      summary: 'my proj',
      operations: [],
      riskLevel: 'low',
      createdAt: 0
    }
    listeners.proposal?.({ projectPath: '/projA', proposal: myProposal })
    expect(useAiStore.getState().currentProposal?.id).toBe('mine')
  })

  it('onChunk 过滤其他项目的事件', () => {
    mocks.project.currentProject = { path: '/projA' }
    const { listeners } = setupQqbat()
    useAiStore.getState().init()

    useAiStore.setState({ streaming: true, currentChunk: '' })
    // 其他项目的 chunk 应被忽略
    listeners.chunk?.({ projectPath: '/projB', text: 'hello' })
    expect(useAiStore.getState().currentChunk).toBe('')

    // 当前项目的 chunk 应被追加
    listeners.chunk?.({ projectPath: '/projA', text: 'world' })
    expect(useAiStore.getState().currentChunk).toBe('world')
  })

  it('onAgentState 过滤其他项目的事件', () => {
    mocks.project.currentProject = { path: '/projA' }
    const { listeners } = setupQqbat()
    useAiStore.getState().init()

    listeners.agentState?.({ projectPath: '/projB', state: 'thinking', message: 'other' })
    expect(useAiStore.getState().agentState.state).toBe('idle')

    listeners.agentState?.({ projectPath: '/projA', state: 'thinking', message: 'mine' })
    expect(useAiStore.getState().agentState.state).toBe('thinking')
  })
})

// ====== Issue 12 & 13: handleClientInstruction ======
describe('aiStore handleClientInstruction', () => {
  it('instruction 失败被捕获（不产生未处理 rejection）', async () => {
    const { listeners } = setupQqbat()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAiStore.getState().init()

    // run_command 的非法命令会抛错
    listeners.clientInstruction?.({
      instruction: { name: 'run_command', args: { command: 'rm -rf /' } }
    })
    // 等待 promise settle
    await new Promise((r) => setTimeout(r, 50))

    expect(consoleSpy).toHaveBeenCalledWith('instruction 失败', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('run_command 非白名单命令不写入终端', async () => {
    const { listeners, terminalWrite } = setupQqbat()
    useAiStore.getState().init()

    listeners.clientInstruction?.({
      instruction: { name: 'run_command', args: { projectPath: '/p', command: 'rm -rf /' } }
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(terminalWrite).not.toHaveBeenCalled()
  })

  it('run_command 不在前端执行面：不写终端，按未知指令告警', async () => {
    const { listeners, terminalWrite } = setupQqbat()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAiStore.getState().init()

    listeners.clientInstruction?.({
      instruction: { name: 'run_command', args: { projectPath: '/p', command: 'pip install foo' } },
    })
    await new Promise((r) => setTimeout(r, 50))

    // 10/18 起没有「前端终端」这条执行面（终端插件已退役）：命令类指令一律不执行，
    // 也不能假装成功 —— 未知指令会 throw，外层捕获后打 'instruction 失败'。
    expect(terminalWrite).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('未知指令'), expect.anything())
    expect(errorSpy).toHaveBeenCalledWith('instruction 失败', expect.any(Error))
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('install_plugin 同样不可执行（不写终端，按未知指令告警）', async () => {
    const { listeners, terminalWrite } = setupQqbat()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAiStore.getState().init()

    listeners.clientInstruction?.({
      instruction: { name: 'install_plugin', args: { projectPath: '/p', packageName: 'nonebot-adapter-onebot' } },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(terminalWrite).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('未知指令'), expect.anything())
    expect(errorSpy).toHaveBeenCalledWith('instruction 失败', expect.any(Error))
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
