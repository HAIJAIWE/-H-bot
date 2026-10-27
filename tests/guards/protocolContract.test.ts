// tests/guards/protocolContract.test.ts
//
// 第 61 批：智能体 SDK 契约闸门。
//
// 为什么需要：SDK 是插件生态的**唯一稳定面**，而它有三份可能漂移的"真相"——
//   · 契约表 `AGENT_METHODS`（shared，人写的那份）
//   · preload 里真实存在的通道（实现）
//   · 主进程 zod schema（校验）
// 三者任何一处改了没跟上，插件装上去就是"静默失效"而不是"报错"。这里逐条对账。
//
// 另外两条硬约束：
//   · `createAgentSdk` 的实现方法集合必须 == 契约表（少一个 = 悬空承诺；多一个 = 未登记面）；
//   · SDK 的映射必须**抽样**核到真实函数名（`listTurns` → `listAiTurns` 这类历史命名，
//     只核通道名核不出来）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_METHODS } from '@shared/protocol/rpc/agentSdk'
import { PROTOCOL_VERSION } from '@shared/protocol/rpc/version'
import * as aiSchemas from '@main/schemas/ai'
import { createAgentSdk } from '../../src/preload/agentSdk'

const PRELOAD = join(process.cwd(), 'src', 'preload', 'index.ts')

/** preload 里所有 `invoke('xxx')` 的通道名（静态扫描，和载荷契约闸门同一手法） */
function preloadChannels(): Set<string> {
  const source = readFileSync(PRELOAD, 'utf-8')
  return new Set([...source.matchAll(/invoke\('([^']+)'/g)].map(m => m[1]))
}

type FakeFn = (...args: unknown[]) => Promise<unknown>

/** 假 `api.ai`：记录每次调用，回执固定 `{ ok: true }` */
function fakeAi(): {
  ai: Record<string, FakeFn>
  calls: Array<{ method: string; args: unknown[] }>
} {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const ai = new Proxy({} as Record<string, FakeFn>, {
    get: (_t, key) => {
      return (...args: unknown[]) => {
        calls.push({ method: String(key), args })
        return Promise.resolve({ ok: true })
      }
    },
  })
  return { ai, calls }
}

describe('智能体 SDK 契约（第 61 批）', () => {
  it('协议版本已冻结，且改版本号必须走评审（这里只挡"随手改"）', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('契约表自洽：sdk 方法名与通道都不重复', () => {
    const sdks = AGENT_METHODS.map(m => m.sdk)
    const channels = AGENT_METHODS.map(m => m.channel)
    expect(new Set(sdks).size).toBe(sdks.length)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('每个契约通道都真实存在于 preload（不存在 = 插件调用会静默失败）', () => {
    const channels = preloadChannels()
    const missing = AGENT_METHODS.filter(m => !channels.has(m.channel)).map(
      m => `${m.sdk} → ${m.channel}`,
    )
    expect(missing).toEqual([])
  })

  it('登记的 schema 都是主进程真实导出（名字拼错 = 契约里写的校验根本没发生）', () => {
    const schemas = aiSchemas as unknown as Record<string, { safeParse?: unknown }>
    const broken = AGENT_METHODS.filter(
      m => m.schema && typeof schemas[m.schema]?.safeParse !== 'function',
    ).map(m => `${m.sdk} → ${String(m.schema)}`)
    expect(broken).toEqual([])
  })

  it('SDK 实现的方法集合 == 契约表（少一个悬空承诺，多一个未登记面）', () => {
    const { ai } = fakeAi()
    const sdk = createAgentSdk(ai as never)
    expect(Object.keys(sdk).sort()).toEqual(
      AGENT_METHODS.map(m => m.sdk)
        .slice()
        .sort(),
    )
  })

  it('抽样核对映射：SDK 方法真的落到那个 preload 函数与参数顺序上', async () => {
    const { ai, calls } = fakeAi()
    const sdk = createAgentSdk(ai as never)

    await sdk.send({ projectPath: 'p', requirement: 'r' })
    expect(calls[0]).toEqual({
      method: 'agentCoreRun',
      args: [
        'p',
        'r',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    })

    await sdk.stop({ projectPath: 'p' })
    expect(calls[1]).toEqual({ method: 'cancelChat', args: ['p'] })

    await sdk.listTurns({ projectPath: 'p' })
    expect(calls[2]).toEqual({ method: 'listAiTurns', args: ['p'] })

    await sdk.renameThread({ projectPath: 'p', threadId: 't', title: 'x' })
    expect(calls[3]).toEqual({ method: 'renameThread', args: ['p', 't', 'x'] })

    await sdk.resolveApproval({ callId: 'c', decision: 'deny' })
    expect(calls[4]).toEqual({ method: 'resolveApproval', args: ['c', 'deny'] })

    await sdk.getConfig()
    expect(calls[5]).toEqual({ method: 'getConfig', args: [undefined] })
  })

  it('preload 把 SDK 挂到 window.qqbat 上，并暴露协议版本号', () => {
    const source = readFileSync(PRELOAD, 'utf-8')
    expect(source).toContain('createAgentSdk(api.ai)')
    expect(source).toContain('Object.assign(api, { agent, protocolVersion: PROTOCOL_VERSION })')
    expect(source).toContain("exposeInMainWorld('qqbat', api)")
  })
})
