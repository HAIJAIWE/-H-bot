// tests/renderer/stores/flowAutoSave.test.ts
//
// 自动保存（本轮修的数据安全问题）。
//
// 背景：磁盘上的 `.qqbat/flow.json` 原来**只有点「生成代码」时才会被写**，
// 于是"搭完直接关窗口 = 白干"、"改完直接点运行 = 解释器读旧文件"。
// 这里锁住四件事：改动即标脏、防抖写盘、Ctrl+S 立即写、启动机器人前先写。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  useFlowStore,
  installFlowPersistence,
  _cancelAutoSaveForTesting,
} from '../../../src/renderer/src/stores/flowStore'
import { useProjectStore } from '../../../src/renderer/src/stores/projectStore'
import { useBotStore } from '../../../src/renderer/src/stores/botStore'
import type { FlowNode } from '../../../src/shared/types/flow'

const PROJECT = 'D:/projects/demo'

function makeNode(id: string): FlowNode {
  return {
    id,
    type: 'action',
    position: { x: 0, y: 0 },
    data: { label: id, nodeKind: 'message_send', config: {}, inputs: [], outputs: [] },
  } as unknown as FlowNode
}

/** 往画布"加一个节点"：用 store.setState 模拟一次真实改动（nodes 引用变化） */
function editFlow(id: string): void {
  useFlowStore.setState((s) => ({ nodes: [...s.nodes, makeNode(id)] }))
}

const graph = {
  schemaVersion: '1.1',
  systems: [],
  nodes: [makeNode('a'), makeNode('b')],
  edges: [],
  nodeGroups: [],
  metadata: {
    name: 'demo',
    version: '1.0',
    runtime: 'typescript',
    createdAt: '',
    updatedAt: '',
  },
}

let saveMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  saveMock = vi.fn(async () => ({ ok: true }))
  ;(window as unknown as { qqbat: unknown }).qqbat = {
    flow: { save: saveMock },
    botManager: { start: vi.fn(async () => ({ ok: true })) },
  }
  useProjectStore.setState({ currentProject: { path: PROJECT, name: 'demo' } as never })
  useFlowStore.setState({
    nodes: [],
    edges: [],
    dirty: false,
    saving: false,
    lastSavedAt: 0,
    loadError: null,
  })
})

afterEach(() => {
  _cancelAutoSaveForTesting()
  vi.useRealTimers()
  useProjectStore.setState({ currentProject: null })
  delete (window as unknown as { qqbat?: unknown }).qqbat
})

describe('流程自动保存', () => {
  it('改动后立刻标脏（不等写盘）', () => {
    const uninstall = installFlowPersistence()
    editFlow('n1')
    expect(useFlowStore.getState().dirty).toBe(true)
    expect(saveMock).not.toHaveBeenCalled() // 防抖期间还没写
    uninstall()
  })

  it('防抖后写盘：连续 3 次改动也只写一次，写到当前项目，写完清脏', async () => {
    const uninstall = installFlowPersistence()
    editFlow('n1')
    editFlow('n2')
    editFlow('n3')
    expect(saveMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1600)

    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveMock.mock.calls[0][0]).toBe(PROJECT)
    expect((saveMock.mock.calls[0][1] as { nodes: FlowNode[] }).nodes).toHaveLength(3)
    expect(useFlowStore.getState().dirty).toBe(false)
    expect(useFlowStore.getState().lastSavedAt).toBeGreaterThan(0)
    uninstall()
  })

  it('写盘失败时保持脏，不能让用户以为已经存住', async () => {
    saveMock.mockResolvedValue({ ok: false, error: '磁盘只读' })
    const uninstall = installFlowPersistence()
    editFlow('n1')
    await vi.advanceTimersByTimeAsync(1600)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(useFlowStore.getState().dirty).toBe(true)
    uninstall()
  })

  it('保存期间又有改动：完成后仍是脏的，等下一轮再存', async () => {
    let release: (v: { ok: boolean }) => void = () => {}
    saveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve as (v: { ok: boolean }) => void
        }),
    )
    const uninstall = installFlowPersistence()

    const pending = useFlowStore.getState().saveNow(PROJECT)
    editFlow('n2') // 写盘途中又改
    release({ ok: true })
    await pending

    expect(useFlowStore.getState().dirty).toBe(true)
    uninstall()
  })

  it('没有打开项目时不写盘（避免把流程写到别处）', async () => {
    useProjectStore.setState({ currentProject: null })
    const ok = await useFlowStore.getState().saveNow()
    expect(ok).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('Ctrl+S 立即写盘，不必等防抖', async () => {
    const uninstall = installFlowPersistence()
    editFlow('n1')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(useFlowStore.getState().dirty).toBe(false)
    uninstall()
  })

  it('卸载后不再自动保存（避免测试/切换项目后残留定时器）', async () => {
    const uninstall = installFlowPersistence()
    uninstall()
    editFlow('n1')
    await vi.advanceTimersByTimeAsync(3000)
    expect(saveMock).not.toHaveBeenCalled()
  })
})

describe('打开项目不会误写盘（回归：真应用里发现的副作用）', () => {
  it('loadGraph 引起的图变化：不标脏、不写盘', async () => {
    const uninstall = installFlowPersistence()
    useFlowStore.getState().loadGraph(graph as never)

    expect(useFlowStore.getState().dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(saveMock).not.toHaveBeenCalled()
    uninstall()
  })

  it('静默窗口结束后，用户改动照常自动保存', async () => {
    const uninstall = installFlowPersistence()
    useFlowStore.getState().loadGraph(graph as never)
    await vi.advanceTimersByTimeAsync(3100) // 越过静默窗口
    editFlow('n1')

    expect(useFlowStore.getState().dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(1600)
    expect(saveMock).toHaveBeenCalledTimes(1)
    uninstall()
  })
})

describe('显式保存（force）', () => {
  it('即使没有未保存标记，启动机器人前也会强写一次（保证磁盘 == 内存）', async () => {
    expect(useFlowStore.getState().dirty).toBe(false)
    // 画布非空才需要落盘：空画布按当前语义视为「无需保存」（避免用空图覆盖磁盘真流程）。
    useFlowStore.setState({ nodes: [makeNode('seed')] })
    await useBotStore.getState().startBot(PROJECT)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveMock.mock.calls[0][0]).toBe(PROJECT)
  })
})

describe('启动机器人前先落盘', () => {
  it('startBot 会先保存再启动（否则跑的是磁盘上的旧流程）', async () => {
    const order: string[] = []
    saveMock.mockImplementation(async () => {
      order.push('flow.save')
      return { ok: true }
    })
    ;(window as unknown as { qqbat: { botManager: { start: unknown } } }).qqbat.botManager.start = vi.fn(
      async () => {
        order.push('bot.start')
        return { ok: true }
      },
    )

    useFlowStore.setState({ nodes: [makeNode('seed')] })
    await useBotStore.getState().startBot(PROJECT)

    expect(order).toEqual(['flow.save', 'bot.start'])
  })
})

describe('加载失败保护（回归：空画布覆盖用户作品）', () => {
  // 事故：flow.json 校验失败 → 编辑器把画布当"新项目"清空 → 用户点「运行」时
  // 启动前那次强制保存把**空图**写回文件，磁盘上的流程被静默覆盖。
  const LOAD_ERROR = 'flow.json 校验失败: nodes.0.data.nodeKind 不存在'

  it('加载失败后拒绝落盘（自动保存不会偷偷覆盖原文件）', async () => {
    const uninstall = installFlowPersistence()
    useFlowStore.getState().setLoadError(LOAD_ERROR)
    editFlow('n1')
    await vi.advanceTimersByTimeAsync(3000)

    expect(saveMock).not.toHaveBeenCalled()
    expect(useFlowStore.getState().dirty).toBe(true) // 仍标脏：不假装已保存
    uninstall()
  })

  it('强制保存（启动机器人 / 生成代码走的就是它）同样被拦住', async () => {
    useFlowStore.getState().setLoadError(LOAD_ERROR)

    const ok = await useFlowStore.getState().saveNow(PROJECT, { force: true })

    expect(ok).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('保护期内 startBot 不启动机器人（避免跑一份和画布不一致的流程）', async () => {
    useFlowStore.getState().setLoadError(LOAD_ERROR)
    const startMock = (window as unknown as { qqbat: { botManager: { start: ReturnType<typeof vi.fn> } } })
      .qqbat.botManager.start

    await useBotStore.getState().startBot(PROJECT)

    expect(startMock).not.toHaveBeenCalled()
  })

  it('重新加载成功后解除保护，保存恢复', async () => {
    useFlowStore.getState().setLoadError(LOAD_ERROR)

    useFlowStore.getState().loadGraph(graph as never)
    expect(useFlowStore.getState().loadError).toBeNull()

    const ok = await useFlowStore.getState().saveNow(PROJECT, { force: true })
    expect(ok).toBe(true)
    expect(saveMock).toHaveBeenCalledTimes(1)
  })
})
