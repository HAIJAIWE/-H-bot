// @vitest-environment node
// tests/main/services/agent-runtime/runtime.test.ts
//
// 第 62 批（P1 第一步）的验收：**假宿主**（没有窗口、没有 Electron）能驱动一整轮。
// 这就是"能被别人驱动"的最小证明 —— 今天它证明运行时不需要 Electron，
// 下一批把 aiAgentCore 的运行体搬进来时，同一批断言必须原样全绿。
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAgentRuntime,
  type AgentRuntimeEvent,
  type AgentRuntimeHost,
} from '@main/services/agent-runtime'

const config = { provider: 'glm', apiKey: 'k', model: 'm' } as never

function makeHost(approval?: AgentRuntimeHost['approval']): {
  events: AgentRuntimeEvent[]
  host: AgentRuntimeHost
} {
  const events: AgentRuntimeEvent[] = []
  const host: AgentRuntimeHost = {
    emit: event => {
      events.push(event)
    },
    ...(approval ? { approval } : {}),
  }
  return { events, host }
}

describe('★ AgentRuntime：宿主的全部接口面 = emit + approval', () => {
  it('一轮纯文本：text 帧拼起来等于最终结果，step 帧至少一帧', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-runtime-'))
    const { events, host } = makeHost()
    const runtime = createAgentRuntime(host)
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onChunk({ type: 'text', content: 'ok' })
      cb.onComplete('ok')
    }) as never

    const r = await runtime.runTurn({
      projectPath: ws,
      requirement: '说一句话',
      config,
      call,
      maxRounds: 1,
    })

    expect(r.finalText).toBe('ok')
    const text = events
      .filter(e => e.type === 'text')
      .map(e => (e as { delta: string }).delta)
      .join('')
    expect(text).toBe('ok')
    expect(events.some(e => e.type === 'step')).toBe(true)
  })

  it('默认审批拒绝：宿主不接 approval 时写盘被拦，工具事件仍完整', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-runtime-'))
    const { events, host } = makeHost()
    const runtime = createAgentRuntime(host)
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'x.txt', content: 'hi' } }])
      cb.onComplete('')
    }) as never

    const r = await runtime.runTurn({
      projectPath: ws,
      requirement: '写文件',
      config,
      call,
      maxRounds: 1,
    })

    expect(r.toolResults[0].output).toContain('失败')
    expect(events.some(e => e.type === 'work/start')).toBe(true)
    expect(events.some(e => e.type === 'work/end')).toBe(true)
    await expect(readFile(join(ws, 'x.txt'), 'utf-8')).rejects.toThrow()
  })

  it('宿主接了 approval 就真能写进去：回调被问到，文件落盘', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-runtime-'))
    let asked = 0
    const { host } = makeHost(async () => {
      asked += 1
      return true
    })
    const runtime = createAgentRuntime(host)
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([{ id: 'c2', name: 'write_file', args: { path: 'ok.txt', content: 'hi' } }])
      cb.onComplete('done')
    }) as never

    const r = await runtime.runTurn({
      projectPath: ws,
      requirement: '写文件',
      config,
      call,
      maxRounds: 1,
    })

    expect(asked).toBeGreaterThan(0)
    expect(r.finalText).toBe('done')
    expect(await readFile(join(ws, 'ok.txt'), 'utf-8')).toBe('hi')
  })
})
