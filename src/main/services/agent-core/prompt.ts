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

export interface PromptContext {
  workspace: string
  /** 当前注册的工具名（顺序同注册表） */
  toolNames: string[]
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
  render: ({ workspace }) => {
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
      '4. 写文件、跑命令会先弹审批给人点。被拒绝时**不要原地重试** —— 换一种做法，或直接说明卡在哪。',
      '5. 流程文件是 .qqbat/flow.json；改完跑一次 validate_flow 再回话。',
      '6. 收尾用两三句话说清：做了什么、改了哪些文件、还剩什么要人决定。',
    ].join('\n')
  },
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
  opts: { tools?: readonly string[] } = {},
): string {
  const toolNames = opts.tools
    ? [...opts.tools]
    : [...new Set([...listTools().map(t => t.name), ...extraTools])]
  const ctx: PromptContext = { workspace, toolNames }
  return listPromptSections()
    .map(s => s.render(ctx).trim())
    .filter(text => text.length > 0)
    .join('\n\n')
}
