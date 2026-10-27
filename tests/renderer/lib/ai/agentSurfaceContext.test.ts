// tests/renderer/lib/ai/agentSurfaceContext.test.ts
//
// 智能体窗口的**输入契约**（第 70 批）：只读快照 + 命令。
// 契约的三条硬要求：① 快照引用稳定（能直接喂 useSyncExternalStore）；
// ② store 一变就换快照并通知订阅者；③ 动作是命令（转发到 store 方法），不是 setter。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAiStore } from '@renderer/stores/aiStore'
import { createAgentSurfaceContext } from '@renderer/lib/ai/agentSurfaceContext'

const projectPath = 'E:/proj'
const msg = (content: string) => ({ role: 'user', content }) as never

beforeEach(() => {
  useAiStore.setState({
    conversationPath: projectPath,
    activeThreadId: 'default',
    threads: [
      {
        id: 'default',
        title: '旧对话',
        titleSource: 'user',
        updatedAt: 11,
        messageCount: 3,
        stats: {},
      },
    ],
    messages: [msg('hi')],
    streaming: false,
    mainProcessRunning: false,
    pendingApproval: null,
  } as never)
})

describe('★ 智能体窗口输入契约（agent surface context）', () => {
  it('★ 快照字段与 store 一一对应，且同一状态内引用稳定', () => {
    const ctx = createAgentSurfaceContext()
    const a = ctx.getSnapshot()
    const b = ctx.getSnapshot()
    expect(a).toBe(b)
    expect(a.projectPath).toBe(projectPath)
    expect(a.threadId).toBe('default')
    expect(a.messages).toHaveLength(1)
    expect(a.streaming).toBe(false)
    expect(a.running).toBe(false)
    expect(a.pendingApproval).toBeNull()
    expect(a.threads).toEqual([{ id: 'default', title: '旧对话', updatedAt: 11, messageCount: 3 }])
  })

  it('线程列表是摊平的只读副本：内部字段（stats 等）不外泄', () => {
    const ctx = createAgentSurfaceContext()
    const [thread] = ctx.getSnapshot().threads
    expect(Object.keys(thread).sort()).toEqual(['id', 'messageCount', 'title', 'updatedAt'])
  })

  it('★ store 变化 → 换新快照并通知订阅者；快照里能看到新值', () => {
    const ctx = createAgentSurfaceContext()
    const before = ctx.getSnapshot()
    const seen: string[] = []
    const unsubscribe = ctx.subscribe(() => seen.push(ctx.getSnapshot().messages[0]?.content ?? ''))

    useAiStore.setState({ streaming: true, mainProcessRunning: true } as never)
    expect(seen).toEqual(['hi'])
    const after = ctx.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.streaming).toBe(true)
    expect(after.running).toBe(true)

    useAiStore.setState({ messages: [msg('hello')] } as never)
    expect(seen).toEqual(['hi', 'hello'])
    unsubscribe()
  })

  it('快照把待审批请求也投出来（窗口据此画确认条）', () => {
    useAiStore.setState({
      pendingApproval: {
        callId: 'call-1',
        toolName: 'write_file',
        args: { path: 'a.txt' },
        hint: '',
      },
    } as never)
    const ctx = createAgentSurfaceContext()
    expect(ctx.getSnapshot().pendingApproval).toMatchObject({
      callId: 'call-1',
      toolName: 'write_file',
    })
  })

  it('★ 动作转发到 store：send / steer / stop / resolveApproval', async () => {
    const sendMessage = vi.fn(async () => {})
    const steer = vi.fn(async () => true)
    const stopStreaming = vi.fn()
    const resolvePendingApproval = vi.fn(async () => {})
    useAiStore.setState({ sendMessage, steer, stopStreaming, resolvePendingApproval } as never)
    const ctx = createAgentSurfaceContext()

    await ctx.actions.send('继续', {
      images: ['data:image/png;base64,x'],
      agentMode: 'build' as never,
    })
    expect(sendMessage).toHaveBeenCalledWith(
      projectPath,
      '继续',
      ['data:image/png;base64,x'],
      'build',
    )

    await expect(ctx.actions.steer('插一句', 'step')).resolves.toBe(true)
    expect(steer).toHaveBeenCalledWith(projectPath, '插一句', 'step')

    ctx.actions.stop()
    expect(stopStreaming).toHaveBeenCalledTimes(1)

    await ctx.actions.resolveApproval('allow')
    expect(resolvePendingApproval).toHaveBeenCalledWith('allow')
  })

  it('★ 线程命令也走当前项目：newThread / switchThread', async () => {
    const newThread = vi.fn()
    const switchThread = vi.fn(async () => {})
    useAiStore.setState({ newThread, switchThread } as never)
    const ctx = createAgentSurfaceContext()

    ctx.actions.newThread()
    expect(newThread).toHaveBeenCalledWith(projectPath)

    await ctx.actions.switchThread('thread-2')
    expect(switchThread).toHaveBeenCalledWith(projectPath, 'thread-2')
  })

  it('★ 创建时是空的，之后 store 变化也能看到（第 71 批：懒订阅会让快照停在创建那一刻）', () => {
    useAiStore.setState({ messages: [] } as never)
    const ctx = createAgentSurfaceContext()
    expect(ctx.getSnapshot().messages).toHaveLength(0)
    useAiStore.setState({ messages: [msg('后来的消息')] } as never)
    expect(ctx.getSnapshot().messages[0]?.content).toBe('后来的消息')
  })

  it('dispose 后释放 store 订阅（窗口卸载不泄漏）', () => {
    useAiStore.setState({ streaming: false } as never)
    const ctx = createAgentSurfaceContext()
    const listener = vi.fn()
    ctx.subscribe(listener)
    ctx.dispose()
    useAiStore.setState({ streaming: true } as never)
    expect(listener).not.toHaveBeenCalled()
    expect(ctx.getSnapshot().streaming).toBe(false)
  })

  it('最后一个订阅者退订后不再转发（避免泄漏）', () => {
    const ctx = createAgentSurfaceContext()
    const listener = vi.fn()
    const unsubscribe = ctx.subscribe(listener)
    unsubscribe()
    useAiStore.setState({ streaming: true } as never)
    expect(listener).not.toHaveBeenCalled()
  })
})
