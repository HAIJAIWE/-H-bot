// src/main/ipc/aiAgentCore.ts
//
// # agent-core 运行入口（`ai:agentCoreRun`）
//
// workspace-first 循环（读文件 → 写文件 → 跑命令 → 校验流程）从这条通道接到界面上。
// 接口钉在 `docs/ai/agent-core-wiring.md`，改形状先改那份文档。
//
// ## 为什么单独一个文件，而不是塞进 `ai.ts`
//
// `ai.ts` 已经 793 行（闸门红线 800）。这条通道是**另一件事**：另一套循环、
// 另一处审批时机、另一种回执形状。挤进同一个文件只会让两边都更难读，
// 而"再长 11 行刚好过线"正是 fileGrowth 那条闸门要防的偷懒。
//
// ## 审批
//
// 走**现有**那条链（`requestApproval` → `ai:approvalRequest` → 界面弹窗 →
// `ai:resolveApproval`），不新开一套：同一个动作在两条路径上必须问同一个问题。
// 语义保持**默认拒绝** —— 没弹窗、没点同意、超时、取消，都不写盘。
import { ipcMain, BrowserWindow } from 'electron'
import {
  aiAgentCoreRunSchema,
  aiAgentCoreSteerSchema,
  aiPresetRosterSchema,
  aiSavePresetsSchema,
  aiSetPresetDefaultSchema,
} from '../schemas/ai'
import { createApprovalGate } from './aiAgentCoreApproval'
import { runProjectTurn } from '../services/agent-runtime/projectTurn'
import { dispatchInstruction } from '../services/ai/instructionBridge'
import { addAllowRule } from '../services/ai/allowRules'
import { DEFAULT_THREAD_ID, threadFile } from '../services/ai/threads'
import { loadInbox, saveInbox, type PendingInbox } from '../services/ai/inboxStore'
import { readPresetRoster, writePresetDefault, writePresets } from '../services/ai/presets'
import { readPresetSession } from '../services/ai/presetLock'
import { readPresetUndo } from '../services/ai/presetUndo'
import { listTools } from '../services/agent-core/core'
import { listMainPlugins } from '../services/plugins/host'
import { runOnboardingTurn } from './aiAgentCoreOnboarding'
import { logger } from '../services/infra/logger'

const RUNNING = new Map<string, AbortController>()

/**
 * **插话队列**（按项目）：循环每到一个步边界取一条，塞进正在跑的对话。
 *
 * 与 DSH 的 inbox 是同一个语义（`next-step`）：不新开一轮，而是**当场纠偏**。
 * 差异也明说：DSH 还有 `next-turn`（等下一轮再说），我们一次调用就是一轮，
 * 所以只实现 next-step —— 没赶上的留在队列里，收尾时如实告诉用户。
 */
const STEER = new Map<string, PendingInbox>()

/** 该项目此刻有没有 agent-core 循环在飞（`ai:isRunning` 用它合流） */
export function isAgentCoreRunning(projectPath: string): boolean {
  return RUNNING.has(projectPath)
}

/** 停下该项目的循环（返回 false = 本来就没在跑） */
export function cancelAgentCoreRun(projectPath: string): boolean {
  const ctrl = RUNNING.get(projectPath)
  if (!ctrl) return false
  ctrl.abort()
  return true
}

export function registerAiAgentCoreIpc(): void {
  /**
   * `ai:savePresets` —— 保存会话预设（整表覆盖，写 .qqbat/agent-presets.json）。
   *
   * 回 warnings 而不是拒绝未知工具/插件：预设允许"先写、后装"；
   * 界面把 warnings 显示出来即可，真正的权限边界在运行时（工具表过滤）。
   */
  ipcMain.handle('ai:savePresets', async (_event, args: unknown) => {
    const parsed = aiSavePresetsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const { projectPath, presets } = parsed.data
    try {
      await writePresets(projectPath, presets)
      const tools = new Set(listTools().map(t => t.name))
      const plugins = new Set(listMainPlugins().map(p => p.id))
      const warnings: string[] = []
      for (const preset of presets) {
        for (const tool of preset.allowedTools ?? []) {
          if (!tools.has(tool)) warnings.push(`预设「${preset.name}」引用了不存在的工具: ${tool}`)
        }
        for (const plugin of preset.plugins ?? []) {
          if (!plugins.has(plugin))
            warnings.push(`预设「${preset.name}」引用了未装载的插件: ${plugin}`)
        }
      }
      return { ok: true, data: { saved: presets.length, warnings } }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * `ai:getPresets` —— 读预设**注册表**（第 48 批新增）。
   *
   * 以前没有读接口，菜单自己读原始 JSON 再解析 —— 容错口径与主进程不一样，
   * 于是"菜单里看得到、跑起来查不到"是可能的。现在菜单只显示这里返回的 roster：
   * 坏条目带 `broken` 原因、字段被忽略带 `notes`，看到的就是跑起来会发生的。
   *
   * 第 50 批起可选收 `threadId`：带上就额外回这条线程的**锁状态**（`session`），
   * 菜单据此禁用换预设。刻意不新开 IPC —— 读的仍是同一份注册表 + 同一条线程，
   * 多一条通道只会让能力清单、payload 契约、权限策略各多一份要同步的东西。
   */
  ipcMain.handle('ai:getPresets', async (_event, args: unknown) => {
    const parsed = aiPresetRosterSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    try {
      const roster = await readPresetRoster(parsed.data.projectPath)
      // 第 54 批：菜单要据此显示「撤销上次导入」，所以读注册表时顺带回撤销点状态。
      const undo = await readPresetUndo(parsed.data.projectPath)
      if (!parsed.data.threadId) return { ok: true, data: { ...roster, undo } }
      const session = await readPresetSession(parsed.data.projectPath, parsed.data.threadId)
      return { ok: true, data: { ...roster, session, undo } }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * `ai:setPresetDefault` —— 设置/清除项目默认预设（第 51 批）。
   *
   * 与预设表**分开存**：默认值是"这个项目新会话从哪套权限开始"的策略，
   * 不是某条预设的字段。改名/删条目不该顺手改掉默认值；反过来，
   * 默认值指向的条目被删了，读注册表时会给 `defaultProblem`，运行时 fail-closed。
   */
  ipcMain.handle('ai:setPresetDefault', async (_event, args: unknown) => {
    const parsed = aiSetPresetDefaultSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    try {
      await writePresetDefault(parsed.data.projectPath, parsed.data.preset)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('ai:agentCoreRun', async (event, args: unknown) => {
    const parsed = aiAgentCoreRunSchema.safeParse(args)
    if (!parsed.success) {
      logger.warn('[ipc/aiAgentCore] 参数校验失败:', parsed.error.message)
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const { projectPath, requirement, maxRounds } = parsed.data
    /**
     * 四个以前「传了但没读」的字段（2026-10-25 补接）：
     *   · planFirst      —— 先计划：只给查询类工具，写/命令物理上不在表里；
     *   · fullAccess     —— 完全权限：不再逐个问人（**不**越过角色的写域闸）；
     *   · images         —— 贴图：只作用于这一轮（图不进记忆，见 promptHints.withImageNote）；
     *   · activeFilePath —— 用户当前在代码编辑器里打开的文件（只对代码页/双向有意义）。
     *
     * schema 一直收着它们，注释还写着「少收一个字段就等于静默丢功能」，
     * 而 handler 从来没读过 —— 界面按了没反应，是最难被当成 bug 报的那种静默。
     * 渲染层这四项早就一路传到了 IPC（见 aiStore.runAgentCoreTurn），断在主进程这一环。
     */
    const { planFirst, fullAccess, images, activeFilePath } = parsed.data
    /**
     * 线程：与助手共用同一个选择器 —— 传了就这条线程的记忆，不传 = 默认那份。
     * `threadFile` 负责把 id 收敛成安全路径（`../../etc/passwd` 只会得到无害文件名），
     * 并在 `default` 时指回老文件（升级前的历史不能丢）。
     */
    const threadId = parsed.data.threadId ?? DEFAULT_THREAD_ID
    const memoryFile = threadFile(projectPath, threadId)
    // 一个项目同时只跑一个循环：两条并行循环会各自弹审批、各自写盘，用户分不清谁是谁
    if (RUNNING.has(projectPath)) {
      return { ok: false, error: '这个项目的循环还在跑：先停下来再发新的要求。' }
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    /**
     * **开荒**（还没有项目）：同一条循环，另一套装配（2026-10-25 双引擎收口）。
     *
     * 以前这里走的是助手链路 `ai:chat`，于是"有没有项目"决定的是**用哪套引擎** ——
     * 工具表、提案形状、报错文案全都不一样。用户看到的是一开荒就换了个 AI。
     * 现在分支只剩"装配不同"：循环、事件通道、提案卡片都是同一份。
     *
     * 放在 `RUNNING` 登记**之前**：开荒没有项目路径可作键，也不该跟项目内运行互斥
     * （它们操作的不是同一个工作区，不会被"两条循环抢着写盘"伤到）。
     */
    if (projectPath.trim() === '') {
      return runOnboardingTurn({ win, requirement, ...(images ? { images } : {}) })
    }
    const ctrl = new AbortController()
    RUNNING.set(projectPath, ctrl)
    /**
     * 待办队列（durable）：
     *   · `step` 插话只对**当前**这一轮有效 —— 启动时清掉（上一轮插的话早就过期了）；
     *   · `turn` 排队跨进程有意义 —— 从盘上读回来接着跑（应用崩了也不丢）。
     */
    const inbox = STEER.get(projectPath) ?? (await loadInbox(projectPath))
    inbox.step.length = 0
    STEER.set(projectPath, inbox)
    const persistInbox = (): void => {
      void Promise.resolve(saveInbox(projectPath, inbox)).catch((e: unknown) =>
        logger.warn('[ipc/aiAgentCore] 待办队列落盘失败:', String(e)),
      )
    }
    persistInbox()
    /**
     * 事件出口：**复用助手那条链路已有的五个通道**（chunk / toolCall / agentState /
     * response / error），渲染层那边一行监听都不用改 —— 流式、工具行、状态栏、
     * 收尾、错误提示全都是现成的。新开通道只会多三处登记和一套重复的界面逻辑。
     *
     * 这里只把「怎么送到渲染层」交给宿主（win）；「发什么」全在 agent-runtime 里。
     */
    const emit = (channel: string, payload: unknown): void => {
      win?.webContents.send(channel, payload)
    }
    try {
      return await runProjectTurn(
        {
          projectPath,
          requirement,
          threadId,
          memoryFile,
          signal: ctrl.signal,
          emit,
          stepQueue: inbox.step,
          turnQueue: inbox.turn,
          persistInbox,
          images,
          fullAccess,
          planFirst,
          maxRounds,
          activeFilePath,
          preset: parsed.data.preset,
          agentMode: parsed.data.agentMode,
          allowedTools: parsed.data.allowedTools,
        },
        {
          /**
           * 审批闸门（角色写域闸 → 全权直通 → 已记住的规则 → 问人）：
           * 实现在 `aiAgentCoreApproval.ts`；运行时只交上下文，窗口留在宿主这边。
           */
          approval: ctx =>
            createApprovalGate({
              ...ctx,
              window: win,
              addRule: async rule => {
                await addAllowRule(projectPath, rule)
              },
            }),
          // 界面指令：发出去并**等回执**；超时/无窗口都收敛成 failed，绝不假成功
          dispatch: async instruction => (await dispatchInstruction(win, instruction)).outcome,
        },
      )
    } finally {
      RUNNING.delete(projectPath)
      STEER.delete(projectPath)
    }
  })

  /**
   * **插话**：把一句话塞进正在跑的那一轮（下一个步边界注入）。
   *
   * 没在跑就直接拒绝 —— 否则用户以为说进去了，实际丢在队列里等下一次运行，
   * 那和"静默失败"是同一种体验。要新开一轮请用 `ai:agentCoreRun`。
   */
  ipcMain.handle('ai:agentCoreSteer', async (_event, args: unknown) => {
    const parsed = aiAgentCoreSteerSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
    }
    const inbox = STEER.get(parsed.data.projectPath)
    if (!inbox) {
      return { ok: false, error: '这个项目现在没有在跑：要新提要求请直接发送。' }
    }
    const target = parsed.data.target ?? 'step'
    const queue = target === 'turn' ? inbox.turn : inbox.step
    queue.push(parsed.data.text.trim())
    // 立刻落盘：排队的那一轮要跨崩溃活着；插话虽然只对当前轮有效，留着也无害
    void Promise.resolve(saveInbox(parsed.data.projectPath, inbox)).catch((e: unknown) =>
      logger.warn('[ipc/aiAgentCore] 待办队列落盘失败:', String(e)),
    )
    return { ok: true, data: { queued: queue.length, target } }
  })
}
