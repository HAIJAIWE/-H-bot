// src/shared/ai/presetRoster.ts
//
// **会话预设的共享真相**（2026-10-26，第 48 批）。
//
// 在这之前"预设长什么样"有三份：主进程 `services/ai/presets.ts` 的 `AgentPreset`、
// 渲染层 `components/ai/presetOptions.ts` 的归一规则、编辑器 `PresetEditor.tsx` 的常量。
// 三份的容错口径一开始就不一样（渲染层把空数组当"不限制"、主进程把坏条目静默丢掉），
// 结果是**菜单里看得到的预设，跑起来可能根本不存在**。
//
// 现在：磁盘形状（常量 + 类型）只写在这里；主进程负责解析与裁决（`readPresetRoster`），
// 渲染层只负责显示 roster —— 看到的就是跑起来会发生的那一份。
//
// 与 DSH `agent-preset-registry` 的对应关系：
//   · `AgentPresetRow` ≈ DSH 的 `AgentPresetRow`（id/name/description/broken）；
//   · `AgentPresetRoster` ≈ DSH 的 `AgentPresetRoster`（含激活失败的声明）；
//   · `PresetSessionState` ≈ DSH 的会话投影 `agentPreset` + `agent-preset/locked`
//     （区别：我们按**线程**锁，DSH 按 session；空白线程仍可换）。
import type { AgentRole } from './roleDomains'

/** 预设文件在项目里的相对路径（磁盘契约；主进程与编辑器都用这一份） */
export const PRESETS_FILE = '.qqbat/agent-presets.json'
/** 文件名（相对 `.qqbat/`） */
export const PRESETS_BASENAME = 'agent-presets.json'
/** 名字上限：菜单一行放得下，也够区分（与主进程原值一致，不在这里收紧） */
export const PRESET_NAME_MAX = 40
/** 附加要求上限：太长会把角色强调句挤成背景噪声（提示词预算也是钱） */
export const PRESET_PROMPT_MAX = 2000
/** 角色值域（与 roleDomains 的 AgentRole 同源；文件里写别的值会被忽略并记一条 notes） */
export const PRESET_ROLES: readonly AgentRole[] = ['builder', 'coder', 'duo', 'creator']

/** 盘上的一条预设（归一后；字段缺省 = 没写，不回填空值） */
export interface AgentPreset {
  /** 预设名同时是**选择键**（文件里的 id 不参与选择，与历史行为一致） */
  name: string
  /** 这一轮的角色；缺省 = 跟着页面走 */
  role?: AgentRole
  /** 附加要求（进系统提示；只在提示层，不是权限边界） */
  prompt?: string
  /** 这一轮的审批口径；缺省/'ask' = 每次问，'full' = 本轮不逐次问 */
  permissionMode?: 'ask' | 'full'
  /** 工具白名单；缺省 = 不限制 */
  allowedTools?: string[]
  /** 会话级插件集；缺省 = 不按插件限定 */
  plugins?: string[]
  /** 给人看的一句话 */
  description?: string
  /** 菜单排序（小的在前；没写的排在有 order 的后面，仍按文件顺序） */
  order?: number
}

/**
 * 注册表里的一行 = 一条声明 + "它现在能不能用"。
 *
 * `broken` 是**整条不可用**（没名字 / 重名 / 名字超长 / 根本不是对象）；
 * `notes` 是**部分字段被忽略**（role 拼错、prompt 被截断…）—— 那一条仍然能用，
 * 只是和文件里写的不完全一样。两种都显示出来：静默降级比直接报错更难查。
 */
export interface AgentPresetRow extends AgentPreset {
  /** 为什么这一条用不了；有值 = 不可选（运行时按名字查也查不到它） */
  broken?: string
  /** 被忽略/截断的字段说明（空 = 文件里的值都生效了） */
  notes?: string[]
}

/** 一次读取的结果：能用的与用不了的都在里面，外加"整个文件读不了"的原因 */
export interface AgentPresetRoster {
  /** 可用的在前（按 order，再按文件顺序），不可用的按文件顺序附在后面 */
  presets: AgentPresetRow[]
  /** 文件级问题（JSON 解析失败 / 顶层不是数组）；缺省 = 文件没问题或不存在 */
  fileProblem?: string
}

/**
 * 一条**线程**的预设会话状态（第 50 批）。
 *
 * 语义对齐 DSH：会话开始后组合固定，不能再换；空白线程可换且选择落盘。
 * 与 DSH 的差别只在粒度 —— 我们按线程锁（一个项目可以有多个互不影响的会话）。
 */
export interface PresetSessionState {
  /** 这条线程是否已经有过一轮（历史非空）。false = 还能自由换 */
  started: boolean
  /** 锁定的预设名；null = 跟页面（明确"没有预设"，不是"还不知道"） */
  preset: string | null
  /** started 为 true 即锁死；老会话没有记录时也算锁定（按 null 锁） */
  locked: boolean
  /** 会话记录本身坏了的原因（界面提示；运行时直接 fail-closed） */
  problem?: string
}
