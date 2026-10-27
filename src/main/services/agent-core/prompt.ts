// src/main/services/agent-core/prompt.ts
//
// **循环的系统提示**（workspace-first）：段落注册 + 组装。
//
// 为什么不写在 core.ts 里：提示是**策略**，循环是**机制**。混在一起之后
// 想换一种提示就得改循环，想测循环就得先有提示 —— 两边都被对方绑住。
//
// 为什么是"段落"而不是一个函数（2026-10-18，对齐 DSH 的 system-prompt）：
// 要加一句"这个项目用 pnpm 不用 npm"或者"先读 README"，现在得改函数体；
// 有注册表之后，谁都能注册一段（业务侧、测试、以后的插件），组装顺序由 order 决定。
//
// ⚠️ 这里**不复制任何一处厂商/开源项目的提示词**：结构借鉴（工作区 + 工具纪律 +
// 收尾要求），措辞与条目是这个项目自己的。
import { listTools } from './core'
import { FILE_REFERENCE_PROMPT } from '@shared/ai/fileReference'

export interface PromptContext {
  workspace: string
  /** 当前注册的工具名（顺序同注册表） */
  toolNames: string[]
  /**
   * 审批口径（第 60 批，M1）：`ask` = 写盘/跑命令要弹窗；`never` = 完全权限、不弹。
   *
   * 不传按 `ask` 渲染 —— 与批次之前的行为逐字相同（脚本/测试/开荒都不显式传）。
   * 为什么值得单独一段而不是塞进规矩里：**同一个规矩在两种口径下说的是反话**
   * （"会先弹审批"在完全权限下是假的），提示里留着假话，模型会停在那里等人点允许。
   */
  approvalPolicy?: 'ask' | 'never'
}

export interface PromptSection {
  /** 稳定 id：重复注册直接报错（宁可启动就炸，也不要两段提示悄悄互相覆盖） */
  id: string
  /** 组装顺序（小的在前；同 order 按注册顺序） */
  order?: number
  render: (ctx: PromptContext) => string
}

const SECTIONS = new Map<string, PromptSection>()

/** 注册一段系统提示（id 唯一；section 为空则跳过，不塞空行） */
export function registerPromptSection(section: PromptSection): void {
  if (!section.id || !/^[a-z][a-z0-9_-]*$/.test(section.id)) {
    throw new Error('提示段落 id 必须是小写字母开头的 kebab/snake: ' + section.id)
  }
  if (typeof section.render !== 'function') throw new Error('提示段落缺少 render: ' + section.id)
  if (SECTIONS.has(section.id)) throw new Error('提示段落重复注册: ' + section.id)
  SECTIONS.set(section.id, section)
}

/** 撤销一段提示（插件停用/卸载用；幂等） */
export function unregisterPromptSection(id: string): void {
  SECTIONS.delete(id)
}

/** 当前注册的段落（按 order 排好；副本） */
export function listPromptSections(): PromptSection[] {
  return [...SECTIONS.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/* ── 内置段落（这个项目自己的规矩） ─────────────────────────────── */

/**
 * 身份段：**开荒**（workspace 为空）与项目内是两件事。
 *
 * 以前只有"项目内"那一段，开荒时也照念「工作区：（空）」—— 模型于是以为
 * 自己有个目录可读，一上手就调 read_file，拿到越界错误再改口。空 workspace
 * 是"还没有项目"这个产品事实，提示里就该直说（2026-10-25 开荒进循环时改）。
 */
registerPromptSection({
  id: 'role',
  order: 10,
  render: ({ workspace }) =>
    workspace
      ? ['你是这个 QQ 机器人低代码项目里的执行型助手。', '工作区：' + workspace].join('\n')
      : [
          '你是这个 QQ 机器人低代码应用的助手。用户**还没有打开任何项目**。',
          '这一阶段你没有任何文件可读可写 —— 先把需求问清，再用工具查这台应用能做什么，最后提议怎么开始。',
        ].join('\n'),
})

registerPromptSection({
  id: 'tools',
  order: 20,
  render: ({ toolNames }) =>
    // 从注册表取，而不是手抄一份 —— 加了工具忘了改提示，模型会以为它没有那个能力
    toolNames.length > 0 ? '可用工具：' + toolNames.join('、') + '。' : '',
})

registerPromptSection({
  id: 'rules',
  order: 30,
  render: ({ workspace, approvalPolicy }) => {
    // 开荒没有工作区：项目内那套"相对路径/审批/flow.json"规矩在这里全是噪音
    if (!workspace) {
      return [
        '规矩：',
        '1. 只能通过工具动手 —— 没调用工具就说明你只是在回答，不是在做事。',
        '2. 先问清想做个什么样的机器人（做什么、给谁用），**一次别问太多**；信息够了就提议，别反复追问。',
        '3. 提议一律走 propose_capability（比如 project.create）：用户点确认之后才会真的建项目。',
        '4. 不确定这台应用能做什么时，用 search_capabilities 查，不要凭印象编能力名。',
        '5. 收尾用两三句话说清：要做的是什么、确认后会发生什么、还差哪些信息。',
      ].join('\n')
    }
    return [
      '规矩：',
      '1. 只能通过工具动手 —— 没调用工具就说明你只是在回答，不是在做事。',
      '2. 改文件前先读它；不确定的内容不要凭印象写。',
      '3. 路径一律用**工作区内的相对路径**；绝对路径与越界路径会被拒绝。',
      // 第 60 批：这句话在两种审批口径下是**反的**，不能写死
      approvalPolicy === 'never'
        ? '4. 写文件、跑命令**不再弹审批**（本次运行是完全权限）：照需要直接做；但角色写域边界仍然有效，越界的写会被直接拒绝。'
        : '4. 写文件、跑命令会先弹审批给人点。被拒绝时**不要原地重试** —— 换一种做法，或直接说明卡在哪。',
      '5. 流程文件是 .qqbat/flow.json；改完跑一次 validate_flow 再回话。',
      '6. 收尾用两三句话说清：做了什么、改了哪些文件、还剩什么要人决定。',
    ].join('\n')
  },
})

/**
 * 「审批怎么运作」的说明（第 60 批，M1，对齐上游 approval-policy 的注入）。
 *
 * 为什么要独立一段：上面规矩里的第 4 条只说"会弹审批"，但模型还需要知道
 * **弹不出来时算什么**（超时/取消/没有窗口）—— 否则它会把"没通过"一律理解成
 * "用户不喜欢这个做法"，于是换着花样重试同一个危险动作。
 *
 * 有工作区才渲染：开荒阶段没有写盘/跑命令，讲审批只会变成噪音。
 */
const APPROVAL_POLICY_PROMPT: Record<'ask' | 'never', string> = {
  ask: [
    '审批策略：ask。写盘、跑命令、以及个别不可撤回的工具调用，会先弹窗等用户点「允许」；没点之前调用不会执行。',
    '四种结局分别怎么反应：',
    '- 用户拒绝 → 换做法或先问清楚，**别原地重试**（重试等于再问同一个人一遍）。',
    '- 超时（5 分钟没人点）→ 用户多半不在；先做不受影响的部分，收尾时提醒需要点一下确认。',
    '- 这一轮被取消 → 立刻停，等用户重新发起。',
    '- 没有可用的审批通道（窗口不在）→ 是环境问题，提醒用户打开主窗口，别换个参数绕过去。',
  ].join('\n'),
  never: [
    '审批策略：never。本次运行里**不会再弹任何审批窗**：需要审批的动作会直接执行（用户明确选了完全权限）。',
    '- 不必等待或请求许可；也不存在"请求升级权限"这种参数 —— 本应用没有这个口子，不要尝试。',
    '- 但角色写域边界依然有效：越界的写会被直接拒绝，别换路径重试。',
  ].join('\n'),
}

registerPromptSection({
  id: 'approval-policy',
  order: 32,
  render: ({ workspace, approvalPolicy }) =>
    workspace ? APPROVAL_POLICY_PROMPT[approvalPolicy ?? 'ask'] : '',
})

/**
 * `@` 引用的说明（第 58 批，对齐 DSH 的条件注入）。
 *
 * **只在 `read_file` 真的可用时才出现**：这段的全部意义是"你自己去读那个文件"，
 * 而这条路不存在时它就是在骗模型 —— 上游为此专门把 render 写成条件返回空串。
 * 开荒（无工作区）时也不给：没有工作区就没有"相对工作区根"这回事。
 */
registerPromptSection({
  id: 'file-reference',
  order: 35,
  render: ({ workspace, toolNames }) =>
    workspace && toolNames.includes('read_file') ? FILE_REFERENCE_PROMPT : '',
})

/**
 * 「会话检索」的说明（第 59 批）。
 *
 * **只在 `search_sessions` 真的可用时才出现**：与前一段同一个理由 ——
 * 讲一个模型调不到的工具，只会让它反复试一个不存在的名字。
 * 内容只讲"什么时候用、别拿它当万能钥匙"，工具本身的参数在 schema 里。
 */
const SESSION_SEARCH_PROMPT = [
  '「搜索历史会话」：`search_sessions` 能搜**这个项目里当前这段对话之外**的历史线程正文。',
  '什么时候用：用户说"上次/之前我们是不是……"、或你需要一条早就聊过的结论而当前上下文里没有。',
  '别拿它当万能钥匙：它只回命中的片段与出处，看不到完整上下文；',
  '真要按内容找文件，用 search_text / read_file 更直接。搜不到就照实说，不要凭印象补全。',
].join('\n')

registerPromptSection({
  id: 'session-search',
  order: 36,
  render: ({ workspace, toolNames }) =>
    workspace && toolNames.includes('search_sessions') ? SESSION_SEARCH_PROMPT : '',
})

/**
 * 「先计划」模式的追加说明（2026-10-18，对齐 DSH 的 plan 阶段）。
 *
 * 只靠这句话是不够的 —— 工具集本身也会被裁到只读（见 runTurn 的 planOnly）。
 * 提示词负责"说清这一轮要产出什么"，工具集负责"物理上做不了坏事"，两层都要。
 */
export const PLAN_ONLY_NOTE = [
  '本轮是**计划阶段**：只允许只读工具（看文件、列目录、搜文本、校验流程）。',
  '先用它们看清现状，然后给出可执行的步骤清单（目标 / 步骤 / 风险），**不要尝试修改任何东西**。',
  '用户看到计划后，会决定是否切回执行模式来落地。',
].join('\n')

/**
 * 组装系统提示：按 order 逐段渲染，空段落跳过，段间空一行。
 *
 * @param workspace 工作区绝对路径
 * @param extraTools 额外工具名（不传就用注册表里的）
 */
export function buildSystemPrompt(
  workspace: string,
  extraTools: readonly string[] = [],
  /**
   * **实际可用的工具名**（预设白名单 / 先计划裁过之后）。传了就**只**列这些，
   * 不再并上注册表全量 —— 提示里广告了模型却调不到，是它最容易白白烧轮次的一种坑。
   */
  opts: { tools?: readonly string[]; approvalPolicy?: 'ask' | 'never' } = {},
): string {
  const toolNames = opts.tools
    ? [...opts.tools]
    : [...new Set([...listTools().map(t => t.name), ...extraTools])]
  const ctx: PromptContext = {
    workspace,
    toolNames,
    ...(opts.approvalPolicy ? { approvalPolicy: opts.approvalPolicy } : {}),
  }
  return listPromptSections()
    .map(s => s.render(ctx).trim())
    .filter(text => text.length > 0)
    .join('\n\n')
}
