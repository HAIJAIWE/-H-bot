// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as fs from 'fs'
import * as path from 'path'
import { readFile } from 'fs/promises'
import * as electron from 'electron'
import { tryIpc, tryIpcAsync } from './_shared'
import {
  MAX_THRESHOLD_CHARS,
  applyToolBudgetSetting,
  currentToolBudgetSetting,
  toolBudgetSchema,
  writeToolBudgetSetting,
} from '../services/ai/budgetSettings'
import { testLlmConfig } from '../services/ai/testConfig'
import { init_logger, logger } from '../services/infra/logger'
import {
  aiConfigSchema,
  aiConfigTestSchema,
  aiFallbacksSchema,
  aiHistorySchema,
  aiNoteTurnSchema,
  aiProjectPathSchema,
  aiThreadSchema,
  approvalDecisionSchema,
  rewindToSchema,
  rollbackTurnSchema,
} from '../schemas/ai'
import { assertProjectPathAllowed } from '../services/devBackup/devMode'
import {
  beginBatch,
  commitBatch,
  getAiConfig,
  handleRollbackBatch,
  isBatchModeFor,
  setAiConfig,
} from '../services/ai/index'
import { clearThread, listThreads, threadFile } from '../services/ai/threads'
import { clearPresetSession } from '../services/ai/presetLock'
import {
  appendHistoryEntries,
  loadHistory,
  readHistoryForUi,
  truncateHistoryAt,
} from '../services/ai/historyStore'
import { AI_TURN_NOTE_PREFIX } from '../../shared/types/ai'
import { listTools } from '../services/agent-core/core'
import { mergeTools } from '../services/agent-core/toolCatalog'
import { ALL_TOOL_DEFINITIONS } from '../services/ai/tools/defs'
import { listTurns, readTurn, rollbackTurn, turnsFromMessage } from '../services/flow/turnJournal'
import { loadProjectPlugins } from '../services/plugins/pluginLoader'
import {
  readAppAiConfig,
  readProjectBotAiConfig,
  resolveAuthorAiConfig,
  writeAppAiConfig,
  writeAppAiFallbacks,
  writeProjectBotAiConfig,
} from '../services/ai/appAiConfig'
import { cancelApprovalsFor, resolveApproval } from '../services/ai/toolApproval'
import { cancelAgentCoreRun, isAgentCoreRunning } from './aiAgentCore'
import { settleInstructionsFor } from '../services/ai/instructionBridge'
/**
 * 从项目的 `.qqbat/project.json` 里读出作者助手的 ai 配置，注入进程内的 `setAiConfig`。
 *
 * 为什么需要（10/20 之后的契约）：应用级 `ai-config.json` 是「这台机器的默认」，
 * 而项目里存的是「这个项目用哪个模型/哪把钥匙」。打开项目时若只用应用级默认，
 * 用户会在自己项目里看到「未配置模型」——而配置明明就在 project.json 里。
 *
 * 校验只有三条（与 `createProjectSchema` 的 refine 同一份判据）：
 *   · provider 必须在内置预设表里（否则运行期 per-provider 分支全走不到）；
 *   · apiKey / model 非空（空串等于没配）；
 *   · 读不出来 / 解析失败 / 字段不合法 → 返回 null，**不覆盖**已有配置。
 */
async function loadAiConfigFromProject(projectPath) {
  if (!projectPath) return null
  try {
    const raw = await readFile(path.join(projectPath, '.qqbat', 'project.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    const ai = parsed?.ai
    if (!ai || typeof ai !== 'object') return null
    const provider = String(ai.provider ?? '').trim()
    const apiKey = String(ai.apiKey ?? '').trim()
    const model = String(ai.model ?? '').trim()
    if (!provider || !apiKey || !model) return null
    const { LLM_PRESET_IDS } = await import('../../shared/types/llm-presets')
    if (!LLM_PRESET_IDS.includes(provider)) return null
    const config = {
      provider,
      apiKey,
      model,
      ...(ai.baseUrl ? { baseUrl: String(ai.baseUrl) } : {}),
    }
    setAiConfig(config)
    logger.info(`[ipc/ai] 已从项目读取 AI 配置：${provider} / ${model}`)
    return config
  } catch (e) {
    // ENOENT 是常态（项目还没配过模型）；其他错误也只降级，不打断打开项目
    if (e?.code !== 'ENOENT') logger.warn('[ipc/ai] 读取项目 AI 配置失败（按未配置处理）:', e)
    return null
  }
}

/**
 * @param projectService 既用来"列出所有项目"，也提供 baseDir ——
 *   渲染层传来的 projectPath 必须落在项目根内（见文件内各处 assertProjectPathAllowed ——
 *   框架开发模式开着时，框架根下的路径也算合法，见 services/devBackup/devMode.ts）。
 */
function registerAiIpc(projectService) {
  const baseDir = projectService.getBaseDir()
  /**
   * 列出「项目根目录下的全部项目」。
   *
   * 为什么不用 `listRecentProjects`：那份是**最近打开**的列表（上限 20、只含打开过的），
   * 而智能体面板要的是"我有哪些机器人项目" —— 一个刚建好还没打开过的项目也该能配。
   *
   * 直接扫目录，只认带 `.qqbat/project.json` 的目录（那是真项目，不是随手建的文件夹）。
   */
  function listProjectPaths() {
    const root = projectService.getBaseDir()
    try {
      return (0, fs.readdirSync)(root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => (0, path.join)(root, d.name))
        .filter(p => (0, fs.existsSync)((0, path.join)(p, '.qqbat', 'project.json')))
    } catch (e) {
      logger.warn('[ipc/ai] 扫描项目目录失败:', e)
      return []
    }
  }
  /**
   * ai:noteTurn —— 渲染层把"用户对计划的处置"回写进项目记忆（应用 / 拒绝 / 回滚）。
   *
   * 用 **system** 角色写：界面上不渲染（MessageBubble 对 system 直接返回 null），
   * 但下一轮组装上下文时会跟着历史一起给模型 —— 它才知道自己的计划到底怎么了。
   */
  electron.ipcMain.handle('ai:noteTurn', async (_event, args) => {
    const parsed = aiNoteTurnSchema.safeParse(args)
    if (!parsed.success) {
      logger.warn('[ipc/ai] ai:noteTurn 参数校验失败:', parsed.error.message)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      parsed.data.threadId && threadFile(parsed.data.projectPath, parsed.data.threadId)
      await appendHistoryEntries(parsed.data.projectPath, [
        {
          ts: /* @__PURE__ */ new Date().toISOString(),
          role: 'user',
          content: `${AI_TURN_NOTE_PREFIX}${parsed.data.note}`,
        },
      ])
    })
  })
  /**
   * ai:tools —— **循环真正能调的那张表**（预设白名单过滤的就是这一张）。
   *
   * 这条通道踩过两个坑，都是「界面上勾的」与「循环里拦得住的」对不上：
   *   ① 以前只返回循环注册表（6 个通用文件工具 + 插件工具）：勾 add_node 拦不住任何
   *      东西，而循环里真能用的 read_file 反倒被标成「不认识」；
   *   ② 更早以前只返回助手链路那 27 个定义：勾了循环里根本没有那些名字。
   * 现在循环把两半接在一起了（aiAgentCore 的 legacyBridge + adaptLegacyTools），这里
   * 必须广告同一张表。合并规则只用 toolCatalog.mergeTools 一份：同名（read_file /
   * write_file / validate_flow）循环版优先，两边不会各说各话。
   */
  electron.ipcMain.handle('ai:tools', async () => {
    return tryIpc(() =>
      mergeTools(
        listTools().map(tool => ({
          name: tool.name,
          description: tool.description,
          category: tool.category ?? 'mutation',
          parameters: tool.parameters ?? {},
        })),
        ALL_TOOL_DEFINITIONS.map(def => ({
          name: def.name,
          description: def.description,
          category: def.category ?? 'mutation',
          parameters: def.parameters ?? {},
        })),
      ),
    )
  })
  electron.ipcMain.handle('ai:setConfig', async (_event, args) => {
    const parsed = aiConfigSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpc(() => {
      setAiConfig(parsed.data)
      return null
    })
  })
  /**
   * ai:getToolBudget / ai:setToolBudget —— 「工具结果上限」的用户设置。
   *
   * 背景：这个上限在 2026-10-01 恢复成默认开，而它的 setter 在**生产代码里零调用点** ——
   * 用户只能靠改代码关掉。设置项补上这个缺口（`bot/policy.ts:13` 那条原则的反面：
   * **默认开着却改不了的层，没人能判断它是对是错**）。
   *
   * 落盘走单独一个文件（`ai-tool-budget.json`），理由见 `budgetSettings.ts`：
   * `writeAppAiConfig` 是整份覆盖写的，共用一个文件迟早互相抹掉。
   */
  electron.ipcMain.handle('ai:getToolBudget', async () => {
    return tryIpc(() => currentToolBudgetSetting())
  })
  electron.ipcMain.handle('ai:setToolBudget', async (_event, args) => {
    const parsed = toolBudgetSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}（thresholdChars 需在 512~${MAX_THRESHOLD_CHARS} 之间）`,
      }
    return tryIpcAsync(async () => {
      await writeToolBudgetSetting(parsed.data)
      applyToolBudgetSetting(parsed.data)
      logger.info(
        `[ai] 工具结果上限已更新：${parsed.data.enabled ? `${parsed.data.thresholdChars} 码点` : '已关闭（不裁剪）'}`,
      )
      return currentToolBudgetSetting()
    })
  })
  /**
   * `ai:testConfig` —— 「测试」按钮：拿一份（**可能还没保存的**）配置真的发一次最小请求。
   *
   * 两层结果必须分得开：外层 `ApiResult` 是"IPC 通不通"，内层 `ok` 是"**模型**通不通"。
   * 配置写错了却报"调用失败"，会把用户引去查错方向。
   *
   * 不需要 projectPath：纯网络请求，不读也不写项目里的任何东西（也不碰 provider 注册表，
   * 见 services/ai/testConfig.ts）。
   */
  electron.ipcMain.handle('ai:testConfig', async (_event, args) => {
    const config = args?.config
    const parsed = aiConfigTestSchema.safeParse(config)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(() => testLlmConfig(parsed.data))
  })
  /**
   * `ai:getHistory` —— 把**磁盘上的对话记忆**读回界面。
   *
   * ## 为什么需要（2026-10-06 用户："重启之后界面上没有历史了，也翻不回去"）
   *
   * 主进程从这轮起会把每一轮写进 `<项目>/.qqbat/ai-history.jsonl`（**模型记得**），
   * 而渲染层那份对话是**内存态** —— 应用一关就没了。两边一错位就出现最别扭的组合：
   * 界面上空白、模型却记得，用户既看不见也翻不回去。
   * 这条通道让界面与模型读**同一个文件**（渲染层只在"自己这份是空的"时才填充）。
   */
  electron.ipcMain.handle('ai:getHistory', async (_event, args) => {
    const parsed = aiHistorySchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      return {
        entries: await readHistoryForUi(
          parsed.data.projectPath,
          parsed.data.threadId ? threadFile(parsed.data.projectPath, parsed.data.threadId) : void 0,
        ),
      }
    })
  })
  /**
   * ai:listThreads —— 列出该项目的**任务线程**（按最后活动时间倒序）。
   *
   * 为什么要有：以前一个项目只有一条无限长的对话，"换任务"没有出口（用户 2026-10-08 提出）。
   * 列表**由文件派生**（每个文件第一条用户消息 = 标题），不建索引文件 —— 不制造第二份真相源。
   */
  /**
   * ai:listTurns —— 列出**已记录的 AI 轮次**（新的在前）。
   *
   * 为什么要有：用户原话「他好像不能撤回对话任务」。之前撤销只覆盖 flow.json（history.ts），
   * AI 写的代码文件撤不回来。轮次日志（turnJournal.ts）把「一轮」变成可撤销单元。
   */
  /**
   * ai:resolveApproval —— 渲染层回「批准 / 拒绝 / 以后别再问」。
   *
   * 工具闸判定 ask 时，主进程会**真的停下来等**这个决定（见服务端 toolApproval.ts）。
   * 返回 applied=false 表示这个 callId 已经解过或不存在（界面据此提示「这条已失效」）。
   */
  /** 撤回**预览**：只读一轮将发生什么（复用 rollbackTurnSchema，载荷形状一致） */
  /**
   * **Key 池（回退链）**：只写它，走**专用载荷**。
   *
   * 为什么不开在 `ai:setAppConfig` 里：appAiConfig.ts 那段注释说得很明白 —— 回退链进了
   * 通用载荷就会变成「渲染层能设置、却被 zod 静默剥掉」的假字段（`enableThinking` 踩过）。
   * 所以：读取仍走 `ai:getAppConfig`（它本来就返回整份文件配置，含 fallbacks），
   * 写入走这条独立通道。
   */
  /**
   * **ai:rewindTo —— 从此处重开对话**（2026-10-15，用户拿别家产品的文案来要这个行为：
   * 「编辑后将从此处重新开始对话，产物也将回退至此信息前版本」）。
   *
   * 做三件事，顺序不能反：
   *   ① 回退「这句话那一轮及之后」的全部产物（文件 / 流程 / 玩家数据；setTurns 里能查到的都退）
   *   ② 把记忆**截断到这句话之前**（truncateHistoryAt，与 append 同格式重写）
   *   ③ 碰过 plugins/ 就重载节点包
   *
   * 找不到那句话 → **什么都不做**并如实报错（不猜位置、不半途而废）。
   */
  electron.ipcMain.handle('ai:rewindTo', async (_event, args) => {
    const parsed = rewindToSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      const text = parsed.data.messageText.trim()
      const file = parsed.data.threadId
        ? threadFile(parsed.data.projectPath, parsed.data.threadId)
        : void 0
      const idx = (await loadHistory(parsed.data.projectPath, file))
        .map(e => (e.content ?? '').trim())
        .lastIndexOf(text)
      if (idx < 0) throw new Error('记忆里找不到这句话（可能已被清空或轮转）—— 没有改动任何东西')
      const ids = await turnsFromMessage(parsed.data.projectPath, parsed.data.messageText)
      let rolledBack = 0
      let touchedPlugins = false
      for (const id of ids)
        try {
          const r = await rollbackTurn(parsed.data.projectPath, id)
          rolledBack += 1
          if ([...r.restored, ...r.removed].some(p => p.startsWith('plugins/')))
            touchedPlugins = true
        } catch (e) {
          logger.warn('[ai] rewindTo：回退某一轮失败（继续退更早的）:', id, e)
        }
      if (touchedPlugins)
        try {
          await loadProjectPlugins(parsed.data.projectPath, { reload: true })
        } catch (e) {
          logger.warn('[ai] rewindTo：重载节点包失败（磁盘已还原）:', e)
        }
      const dropped = await truncateHistoryAt(parsed.data.projectPath, idx, file)
      logger.info(
        '[ai] rewindTo：保留 ' + idx + ' 条、丢掉 ' + dropped + ' 条；回退 ' + rolledBack + ' 轮',
      )
      return {
        kept: idx,
        dropped,
        rolledBack,
        turnsFound: ids.length,
      }
    })
  })
  electron.ipcMain.handle('ai:setFallbacks', async (_event, args) => {
    const parsed = aiFallbacksSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      await writeAppAiFallbacks(parsed.data.fallbacks)
      setAiConfig((await readAppAiConfig()) ?? {})
      return { saved: true }
    })
  })
  electron.ipcMain.handle('ai:previewTurn', async (_event, args) => {
    const parsed = rollbackTurnSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => ({
      preview: await readTurn(parsed.data.projectPath, parsed.data.turnId),
    }))
  })
  electron.ipcMain.handle('ai:resolveApproval', async (_event, args) => {
    const parsed = approvalDecisionSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => ({
      applied: resolveApproval(parsed.data.callId, parsed.data.decision),
    }))
  })
  electron.ipcMain.handle('ai:listTurns', async (_event, args) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      return { turns: await listTurns(parsed.data.projectPath) }
    })
  })
  /**
   * ai:rollbackTurn —— **撤回某一轮**：改过的文件按 before 回滚、flow.json 还原。
   *
   * ⚠️ 调用方（渲染层）拿到结果后要**重新加载画布** —— 主进程还原了 flow.json，
   * 但画布内存里还是旧的（不重载的话用户会以为「撤回了但界面没变」）。
   */
  electron.ipcMain.handle('ai:rollbackTurn', async (_event, args) => {
    const parsed = rollbackTurnSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      /**
       * **先把这一轮的「用户那句话」记下来，再回滚** —— rollbackTurn 会**删掉轮次文件**，
       * 之后就问不出来了（顺序反了这里就永远拿不到那句话）。
       */
      let userMessage = null
      try {
        userMessage =
          (await readTurn(parsed.data.projectPath, parsed.data.turnId))?.userMessage ?? null
      } catch {
        userMessage = null
      }
      const result = await rollbackTurn(parsed.data.projectPath, parsed.data.turnId)
      /**
       * ★ **对话也一起退回去**（2026-10-15 用户：「撤回的时候，对话消息没有撤回回去，这个对吗？
       * 你都不会这样子做」）。
       *
       * 以前只还原文件/流程，对话面板上那一问一答还留着 —— 与「编辑后从此处重开」的行为不一致
       * （那个会把消息退回去），用户自然觉得别扭。撤回的语义就该是「回到那一轮之前」。
       * 复用 rewindTo 那两个原语：找到这句话在记忆里的位置 → 截断到它**之前**。
       * 渲染层刷新历史后，那一轮的消息自己就没了（不需要前端额外做什么）。
       */
      let droppedMessages = 0
      if (userMessage)
        try {
          const file = parsed.data.threadId
            ? threadFile(parsed.data.projectPath, parsed.data.threadId)
            : void 0
          const idx = (await loadHistory(parsed.data.projectPath, file))
            .map(e => (e.content ?? '').trim())
            .lastIndexOf(userMessage.trim())
          if (idx >= 0)
            droppedMessages = await truncateHistoryAt(parsed.data.projectPath, idx, file)
          else
            logger.warn(
              '[ai] 撤回：记忆里找不到那句话，对话未截断（文件/流程已还原）:',
              userMessage,
            )
        } catch (e) {
          logger.warn('[ai] 撤回：截断对话失败（文件/流程已还原）:', e)
        }
      logger.info(
        '[ai] 已撤回轮次 ' +
          parsed.data.turnId +
          '：还原 ' +
          result.restored.length +
          ' 个文件、删除 ' +
          result.removed.length +
          ' 个、流程快照=' +
          (result.flowSnapshot ? '已交回渲染层' : '无'),
      )
      if ([...result.removed, ...result.restored].some(p => p.startsWith('plugins/')))
        try {
          await loadProjectPlugins(parsed.data.projectPath, { reload: true })
          logger.info('[ai] 撤回后已重载节点包')
        } catch (e) {
          logger.warn('[ai] 撤回后重载节点包失败（磁盘已还原，下次启动会再加载）:', e)
        }
      return {
        result: {
          ...result,
          droppedMessages,
        },
      }
    })
  })
  electron.ipcMain.handle('ai:listThreads', async (_event, args) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      return { threads: await listThreads(parsed.data.projectPath) }
    })
  })
  /**
   * ai:clearThread —— **真的**清空某条线程的记忆。
   *
   * 在此之前界面上的「清空」只清渲染层 state，磁盘一个字没动 ——
   * 于是用户点了清空、下一轮助手照样把历史读回来（"它是同一个记忆的"）。
   */
  electron.ipcMain.handle('ai:clearThread', async (_event, args) => {
    const parsed = aiThreadSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      await clearThread(parsed.data.projectPath, parsed.data.threadId)
      // 记忆与预设锁必须一起清：只清记忆会留下"已开始"的锁，用户清空后还是换不了预设
      await clearPresetSession(parsed.data.projectPath, parsed.data.threadId)
      return null
    })
  })
  electron.ipcMain.handle('ai:getConfig', async (_event, args) => {
    const projectPath =
      args && typeof args === 'object' && typeof args.projectPath === 'string'
        ? args.projectPath
        : ''
    return tryIpcAsync(async () => {
      if (getAiConfig()) return getAiConfig()
      if (projectPath) assertProjectPathAllowed(baseDir, projectPath)
      const resolved = await resolveAuthorAiConfig(projectPath)
      if (resolved) setAiConfig(resolved)
      return resolved
    })
  })
  /**
   * ai:saveProjectConfig — 把作者助手配置**落盘**到项目的 `.qqbat/project.json`。
   *
   * 合并式写入（只覆盖 ai 字段），避免把 adapter / official / translatorPort 这些
   * 由其它模块维护的字段冲掉 —— project.json 是多处共写的文件，整文件覆盖是历史事故源。
   */
  electron.ipcMain.handle('ai:saveProjectConfig', async (_event, args) => {
    const projectPath =
      args && typeof args === 'object' && typeof args.projectPath === 'string'
        ? args.projectPath
        : ''
    const config = args?.config
    if (!projectPath)
      return {
        ok: false,
        error: '缺少 projectPath',
      }
    const parsed = aiConfigSchema.safeParse(config)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, projectPath)
      let existing
      try {
        existing = await projectService.loadProjectConfig(projectPath)
      } catch {
        existing = {}
      }
      await projectService.saveProjectConfig(projectPath, {
        ...existing,
        ai: parsed.data,
      })
      setAiConfig(parsed.data)
      return { saved: true }
    })
  })
  electron.ipcMain.handle('ai:getAppConfig', async () => {
    return tryIpcAsync(async () => readAppAiConfig())
  })
  electron.ipcMain.handle('ai:setAppConfig', async (_event, args) => {
    const config = args?.config
    const parsed = aiConfigSchema.safeParse(config)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      await writeAppAiConfig(parsed.data)
      setAiConfig((await readAppAiConfig()) ?? parsed.data)
      return { saved: true }
    })
  })
  electron.ipcMain.handle('ai:getProjectBotConfig', async (_event, args) => {
    const projectPath =
      args && typeof args === 'object' && typeof args.projectPath === 'string'
        ? args.projectPath
        : ''
    if (!projectPath)
      return {
        ok: false,
        error: '缺少 projectPath',
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, projectPath)
      return readProjectBotAiConfig(projectPath)
    })
  })
  /**
   * `ai:setProjectBotConfig` —— 写某个项目的「AI 对话」配置。
   *
   * `config === null` 表示**跟随全局**（清除该项目自己的那份）。
   */
  electron.ipcMain.handle('ai:setProjectBotConfig', async (_event, args) => {
    const projectPath =
      args && typeof args === 'object' && typeof args.projectPath === 'string'
        ? args.projectPath
        : ''
    if (!projectPath)
      return {
        ok: false,
        error: '缺少 projectPath',
      }
    const raw = args.config
    if (raw === null)
      return tryIpcAsync(async () => {
        assertProjectPathAllowed(baseDir, projectPath)
        await writeProjectBotAiConfig(projectPath, null)
        return { saved: true }
      })
    const parsed = aiConfigSchema.safeParse(raw)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpcAsync(async () => {
      assertProjectPathAllowed(baseDir, projectPath)
      await writeProjectBotAiConfig(projectPath, parsed.data)
      return { saved: true }
    })
  })
  /**
   * `ai:listProjectBotConfigs` —— 面板要**一次列出所有项目**各自的实际配置。
   *
   * 为什么要一次拿全：设计稿的核心诉求是「**不用切项目就能配**」。
   * 逐个切项目读的话，面板就得跟着"当前项目"变，那正是要避免的。
   *
   * 每行要能看出**实际会用哪个模型**：该项目自己配了就用它，否则回落到全局 ——
   * 让用户猜"这个项目到底跟不跟随"是最容易出错的地方。
   */
  electron.ipcMain.handle('ai:listProjectBotConfigs', async () => {
    return tryIpcAsync(async () => {
      const global = await readAppAiConfig()
      const projects = listProjectPaths()
      return {
        global,
        projects: await Promise.all(
          projects.map(async projectPath => {
            const own = await readProjectBotAiConfig(projectPath)
            return {
              projectPath,
              name: (0, path.basename)(projectPath),
              /** 该项目自己那份（null = 跟随全局） */
              own,
              /** 实际生效的那份（面板显示"当前会用哪个模型"） */
              effective: own ?? global,
              followsGlobal: own === null,
            }
          }),
        ),
      }
    })
  })
  /**
   * ⚠️ 这三个通道**必须带 projectPath**（2026-10-01 修）。
   *
   * 批处理是"**这个项目的这次 AI 会话是一个事务**"，但它以前是进程级标志：
   * 在 A 项目开一批改动、切到 B 项目干活，B 这轮会被当成在批处理里 ——
   * B 里任一工具失败就回滚掉 **A 的批次**。现在按项目存（见 `index.ts` 的 `batches`）。
   */
  /**
   * `ai:cancelChat` —— **真正**停下主进程里那个项目的 AI 请求。
   *
   * 2026-10-01 补这条时是两个引擎各一个 AbortController（"停止"只动界面，主进程照样跑到轮数上限）；
   * 2026-10-25 旧引擎删除后只剩循环这一个（`cancelAgentCoreRun`），这里顺带收三样东西：
   *   ① 挂着的审批弹窗（`cancelApprovalsFor`）—— 否则界面一直转圈等人点一个不会来的批准；
   *   ② 挂着的写指令（`settleInstructionsFor`）—— 停止之后不该还有 Promise 悬着；
   *   ③ 挂着的批处理事务（`commitBatch`）—— 取消 = 这一轮结束了，30 秒定时器不该继续跑。
   */
  electron.ipcMain.handle('ai:cancelChat', async (_event, args) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpc(() => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      const projectPath = parsed.data.projectPath
      // 停止是一条命：abort 循环 → 解掉等人点的批准 → 判掉悬着的写指令 → 收掉批次事务
      const cancelled = cancelAgentCoreRun(projectPath)
      cancelApprovalsFor(projectPath)
      settleInstructionsFor(projectPath, '用户停止了这一轮对话')
      if (isBatchModeFor(projectPath)) {
        commitBatch(projectPath)
        logger.info(`[ai] 取消会话，同时结束批处理事务：${projectPath}`)
      }
      return { cancelled }
    })
  })
  /**
   * `ai:isRunning` —— 该项目此刻是否真有 AI 请求在飞（渲染层据此决定「停止」是否可用）。
   *
   * 为什么补这条（2026-10-04 零引用扫描发现，与 `ai:cancelChat` 同一次审计）：
   * 界面只能"本地发起过就以为在跑"；别的窗口发起、或界面刚重载过，都会显示错。
   * 上一条接的是"能不能停"，这条接"该不该显示能停"。旧引擎删除后只问循环这一个来源。
   */
  electron.ipcMain.handle('ai:isRunning', async (_event, args) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpc(() => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      return { running: isAgentCoreRunning(parsed.data.projectPath) }
    })
  })
  electron.ipcMain.handle('ai:beginBatch', async (event, args) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpc(() => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      const win = electron.BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('无法获取窗口')
      beginBatch(parsed.data.projectPath, win)
      return null
    })
  })
  electron.ipcMain.handle('ai:commitBatch', async (_event, args) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpc(() => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      commitBatch(parsed.data.projectPath)
      return null
    })
  })
  electron.ipcMain.handle('ai:rollbackBatch', async (_event, args) => {
    const parsed = aiProjectPathSchema.safeParse(args)
    if (!parsed.success)
      return {
        ok: false,
        error: `参数校验失败: ${parsed.error.message}`,
      }
    return tryIpc(() => {
      assertProjectPathAllowed(baseDir, parsed.data.projectPath)
      handleRollbackBatch(parsed.data.projectPath)
      return null
    })
  })
}

export { registerAiIpc, loadAiConfigFromProject }
