// src/main/ipc/aiAgentCoreApproval.ts
//
// # agent-core 的审批闸门（从 aiAgentCore.ts 抽出来，第 60 批）
//
// 为什么单独一个文件：`aiAgentCore.ts` 已过 1100 行且每次改都动这里；第 60 批把
// 「四种结局的话术」加进来后，fileGrowth 闸门要求"拆或者写明为什么"。拆这块最自然：
// 它是**纯接线**（形状 → 弹窗 → 决定 → 放行/拒绝），不依赖循环状态。
import { isAbsolute, relative } from 'path'
import type { BrowserWindow } from 'electron'
import { logger } from '../services/infra/logger'
import {
  APPROVAL_TIMEOUT_MS,
  requestApproval,
  type ApprovalReason,
} from '../services/ai/toolApproval'
import type { AllowRule } from '../services/ai/allowRules'
import { toolRuleMatch } from '../services/ai/allowRules'
import { mayRoleWritePath, rolePathBoundaryMessage, type AgentRole } from '@shared/ai/roleDomains'
import type { ApprovalRequest } from '../services/agent-core/contracts'

/** 审批弹窗里的工具名：沿用助手那套名字，界面上的文案就不会出现第二套说法 */
const TOOL_NAME: Record<ApprovalRequest['kind'], string> = {
  write: 'write_file',
  command: 'run_command',
  irreversible: 'run_command',
  tool: 'tool',
}

/**
 * 弹窗标题里的工具名。`tool` 类用**真名**（插件工具叫什么就显示什么）——
 * 拿一个占位的 "tool" 去问"要不要允许 tool"，等于什么都没说。
 */
function toolNameOf(req: ApprovalRequest): string {
  return req.kind === 'tool' ? (req.tool ?? req.summary) : TOOL_NAME[req.kind]
}

/** 审批弹窗里要展示的结构化参数（"改哪个文件 / 跑什么命令 / 哪个工具的什么参数"） */
function approvalArgs(req: ApprovalRequest): Record<string, unknown> {
  if (req.kind === 'write') return { path: req.summary, ...req.detail }
  if (req.kind === 'tool') return { tool: req.tool ?? req.summary, ...req.detail }
  return { command: req.summary, ...req.detail }
}

/**
 * 工具类审批的正文。summary 只有工具名 —— 光问"要不要允许 market_coin"，
 * 用户没法判断这次要花什么、动哪里；参数太长就截断（弹窗不该是一屏滚动 JSON）。
 */
function describeToolRequest(req: ApprovalRequest): string {
  const name = req.tool ?? req.summary
  const args = req.detail?.args
  if (args === undefined) return '工具 ' + name + ' 要在项目里做改动'
  let text: string
  try {
    text = JSON.stringify(args) ?? String(args)
  } catch {
    text = String(args)
  }
  if (text.length > 160) text = text.slice(0, 157) + '…'
  return '工具 ' + name + ' 想这样调用：' + text
}

/**
 * 闸门类别的一句话：审批没成时告诉模型"到底是哪件事没成"。
 * write/command 的 summary 就是路径/命令本身；工具类要带真名（`tool` 占位名毫无信息量）。
 */
function approvalTarget(req: ApprovalRequest): string {
  if (req.kind === 'write') return '写 ' + req.summary
  if (req.kind === 'tool') return '工具 ' + (req.tool ?? req.summary) + ' 的调用'
  return '跑命令 ' + req.summary
}

/** 拒绝的四种结局各自回灌给模型的话（M2，第 60 批；理由见 toolApproval.ApprovalReason） */
function approvalDeniedText(req: ApprovalRequest, reason: ApprovalReason | 'unavailable'): string {
  const target = approvalTarget(req)
  if (reason === 'timeout') {
    return (
      `这次${target}没有执行：审批等了 ${Math.round(APPROVAL_TIMEOUT_MS / 60_000)} 分钟没人点「允许」。` +
      '用户可能在忙 —— 先把不依赖它的部分做完，收尾时提一句"需要你点一下确认"。'
    )
  }
  if (reason === 'aborted') {
    return (
      `这次${target}没有执行：这一轮被取消了（或被新的要求顶掉）。` +
      '等用户重新发起之后再继续，别在这个方向上原地重试。'
    )
  }
  if (reason === 'unavailable') {
    return (
      `没有可用的审批通道（主窗口不在或已关闭），这次${target}没有执行。` +
      '提醒用户打开主窗口后再试，别换个参数绕过去。'
    )
  }
  return (
    `这次${target}被用户拒绝了。不要原地重试：换一种做法（比如先问清用户想要什么），` +
    '或者直接说明卡在哪。'
  )
}

/** 规则表只认 write / command / tool 三类（irreversible 归 command：它是"改动很大的一种命令"） */
function ruleKindOf(kind: ApprovalRequest['kind']): 'write' | 'command' | 'tool' {
  if (kind === 'write') return 'write'
  return kind === 'tool' ? 'tool' : 'command'
}

export interface ApprovalGateContext {
  projectPath: string
  role: AgentRole
  /** 完全权限：跳过「问人」，但不跳过角色的写域闸，也不写规则表 */
  effectiveFullAccess: boolean
  /** 「以后别再问」的规则表（跨轮、可撤销）。闸门会就地 push */
  allowRules: AllowRule[]
  /** 本轮内已选"别再问"的动作类别 */
  approved: Set<string>
  /** 审批弹窗的目标窗口；没有 = M2 的 unavailable 结局 */
  window: BrowserWindow | null
  /** 落盘一条规则（由调用方给，让本文件不直接碰 allowRules 的存储细节） */
  addRule: (rule: { kind: 'write' | 'command' | 'tool'; match: string }) => Promise<void>
}

/**
 * 造出 `runAgentTurn` 要的 `approval` 回调。
 *
 * 顺序是硬约束：**角色的写域闸在最前**（越界写连弹窗都不弹 —— 让用户点"允许"
 * 绕过角色边界，等于边界不存在），然后是全权直通、已记住的规则，最后才问人。
 */
export function createApprovalGate(
  ctx: ApprovalGateContext,
): (req: ApprovalRequest, signal?: AbortSignal) => Promise<boolean> {
  const { projectPath, role, effectiveFullAccess, allowRules, approved } = ctx
  let seq = 0
  const matchOf = (req: ApprovalRequest): string => {
    // 工具类：同名 + 同参数才算同一个动作（见 toolRuleMatch 的说明）
    if (req.kind === 'tool') {
      const args = (req.detail?.args ?? {}) as Record<string, unknown>
      return toolRuleMatch(req.tool ?? req.summary, args)
    }
    if (req.kind !== 'write') return req.summary.trim()
    const rel = relative(projectPath, req.summary)
    return rel && !rel.startsWith('..') && !isAbsolute(rel)
      ? rel.split('\\').join('/')
      : req.summary.trim()
  }

  return async (req, signal) => {
    if (req.kind === 'write') {
      const rel = relative(projectPath, req.summary)
      const inside = rel && !rel.startsWith('..') && !isAbsolute(rel)
      const relPath = (inside ? rel : req.summary).split('\\').join('/')
      if (!mayRoleWritePath(role, relPath)) {
        const message = rolePathBoundaryMessage(role, relPath)
        logger.warn('[ipc/aiAgentCore] 角色写域拒绝：' + message)
        // throw 而不是 return false：调度器会把异常变成 `[工具失败] <原因>`，
        // 原因里带"这是谁的活、怎么才能做"，模型才有可执行的下一步
        throw new Error(message)
      }
    }
    if (effectiveFullAccess) return true
    const match = matchOf(req)
    const ruleKind = ruleKindOf(req.kind)
    // ① 本轮内说过"别再问" ② 以前点过"以后别再问" → 都直接放行（不再弹窗）
    if (approved.has(ruleKind) || allowRules.some(r => r.kind === ruleKind && r.match === match)) {
      logger.info(`[ipc/aiAgentCore] 按已记住的规则放行：${req.kind} ${match}`)
      return true
    }
    seq += 1
    /**
     * **没有窗口 = 没人能点**（M2 的 unavailable 结局）：直接按拒绝回去，
     * 别让模型干等 5 分钟超时 —— "窗口不在"是马上就知道的环境事实。
     */
    const win = ctx.window
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
      throw new Error(approvalDeniedText(req, 'unavailable'))
    }
    const outcome = await requestApproval(
      {
        projectPath,
        callId: `agentcore-${seq}-${Date.now()}`,
        toolName: toolNameOf(req),
        args: approvalArgs(req),
        // hint 是弹窗正文：工具类说清"哪个工具要动什么"（summary 就是工具名，光它不够）
        hint: req.kind === 'tool' ? describeToolRequest(req) : req.summary,
      },
      {
        emit: (channel, payload) => win?.webContents.send(channel, payload),
        ...(signal ? { signal } : {}),
      },
    )
    if (outcome.decision === 'always') {
      approved.add(ruleKind)
      // 落盘：以后同类动作不再问（界面里能看见、能删）
      await ctx.addRule({ kind: ruleKind, match })
      allowRules.push({ kind: ruleKind, match, addedAt: new Date().toISOString() })
    }
    if (outcome.decision === 'deny') throw new Error(approvalDeniedText(req, outcome.reason))
    return true
  }
}
