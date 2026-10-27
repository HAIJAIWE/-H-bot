// tests/main/services/agent-core/runTurn.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgentTurn } from '@main/services/agent-core/runTurn'
import { listTools } from '@main/services/agent-core/core'

const config = { provider: 'glm', apiKey: 'k', model: 'm' } as never

describe('★ 总入口：模型 → 工具 → 落盘（默认拒绝写）', () => {
  it('★ 默认审批拒绝：模型想写也写不进去', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'x.txt', content: 'hi' } }])
      cb.onComplete('')
    }) as never
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '写文件',
      config,
      call,
      maxRounds: 1,
    })
    expect(r.toolResults[0].output).toContain('失败')
    await expect(readFile(join(ws, 'x.txt'), 'utf-8')).rejects.toThrow()
  })

  it('★ requirement 与系统提示真的进了第一轮请求（真机 400 的那个 bug）', async () => {
    // 第一版循环从空 messages 起步 —— 真机第一轮就被厂商 400 拒掉（last message role）。
    // 单测里模型是假的，所以只有这条断言能把它钉住。
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    let first: any[] = []
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m
      cb.onComplete('ok')
    }) as never
    await runAgentTurn({
      projectPath: ws,
      requirement: '读一下 project.json',
      config,
      call,
      maxRounds: 1,
    })
    expect(first[0].role).toBe('system')
    expect(first[0].content).toContain(ws)
    expect(first[1]).toEqual({ role: 'user', content: '读一下 project.json' })
  })

  it('★ 第 60 批（M1）：approvalMode 真的进了系统提示（never 与默认 ask 两副口径）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    const capture = async () => {
      let system = ''
      const call = (async (_c: unknown, m: any[], _t: unknown, cb: any) => {
        system = m[0].content
        cb.onComplete('ok')
      }) as never
      return { call, get: () => system }
    }

    const plain = await capture()
    await runAgentTurn({
      projectPath: ws,
      requirement: '读项目',
      config,
      call: plain.call,
      maxRounds: 1,
    })
    // 默认 = ask：四种结局都要讲清
    expect(plain.get()).toContain('审批策略：ask')
    expect(plain.get()).toContain('没有可用的审批通道')

    const full = await capture()
    await runAgentTurn({
      projectPath: ws,
      requirement: '读项目',
      config,
      call: full.call,
      maxRounds: 1,
      approvalMode: 'never',
    })
    expect(full.get()).toContain('审批策略：never')
    expect(full.get()).not.toContain('审批策略：ask')
  })

  it('★ 跨轮记忆：历史拼在系统提示之后、本轮要求之前（顺序错了模型会以为那是刚说的）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    let first: any[] = []
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m
      cb.onComplete('ok')
    }) as never
    await runAgentTurn({
      projectPath: ws,
      requirement: '这一轮继续',
      config,
      call,
      maxRounds: 1,
      history: [
        { role: 'user', content: '上一轮问的' },
        { role: 'assistant', content: '上一轮答的' },
      ],
      historyNote: '更早的 3 条已省略',
    })
    expect(first.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    // 裁掉的旧记忆要交代一句（不许静默）
    expect(first[0].content).toContain('更早的 3 条已省略')
    expect(first[3].content).toBe('这一轮继续')
  })

  it('★ 角色说明进系统提示，且排在历史交代之前（先"你是谁"再"你看不到什么"）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    let first: any[] = []
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m
      cb.onComplete('ok')
    }) as never
    await runAgentTurn({
      projectPath: ws,
      requirement: '加个夜巡签到',
      config,
      call,
      maxRounds: 1,
      roleNote: '你是搭建者：只能改流程，不许改源码。',
      historyNote: '更早的 2 条已省略',
    })
    const sys = first[0].content as string
    expect(sys).toContain('你是搭建者')
    expect(sys.indexOf('你是搭建者')).toBeLessThan(sys.indexOf('更早的 2 条已省略'))
    expect(first[1]).toEqual({ role: 'user', content: '加个夜巡签到' })
  })

  it('★ 先计划：写/命令在这一轮**工具列表里不存在**，且提示交代了计划阶段', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    let first: any[] = []
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m
      // 模型硬要写：这一轮它应该只拿到"未知工具"
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'x.txt', content: 'hi' } }])
      cb.onComplete('')
    }) as never
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '先计划一下怎么加签到',
      config,
      call,
      maxRounds: 1,
      planOnly: true,
    })
    expect(r.toolResults[0].output).toContain('未知工具')
    expect(first[0].content).toContain('计划阶段')
    // 提示里的「可用工具」也只剩 query 类 —— 广告了却调不到，模型会白白烧一轮
    expect(first[0].content).not.toContain('write_file')
    await expect(readFile(join(ws, 'x.txt'), 'utf-8')).rejects.toThrow()
  })

  it('★ 工具表被裁（预设白名单）：提示只广告裁过的那些，调用表里也没有别的', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    const readOnly = listTools().filter(t => t.name === 'read_file')
    expect(readOnly).toHaveLength(1)
    let first: any[] = []
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m
      cb.onToolCalls([{ id: 'c1', name: 'write_file', args: { path: 'x.txt', content: 'hi' } }])
      cb.onComplete('')
    }) as never
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '只读一遍',
      config,
      call,
      maxRounds: 1,
      tools: readOnly,
    })
    expect(first[0].content).toContain('read_file')
    expect(first[0].content).not.toContain('write_file')
    expect(r.toolResults[0].output).toContain('未知工具')
    await expect(readFile(join(ws, 'x.txt'), 'utf-8')).rejects.toThrow()
  })

  it('★ 广告 == 调用表：系统提示列的每个工具名，provider 侧都真有这个 function', async () => {
    // 2026-10-25 真机：模型把提示里的 36 个工具全念出来，然后说「我实际只能发这 6 个」。
    // 根因是适配器自己写死 CORE_TOOLS —— 这条断言把两侧钉成同一份。
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    let first: any[] = []
    let defs: any[] = []
    const call = (async (_c: unknown, m: any, t: any, cb: any) => {
      first = m
      defs = t
      cb.onComplete('ok')
    }) as never
    const tools = listTools()
    expect(tools.length).toBeGreaterThan(6)
    await runAgentTurn({ projectPath: ws, requirement: '看看', config, call, maxRounds: 1, tools })
    const advertised = tools.map(t => t.name)
    // 提示里的「可用工具」正好是这一份（不多不少）
    const line =
      String(first[0].content)
        .split('\n')
        .find(l => l.includes('可用工具')) ?? ''
    for (const name of advertised) expect(line).toContain(name)
    // 调用表与提示同一份：既没有漏（旧 bug），也没有多
    expect(defs.map(d => d.name).sort()).toEqual([...advertised].sort())
  })

  it('★ onToolStart / onToolEnd 真的接到循环上（界面靠它摆工具行）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    await writeFile(join(ws, 'a.txt'), 'hello', 'utf-8')
    const events: string[] = []
    let round = 0
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      round += 1
      if (round === 1) {
        cb.onToolCalls([{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }])
        cb.onComplete('')
        return
      }
      cb.onComplete('ok')
    }) as never
    await runAgentTurn({
      projectPath: ws,
      requirement: '读文件',
      config,
      call,
      onToolStart: c => events.push('start:' + c.name),
      onToolEnd: (_c, output) => events.push('end:' + output.slice(0, 5)),
    })
    expect(events).toEqual(['start:read_file', 'end:hello'])
  })

  it('★ 显式放行后：写 → 再读回（完整一轮）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    await mkdir(join(ws, '.qqbat'), { recursive: true })
    await writeFile(join(ws, 'a.txt'), 'hello', 'utf-8')
    let round = 0
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      round += 1
      if (round === 1) {
        cb.onToolCalls([{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }])
        cb.onComplete('')
        return
      }
      cb.onComplete('读到了 hello')
    }) as never
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '读文件',
      config,
      call,
      approval: async () => true,
    })
    expect(r.finalText).toBe('读到了 hello')
    expect(r.toolResults[0].output).toContain('hello')
    expect(r.phase).toEqual({ kind: 'finished', reason: 'completed' })
  })

  it('★ 本轮统计（状态条）：token 只认厂商回传，steps 跟着工具数走', async () => {
    // 旧助手链路删掉后 ai:stats 改由循环发（ipc/aiAgentCore.ts 的 onStats）；
    // 这条钉住"发了什么"：没回传就是 usageReported=false（界面一个数都不许编）。
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    await mkdir(join(ws, '.qqbat'), { recursive: true })
    await writeFile(join(ws, 'a.txt'), 'hello', 'utf-8')
    const published: any[] = []
    let round = 0
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      round += 1
      cb.onUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 4 })
      if (round === 1) {
        cb.onToolCalls([{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }])
        cb.onComplete('')
        return
      }
      cb.onComplete('读到了')
    }) as never
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '读文件',
      config,
      call,
      maxRounds: 2,
      onStats: stats => published.push(stats),
    })
    // 两轮各回传一次 → 累加（不是覆盖）
    expect(r.stats.promptTokens).toBe(20)
    expect(r.stats.completionTokens).toBe(10)
    expect(r.stats.cachedTokens).toBe(8)
    expect(r.stats.usageReported).toBe(true)
    // 工具只真跑了 1 次
    expect(r.stats.steps).toBe(1)
    expect(r.stats.rounds).toBe(2)
    // 上下文预算是本轮压缩上限，没传压缩就用循环默认值（不是 0）
    expect(r.stats.contextBudget).toBeGreaterThan(0)
    // 最后推出去的那一份 == 返回的这一份（界面与终态不许两套数）
    expect(published.at(-1)).toEqual(r.stats)
  })

  it('★ 厂商没回传用量时 usageReported=false（界面据此显示"—"而不是 0）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    const call = (async (_c: unknown, _m: unknown, _t: unknown, cb: any) => {
      cb.onComplete('ok')
    }) as never
    const r = await runAgentTurn({
      projectPath: ws,
      requirement: '随便聊聊',
      config,
      call,
      maxRounds: 1,
    })
    expect(r.stats.usageReported).toBe(false)
    expect(r.stats.promptTokens).toBe(0)
    expect(r.stats.completionTokens).toBe(0)
  })
})

describe('★ 第 55 批：时间上下文拼进系统提示尾部', () => {
  it('★ timeNote 在 system 里，且排在 roleNote / historyNote 之后', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    let first: any[] = []
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m
      cb.onComplete('ok')
    }) as never
    const timeNote = '时间：2026-10-26 08:00:00（Asia/Shanghai，周一）\n距上一条消息：约 8 分钟前'
    await runAgentTurn({
      projectPath: ws,
      requirement: '现在几点',
      config,
      call,
      maxRounds: 1,
      roleNote: '你是流程助手',
      historyNote: '更早的 3 条已省略',
      timeNote,
    })
    const system: string = first[0].content
    expect(system).toContain(timeNote)
    expect(system.indexOf('你是流程助手')).toBeLessThan(system.indexOf('更早的 3 条已省略'))
    expect(system.indexOf('更早的 3 条已省略')).toBeLessThan(system.indexOf(timeNote))
    // 系统提示仍然是消息列表的第一条
    expect(first[0].role).toBe('system')
  })

  it('不传 timeNote：系统提示里没有时间行（脚本/测试的默认）', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'qqbat-turn-'))
    let first: any[] = []
    const call = (async (_c: unknown, m: any, _t: unknown, cb: any) => {
      first = m
      cb.onComplete('ok')
    }) as never
    await runAgentTurn({
      projectPath: ws,
      requirement: '随便聊聊',
      config,
      call,
      maxRounds: 1,
    })
    expect(first[0].content).not.toContain('距上一条消息')
  })
})
