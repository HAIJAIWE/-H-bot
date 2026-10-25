// src/main/ipc/aiAgentCoreOnboarding.ts
//
// # 开荒（还没有项目）也走同一条循环
//
// 2026-10-25：双引擎合并的最后一公里。项目对话早就走 `ai:agentCoreRun`，
// 只有"还没有任何项目"这一种情况留在助手链路（`ai:chat` → `processAiChat`）——
// 因为循环要工作目录。于是同一个应用两套行为：工具表、提案形状、报错文案都不同。
// 结论：**没有工作区也是一个工作区**，循环不假设磁盘存在，是适配器在假设，
// 所以这里只换装配（工具 = 能力层三个、提示 = workspace 为空那一段 + ONBOARDING_HINT、
// 提案 = capability 操作、记忆/轮次日志/插话/预设全部跳过），不换循环。
// 为什么单独一个文件：aiAgentCore.ts 已 778 行（红线 800），且事件契约闸门钉死了
// 那文件里 16 条 `ai:*` 发送的顺序；这里发射形状与主链路逐字段一致，渲染层不用改。
import type { BrowserWindow } from 'electron'
import { resolveAuthorAiConfig } from '../services/ai/appAiConfig'
import { ONBOARDING_HINT, ONBOARDING_TOOLS } from '../services/ai/agents'
import { adaptLegacyTools, type LegacyToolBridge } from '../services/agent-core/legacyTools'
import { runAgentTurn, type RunTurnResult } from '../services/agent-core/runTurn'
import { createProposal, type ProposalOperation } from '@shared/types/proposal'
import { logger } from '../services/infra/logger'

/**
 * 开荒的轮数上限：比项目内（12）更小。
 *
 * 这一段的产出是**一张提案卡片**，不是把活干完 —— 问清需求 → 查能力 → 提议，
 * 三步就该收。给到 12 轮只会让用户在"还没有项目"的空白页上等更久。
 */
export const ONBOARDING_MAX_ROUNDS = 8

export interface OnboardingTurnInput {
  win: BrowserWindow | null
  requirement: string
  /** 这一轮贴的图（data URL）：只进这一轮，不落盘、不进记忆 */
  images?: readonly string[]
}

export type OnboardingTurnResult = ({ ok: true } & RunTurnResult) | { ok: false; error: string }

/**
 * 跑一轮开荒。
 *
 * 调用方（`ai:agentCoreRun` 的 handler）只负责在 projectPath 为空时早返回进来 ——
 * 参数校验、窗口、需求文本都已经有了。这里不再看 `event`：审批、插话、记忆都不参与，
 * 唯一需要窗口的地方是发事件。
 */
export async function runOnboardingTurn(input: OnboardingTurnInput): Promise<OnboardingTurnResult> {
  const { win, requirement } = input
  /**
   * 事件出口：**与主链路同名同形状**。`projectPath` 显式写成空串而不是省略 ——
   * 渲染层 `routeTo('')` 的语义是"当前视图"，正是开荒要的（没有项目可路由）。
   * 事件契约闸门按字面量扫这里的键，所以每个键都写全，不要简写兜底。
   */
  const emit = (channel: string, payload: unknown): void => {
    win?.webContents.send(channel, payload)
  }
  emit('ai:agentState', { projectPath: '', state: 'thinking' })
  try {
    const config = await resolveAuthorAiConfig('')
    if (!config) {
      const error = '没有可用的模型配置（先在设置里配好）'
      emit('ai:error', { projectPath: '', message: error })
      emit('ai:agentState', { projectPath: '', state: 'idle' })
      return { ok: false, error }
    }
    /**
     * 旧工具接进循环（`adaptLegacyTools`）：mutation 类**不执行**，只把
     * `propose_capability` 转成待确认操作。这正是开荒要的语义 ——
     * 模型提议、用户点确认才真的建项目。
     */
    const pendingOperations: ProposalOperation[] = []
    const bridge: LegacyToolBridge = {
      projectPath: '',
      role: 'builder',
      pendingOperations,
    }
    const allowed = new Set<string>(ONBOARDING_TOOLS)
    const tools = adaptLegacyTools(bridge).filter(t => allowed.has(t.name))
    if (tools.length === 0) {
      // 装配错了就说出来：静默少工具会让模型以为"这台应用什么都做不了"
      throw new Error('开荒工具集为空：search/describe/propose 没有注册（构建或插件装载出错）')
    }
    const result = await runAgentTurn({
      projectPath: '',
      requirement,
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      config,
      tools,
      roleNote: ONBOARDING_HINT,
      maxRounds: ONBOARDING_MAX_ROUNDS,
      onStep: info =>
        emit('ai:agentStep', { projectPath: '', step: info.step, maxSteps: info.maxSteps }),
      onTextChunk: text => emit('ai:chunk', { projectPath: '', text }),
      onReasoningChunk: text => emit('ai:chunk', { projectPath: '', text, kind: 'reasoning' }),
      onToolStart: call =>
        emit('ai:toolCall', {
          projectPath: '',
          id: call.id,
          name: call.name,
          args: call.args,
          status: 'running',
          timestamp: Date.now(),
        }),
      onToolEnd: (call, output) =>
        emit('ai:toolCall', {
          projectPath: '',
          id: call.id,
          name: call.name,
          args: call.args,
          // 工具失败在循环里是**返回值**而不是异常（"[工具失败] …"），只能按前缀判
          status: output.startsWith('[工具失败]') ? 'error' : 'done',
          result: output,
          timestamp: Date.now(),
        }),
    })
    /**
     * 提案与正文二选一（与主链路同一条分工）：有提案就发提案、不发 response ——
     * 两条都发会让同一轮长出"正文 + 卡片"两份尾巴。
     *
     * 这里**不做结构校验**（`validateProposalOperations` 要读 flow.json）：
     * 开荒的提案是 capability（比如 project.create），本来就没有画布可校验。
     * 不传 validation/verdict，卡片会显示"未校验"—— 这是事实，不是省略。
     */
    if (pendingOperations.length > 0) {
      const proposal = createProposal(requirement, pendingOperations)
      emit('ai:proposal', { projectPath: '', proposal })
    } else {
      emit('ai:response', { projectPath: '', message: result.finalText })
    }
    emit('ai:agentState', { projectPath: '', state: 'idle' })
    return { ok: true, ...result }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.warn('[ipc/aiAgentCoreOnboarding] 开荒运行失败:', message)
    emit('ai:error', { projectPath: '', message })
    emit('ai:agentState', { projectPath: '', state: 'idle' })
    return { ok: false, error: message }
  }
}
