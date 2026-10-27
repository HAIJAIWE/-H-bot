// tests/renderer/lib/ai/executableProtocol.test.ts
//
// 第 74 批：宿主 ⇄ worker 的翻译层。钉三件事：
//   · init 消息把清单里的 capabilities 原样交给 worker；
//   · 会话快照投影只带窗口该看的字段（不带 trace/stats 等内部结构）；
//   · worker 回来的消息，视图要过白名单校验、命令要过能力声明，不合法的忽略。
import { describe, expect, it } from 'vitest'
import {
  buildInitMessage,
  interpretEntryMessage,
  toEntryContext,
} from '../../../../src/renderer/src/lib/ai/executableProtocol'
import type { AgentSurfaceSnapshot } from '../../../../src/renderer/src/lib/ai/agentSurfaceContext'
import type { WindowPackageInfo } from '../../../../src/shared/plugins/windowPackage'
import { WINDOW_VIEW_API_VERSION } from '../../../../src/shared/plugins/windowView'

const spec = (extra: Partial<WindowPackageInfo> = {}): WindowPackageInfo => ({
  schemaVersion: 1,
  id: 'demo.executable',
  name: '演示',
  version: '1.0.0',
  layout: 'compact',
  entry: 'entry.js',
  capabilities: ['send-message', 'stop'],
  dir: 'C:/x',
  ...extra,
})

const snapshot = (): AgentSurfaceSnapshot => ({
  projectPath: 'E:/p',
  threadId: 't1',
  threads: [
    { id: 't1', title: '线程一', updatedAt: 1, messageCount: 2 },
    { id: 't2', title: '线程二', updatedAt: 2, messageCount: 0 },
  ],
  messages: [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '收到' },
  ] as unknown as AgentSurfaceSnapshot['messages'],
  streaming: true,
  running: true,
  pendingApproval: {
    callId: 'c1',
    toolName: 'write_file',
    args: { path: 'a.txt' },
    hint: '写文件',
  },
})

describe('buildInitMessage（第 74 批）', () => {
  it('版本协商 + capabilities 原样带出（数组是拷贝，worker 改不动清单）', () => {
    const message = buildInitMessage(spec())
    expect(message).toEqual({
      type: 'init',
      apiVersion: WINDOW_VIEW_API_VERSION,
      packageId: 'demo.executable',
      capabilities: ['send-message', 'stop'],
    })
    message.capabilities.push('select-thread')
    expect(spec().capabilities).toEqual(['send-message', 'stop'])
  })

  it('没声明能力的包 → 空数组', () => {
    expect(buildInitMessage(spec({ capabilities: undefined })).capabilities).toEqual([])
  })
})

describe('toEntryContext（第 74 批）', () => {
  it('只投影窗口该看的字段（不带 args/hint/updatedAt 等内部结构）', () => {
    const context = toEntryContext(snapshot())
    expect(context).toEqual({
      projectPath: 'E:/p',
      threadId: 't1',
      threads: [
        { id: 't1', title: '线程一', messageCount: 2 },
        { id: 't2', title: '线程二', messageCount: 0 },
      ],
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '收到' },
      ],
      streaming: true,
      running: true,
      pendingApproval: { toolName: 'write_file' },
    })
  })

  it('没有待审批时是 null', () => {
    const base = snapshot()
    const context = toEntryContext({ ...base, pendingApproval: null })
    expect(context.pendingApproval).toBeNull()
  })
})

describe('interpretEntryMessage（第 74 批）', () => {
  const capabilities = ['send-message', 'stop'] as const

  it('合法视图 → kind=view（附 issues 供调试）', () => {
    const result = interpretEntryMessage(
      { type: 'view', view: { root: { type: 'text', content: 'hi' } } },
      capabilities,
    )
    expect(result.kind).toBe('view')
    if (result.kind !== 'view') return
    expect(result.view.root).toEqual({ type: 'text', content: 'hi' })
    expect(result.issues).toEqual([])
  })

  it('非法视图 → ignore', () => {
    const result = interpretEntryMessage(
      { type: 'view', view: { root: { type: 'script' } } },
      capabilities,
    )
    expect(result.kind).toBe('ignore')
  })

  it('声明过的命令 → kind=command', () => {
    const result = interpretEntryMessage(
      { type: 'command', command: 'send-message', payload: '继续' },
      capabilities,
    )
    expect(result).toEqual({ kind: 'command', command: 'send-message', payload: '继续' })
  })

  it('没声明过的命令 → ignore（即使命令本身合法）', () => {
    const result = interpretEntryMessage(
      { type: 'command', command: 'select-thread', payload: 't1' },
      capabilities,
    )
    expect(result.kind).toBe('ignore')
    if (result.kind !== 'ignore') return
    expect(result.reason).toContain('is not declared in manifest capabilities')
  })

  it('未知命令 / 超长 payload / 未知消息类型 → ignore', () => {
    expect(
      interpretEntryMessage({ type: 'command', command: 'exec-shell' }, capabilities).kind,
    ).toBe('ignore')
    expect(
      interpretEntryMessage(
        { type: 'command', command: 'send-message', payload: 'x'.repeat(501) },
        capabilities,
      ).kind,
    ).toBe('ignore')
    expect(interpretEntryMessage({ type: 'log', text: 'x' }, capabilities).kind).toBe('ignore')
    expect(interpretEntryMessage('hello', capabilities).kind).toBe('ignore')
  })
})
