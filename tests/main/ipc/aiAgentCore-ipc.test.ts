// tests/main/ipc/aiAgentCore-ipc.test.ts
//
// # 闸门（行为）：agent-core 运行入口的**接线**
//
// 通道名/key 名有 ipcPayloadContract + ipcReachability 两条静态闸门管着，
// 但它们都看不出**接线是不是真的通**：schema 有没有被用、审批有没有接到弹窗、
// 轮数上限有没有透传。这里用 mock 把六件外部依赖挡掉，只测这几件事。
//
// 为什么不复用 ai-ipc.test.ts：那个文件 mock 了整套助手服务（720 行），
// 这一条通道**不经过**那些服务 —— 塞进去只会让两边的 mock 互相干扰。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Handler = (event: unknown, args: unknown) => Promise<unknown>

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  resolveConfig: vi.fn(),
  runAgentTurn: vi.fn(),
  requestApproval: vi.fn(),
  appendTrace: vi.fn(),
  /** 预设注册表：运行时按名字裁决（fail-closed）、菜单读整份注册表 */
  resolvePresetForRun: vi.fn(),
  readPresetRoster: vi.fn(),
  /** 第 51 批：空白线程套项目默认；默认坏了 fail-closed */
  resolveDefaultPreset: vi.fn(),
  writePresetDefault: vi.fn(),
  /** 会话预设锁（第 50 批）：默认"没锁"，各用例按需改 */
  decideSessionPreset: vi.fn(),
  readPresetSession: vi.fn(),
  writePresetSession: vi.fn(),
  /** 主进程发出去的事件（只在回调里发的那些，比如 ai:compact，要靠它断言） */
  send: vi.fn(),
  /** 旧 27 工具适配器：这里只验接线（真适配器另有 legacyTools 的测试） */
  adaptLegacyTools: vi.fn(),
  validateProposal: vi.fn(),
  buildVerdict: vi.fn(),
  /** 开荒装配（空 projectPath）：这条分支单独测，项目内那条一步都不该走 */
  runOnboarding: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn)
    },
  },
  BrowserWindow: {
    // send 必须是**稳定**的 mock：事件在循环回调里才发，用例要先拿到同一个函数
    fromWebContents: () => ({ webContents: { send: h.send } }),
  },
}))

vi.mock('@main/services/ai/appAiConfig', () => ({ resolveAuthorAiConfig: h.resolveConfig }))
vi.mock('@main/ipc/aiAgentCoreOnboarding', () => ({
  ONBOARDING_MAX_ROUNDS: 8,
  runOnboardingTurn: h.runOnboarding,
}))
vi.mock('@main/services/ai/trace', () => ({ appendTrace: h.appendTrace }))
vi.mock('@main/services/ai/toolApproval', () => ({ requestApproval: h.requestApproval }))
vi.mock('@main/services/agent-core/runTurn', () => ({ runAgentTurn: h.runAgentTurn }))
vi.mock('@main/services/agent-core/legacyTools', () => ({
  adaptLegacyTools: h.adaptLegacyTools,
  adaptLegacyTool: vi.fn(),
}))
vi.mock('@main/services/ai/proposalValidation', () => ({
  validateProposalOperations: h.validateProposal,
}))
vi.mock('@main/services/ai/verifier', () => ({ buildVerdict: h.buildVerdict }))
vi.mock('@main/services/ai/presets', () => ({
  resolvePresetForRun: h.resolvePresetForRun,
  readPresetRoster: h.readPresetRoster,
  resolveDefaultPreset: h.resolveDefaultPreset,
  writePresetDefault: h.writePresetDefault,
  writePresets: vi.fn(),
}))
vi.mock('@main/services/ai/presetLock', () => ({
  decideSessionPreset: h.decideSessionPreset,
  readPresetSession: h.readPresetSession,
  writePresetSession: h.writePresetSession,
}))
vi.mock('@main/services/infra/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { registerAiAgentCoreIpc } from '@main/ipc/aiAgentCore'

const CONFIG = { baseUrl: 'http://example.invalid', apiKey: 'k', model: 'm' }
const RESULT = {
  finalText: '做完了',
  rounds: 2,
  phase: { kind: 'finished', reason: 'completed' },
  toolResults: [{ name: 'write_file', args: { path: 'a.ts' }, output: '已写入' }],
}

/** 调一次通道（注册只有启动时一次，所以延迟到调用处再注册） */
async function invokeChannel(channel: string, payload: unknown): Promise<unknown> {
  if (!h.handlers.has(channel)) registerAiAgentCoreIpc()
  const fn = h.handlers.get(channel)
  expect(fn, `通道 ${channel} 没注册`).toBeTruthy()
  return fn!({ sender: {} }, payload)
}

/** 本文件的主角：`ai:agentCoreRun` */
async function invoke(payload: unknown): Promise<unknown> {
  return invokeChannel('ai:agentCoreRun', payload)
}

describe('ai:agentCoreRun 接线', () => {
  beforeEach(() => {
    h.handlers.clear()
    h.resolveConfig.mockReset().mockResolvedValue(CONFIG)
    h.runAgentTurn.mockReset().mockResolvedValue(RESULT)
    h.requestApproval.mockReset().mockResolvedValue('allow')
    h.appendTrace.mockReset()
    // 预设默认"按名字能查到"；查不到/坏了的分支各自在用例里改
    h.resolvePresetForRun
      .mockReset()
      .mockImplementation(async (_projectPath: string, name: string) => ({
        ok: true,
        preset: { name },
      }))
    h.readPresetRoster.mockReset().mockResolvedValue({ presets: [] })
    h.resolveDefaultPreset.mockReset().mockResolvedValue({ ok: true, preset: null })
    h.writePresetDefault.mockReset().mockResolvedValue(undefined)
    h.decideSessionPreset
      .mockReset()
      .mockImplementation(
        async (
          _projectPath: string,
          _threadId: string,
          _started: boolean,
          requested: string | null,
        ) => ({
          ok: true,
          decision: { preset: requested, persist: false },
        }),
      )
    h.readPresetSession
      .mockReset()
      .mockResolvedValue({ started: false, preset: null, locked: false })
    h.writePresetSession.mockReset().mockResolvedValue(undefined)
    h.send.mockReset()
    h.runOnboarding.mockReset().mockResolvedValue({ ok: true, finalText: '开荒好了' })
    h.validateProposal.mockReset().mockResolvedValue({ issues: [], introduced: [] })
    h.buildVerdict.mockReset().mockReturnValue({ ok: true, issues: [], evidence: '', by: 'static' })
    /**
     * 假旧工具表：一条 mutation（往 bridge 里攒操作）+ 一条与循环同名的 query。
     * 同名那条是为了钉住「循环版优先」—— 留错那份，闸门就变成两套。
     */
    h.adaptLegacyTools
      .mockReset()
      .mockImplementation((bridge: { pendingOperations: Array<Record<string, unknown>> }) => [
        {
          name: 'add_node',
          description: '加节点',
          category: 'mutation',
          parameters: {},
          async run() {
            bridge.pendingOperations.push({ kind: 'add_node', type: 'message_send' })
            return '操作已加入待确认计划（1 项）'
          },
        },
        {
          name: 'read_file',
          description: '旧版读文件',
          category: 'query',
          parameters: {},
          async run() {
            return '（旧版）'
          },
        },
      ])
  })

  it('★ 载荷过 schema：缺 requirement 直接拒，不往下跑', async () => {
    const res = (await invoke({ projectPath: 'D:/p' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('参数校验失败')
    // 校验失败不该去碰模型配置，更不该开始循环
    expect(h.resolveConfig).not.toHaveBeenCalled()
    expect(h.runAgentTurn).not.toHaveBeenCalled()
  })

  it('参数不是对象也拒（undefined / null）', async () => {
    expect(((await invoke(undefined)) as { ok: boolean }).ok).toBe(false)
    expect(((await invoke(null)) as { ok: boolean }).ok).toBe(false)
  })

  it('★ projectPath 为空 = 开荒装配（同一条循环的第二套装配，不是第二条链路）', async () => {
    const res = (await invoke({ projectPath: '', requirement: '做个签到机器人' })) as {
      ok: boolean
    }
    expect(res.ok).toBe(true)
    expect(h.runOnboarding).toHaveBeenCalledTimes(1)
    expect(h.runOnboarding.mock.calls[0][0]).toMatchObject({ requirement: '做个签到机器人' })
    // 项目内那条路一步都不该走：trace / 审批 / 项目工具表都只属于有工作区的时候
    expect(h.runAgentTurn).not.toHaveBeenCalled()
    expect(h.appendTrace).not.toHaveBeenCalled()
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('没有模型配置 → 明确说"先配好"，不静默失败', async () => {
    h.resolveConfig.mockResolvedValue(null)
    const res = (await invoke({ projectPath: 'D:/p', requirement: '改一下' })) as {
      ok: boolean
      error?: string
    }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没有可用的模型配置')
    expect(h.runAgentTurn).not.toHaveBeenCalled()
  })

  it('★ 正常一轮：回执带 finalText / rounds / phase / toolResults（含 args）', async () => {
    const res = (await invoke({ projectPath: 'D:/p', requirement: '改一下' })) as Record<
      string,
      unknown
    >
    expect(res.ok).toBe(true)
    expect(res.finalText).toBe('做完了')
    expect(res.rounds).toBe(2)
    expect(res.phase).toEqual({ kind: 'finished', reason: 'completed' })
    expect(res.toolResults).toEqual(RESULT.toolResults)
    const passed = h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>
    expect(passed.projectPath).toBe('D:/p')
    expect(passed.requirement).toBe('改一下')
    expect(passed.config).toEqual(CONFIG)
    // 没传 maxRounds 就不该带这个键（循环用自己的默认值）
    expect('maxRounds' in passed).toBe(false)
  })

  it('maxRounds 透传（只认正整数，schema 挡掉 0 和负数）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '改一下', maxRounds: 3 })
    expect((h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>).maxRounds).toBe(3)

    h.runAgentTurn.mockClear()
    expect(
      ((await invoke({ projectPath: 'D:/p', requirement: 'x', maxRounds: 0 })) as { ok: boolean })
        .ok,
    ).toBe(false)
    expect(h.runAgentTurn).not.toHaveBeenCalled()
  })

  it('★ 审批接到现有弹窗：写盘问 write_file、跑命令问 run_command，allow 才算同意', async () => {
    // 用 coder（代码页）：下面写的是 src/，builder 会被角色的写域闸先拒掉
    await invoke({ projectPath: 'D:/p', requirement: '改一下', agentMode: 'code' })
    const approval = (
      h.runAgentTurn.mock.calls[0][0] as {
        approval: (req: unknown) => Promise<boolean>
      }
    ).approval

    await expect(approval({ kind: 'write', summary: 'src/a.ts' })).resolves.toBe(true)
    expect(h.requestApproval.mock.calls[0][0]).toMatchObject({
      projectPath: 'D:/p',
      toolName: 'write_file',
      args: { path: 'src/a.ts' },
      hint: 'src/a.ts',
    })
    // callId 每轮唯一：重复的 callId 会把上一次的等待按拒绝收掉
    await approval({ kind: 'write', summary: 'src/b.ts' })
    const ids = h.requestApproval.mock.calls.map(c => (c[0] as { callId: string }).callId)
    expect(new Set(ids).size).toBe(ids.length)

    h.requestApproval.mockResolvedValue('deny')
    await expect(approval({ kind: 'command', summary: 'pnpm test' })).resolves.toBe(false)
    expect(h.requestApproval.mock.calls.at(-1)?.[0]).toMatchObject({
      toolName: 'run_command',
      args: { command: 'pnpm test' },
    })
  })

  it('★ 先计划：planFirst 变成循环的 planOnly（只读工具由 runTurn 那层物理裁掉）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '先出计划', planFirst: true })
    const passed = h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>
    expect(passed.planOnly).toBe(true)

    h.runAgentTurn.mockClear()
    await invoke({ projectPath: 'D:/p', requirement: '直接做' })
    // 没开就是没开：不该塞一个 false 进去（循环按缺省处理）
    expect('planOnly' in (h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>)).toBe(false)
  })

  it('★ 完全权限：不再弹窗，但角色的写域闸仍然拦得住（开关不是免死金牌）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '放开做', fullAccess: true }) // 缺省 builder
    const approval = (
      h.runAgentTurn.mock.calls[0][0] as {
        approval: (req: unknown) => Promise<boolean>
      }
    ).approval

    // 界面域：直接放行，而且连规则表都没碰（本次运行有效，不落盘）
    await expect(approval({ kind: 'command', summary: 'pnpm test' })).resolves.toBe(true)
    await expect(approval({ kind: 'write', summary: 'D:/p/.qqbat/flow.json' })).resolves.toBe(true)
    expect(h.requestApproval).not.toHaveBeenCalled()

    // 越界写照样拒：完全权限只跳过"问人"，不跳过角色的作用域
    await expect(approval({ kind: 'write', summary: 'D:/p/src/a.ts' })).rejects.toThrow(/不能写它/)
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('★ 预设/白名单裁过的工具表真的交给循环（以前 turnTools 算完就丢）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '只看', allowedTools: ['read_file'] })
    const tools = (h.runAgentTurn.mock.calls[0][0] as { tools?: Array<{ name: string }> }).tools
    expect(tools?.map(t => t.name)).toEqual(['read_file'])

    // 旧工具也在同一张表里，白名单一样收得住
    h.runAgentTurn.mockClear()
    await invoke({ projectPath: 'D:/p', requirement: '只加节点', allowedTools: ['add_node'] })
    const legacyOnly = (h.runAgentTurn.mock.calls[0][0] as { tools?: Array<{ name: string }> })
      .tools
    expect(legacyOnly?.map(t => t.name)).toEqual(['add_node'])
  })

  it('★ 旧工具真进循环工具表，同名时让位给循环版（闸门只能有一套）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '给 /test 加个发消息节点' })
    const tools = (
      h.runAgentTurn.mock.calls[0][0] as {
        tools?: Array<{ name: string; description: string }>
      }
    ).tools
    const names = tools?.map(t => t.name) ?? []
    expect(names).toContain('add_node')
    expect(names).toContain('read_file')
    // 两张表都有 read_file：循环那份（工作区相对路径 + 审批闸）必须赢
    expect(names.filter(n => n === 'read_file')).toHaveLength(1)
    expect(tools?.find(t => t.name === 'read_file')?.description).not.toBe('旧版读文件')
    expect(h.adaptLegacyTools).toHaveBeenCalledTimes(1)
  })

  it('★ mutation 只攒提案：轮末发 ai:proposal、不发 ai:response', async () => {
    // 模拟模型这一轮真的调了 add_node（适配器把操作攒进 bridge，不落盘）
    h.runAgentTurn.mockImplementation(
      async (input: {
        tools?: Array<{ name: string; run: (a: Record<string, unknown>) => Promise<string> }>
      }) => {
        const tool = input.tools?.find(t => t.name === 'add_node')
        const output = await tool!.run({})
        return {
          ...RESULT,
          finalText: '我把它排进计划了',
          toolResults: [{ name: 'add_node', args: {}, output }],
        }
      },
    )
    const res = (await invoke({
      projectPath: 'D:/p',
      requirement: '给 /test 加个发消息节点',
    })) as { ok: boolean }
    expect(res.ok).toBe(true)

    const channels = h.send.mock.calls.map(c => c[0])
    expect(channels).toContain('ai:proposal')
    // 两条都发 = 同一轮长出「正文 + 提案」两份尾巴，渲染层的收尾分工靠这条口径
    expect(channels).not.toContain('ai:response')
    expect(channels).toContain('ai:agentState')

    const payload = h.send.mock.calls.find(c => c[0] === 'ai:proposal')![1] as {
      projectPath: string
      proposal: { id: string; summary: string; operations: unknown[] }
    }
    expect(payload.projectPath).toBe('D:/p')
    // 提案标题就是用户这一句：卡片上要能认出「这是刚才那个要求」
    expect(payload.proposal.summary).toBe('给 /test 加个发消息节点')
    expect(payload.proposal.operations).toHaveLength(1)
    expect(typeof payload.proposal.id).toBe('string')
  })

  it('提案组装失败就退回正文（不许一片空白）', async () => {
    h.validateProposal.mockRejectedValue(new Error('校验炸了'))
    h.runAgentTurn.mockImplementation(
      async (input: {
        tools?: Array<{ name: string; run: (a: Record<string, unknown>) => Promise<string> }>
      }) => {
        const tool = input.tools?.find(t => t.name === 'add_node')
        await tool!.run({})
        return RESULT
      },
    )
    await invoke({ projectPath: 'D:/p', requirement: '加个节点' })
    const channels = h.send.mock.calls.map(c => c[0])
    expect(channels).toContain('ai:response')
    expect(channels).not.toContain('ai:proposal')
  })

  it('★ 角色的写域闸：builder 写 src/ 直接拒，连弹窗都不弹（点"允许"不能绕过角色边界）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '改源码' }) // 缺省 = builder
    const approval = (
      h.runAgentTurn.mock.calls[0][0] as {
        approval: (req: unknown) => Promise<boolean>
      }
    ).approval

    // 真机上 `GateRequest.path` 就是**绝对路径**（core.ts:274 → 适配成 summary），
    // 所以这里按绝对路径断言；顺手再测一次相对路径（手工调用/测试的常见写法）
    await expect(approval({ kind: 'write', summary: 'D:/p/src/a.ts' })).rejects.toThrow(
      /src\/a\.ts/,
    )
    await expect(approval({ kind: 'write', summary: 'src/b.ts' })).rejects.toThrow(/不能写它/)
    expect(h.requestApproval).not.toHaveBeenCalled()

    // 同一角色的界面域照常问（拒绝的是越界，不是"这个角色不许写盘"）
    await expect(approval({ kind: 'write', summary: 'D:/p/.qqbat/flow.json' })).resolves.toBe(true)
    expect(h.requestApproval).toHaveBeenCalledTimes(1)
  })

  it('★ coder 反过来：界面域被拒（读不分域，只是不许写）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '改源码', agentMode: 'code' })
    const approval = (
      h.runAgentTurn.mock.calls[0][0] as {
        approval: (req: unknown) => Promise<boolean>
      }
    ).approval

    await expect(approval({ kind: 'write', summary: 'D:/p/.qqbat/flow.json' })).rejects.toThrow(
      /界面/,
    )
    expect(h.requestApproval).not.toHaveBeenCalled()
  })

  it('★ 角色说明进系统提示：agentMode 推角色；预设的 role 覆盖它、prompt 接在后面', async () => {
    await invoke({ projectPath: 'D:/p', requirement: 'x', agentMode: 'code' })
    const note = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote
    expect(note).toBeTruthy()

    h.runAgentTurn.mockClear()
    h.resolvePresetForRun.mockResolvedValue({
      ok: true,
      preset: { name: '夜巡', role: 'builder', prompt: '只动流程' },
    })
    await invoke({ projectPath: 'D:/p', requirement: 'x', agentMode: 'code', preset: '夜巡' })
    const second = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote
    expect(second).toContain('只动流程')
    // 预设的 role 真的盖过了页面推出的角色（否则两段说明会一模一样）
    expect(second).not.toBe(note)
  })

  it('★ 贴图真交给循环，而且记忆里只留一句「附了 N 张图」（图不落盘）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-img-'))
    try {
      const png = 'data:image/png;base64,iVBORw0KGgo='
      await invoke({ projectPath: dir, requirement: '你看这是怎么回事', images: [png] })
      const passed = h.runAgentTurn.mock.calls[0][0] as { images?: string[] }
      expect(passed.images).toEqual([png])

      // 记忆 == .qqbat 下那份 JSONL；图本身不进去，只有一句说明
      const raw = readFileSync(join(dir, '.qqbat', 'ai-history.jsonl'), 'utf-8')
      expect(raw).toContain('附了 1 张图')
      expect(raw).not.toContain('base64')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    h.runAgentTurn.mockClear()
    await invoke({ projectPath: 'D:/p', requirement: '没图' })
    // 没贴图就不带这个键（循环按纯文本走）
    expect('images' in (h.runAgentTurn.mock.calls[0][0] as Record<string, unknown>)).toBe(false)
  })

  it('★ 贴图的格式与张数由 schema 兜底（界面可以被绕过）', async () => {
    // 非 data URL 的串不该被当真送进 provider
    const bad = (await invoke({
      projectPath: 'D:/p',
      requirement: 'x',
      images: ['https://example.invalid/a.png'],
    })) as { ok: boolean; error?: string }
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('参数校验失败')

    const tooMany = (await invoke({
      projectPath: 'D:/p',
      requirement: 'x',
      images: Array.from({ length: 5 }, () => 'data:image/png;base64,AAAA'),
    })) as { ok: boolean }
    expect(tooMany.ok).toBe(false)
    expect(h.runAgentTurn).not.toHaveBeenCalled()
  })

  it('★ 代码页把「当前打开的文件」写进提示；低代码页不写（不引它去动源码）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-file-'))
    try {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n')

      await invoke({
        projectPath: dir,
        requirement: '改这个',
        agentMode: 'code',
        activeFilePath: 'src/a.ts',
      })
      const note = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote
      expect(note).toContain('src/a.ts')
      expect(note).toContain('不要再反问')

      h.runAgentTurn.mockClear()
      // 低代码页（builder）拿到同一个字段也不该用
      await invoke({ projectPath: dir, requirement: '改这个', activeFilePath: 'src/a.ts' })
      const builder = (h.runAgentTurn.mock.calls[0][0] as { roleNote: string }).roleNote
      expect(builder).not.toContain('src/a.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('★ 预设的 permissionMode:full 真的补位（调用方没表态时）', async () => {
    h.resolvePresetForRun.mockResolvedValue({
      ok: true,
      preset: { name: '无人值守', permissionMode: 'full' },
    })
    await invoke({
      projectPath: 'D:/p',
      requirement: '放开来做',
      agentMode: 'code',
      preset: '无人值守',
    })
    const approval = (
      h.runAgentTurn.mock.calls[0][0] as {
        approval: (req: unknown) => Promise<boolean>
      }
    ).approval

    // coder 的写域内：不弹窗直接过
    await expect(approval({ kind: 'write', summary: 'src/a.ts' })).resolves.toBe(true)
    expect(h.requestApproval).not.toHaveBeenCalled()

    // 但显式 false 要盖过预设（界面开关是显式表态）
    h.runAgentTurn.mockClear()
    await invoke({
      projectPath: 'D:/p',
      requirement: '还是问我',
      agentMode: 'code',
      preset: '无人值守',
      fullAccess: false,
    })
    const second = (
      h.runAgentTurn.mock.calls[0][0] as {
        approval: (req: unknown) => Promise<boolean>
      }
    ).approval
    await expect(second({ kind: 'write', summary: 'src/a.ts' })).resolves.toBe(true)
    expect(h.requestApproval).toHaveBeenCalledTimes(1)
  })

  it('★ 循环内压缩要发 ai:compact（不然"模型突然变笨"没法解释）', async () => {
    await invoke({ projectPath: 'D:/p', requirement: '跑个长任务' })
    const onCompact = (
      h.runAgentTurn.mock.calls[0][0] as {
        onCompact?: (info: { dropped: number; tokensBefore: number; tokensAfter: number }) => void
      }
    ).onCompact
    expect(typeof onCompact, '循环压缩的回调必须接上').toBe('function')

    h.send.mockClear()
    onCompact!({ dropped: 7, tokensBefore: 91234, tokensAfter: 12045 })
    /**
     * 通道 + 四个键都要对：少 projectPath → 渲染层 routeTo 不知道往哪个项目挂，
     * 少 dropped / tokensBefore / tokensAfter → 界面上那句话没有数字可填。
     */
    expect(h.send).toHaveBeenCalledWith('ai:compact', {
      projectPath: 'D:/p',
      dropped: 7,
      tokensBefore: 91234,
      tokensAfter: 12045,
    })
  })

  /**
   * ★ 第 48 批：预设查不到 = 直接不开跑。
   *
   * 以前查不到就 `undefined`：白名单消失、角色退回页面默认，界面上一切正常。
   * 这条用例钉住"静默放行"不会再回来 —— 报错里还要带名字，用户才知道去改哪一条。
   */
  it('★ 预设名查不到：fail-closed，不开始循环并把原因说清', async () => {
    h.resolvePresetForRun.mockResolvedValue({
      ok: false,
      error: '找不到预设「夜巡」；为避免静默放开权限，这一轮没有开始',
    })
    const res = (await invoke({
      projectPath: 'D:/p',
      requirement: 'x',
      preset: '夜巡',
    })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('找不到预设「夜巡」')
    expect(h.runAgentTurn).not.toHaveBeenCalled()
  })

  it('★ 会话已锁定：界面不传 preset 也沿用锁里的值（不能少传一个字段就放开）', async () => {
    h.decideSessionPreset.mockResolvedValue({
      ok: true,
      decision: { preset: '只读巡检', persist: false },
    })
    // 用空临时项目：D:/p 在别的用例里已经被写过历史，会变成"已开始"
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-lock-'))
    try {
      const res = (await invoke({ projectPath: dir, requirement: '继续' })) as { ok: boolean }
      expect(res.ok).toBe(true)
      expect(h.decideSessionPreset).toHaveBeenCalledWith(dir, 'default', false, null)
      expect(h.resolvePresetForRun).toHaveBeenCalledWith(dir, '只读巡检')
      // 已锁的会话不再落盘：锁是上一轮写的
      expect(h.writePresetSession).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('★ 会话已锁定还换名：直接拒绝，不开始循环', async () => {
    h.decideSessionPreset.mockResolvedValue({
      ok: false,
      error: '这个会话已经以预设「只读巡检」开始，不能再换成「全放行」。要换预设，先清空这个会话。',
    })
    const res = (await invoke({
      projectPath: 'D:/p',
      requirement: 'x',
      preset: '全放行',
    })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('先清空这个会话')
    expect(h.resolvePresetForRun).not.toHaveBeenCalled()
    expect(h.runAgentTurn).not.toHaveBeenCalled()
  })

  it('空白线程：预设解析成功后才落锁（解析失败不写）', async () => {
    h.decideSessionPreset.mockResolvedValue({
      ok: true,
      decision: { preset: '只读巡检', persist: true },
    })
    await invoke({ projectPath: 'D:/p', requirement: 'x', preset: '只读巡检' })
    expect(h.writePresetSession).toHaveBeenCalledWith('D:/p', 'default', '只读巡检')
  })

  it('ai:getPresets：把注册表原样交出去（坏条目/notes/fileProblem 都由服务层裁决）', async () => {
    const roster = {
      presets: [
        { name: '只读', role: 'coder' },
        { name: '只读', broken: '重名' },
      ],
      fileProblem: '顶层不是数组',
    }
    h.readPresetRoster.mockResolvedValue(roster)
    const res = await invokeChannel('ai:getPresets', { projectPath: 'D:/p' })
    expect(res).toEqual({ ok: true, data: roster })
    expect(h.readPresetRoster).toHaveBeenCalledWith('D:/p')
    expect(h.readPresetSession).not.toHaveBeenCalled()
  })

  it('★ 空白线程没表态：套项目默认（默认只影响新会话）', async () => {
    h.resolveDefaultPreset.mockResolvedValue({ ok: true, preset: '只读巡检' })
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-default-'))
    try {
      await invoke({ projectPath: dir, requirement: 'x' })
      expect(h.resolveDefaultPreset).toHaveBeenCalledWith(dir)
      expect(h.decideSessionPreset).toHaveBeenCalledWith(dir, 'default', false, '只读巡检')
      expect(h.resolvePresetForRun).toHaveBeenCalledWith(dir, '只读巡检')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('★ 显式 null（跟页面）：不套默认，也不读默认文件', async () => {
    h.resolveDefaultPreset.mockResolvedValue({ ok: true, preset: '只读巡检' })
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-null-'))
    try {
      await invoke({ projectPath: dir, requirement: 'x', preset: null })
      expect(h.resolveDefaultPreset).not.toHaveBeenCalled()
      expect(h.decideSessionPreset).toHaveBeenCalledWith(dir, 'default', false, null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('★ 默认预设坏了：fail-closed，不开始循环（默认也是权限口径）', async () => {
    h.resolveDefaultPreset.mockResolvedValue({
      ok: false,
      error: '默认预设不可用：默认预设「夜巡」不存在或不可用；为避免静默放开权限，这一轮没有开始',
    })
    const dir = mkdtempSync(join(tmpdir(), 'qqbat-agentcore-baddefault-'))
    try {
      const res = (await invoke({ projectPath: dir, requirement: 'x' })) as {
        ok: boolean
        error?: string
      }
      expect(res.ok).toBe(false)
      expect(res.error).toContain('默认预设不可用')
      expect(h.runAgentTurn).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('★ ai:setPresetDefault：写默认 / 服务层拒绝时把原因带回来', async () => {
    const ok = await invokeChannel('ai:setPresetDefault', {
      projectPath: 'D:/p',
      preset: '只读巡检',
    })
    expect(ok).toEqual({ ok: true })
    expect(h.writePresetDefault).toHaveBeenCalledWith('D:/p', '只读巡检')

    h.writePresetDefault.mockRejectedValue(new Error('不能把「夜巡」设为默认：它不是可用的预设'))
    const bad = (await invokeChannel('ai:setPresetDefault', {
      projectPath: 'D:/p',
      preset: '夜巡',
    })) as { ok: boolean; error?: string }
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('不是可用的预设')
  })

  it('ai:getPresets 带 threadId：额外回会话锁状态（菜单据此禁用换预设）', async () => {
    const roster = { presets: [] }
    const session = { started: true, preset: '只读巡检', locked: true }
    h.readPresetRoster.mockResolvedValue(roster)
    h.readPresetSession.mockResolvedValue(session)
    const res = await invokeChannel('ai:getPresets', { projectPath: 'D:/p', threadId: 't-1' })
    expect(res).toEqual({ ok: true, data: { ...roster, session } })
    expect(h.readPresetSession).toHaveBeenCalledWith('D:/p', 't-1')
  })
})
