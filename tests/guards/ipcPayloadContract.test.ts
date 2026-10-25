// tests/guards/ipcPayloadContract.test.ts
//
// # 闸门：preload 发出去的**载荷键名**，必须与主进程 schema 要的一致
//
// ## 为什么要有它（2026-10-06 审查抓到的 P0）
//
// `ai:chat` 曾经长这样：preload 发 `{ projectPath, text }`，而 `aiChatSchema` 要 `message`
// → `safeParse` 失败 → handler 在"参数校验失败"处直接返回 —— `processAiChat` **一次都没跑过**。
// 三条既有守卫全绿：
//   · `ipcSurfaceParity` 只比**通道名**（两边都有 ai:chat ✓）
//   · 测试走的是 schema 的形状（`message`），而生产走的是 preload 的形状（`text`）
//   · `tsc` 管不到载荷 —— `ipcRenderer.invoke` 的参数类型是 `unknown`
// **键名是跨进程契约里唯一没人对账的一环**，这条闸门就是来对账的。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aiAgentCoreRunSchema,
  aiAgentCoreSteerSchema,
  aiSavePresetsSchema,
  aiRemoveAllowRuleSchema,
  aiHistorySchema,
  aiNoteTurnSchema,
  aiProjectPathSchema,
  aiPresetRosterSchema,
  aiThreadSchema,
  rewindToSchema,
  aiFallbacksSchema,
  approvalDecisionSchema,
  rollbackTurnSchema,
} from '@main/schemas/ai'

const PRELOAD = join(process.cwd(), 'src', 'preload', 'index.ts')

/**
 * 通道 → 主进程用来校验**整个载荷**的 schema。
 *
 * 只有"整份载荷就是这个 schema"的通道才能登记（有些通道是 `{ projectPath, config }`，
 * 而 schema 只校验 config 那一段 —— 那种这里核不出来，见 EXEMPT）。
 */
const CONTRACTS: Record<string, { shape: Record<string, unknown>; note: string }> = {
  'ai:agentCoreRun': {
    shape: aiAgentCoreRunSchema.shape,
    note: 'agent-core 循环入口（workspace-first）：projectPath + requirement + 可选轮数上限',
  },
  'ai:savePresets': {
    shape: aiSavePresetsSchema.shape,
    note: '保存会话预设（整表覆盖）：projectPath + presets[]（未知工具/插件回 warnings）',
  },
  'ai:getPresets': {
    shape: aiPresetRosterSchema.shape,
    note: '读会话预设注册表（坏条目带 broken、字段被忽略带 notes；带 threadId 时回会话锁状态）',
  },
  'ai:agentCoreSteer': {
    shape: aiAgentCoreSteerSchema.shape,
    note: '循环中途插话：projectPath + text（下一个步边界注入）',
  },
  'ai:getAllowRules': {
    shape: aiProjectPathSchema.shape,
    note: '「以后别再问」规则表（撤销口：看）',
  },
  'ai:clearAllowRules': {
    shape: aiProjectPathSchema.shape,
    note: '「以后别再问」规则表（撤销口：清空）',
  },
  'ai:removeAllowRule': {
    shape: aiRemoveAllowRuleSchema.shape,
    note: '「以后别再问」规则表（撤销口：删单条）',
  },
  'ai:beginBatch': { shape: aiProjectPathSchema.shape, note: '批处理事务按项目' },
  'ai:commitBatch': { shape: aiProjectPathSchema.shape, note: '批处理事务按项目' },
  'ai:rollbackBatch': { shape: aiProjectPathSchema.shape, note: '批处理事务按项目' },
  'ai:cancelChat': { shape: aiProjectPathSchema.shape, note: '取消按项目' },
  'ai:isRunning': { shape: aiProjectPathSchema.shape, note: '在飞状态按项目' },
  'ai:getHistory': {
    shape: aiHistorySchema.shape,
    note: '读回磁盘对话记忆（按项目 + 可选任务线程）',
  },
  'ai:listThreads': {
    shape: aiProjectPathSchema.shape,
    note: '列出项目的任务线程（按最后活动倒序）',
  },
  'ai:listTurns': { shape: aiProjectPathSchema.shape, note: '列出已记录的 AI 轮次（撤回候选）' },
  'ai:rewindTo': {
    shape: rewindToSchema.shape,
    note: '从此处重开对话：回退产物 + 记忆截断到这句之前',
  },
  'ai:setFallbacks': {
    shape: aiFallbacksSchema.shape,
    note: 'Key 池（回退链）：只写它，走专用载荷（不进 aiConfigSchema）',
  },
  'ai:previewTurn': {
    shape: rollbackTurnSchema.shape,
    note: '撤回预览：只读一轮将发生什么（复用 rollbackTurnSchema）',
  },
  'ai:resolveApproval': {
    shape: approvalDecisionSchema.shape,
    note: '回工具批准决定（allow/deny/always）',
  },
  'ai:rollbackTurn': { shape: rollbackTurnSchema.shape, note: '撤回一轮：文件回滚 + 流程还原' },
  'ai:clearThread': { shape: aiThreadSchema.shape, note: '真的清空某条线程的记忆（界面 + 磁盘）' },
  'ai:noteTurn': {
    shape: aiNoteTurnSchema.shape,
    note: '把"用户对计划的处置"写进记忆（应用 / 拒绝 / 回滚）—— 模型下一轮据此知道结果',
  },
}

/** 暂不纳入核对（载荷不是对象字面量 / schema 只校验其中一段）—— **新增 ai: 通道必须在这里表态** */
const EXEMPT: Record<string, string> = {
  'ai:tools': '无载荷',
  'ai:getToolBudget': '无载荷',
  'ai:setToolBudget': '载荷是 setting 对象（非字面量），键名由 toolBudgetSchema 校验',
  'ai:setConfig': '载荷是 config 对象（非字面量）',
  'ai:getAppConfig': '无载荷',
  'ai:setAppConfig': '载荷是 { config }，schema 只校验 config 段',
  'ai:getProjectBotConfig': '载荷是 { projectPath }，schema 只校验 config 段（可 null）',
  'ai:setProjectBotConfig': '载荷是 { projectPath, config }，schema 只校验 config 段',
  'ai:listProjectBotConfigs': '无载荷',
  'ai:getConfig': 'projectPath 可省略（schema 是 min(1)，语义不同）',
  'ai:testConfig': '载荷是 { config }（表单对象，非字面量），schema 只校验 config 段',
  'ai:saveProjectConfig': '载荷是 { projectPath, config }，schema 只校验 config 段',
  'ai:instructionResult':
    '载荷是 { requestId, outcome }，由 shared/protocol/instruction 的 isInstructionResult 窄化（不是 zod schema）',
}

interface Payload {
  channel: string
  keys: string[] | null
}

/** 从 preload 源码里抠出 `invoke('chan', { a, b })` 的键名；非字面量载荷返回 null */
export function extractPayloads(source: string): Payload[] {
  const out: Payload[] = []
  const re = /invoke\('([^']+)',\s*(\{[^}]*\})?/g
  for (const m of source.matchAll(re)) {
    const channel = m[1]
    const literal = m[2]
    if (!literal) {
      out.push({ channel, keys: null })
      continue
    }
    const body = literal.slice(1, -1).trim()
    const keys = body
      ? body
          .split(',')
          .map(part => {
            const t = part.trim()
            const colon = t.indexOf(':')
            return (colon >= 0 ? t.slice(0, colon) : t).trim()
          })
          // ⚠️ 尾逗号会切出一个**空名**（载荷超过 100 列后 prettier 会拆成多行并补尾逗号）——
          // 那不是键，必须丢掉：否则排版一变，闸门就会报「多出 schema 里没有的键 ''」
          //（2026-10-15 加 activeFilePath 让 ai:chat 的载荷正好过线时撞到）。
          .filter(name => name.length > 0)
      : []
    out.push({ channel, keys })
  }
  return out
}

/** 载荷键名核对 —— 返回问题清单（空数组 = 通过） */
export function checkPayload(
  channel: string,
  keys: readonly string[] | null,
  shape: Record<string, unknown>,
): string[] {
  if (keys === null) return [`${channel}: 载荷不是对象字面量，无法静态核对`]
  const want = Object.keys(shape).sort()
  const got = [...keys].sort()
  const problems: string[] = []
  for (const k of want)
    if (!got.includes(k))
      problems.push(
        `${channel}: 少了主进程要的键 ${k}（schema 需要 ${want.join(',')}，实际 ${got.join(',')}）`,
      )
  for (const k of got)
    if (!want.includes(k))
      problems.push(`${channel}: 多出 schema 里没有的键 ${k}（zod 会静默剥掉它）`)
  return problems
}

describe('闸门：IPC 载荷键名 ↔ 主进程 schema', () => {
  const source = readFileSync(PRELOAD, 'utf-8')
  const payloads = extractPayloads(source)

  it('登记过的通道，preload 的键名与 schema 完全一致', () => {
    const problems: string[] = []
    for (const [channel, { shape }] of Object.entries(CONTRACTS)) {
      const hit = payloads.find(p => p.channel === channel)
      expect(hit, `preload 里找不到 ${channel} 的调用`).toBeTruthy()
      problems.push(...checkPayload(channel, hit!.keys, shape))
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('ai: 命名空间里的每个通道都登记了（新增通道必须表态）', () => {
    const aiChannels = [...new Set(payloads.map(p => p.channel).filter(c => c.startsWith('ai:')))]
    const unclassified = aiChannels.filter(c => !(c in CONTRACTS) && !(c in EXEMPT))
    expect(
      unclassified,
      `这些 ai: 通道既没进 CONTRACTS 也没进 EXEMPT：${unclassified.join(', ')}`,
    ).toEqual([])
  })

  it('反向对照：把一个键改成 schema 没有的名字，闸门必须报错（否则它是空转的）', () => {
    // ⚠️ 锚点**不能写成整段字面量**：preload 的载荷超过 100 列后会被 prettier 拆成多行，
    // 那样锚点会静默失效（2026-10-15 加 activeFilePath 时就撞上了 —— 载荷变成 11 个键）。
    // 这里只锚 `ai:agentCoreRun` 段里的**第一个** requirement 键，与排版无关。
    const mutated = source.replace(
      /(invoke\('ai:agentCoreRun',\s*\{[^}]*?)\brequirement\b/,
      '$1text',
    )
    expect(mutated, '反向对照没能改到那行 —— 说明锚点失效').not.toBe(source)
    const broken = extractPayloads(mutated).find(p => p.channel === 'ai:agentCoreRun')!
    expect(
      checkPayload('ai:agentCoreRun', broken.keys, aiAgentCoreRunSchema.shape).length,
    ).toBeGreaterThan(0)
  })

  it('★ 排版不影响核对：载荷被拆成多行 + 尾逗号时，键名照样对得上', () => {
    // 反向对照：preload 是普通对象字面量，具体排版由 prettier 决定 —— 闸门不能因此变红。
    const keys = [
      'projectPath',
      'requirement',
      'threadId',
      'maxRounds',
      'planFirst',
      'fullAccess',
      'allowedTools',
      'preset',
      'agentMode',
      'images',
      'activeFilePath',
    ]
    const multiline = `ipcRenderer.invoke('ai:agentCoreRun', {\n${keys
      .map(key => `  ${key},`)
      .join('\n')}\n})`
    const hit = extractPayloads(multiline).find(p => p.channel === 'ai:agentCoreRun')!
    expect(hit.keys, '拆行后的键名解析').toEqual(keys)
    expect(checkPayload('ai:agentCoreRun', hit.keys, aiAgentCoreRunSchema.shape)).toEqual([])
  })

  it('多出来的键也要报（zod 会静默剥掉未知字段）', () => {
    // 载荷带上 schema 认可的键 + 一个多余的键 → 只报那个多余的
    const problems = checkPayload(
      'ai:agentCoreRun',
      ['projectPath', 'requirement', 'enableThinking'],
      aiAgentCoreRunSchema.shape,
    )
    expect(problems.some(p => p.includes('enableThinking'))).toBe(true)
  })
})
