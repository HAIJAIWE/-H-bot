// tests/main/services/agent-core/core.test.ts
//
// # agent-core：单循环 + 工作区沙箱
//
// 三件事必须成立：越界拒绝、写必须过闸门、命令必须白名单。
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CORE_TOOLS,
  clampToolOutput,
  listTools,
  matchGlob,
  registerTool,
  resolveInWorkspace,
  runAgentLoop,
  runCommand,
  type ChatTurn,
  type GateRequest,
  type Tool,
  type ToolCall,
} from '@main/services/agent-core/core'

let ws: string
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'qqbat-core-'))
})

const ctx = () => ({ workspace: ws })
const tool = (name: string) => CORE_TOOLS.find(t => t.name === name)!

/**
 * 跑一条工具调用，返回调度器落地的那条结果。
 *
 * 2026-10-26 起闸门在 `toolPipeline.prepare` 里过（工具自己不再读 `ctx.gate`），
 * 所以"过闸门"这件事必须走真实循环来验：直接 `tool.run(..., {gate})` 已经不经过它了。
 */
async function runOne(
  call: { name: string; args: Record<string, unknown> },
  opts: {
    gate?: (req: GateRequest) => Promise<boolean>
    onBeforeWrite?: (rel: string) => Promise<void>
  } = {},
) {
  let round = 0
  const result = await runAgentLoop({
    workspace: ws,
    tools: CORE_TOOLS,
    ...(opts.gate ? { gate: opts.gate } : {}),
    ...(opts.onBeforeWrite ? { onBeforeWrite: opts.onBeforeWrite } : {}),
    model: async () => {
      round += 1
      return round === 1
        ? { calls: [{ id: 'c1', name: call.name, args: call.args }] as ToolCall[] }
        : { text: 'done' }
    },
  })
  const entry = result.toolResults[0]
  // 带出来的 ok 与 ToolRunOutcome 同义：failure 缺席 = 成功
  return { ...entry, ok: !entry.failure }
}

describe('★ 循环的起点：initialTurns', () => {
  it('★ 第一轮请求就能看到 initialTurns（真机 400 的根因）', async () => {
    let seen: ChatTurn[] = []
    const result = await runAgentLoop({
      workspace: ws,
      initialTurns: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'REQ' },
      ],
      model: async messages => {
        seen = messages
        return { text: 'done' }
      },
    })
    expect(seen.map(t => t.role + ':' + t.content)).toEqual(['system:SYS', 'user:REQ'])
    expect(result.finalText).toBe('done')
  })
})

describe('★ 流式观测：工具开始/结束', () => {
  it('★ 先报开始再执行；模型没给 id 就当场补一个（开始/结束必须对得上）', async () => {
    const events: string[] = []
    let round = 0
    await runAgentLoop({
      workspace: ws,
      tools: [{ name: 't', description: 'd', run: async () => 'OK' }],
      model: async () => {
        round += 1
        return round === 1
          ? { text: '', calls: [{ id: '', name: 't', args: {} }] }
          : { text: 'done' }
      },
      onToolStart: call => events.push('start:' + call.id),
      onToolResult: (_call, output) => events.push('end:' + output),
    })
    expect(events).toEqual(['start:call-1-0', 'end:OK'])
  })
})

describe('★ 工具结果契约（结构化 ok + 超时）', () => {
  const runOnce = async (tool: Tool) => {
    const res = await runAgentLoop({
      workspace: ws,
      tools: [tool],
      model: async () => ({ calls: [{ id: 'c1', name: tool.name, args: {} }] }),
      maxRounds: 1,
    })
    return res
  }

  it('★ 显式 ok 优先于前缀：正常返回"[工具失败] 只是文本"的工具不会被误判失败', async () => {
    const seen: Array<boolean | undefined> = []
    await runAgentLoop({
      workspace: ws,
      tools: [
        {
          name: 'odd_tool',
          description: '返回一句以 [工具失败] 开头的正常结果（回归用例）',
          category: 'query',
          async run() {
            return { text: '[工具失败] 这是一句正常的话', ok: true }
          },
        },
      ],
      model: async () => ({ calls: [{ id: 'c1', name: 'odd_tool', args: {} }] }),
      maxRounds: 1,
      onToolResult: (_call, output, ok) => {
        seen.push(ok)
        expect(output).toContain('这是一句正常的话')
      },
    })
    expect(seen).toEqual([true])
  })

  it('★ 超时的工具按失败收尾，不拖死整轮', async () => {
    const res = await runOnce({
      name: 'hang_tool',
      description: '永远不返回（超时用例）',
      category: 'query',
      timeoutMs: 30,
      run: () => new Promise<string>(() => undefined),
    })
    expect(res.toolResults[0].output).toContain('超时')
    expect(res.phase.kind).toBe('finished')
  })

  it('显式 ok=false：正常文本也按失败记账（trace/界面同源）', async () => {
    const seen: Array<boolean | undefined> = []
    await runAgentLoop({
      workspace: ws,
      tools: [
        {
          name: 'soft_fail',
          description: '返回文本但显式标记失败',
          category: 'query',
          async run() {
            return { text: '部分成功', ok: false }
          },
        },
      ],
      model: async () => ({ calls: [{ id: 'c1', name: 'soft_fail', args: {} }] }),
      maxRounds: 1,
      onToolResult: (_call, _out, ok) => {
        seen.push(ok)
      },
    })
    expect(seen).toEqual([false])
  })
})

describe('★ 工具类别（与旧链路同一套词汇，迁移时逐字段映射）', () => {
  it('六个内置工具都标了类别：读=query，写/命令=mutation', () => {
    const byName = Object.fromEntries(CORE_TOOLS.map(t => [t.name, t.category]))
    expect(byName).toMatchObject({
      read_file: 'query',
      list_dir: 'query',
      search_text: 'query',
      validate_flow: 'query',
      write_file: 'mutation',
      run_command: 'mutation',
    })
  })

  it('没标类别的工具**不算 query**（先计划模式不会放它进来）', () => {
    // 缺省视同 mutation：迁移旧工具时，忘标类别 = 该工具在计划轮里不可用（安全侧失败）
    const bare: Tool = { name: 'bare_tool', description: 'x', run: async () => 'x' }
    expect(bare.category).toBeUndefined()
    expect(
      listTools()
        .filter(t => t.category === 'query')
        .some(t => t.name === bare.name),
    ).toBe(false)
  })
})

describe('★ 工具注册表（对齐 dsh-tools 的缝）', () => {
  it('内置工具都在表里', () => {
    const names = listTools().map(t => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'read_file',
        'write_file',
        'run_command',
        'validate_flow',
        'list_dir',
        'search_text',
      ]),
    )
  })

  it('★ 注册的新工具**不改循环**就能被调到（这才是缝的意义）', async () => {
    registerTool({
      name: 'echo_tool',
      description: '把 text 原样返回（注册表用例）',
      async run(args) {
        return 'echo:' + String(args.text ?? '')
      },
    })
    let round = 0
    const result = await runAgentLoop({
      workspace: ws,
      model: async () => {
        round += 1
        if (round === 1) return { calls: [{ id: 'c1', name: 'echo_tool', args: { text: 'hi' } }] }
        return { text: 'done' }
      },
    })
    expect(result.toolResults[0].output).toBe('echo:hi')
  })

  it('名字不合法 / 重名 / 没描述 → 注册时直接拒（别等模型调到才炸）', () => {
    expect(() =>
      registerTool({ name: 'Bad-Name', description: 'x', run: async () => 'x' }),
    ).toThrow(/snake_case/)
    expect(() =>
      registerTool({ name: 'no_desc', description: '  ', run: async () => 'x' }),
    ).toThrow(/description/)
    expect(() =>
      registerTool({ name: 'read_file', description: 'dup', run: async () => 'x' }),
    ).toThrow(/重复注册/)
  })
})

describe('★ 插话：步边界逐条注入', () => {
  it('两条排队 → 两个步边界各取一条，模型能看到它们', async () => {
    const queue = ['先别写', '改成只读']
    let round = 0
    const result = await runAgentLoop({
      workspace: ws,
      tools: [{ name: 't', description: 'd', run: async () => 'ok' }],
      inbox: () => {
        const next = queue.shift()
        return next ? { role: 'user', content: next } : null
      },
      model: async messages => {
        round += 1
        if (round <= 2) return { calls: [{ id: 'c' + round, name: 't', args: {} }] }
        return {
          text: messages
            .filter(m => m.role === 'user')
            .map(m => m.content)
            .join('|'),
        }
      },
    })
    expect(result.finalText).toContain('先别写')
    expect(result.finalText).toContain('改成只读')
  })
})

describe('★ 工具结果的上下文预算', () => {
  it('短输出不动（别为了省 token 把正常内容也改了）', () => {
    expect(clampToolOutput('hello', 100)).toBe('hello')
  })

  it('★ 超长输出保头尾，并写明省略了多少（模型要知道自己看的是节选）', () => {
    const long = 'H'.repeat(500) + 'M'.repeat(1000) + 'T'.repeat(500)
    const out = clampToolOutput(long, 200)
    expect(out.length).toBeLessThanOrEqual(400) // 正文受控 + 省略说明
    expect(out.startsWith('HHHH')).toBe(true)
    expect(out.endsWith('TTTT')).toBe(true)
    expect(out).toContain('中间省略')
    expect(out).toContain(String(long.length - 200))
  })

  it('★ 有溢出存储：完整内容落盘，节选里带路径与读回指引', async () => {
    const long = 'x'.repeat(5000)
    const saved: Array<{ name: string; len: number }> = []
    let round = 0
    const result = await runAgentLoop({
      workspace: ws,
      maxToolOutputChars: 300,
      spill: async (name, text) => {
        saved.push({ name, len: text.length })
        return '/tmp/spill/big.txt'
      },
      tools: [{ name: 'big', description: 'd', run: async () => long }],
      model: async messages => {
        round += 1
        if (round === 1) return { calls: [{ id: 'c1', name: 'big', args: {} }] }
        const msg = messages.find(m => m.role === 'tool')?.content ?? ''
        return {
          text: msg.includes('/tmp/spill/big.txt') && msg.includes('search_text') ? 'ok' : 'bad',
        }
      },
    })
    expect(result.finalText).toBe('ok')
    // spill 收到的是**完整**内容，不是节选
    expect(saved).toEqual([{ name: 'big', len: 5000 }])
  })

  it('★ 落盘失败 → fail-open：不裁，原文给模型（没有出路的省略更糟）', async () => {
    const long = 'y'.repeat(5000)
    let round = 0
    const result = await runAgentLoop({
      workspace: ws,
      maxToolOutputChars: 300,
      spill: async () => undefined,
      tools: [{ name: 'big', description: 'd', run: async () => long }],
      model: async messages => {
        round += 1
        if (round === 1) return { calls: [{ id: 'c1', name: 'big', args: {} }] }
        const msg = messages.find(m => m.role === 'tool')?.content ?? ''
        return { text: msg.length === 5000 ? 'kept-raw' : 'clamped' }
      },
    })
    expect(result.finalText).toBe('kept-raw')
  })

  it('★ 循环回灌给模型的是节选，toolResults 里仍是原始输出（界面按真实内容统计）', async () => {
    const long = 'x'.repeat(5000)
    let round = 0
    const result = await runAgentLoop({
      workspace: ws,
      maxToolOutputChars: 300,
      tools: [{ name: 'big', description: 'd', run: async () => long }],
      model: async messages => {
        round += 1
        if (round === 1) return { calls: [{ id: 'c1', name: 'big', args: {} }] }
        const toolMsg = messages.find(m => m.role === 'tool')
        return { text: toolMsg?.content.includes('中间省略') ? 'saw-clamped' : 'saw-raw' }
      },
    })
    expect(result.finalText).toBe('saw-clamped')
    expect(result.toolResults[0].output).toHaveLength(5000)
  })
})

describe('★ read_file 分块（大文件别整份灌进上下文）', () => {
  it('offset/limit 取指定行，并说清"你看到的是哪一段"', async () => {
    await writeFile(
      join(ws, 'big.txt'),
      Array.from({ length: 10 }, (_, i) => 'L' + (i + 1)).join('\n'),
      'utf-8',
    )
    const out = await tool('read_file').run({ path: 'big.txt', offset: 3, limit: 2 }, ctx())
    expect(out).toContain('[第 3-4 行，共 10 行]')
    expect(out).toContain('L3\nL4')
    expect(out).not.toContain('L5')
  })

  it('不传就整份（保持老行为）', async () => {
    await writeFile(join(ws, 'a.txt'), 'x\ny', 'utf-8')
    expect(await tool('read_file').run({ path: 'a.txt' }, ctx())).toBe('x\ny')
  })

  it('offset 越界不炸：给空段 + 行号说明', async () => {
    await writeFile(join(ws, 'a.txt'), 'x\ny', 'utf-8')
    const out = await tool('read_file').run({ path: 'a.txt', offset: 99, limit: 5 }, ctx())
    expect(out).toContain('共 2 行')
  })
})

describe('★ 找东西：list_dir / search_text', () => {
  it('list_dir：目录以 / 结尾，跳过 node_modules/.git 这类噪音', async () => {
    await mkdir(join(ws, 'src', 'deep'), { recursive: true })
    await mkdir(join(ws, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(ws, 'a.txt'), 'x', 'utf-8')
    const out = await tool('list_dir').run({ path: '.' }, ctx())
    expect(out).toContain('src/')
    expect(out).toContain('a.txt')
    expect(out).not.toContain('node_modules')
  })

  it('list_dir 也不能跑出工作区（路径沙箱对只读工具一样生效）', async () => {
    await expect(tool('list_dir').run({ path: '../' }, ctx())).rejects.toThrow()
  })

  it('search_text：命中带 文件:行号，按 glob 过滤，跳过噪音目录', async () => {
    await mkdir(join(ws, 'src'), { recursive: true })
    await mkdir(join(ws, 'node_modules'), { recursive: true })
    await writeFile(join(ws, 'src', 'a.ts'), 'const foo = 1;\nconst bar = 2;', 'utf-8')
    await writeFile(join(ws, 'src', 'b.md'), 'foo in markdown', 'utf-8')
    await writeFile(join(ws, 'node_modules', 'x.ts'), 'foo in deps', 'utf-8')

    const all = await tool('search_text').run({ pattern: 'foo' }, ctx())
    expect(all).toContain('src/a.ts:1: const foo = 1;')
    expect(all).toContain('src/b.md:1: foo in markdown')
    expect(all).not.toContain('node_modules')

    const onlyTs = await tool('search_text').run({ pattern: 'foo', glob: '*.ts' }, ctx())
    expect(onlyTs).toContain('src/a.ts')
    expect(onlyTs).not.toContain('b.md')
  })

  it('★ 溢出的工具结果可以被搜到（节选里那句"用 search_text 搜它"必须是真的）', async () => {
    await mkdir(join(ws, '.qqbat', 'ai-spill'), { recursive: true })
    await writeFile(join(ws, '.qqbat', 'ai-spill', 'x-read_file.txt'), 'needle here', 'utf-8')
    // 其它 .qqbat 内容仍然跳过（state/记忆那些不该被模型瞎翻）
    await writeFile(join(ws, '.qqbat', 'secret.txt'), 'needle in secret', 'utf-8')
    const out = await tool('search_text').run({ pattern: 'needle' }, ctx())
    expect(out).toContain('ai-spill/x-read_file.txt')
    expect(out).not.toContain('secret.txt')
  })

  it('search_text：正则写错把原因还给模型（不抛，它自己会改）', async () => {
    const out = await tool('search_text').run({ pattern: '[' }, ctx())
    expect(out).toContain('[无效正则]')
  })

  it('search_text：limit 生效（不给模型灌一屏）', async () => {
    await writeFile(
      join(ws, 'many.txt'),
      Array.from({ length: 20 }, () => 'hit').join('\n'),
      'utf-8',
    )
    const out = String(await tool('search_text').run({ pattern: 'hit', limit: 3 }, ctx()))
    expect(out.split('\n').filter(l => l.includes('many.txt'))).toHaveLength(3)
    expect(out).toContain('达到上限 3')
  })

  it('matchGlob：* 不跨目录、** 跨目录、不含斜杠只比文件名', () => {
    expect(matchGlob('src/a.ts', '*.ts')).toBe(true)
    expect(matchGlob('src/deep/a.tsx', 'src/*.tsx')).toBe(false)
    expect(matchGlob('src/deep/a.tsx', 'src/**/*.tsx')).toBe(true)
    expect(matchGlob('a.ts', 'src/**')).toBe(false)
    expect(matchGlob('src/a.ts', '**/*.ts')).toBe(true)
  })
})

describe('★ 沙箱：越界与白名单', () => {
  it('★ 路径越界一律拒绝（.. 与绝对路径）', () => {
    expect(() => resolveInWorkspace(ws, '../escape.txt')).toThrow()
    expect(() => resolveInWorkspace(ws, 'C:/windows/x')).toThrow()
    expect(resolveInWorkspace(ws, 'a/b.txt')).toContain('a')
  })

  it('★ 跑命令也要过闸门（白名单命令能做的事比写文件更多：git push / npx）', async () => {
    // 拒绝 → 根本不执行（这里用必然成功的 node -v 证明"没跑"）
    const denied = await runOne(
      { name: 'run_command', args: { command: 'node -v' } },
      { gate: async req => req.kind !== 'command' },
    )
    expect(denied.ok).toBe(false)
    expect(denied.output).toContain('命令被拒绝（未通过闸门）')
    expect(denied.output).not.toMatch(/^v\d+/m)

    const seen: GateRequest['kind'][] = []
    const allowed = await runOne(
      { name: 'run_command', args: { command: 'node -v' } },
      {
        gate: async req => {
          seen.push(req.kind)
          return true
        },
      },
    )
    expect(seen).toEqual(['command'])
    expect(allowed.output).toMatch(/v\d+/)
  })

  it('★ 写盘前会回调 onBeforeWrite（轮次日志靠它记 before）；被拒的写入不回调', async () => {
    const seen: string[] = []
    await tool('write_file').run(
      { path: 'note.txt', content: 'v1' },
      {
        ...ctx(),
        onBeforeWrite: async rel => {
          seen.push(rel)
        },
      },
    )
    expect(seen).toEqual(['note.txt'])

    const denied = await runOne(
      { name: 'write_file', args: { path: 'nope.txt', content: 'x' } },
      {
        gate: async () => false,
        onBeforeWrite: async rel => {
          seen.push(rel)
        },
      },
    )
    expect(denied.output).toContain('写操作被拒绝（未通过闸门）')
    expect(seen).toEqual(['note.txt']) // 被拒的那次没有回调
  })

  it('★ 写必须过闸门：拒绝时不落盘', async () => {
    const denied = await runOne(
      { name: 'write_file', args: { path: 'x.txt', content: 'hi' } },
      { gate: async () => false },
    )
    expect(denied.ok).toBe(false)
    expect(denied.output).toContain('写操作被拒绝（未通过闸门）')
    await expect(readFile(join(ws, 'x.txt'), 'utf-8')).rejects.toThrow()
  })

  it('闸门通过 ⇒ 写入成功', async () => {
    const out = await runOne(
      { name: 'write_file', args: { path: 'x.txt', content: 'hi' } },
      { gate: async () => true },
    )
    expect(out.output).toContain('已写入')
    expect(await readFile(join(ws, 'x.txt'), 'utf-8')).toBe('hi')
  })

  it('★ 命令白名单：非白名单与元字符都拒绝', async () => {
    expect((await runCommand('rm -rf /', ctx())).ok).toBe(false)
    expect((await runCommand('node -e 1 && rm x', ctx())).ok).toBe(false)
  })

  it('白名单命令能跑（node -e 1 退出码 0）', async () => {
    const r = await runCommand('node -e 1', ctx())
    expect(r.ok, r.stderr).toBe(true)
  })
})

describe('★ 循环：工具结果回灌、未知工具不炸', () => {
  it('模型写文件 → 再回答（两轮）', async () => {
    const script: ChatTurn[][] = []
    let i = 0
    const result = await runAgentLoop({
      workspace: ws,
      gate: async () => true,
      model: async messages => {
        script.push([...messages])
        i += 1
        if (i === 1) {
          return {
            calls: [
              { id: 'c1', name: 'write_file', args: { path: 'a.txt', content: 'ok' } },
            ] as ToolCall[],
          }
        }
        return { text: '写好了' }
      },
    })
    expect(result.rounds).toBe(2)
    expect(result.finalText).toBe('写好了')
    expect(result.toolResults[0].output).toContain('已写入')
    expect(await readFile(join(ws, 'a.txt'), 'utf-8')).toBe('ok')
    // 第二轮模型能看到工具结果（回灌）
    expect(JSON.stringify(script[1])).toContain('已写入')
  })

  it('★ 未知工具 ⇒ 错误回灌给模型，循环不炸', async () => {
    let i = 0
    const result = await runAgentLoop({
      workspace: ws,
      model: async () => {
        i += 1
        if (i === 1) return { calls: [{ id: 'c1', name: 'nope', args: {} }] as ToolCall[] }
        return { text: '换个办法' }
      },
    })
    expect(result.toolResults[0].output).toContain('未知工具')
    expect(result.finalText).toBe('换个办法')
  })

  it('轮数用尽 ⇒ 返回已拿到的文本（不抛错）', async () => {
    const result = await runAgentLoop({
      workspace: ws,
      maxRounds: 2,
      model: async () => ({
        calls: [{ id: 'c', name: 'read_file', args: { path: 'missing.txt' } }] as ToolCall[],
      }),
    })
    expect(result.rounds).toBe(2)
    expect(result.toolResults.length).toBe(2)
  })
})

describe('★ validate_flow：结构问题能作为反馈回灌', () => {
  it('合法空流程图 ⇒ 通过', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(ws, '.qqbat'), { recursive: true })
    await writeFile(
      join(ws, '.qqbat', 'flow.json'),
      JSON.stringify({ schemaVersion: '1.1', systems: [], nodes: [], edges: [] }),
    )
    const out = await tool('validate_flow').run({}, ctx())
    expect(out).toContain('通过')
  })

  it('★ 坏文件 ⇒ 返回 invalid 而不是抛错（模型能据此改）', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(ws, '.qqbat'), { recursive: true })
    await writeFile(join(ws, '.qqbat', 'flow.json'), 'not json')
    const out = await tool('validate_flow').run({}, ctx())
    expect(out).toContain('无效')
  })
})

describe('★ step 边界收输入（中途插话）', () => {
  it('★ 第二轮前注入的用户消息会被模型看到', async () => {
    const seen: string[] = []
    let round = 0
    let queued = true
    const result = await runAgentLoop({
      workspace: ws,
      inbox: () => (queued ? ((queued = false), { role: 'user', content: '顺便改下文案' }) : null),
      model: async messages => {
        round += 1
        seen.push(JSON.stringify(messages))
        if (round === 1) {
          return {
            calls: [{ id: 'c', name: 'read_file', args: { path: 'missing.txt' } }] as ToolCall[],
          }
        }
        return { text: '好' }
      },
    })
    expect(result.rounds).toBe(2)
    expect(seen[1]).toContain('顺便改下文案')
  })
})

describe('★ 阶段状态机：结束原因由状态机给出', () => {
  it('正常收尾 ⇒ completed', async () => {
    const r = await runAgentLoop({ workspace: ws, model: async () => ({ text: 'ok' }) })
    expect(r.phase).toEqual({ kind: 'finished', reason: 'completed' })
  })

  it('★ 轮数用尽 ⇒ max-rounds（不是 completed）', async () => {
    const r = await runAgentLoop({
      workspace: ws,
      maxRounds: 1,
      model: async () => ({
        calls: [{ id: 'c', name: 'read_file', args: { path: 'x' } }] as ToolCall[],
      }),
    })
    expect(r.phase).toEqual({ kind: 'finished', reason: 'max-rounds' })
  })

  it('★ 取消 ⇒ cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const r = await runAgentLoop({
      workspace: ws,
      signal: controller.signal,
      model: async () => ({ text: 'never' }),
    })
    expect(r.phase).toEqual({ kind: 'finished', reason: 'cancelled' })
  })
})

describe('★ 服务接线：审批/观测/会话', () => {
  it('★ 写操作走 services.approval；trace 与 session 都收到记录', async () => {
    const approved: string[] = []
    const traced: string[] = []
    const appended: string[] = []
    const services = {
      sandbox: {} as never,
      approval: { request: async (req: { summary: string }) => (approved.push(req.summary), true) },
      context: {} as never,
      session: {
        append: async (_p: string, turn: { content: string }) => {
          appended.push(turn.content)
        },
        load: async () => [],
      },
      trace: {
        record: (_p: string, e: { name: string }) => {
          traced.push(e.name)
        },
      },
    }
    let round = 0
    const result = await runAgentLoop({
      workspace: ws,
      services: services as never,
      model: async () => {
        round += 1
        if (round === 1) {
          return {
            calls: [
              { id: 'c', name: 'write_file', args: { path: 'ok.txt', content: 'hi' } },
            ] as ToolCall[],
          }
        }
        return { text: 'done' }
      },
    })
    expect(result.finalText).toBe('done')
    expect(approved).toHaveLength(1)
    expect(traced).toEqual(['write_file'])
    expect(appended[0]).toContain('write_file')
  })

  it('★ 审批拒绝 ⇒ 工具失败，文件不落盘', async () => {
    const services = {
      sandbox: {} as never,
      approval: { request: async () => false },
      context: {} as never,
      session: { append: async () => undefined, load: async () => [] },
      trace: { record: () => {} },
    }
    let round = 0
    const result = await runAgentLoop({
      workspace: ws,
      services: services as never,
      model: async () => {
        round += 1
        if (round === 1) {
          return {
            calls: [
              { id: 'c', name: 'write_file', args: { path: 'denied.txt', content: 'x' } },
            ] as ToolCall[],
          }
        }
        return { text: 'ok' }
      },
    })
    expect(result.toolResults[0].output).toContain('失败')
    await expect(readFile(join(ws, 'denied.txt'), 'utf-8')).rejects.toThrow()
  })

  describe('★ 厂商报上下文超了：强压一次再试一次', () => {
    it('第二次请求拿到压缩后的消息，onCompact 标明 overflow', async () => {
      let calls = 0
      const seen: ChatTurn[][] = []
      const compacts: { trigger: string; dropped: number }[] = []
      const result = await runAgentLoop({
        workspace: ws,
        initialTurns: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'REQ' },
          ...Array.from({ length: 6 }, () => ({ role: 'user' as const, content: 'x'.repeat(400) })),
        ],
        compaction: { budgetTokens: 100_000, pruneToolResults: false },
        onCompact: c => compacts.push({ trigger: c.trigger, dropped: c.dropped }),
        model: async messages => {
          calls += 1
          seen.push([...messages])
          if (calls === 1) {
            throw Object.assign(new Error('maximum context length exceeded'), { status: 400 })
          }
          return { text: 'recovered' }
        },
      })
      expect(calls).toBe(2)
      expect(result.finalText).toBe('recovered')
      // 第一发是原样，第二发已经变成"头 + 注记 + 最后一条"
      expect(seen[0]!.length).toBe(8)
      expect(seen[1]!.length).toBe(4)
      expect(compacts).toEqual([{ trigger: 'overflow', dropped: 5 }])
    })

    it('不是溢出的错误原样抛，只调一次模型', async () => {
      let calls = 0
      await expect(
        runAgentLoop({
          workspace: ws,
          model: async () => {
            calls += 1
            throw new Error('boom')
          },
        }),
      ).rejects.toThrow('boom')
      expect(calls).toBe(1)
    })

    it('溢出但没得压：只调一次，原始 400 不被"压缩失败"盖掉', async () => {
      let calls = 0
      await expect(
        runAgentLoop({
          workspace: ws,
          compaction: { budgetTokens: 100_000 },
          initialTurns: [
            { role: 'system', content: 'SYS' },
            { role: 'user', content: 'REQ' },
          ],
          model: async () => {
            calls += 1
            throw Object.assign(new Error('maximum context length exceeded'), { status: 400 })
          },
        }),
      ).rejects.toThrow('maximum context length exceeded')
      expect(calls).toBe(1)
    })
  })
})
