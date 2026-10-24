// src/main/services/ai/index.ts
import { BrowserWindow } from 'electron';
import {
  AI_BATCH_TIMEOUT_MS,
  type ChatMessage,
  type AiToolCall,
  type AiConfig,
  type AiToolDefinition,
} from '@shared/types/ai';
import { callLlm, type LlmConfig } from './llm';
import { buildSystemMessage } from './context';
import {
  appendHistoryEntries,
  describeDropped,
  historyFilePath,
  historyToMessages,
  loadHistory,
} from './historyStore';
import { CONVERSATION_TOKEN_BUDGET, describeMeasurement, measureConversation } from './tokenBudget';
import { logger } from '../infra/logger';
import { ALL_TOOL_DEFINITIONS, executeTool, getToolCategory, ToolAbortedError } from './tools';
import type { ToolExecutionContext } from './tools';
import { existsSync, rmSync } from 'node:fs';
import { DEFAULT_THREAD_ID, threadFile as threadFilePath } from './threads';
import { applyPendingOperations, pendingNote } from './pendingGraph';
import { validateProposalOperations } from './proposalValidation';
import { findIncompleteRebuild, isSelfConsistencyEnabled, MAX_PLAN_FIX_KICKS } from './verifier';
import { buildPendingContext } from './pendingContext';
import {
  ANNOUNCE_KICK_NUDGE,
  emitProposal,
  isPlanPhaseEnabled,
  looksLikeAnnouncement,
  MAX_ANNOUNCE_KICKS,
  MAX_ROUNDS,
  narrowRepeatedTools,
  PLAN_PHASE_HINT,
  PLAN_PHASE_MAX_ROUNDS,
  PLAN_PHASE_OPEN_NUDGE,
  planPhaseApplies,
  planPhaseTools,
  runOneRound,
  shouldStayInPlanPhase,
  WRAP_UP_NUDGE,
  WRAP_UP_ROUNDS_BEFORE_END,
  type ChatRunState,
} from './chatRun';
import {
  autoTxRollbackReason,
  decideAutoTxOutcome,
  isAutoTxEnabled,
  type AutoTxHooks,
} from './autoTx';
import { toolCallToOperations } from './proposal';
import { readTrace } from './trace';
import { formatTraceSummary, summarizeTrace } from './traceSummary';
import {
  AGENT_ROLE_HINT,
  AGENT_TOOLS,
  ONBOARDING_HINT,
  roleForMode,
  toolsForOnboarding,
  toolsForRole,
} from './agents';
import {
  buildToolResultMessages,
  buildToolResultMessagesWithSpill,
  buildToolFailureMessagesWithSpill,
} from './toolMessages';
import {
  createProposal,
  type ProposalOperation,
  type ProposalValidation,
} from '@shared/types/proposal';
import { resolveAuthorAiConfig } from './appAiConfig';
import { beginTurn, currentTurnId, endTurn, rollbackTurn } from '../flow/turnJournal';
import { cancelApprovalsFor } from './toolApproval';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { MAX_ROUND_IMAGES, withImageNote, activeFileHintFor } from './promptHints';
import { providerRegistry, type AIProviderConfig } from '@shared/types/ai-provider';

interface ProjectInfo {
  name: string;
  qq: string;
  adapter: string;
  /** **开发助手自己**正在用的模型（全局优先解析 —— 与 resolveAuthorAiConfig 同一份顺序） */
  model: string;
  /** **机器人运行时**（群里应答）用的模型；没单独配 = 跟随全局 */
  botModel: string;
  projectPath: string;
}

/**
 * 读项目信息（进系统提示的「## 当前项目」那一节）。
 *
 * ## 这里曾经报错了一层，害得助手**自己打自己的脸**（2026-10-08 真机）
 *
 * 三层 AI 配置：
 *   ① `%APPDATA%/qqbat/ai-config.json`      = **全局智能体**（作者助手，正统来源）
 *   ② `<项目>/.qqbat/project.json` 的 `botAi` = **机器人运行时**（群里应答）的模型
 *   ③ `<项目>/.qqbat/project.json` 的 `ai`    = **旧版助手配置**（已被全局取代）
 *
 * 原来读的是 ③，标签却写「已配置的 AI 模型」→ 全局明明配好了，提示词里却是"未配置"，
 * 于是助手一边正常回话、一边告诉用户「⚠️ AI 模型未配置，涉及智能对话的功能跑不了」。
 * 用户当场被绕进去（原话：「截图里写着 AI 模型未配置，但中间那栏明明配好了」）。
 *
 * 现在报**两层真实信息**：助手自己用的那个（全局优先），和机器人用的那个。
 */
async function loadProjectInfo(projectPath: string): Promise<ProjectInfo> {
  let name = '未命名';
  let qq = '-';
  let adapter = 'official';
  let botModel = '未单独配置（跟随全局）';
  try {
    const configPath = join(projectPath, '.qqbat', 'project.json');
    const raw = await readFile(configPath, 'utf-8');
    const config: { name?: string; qq?: string; adapter?: string; botAi?: { model?: string } } =
      JSON.parse(raw);
    name = config.name || name;
    qq = config.qq || qq;
    adapter = config.adapter || adapter;
    if (config.botAi?.model) botModel = config.botAi.model;
  } catch {
    // 项目配置读取失败时用默认值（下面仍然会把助手自己的模型报出来）
  }

  // **助手实际在用的**那个：全局优先，项目历史字段兜底 —— 与 resolveAuthorAiConfig 同一份顺序，
  // 不另写一遍（两套解析顺序迟早分裂）。
  let model = '未配置';
  try {
    const resolved = await resolveAuthorAiConfig(projectPath);
    if (resolved?.model) model = resolved.model;
  } catch {
    // 读不到就保持"未配置"（这时 processAiChat 本来也会走未配置分支）
  }

  return { name, qq, adapter, model, botModel, projectPath };
}

let aiConfig: LlmConfig | null = null;

export function setAiConfig(config: LlmConfig): void {
  aiConfig = config;
  // 同步更新 Provider 注册表
  if (config) {
    const providerConfig: AIProviderConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    };
    providerRegistry.getOrCreate(config.provider, providerConfig);
    providerRegistry.setCurrent(config.provider);
  }
}

export function getAiConfig(): LlmConfig | null {
  return aiConfig;
}

// ====== Batch 事务状态管理 ======

/** 与渲染层共用同一个值（见 @shared/types/ai 的 AI_BATCH_TIMEOUT_MS） */
const BATCH_TIMEOUT_MS = AI_BATCH_TIMEOUT_MS;

/**
 * 批处理状态**按项目**存（2026-10-01 修）。
 *
 * ## 修之前是什么样（一个真会咬人的 bug）
 *
 * 批处理的语义是"**这个项目的这次 AI 会话是一个事务**"（30 秒自动提交、失败自动回滚），
 * 但它被实现成**进程级标志**，而且 API 与 IPC 连 `projectPath` 都没有：
 *
 *     beginBatch(win) / commitBatch() / handleRollbackBatch()
 *
 * 于是**用户切换项目就会串**（不需要多窗口）：
 * ① 在项目 A 里让 AI 开始一批改动 → 全局 `isBatchMode = true`
 * ② 切到项目 B 让 AI 干活 → B 这一轮**也被当成在批处理里**
 * ③ B 里任一工具失败 → 触发回滚 → **回滚的是 A 的批次**（窗口还指着 A）
 * ④ 或 A 的 30 秒超时到了 → 把 B 这轮当 A 的批次处置
 *
 * 现在与 `runningChats` / `writeGuard.observed` 一致：**按 projectPath 存**。
 */
interface BatchState {
  active: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  /** batch 开始时关联的窗口，用于失败/超时后通知渲染层 */
  win: BrowserWindow | null;
}

const batches = new Map<string, BatchState>();

function batchOf(projectPath: string): BatchState {
  let s = batches.get(projectPath);
  if (!s) {
    s = { active: false, timeoutId: null, win: null };
    batches.set(projectPath, s);
  }
  return s;
}

/** 清掉定时器但不改 active（commit/rollback 共用） */
function clearBatchTimer(state: BatchState): void {
  if (state.timeoutId !== null) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
}

export function beginBatch(projectPath: string, win: BrowserWindow): void {
  const state = batchOf(projectPath);
  // 清除**这个项目**的旧超时（别的项目的定时器不归这里管 —— 这正是按项目存的意义）
  clearBatchTimer(state);

  state.active = true;
  state.win = win;

  // 30 秒超时自动 commit（防死锁）
  state.timeoutId = setTimeout(() => {
    if (state.active) {
      state.active = false;
      state.win = null;
      logger.info(`[Batch] ${projectPath} 超时自动 commit`);
    }
    state.timeoutId = null;
  }, BATCH_TIMEOUT_MS);
}

export function commitBatch(projectPath: string): void {
  const state = batchOf(projectPath);
  state.active = false;
  state.win = null;
  clearBatchTimer(state);
}

export function handleRollbackBatch(projectPath: string): void {
  const state = batchOf(projectPath);
  state.active = false;
  state.win = null;
  clearBatchTimer(state);
}

/** 该项目当前是否处于批处理（渲染层与循环都从这里读） */
export function isBatchModeFor(projectPath: string): boolean {
  return batches.get(projectPath)?.active ?? false;
}

/**
 * 当工具执行失败时，如果**该项目**处于 batch 模式，自动通知渲染层回滚。
 */
function notifyRollbackIfBatch(projectPath: string): void {
  const state = batches.get(projectPath);
  if (state?.active && state.win && !state.win.isDestroyed()) {
    state.win.webContents.send('ai:needRollback', { projectPath });
  }
}

/**
 * ── 【运行级自动事务】的**收尾**（P0-4）────────────────────────────────────
 *
 * 只在 `QQBAT_AUTO_TX=1` 且**事务是我们开的**时候被调用（判据见 autoTx.ts）。
 *
 * ## 为什么放在 finally 里调
 *
 * 三条中断路径（报错 / 取消 / 没能正常收尾）在 processAiChat 里是**三个不同的出口**，
 * 各自写一遍收尾，迟早漏掉一处 —— 而"漏掉"的表现正是本任务要堵的那个事故。
 * `finally` 是它们唯一的汇合点，所以收尾放这儿，用 `decideAutoTxOutcome` 判"提交还是回滚"。
 *
 * ## 三件事，全部复用既有机制（不新造回滚）
 *
 * ① 主进程批次状态：`commitBatch` / `handleRollbackBatch`（既有的那两个）；
 * ② 渲染层的**图快照**：`ai:needRollback`（既有的失败回滚通道，渲染层收到就 `rollbackBatch()`
 *    —— 它自己拿着 begin_batch 时的快照；快照空了会安全跳过）；
 * ③ **磁盘**：`rollbackTurn` —— 与用户点「撤回这一轮」**同一个函数**（文件按 before 还原、
 *    `data/` 按运行前快照还原）。它同时删掉那条轮次记录：已经自动回滚过的轮次不该再出现在
 *    「可撤回」列表里（与 `ai:rollbackTurn` 的处理一致）。
 */
async function closeAutoTxRun(opts: {
  enabled: boolean;
  opened: boolean;
  aborted: boolean;
  errored: boolean;
  degraded: boolean;
  projectPath: string;
  win: BrowserWindow;
  turnId: string;
}): Promise<void> {
  const outcome = decideAutoTxOutcome({
    enabled: opts.enabled,
    opened: opts.opened,
    aborted: opts.aborted,
    errored: opts.errored,
    degraded: opts.degraded,
  });
  if (outcome === 'none') return;
  const { projectPath, win, turnId } = opts;

  if (outcome === 'commit') {
    commitBatch(projectPath);
    if (!win.isDestroyed()) {
      // 走渲染层既有的 commit_batch 指令：清横幅 + 丢快照（与模型自己调 commit_batch 同一条路）
      win.webContents.send('ai:clientInstruction', {
        projectPath,
        instruction: { name: 'commit_batch', args: {} },
      });
    }
    logger.info(`[ai] 运行事务已提交（正常收尾）：${projectPath}`);
    return;
  }

  handleRollbackBatch(projectPath);
  if (!win.isDestroyed()) win.webContents.send('ai:needRollback', { projectPath });

  const reason = autoTxRollbackReason(outcome);
  let restored: string[] = [];
  let removed: string[] = [];
  let restoredData = false;
  try {
    const r = await rollbackTurn(projectPath, turnId);
    restored = r.restored;
    removed = r.removed;
    restoredData = r.restoredData;
  } catch (e) {
    // 轮次日志缺失/损坏不该把收尾搞崩（批次状态与图快照那两半已经处理过了）
    logger.warn('[ai] 运行事务回滚：轮次日志还原失败（跳过这一半）:', e);
  }
  logger.info(
    `[ai] 运行事务已回滚（原因：${reason}）：还原 ${restored.length} 个文件、删除 ${removed.length} 个本轮新建的文件` +
      `${restoredData ? '、玩家数据一并还原' : ''}`,
  );
  /**
   * 只有**真的动过盘**才打扰用户：助手路径上 mutation 本来就不落盘，空手的回滚
   * （回滚了 0 个文件）不该多冒一条吓人的横幅 —— 但日志一定要留（排查靠它）。
   */
  if ((restored.length > 0 || removed.length > 0 || restoredData) && !win.isDestroyed()) {
    win.webContents.send('ai:warning', {
      projectPath,
      message: `本次运行的改动已自动回滚（${reason}）：磁盘已回到这次运行之前。`,
    });
  }
}

/**
 * 在飞的 AI 请求：`projectPath → AbortController`。
 *
 * 为什么按项目而不是全局一个：同一项目**只允许一条链在跑**（否则两条链同时改同一张图），
 * 而不同项目互不相干，没必要互相打断。
 */
const runningChats = new Map<string, AbortController>();

/** 该项目是否有 AI 请求在飞（界面据此决定「停止」按钮是否可用） */
export function isAiChatRunning(projectPath: string): boolean {
  return runningChats.has(projectPath);
}

/**
 * 取消该项目的 AI 请求。**幂等**：没有在飞请求时返回 false，不抛错。
 *
 * 光把界面状态置一下是不够的 —— 原来渲染层就是这么"停"的：文本尾巴拼一句「（已中断）」，
 * 主进程照跑满 10 轮，工具还在调、LLM 还在请求、mutation 还在累积。
 * 这里必须真的 `abort()`，信号一路传到 `fetch`，HTTP 请求才会断。
 */
export function cancelAiChat(projectPath: string): boolean {
  const controller = runningChats.get(projectPath);
  if (!controller) return false;
  controller.abort();
  /**
   * 取消 = 这一轮结束了，**批处理事务不该再挂着**（2026-10-06 审查发现）。
   *
   * 以前只 abort：`batches` 里那个 30 秒定时器照跑到底 —— 期间该项目的任何工具失败
   * 都可能触发"回滚这个批次"的通知，而界面上的批处理条与主进程状态也对不上。
   * `commitBatch` 只清状态与定时器（不写盘），所以这里收掉是安全的。
   */
  if (isBatchModeFor(projectPath)) {
    commitBatch(projectPath);
    logger.info(`[ai] 取消会话，同时结束批处理事务：${projectPath}`);
  }
  return true;
}

/**
 * 清空某个项目的对话记忆（默认那份 ai-history.jsonl；传 file 清指定线程）。
 *
 * 为什么**同步**：调用方通常是「先清空、紧接着跑一轮」的测试/重开对话路径，
 * 异步删文件会和后续的 loadHistory 竞态 —— 读到已删但还没删完的旧内容。
 * 删失败只记日志：记忆是锦上添花，不该让调用方失败。
 */
export function clearAiHistory(projectPath: string, file?: string): void {
  if (!projectPath) return;
  try {
    const target = file ?? historyFilePath(projectPath);
    if (existsSync(target)) rmSync(target, { force: true });
  } catch (e) {
    logger.warn(`[ai] 清空对话记忆失败（忽略）: ${String(e)}`);
  }
}

/**
 * 读回作者助手的多轮记忆（`.qqbat/ai-history.jsonl`），按 token 预算裁成 messages，
 * 并给出"更早的 N 条已省略"的交代。
 *
 * 任何失败都降级为"全新对话" —— 记忆读不出来时用户仍然要能问问题。
 */
async function loadAuthorMemory(
  projectPath: string,
  /** 任务线程的记忆文件；不传 = 默认那份（老行为） */
  file?: string,
): Promise<{ messages: ChatMessage[]; note: string | null }> {
  // 开荒模式（还没有项目）没有记忆可言。**必须在这里挡住**：
  // `join('', '.qqbat', 'ai-history.jsonl')` 会拼出**相对路径**，
  // 那会去读进程工作目录下的东西（甚至写到仓库里）—— 不是"没有记忆"，是"读错文件"。
  if (!projectPath) return { messages: [], note: null };
  try {
    const { messages, retention } = historyToMessages(await loadHistory(projectPath, file));
    return { messages, note: describeDropped(retention) || null };
  } catch (e) {
    logger.warn(`[ai] 读取对话记忆失败（本轮按全新对话处理）: ${String(e)}`);
    return { messages: [], note: null };
  }
}

/**
 * 把这一轮追加进记忆文件。
 *
 * @param opsCount 本轮提出的待确认操作数 —— 写进 `[本轮提出的操作]` 标记：
 *   这样即使散文被预算裁掉（`selectWithinBudget`），"我动过什么"也不会丢（见 historyStore 文件头）。
 *
 * 写失败只记日志：记忆是锦上添花，不该让一次已经成功的对话变成失败。
 */
async function rememberTurn(
  projectPath: string,
  userMessage: string,
  assistantText: string,
  opsCount: number,
  /** 写进哪条线程；不传 = 默认那份（老行为） */
  file?: string,
): Promise<void> {
  // 同上：空路径不写记忆（写下去会落在相对路径上）
  if (!projectPath) return;
  const ts = new Date().toISOString();
  const opsNote = opsCount > 0 ? `\n\n[本轮提出的操作] ${opsCount} 个待确认操作` : '';
  try {
    await appendHistoryEntries(
      projectPath,
      [
        { ts, role: 'user', content: userMessage },
        { ts, role: 'assistant', content: `${assistantText || '（本轮没有文字输出）'}${opsNote}` },
      ],
      file,
    );
  } catch (e) {
    logger.warn(`[ai] 写入对话记忆失败（这轮对话本身仍然有效）: ${String(e)}`);
  }
}

/**
 * 处理 AI 聊天请求。
 * 收集上下文 → 调用 LLM（流式）→ 如遇 tool_calls 执行工具 → 继续 LLM 循环
 */
export async function processAiChat(
  projectPath: string,
  userMessage: string,
  win: BrowserWindow,
  /** M5：页面模式（`blocks` = 低代码 / `code` = 代码页）。不传按低代码处理。 */
  opts?: {
    mode?: string;
    threadId?: string;
    /**
     * 用户这一轮贴的图片（data URL）。**只作用于这一轮**：
     * 记忆里只留一句「（附 N 张图）」，图片本身不落盘（见 ChatMessage.images 的说明）。
     */
    images?: string[];
    /**
     * **用户当前在代码编辑器里打开的文件**（项目内相对路径，P1-5）。
     *
     * 只在**代码页 / 双向**（角色 coder / duo）时进系统提示 —— 见 activeFileHintFor：
     * 低代码页的助手不写源码文件，塞给它只会引它去动代码（M5 防串味的反面）。
     */
    activeFilePath?: string;
  },
): Promise<void> {
  // 同一项目的新请求**顶掉**旧请求（否则两条链同时改同一张图）
  runningChats.get(projectPath)?.abort();
  const controller = new AbortController();
  const { signal } = controller;
  runningChats.set(projectPath, controller);
  /** 本轮开始时间（收尾时用来判断"要不要留一条耗时概览"） */
  const turnStartedAt = Date.now();
  /** 轮次日志 id（收尾时按它校验「这一轮还是不是我」） */
  let turnId = '';
  /** state 建在 try 里，finally 看不到它 —— 用这个引用把「这一轮提过操作吗」带出去 */
  let stateRef: ChatRunState | null = null;

  /**
   * ── 【运行级自动事务】的标记（P0-4；说明见 autoTx.ts）──────────────────
   *
   * 与 stateRef 同理：`finally` 是三条中断路径的唯一汇合点，"提交还是回滚"必须在那里判，
   * 所以这几个标记要跨 try/finally 可见。
   */
  const autoTxEnabled = isAutoTxEnabled();
  /** 事务是**我们**开的（用户/模型自己开的批次不归自动逻辑管：不重复开、也不替他提交或回滚） */
  let autoTxOpened = false;
  /** 已经**让位**过（用户开着批次 / 模型自己动了事务控制）—— 也让日志只说一次，不刷屏 */
  let autoTxDeclined = false;
  /** 这一次运行**中途报错**（403 / 网络 / 解析…）；"取消"走 signal.aborted，不靠它 */
  let autoTxErrored = false;
  /** 运行结束但**没能正常收尾**（轮数用尽 / 上下文超限） */
  let autoTxDegraded = false;

  try {
    // 可诊断性（2026-10-06 真机教训）：这一行让"请求到底有没有到主进程"一眼可查 ——
    // 之前用户说"我试了"而日志里一行都没有，只能靠猜（没发出去？被参数校验挡了？没配置？）。
    logger.info('[ai] 收到请求：' + projectPath + '（' + userMessage.length + ' 字）');

    /**
     * **轮次日志**：这一轮里改过的文件 + 开始时的 flow.json（见 turnJournal.ts）。
     * 用户要能「撤回这一轮」—— 在此之前只能撤流程、代码文件撤不回来。
     */
    turnId = await beginTurn(projectPath, userMessage);
    if (!aiConfig) {
      // 冷启动兜底：内存里没有就**按分层**读一次（全局智能体优先，老项目的 `ai` 字段兜底，
      // 见 appAiConfig.ts）。以前只读项目那个历史字段 —— 于是面板显示全局已配好，
      // 对话却回"⚠ AI 未配置"（2026-10-06 真机）。
      const resolved = await resolveAuthorAiConfig(projectPath);
      if (resolved) setAiConfig(resolved);
    }
    if (!aiConfig) {
      logger.warn('[ai] 模型未配置（全局/项目都读不到），已提示用户去填 API Key');
      win.webContents.send('ai:chunk', {
        projectPath,
        text: '⚠ AI 未配置。请在项目设置中填写 API Key。',
      });
      win.webContents.send('ai:response', {
        projectPath,
        message: '⚠ AI 未配置。请在项目设置中填写 API Key。',
      });
      return;
    }

    // ── 开荒模式：**还没有任何项目**（第一次打开客户端时的常态） ──────────────
    //
    // 之前这里假设"一定有项目"：面板上没有项目时输入框是禁用的，于是
    // 「让 AI 帮我建第一个项目」这件最自然的事**恰恰做不到**（鸡生蛋）。
    // 现在空路径是一个**正经模式**：只给"发现 + 提议"三类工具，且不读写项目记忆。
    const onboarding = projectPath.trim() === '';

    // ── M5 按模式分专家：角色决定**工具子集**与**一句边界提示** ──────────────
    const role = roleForMode(opts?.mode);
    const roleTools: AiToolDefinition[] = onboarding ? toolsForOnboarding() : toolsForRole(role);
    logger.info(
      `[ai] ${onboarding ? '开荒模式（未打开项目）' : `角色：${role}（页面 ${opts?.mode ?? '未传'}）`}；` +
        `可用工具 ${roleTools.length} 个`,
    );

    const projectInfo = await loadProjectInfo(projectPath);

    /**
     * 多轮记忆（`.qqbat/ai-history.jsonl`）。
     *
     * 补这里之前（2026-10-06 审查发现），作者助手的每一轮都是**全新对话**：
     * `messages` 永远只有 [system, user] 两条 —— 而文档（ai-agent-dsh-alignment）、
     * 渲染层注释（aiStore / ChatPanel 都写着"磁盘上的历史本来就按项目分"）与
     * `historyStore` 这个模块三处都声称记忆是落盘的。
     * 体感是：用户说"再给它加个日志节点"，AI 不知道"它"指谁。
     */
    /**
     * 本轮属于哪条**任务线程**（见 services/ai/threads.ts）。
     *
     * 不传 = `default` = 老的单文件路径 —— **老调用方行为一字不变**。
     * 开荒模式没有项目，也就没有线程文件（不读不写）。
     */
    const memoryFile = onboarding
      ? undefined
      : threadFilePath(projectPath, opts?.threadId ?? DEFAULT_THREAD_ID);
    /** 本轮的图片（data URL）。开荒模式也允许 —— 用户就是想让你看看他屏幕上有什么 */
    const roundImages = Array.isArray(opts?.images) ? opts.images.slice(0, MAX_ROUND_IMAGES) : [];
    const memory = await loadAuthorMemory(projectPath, memoryFile);

    /**
     * 角色强调句 —— 含 P1-5 的「用户当前打开的文件」。
     * 开荒模式没有项目，也就没有「项目内文件」这回事，所以走 ONBOARDING_HINT 时整段不加。
     */
    const roleHint = onboarding
      ? ONBOARDING_HINT
      : AGENT_ROLE_HINT[role] + activeFileHintFor(role, projectPath, opts?.activeFilePath);

    /**
     * **本角色的开放集**（不在里面的工具调用会被拒绝 —— 见 chatRun.ts 的允许集分支）。
     *
     * 计划阶段（P1-7）会把 state.allowedTools **临时**收窄成只读，出来再还原成**这一份**，
     * 所以这里必须先留一个引用 —— 否则收窄之后就找不回"角色表"了。
     */
    const roleAllowedTools = new Set(AGENT_TOOLS[role]);

    /**
     * 自动事务的**开**这一半（P0-4）：循环第一次真要累积 mutation 时调它（幂等）。
     *
     * 注意：**工具表里没有 begin_batch 也要能开** —— 这正是本任务的重点（结构性发生，不靠模型自觉）。
     * 已经有批次在跑（用户或模型自己开的）时**不重复开、也不接管**：那笔事务的提交/回滚仍由原来那条路决定。
     */
    const autoTxHooks: AutoTxHooks | undefined = autoTxEnabled
      ? {
          open: (toolName: string): void => {
            if (autoTxOpened || autoTxDeclined) return;
            if (isBatchModeFor(projectPath)) {
              autoTxDeclined = true;
              logger.info(`[ai] 运行事务：已有批次在跑，不重复开启（首次改动：${toolName}）`);
              return;
            }
            beginBatch(projectPath, win);
            autoTxOpened = true;
            // 图快照由渲染层在收到这条既有指令时拍（与模型自己调 begin_batch 同一条路）。
            // 窗口没了也要照开：磁盘那一半（轮次日志）不依赖渲染层，回滚时它会安全跳过图快照。
            if (!win.isDestroyed()) {
              win.webContents.send('ai:clientInstruction', {
                projectPath,
                instruction: { name: 'begin_batch', args: {} },
              });
            }
            logger.info(
              `[ai] 自动开启运行事务（首次改动：${toolName}）—— 本次运行若没能正常收尾，将自动回滚到运行前`,
            );
          },
          /**
           * 模型**自己**动了事务控制 ⇒ 自动逻辑让位。
           *
           * 为什么非要有这一条：主进程的批次标志要等渲染层 IPC 回来才置位，
           * 模型在同一轮里先 begin_batch 再 add_node 时，自动逻辑可能抢在它前面又开一个事务。
           * 这条通知把「谁在管事务」变成**确定的事实**，不再是竞态。
           */
          noticeTransactionTool: (toolName: string): void => {
            if (!/^(begin|commit|rollback)_batch$/.test(toolName)) return;
            if (autoTxDeclined) return;
            autoTxDeclined = true;
            logger.info(`[ai] 运行事务：模型自己调了 ${toolName}，自动逻辑让位`);
          },
        }
      : undefined;

    /** 一轮对话的可变状态（三个步骤共享；见 chatRun.ts） */
    const state: ChatRunState = {
      projectPath,
      win,
      signal,
      messages: [
        // memory.note / roleHint 在还原实现里可能是 null；统一收敛成 undefined，
        // 语义不变（context.ts 里都只按 truthiness 使用）。
        await buildSystemMessage(projectInfo, memory.note ?? undefined, roleHint ?? undefined, {
          // P3 v2：领域知识包按**用户这一次的话**装载（见 context.ts 的 domainPacks）
          requirement: userMessage,
        }),
        ...memory.messages,
        {
          role: 'user',
          content: userMessage,
          ...(roundImages.length ? { images: roundImages } : {}),
        },
      ],
      pendingOperations: [],
      fullResponse: '',
      hadToolCalls: false,
      toolCallCounts: new Map<string, number>(),
      // 批处理状态由本模块注入：chatRun 不依赖这里的模块级单例
      // 按**本项目**读批处理状态（见 batches 的说明）
      isBatchMode: () => isBatchModeFor(projectPath),
      onBatchToolFailure: () => notifyRollbackIfBatch(projectPath),
      // 角色能力表：越界的工具调用会被拒绝（不是"没提供"而已 —— 见 dispatchToolCalls）
      allowedTools: roleAllowedTools,
      role,
      // P0-4：只在开关打开时注入（undefined ⇒ 循环那一行什么都不做）
      autoTx: autoTxHooks,
      // M4b：emitProposal 里可能要为"大/破坏性计划"跑一次只读复核
      llm: aiConfig,
      // 状态条：轮数/步数来自真实流程，token 只来自厂商回传（没回传就不显示数字）
      stats: {
        rounds: 0,
        steps: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        usageReported: false,
        llmMs: 0,
        contextTokens: 0,
        contextBudget: CONVERSATION_TOKEN_BUDGET,
        // 计划阶段跑了几轮（P1-7；默认关时恒为 0 —— 状态条据此能解释"这轮为什么变慢了"）
        planRounds: 0,
      },
    };
    stateRef = state;

    /** 把统计推给界面（状态条）。**每轮都推** —— 一轮跑十几秒，等结束才更新等于没更新 */
    const pushStats = (): void => {
      if (state.stats) win.webContents.send('ai:stats', { projectPath, stats: state.stats });
    };

    // 通知渲染层 AI 正在思考
    win.webContents.send('ai:agentState', { projectPath, state: 'thinking' });

    /**
     * ── 模板直通已**移除**（2026-10-10）────────────────────────────────
     *
     * 这里曾经有一发「关键词直通」：短句命中片段名就**跳过模型**，直接把 apply_template 组装成计划
     * （目的：绕开当时实测的「20 轮 / 4.5 分钟」）。**现在删了**，三条理由：
     *
     * 1. 它**不读上下文**。真机上用户在**代码页**说「麻烦在代码编辑器帮我生成一个签到指令吧」，
     *    「签到」两个字命中了 signin-flow，于是铺了一张**流程**计划 —— 而 apply_template
     *    根本不在代码助手的工具表里（见 agents.ts 的声明式角色定义）。用户要的是**代码**。
     * 2. 「绕开模型」本身就是错的方向。当年那句慢的**根因**是：没有「先查片段」的用法约束、
     *    也没有可抄的示例。这两样现在都有了（context.ts 的流程手册 + nodeExamples.ts 的示例库）。
     * 3. 选片段这件事**本来就该由智能体判断** —— 它读得到当前页面、角色、以及用户原话里的限定词
     *    （「在代码编辑器」），而关键词匹配读不到。
     *
     * ⚠️ **别再把它加回来**。要提速就提**智能体**的速（提示词 / 示例 / 少绕路），别绕过它。
     */
    // ReAct 多轮循环：LLM 返回 tool_calls → 执行 → 结果回传 → 继续，直到纯文本或达 MAX_ROUNDS
    //
    // 每一轮的内部（调 LLM、分发工具、把结果并回 messages）都在 `chatRun.ts` 里，
    // 各自可以被单独调用与断言 —— 这里只留"循环 + 四种收尾"（response / proposal / 轮数用尽 / 上下文超限）。
    let rounds = 0;
    /** 因"上下文总量超限"提前收尾（与"轮数用尽"是两种结束原因，文案与收尾方式都不同） */
    let overBudget = false;
    /**
     * P0-5 **提案自洽**：这次运行已经催了几次「把重建补进同一份提案」
     * （上限 MAX_PLAN_FIX_KICKS；催不动就照原样交付，不硬拦）。
     */
    let planFixKicks = 0;
    /**
     * 正常收尾那条路上先算过一次的结构校验 —— 传给 `emitProposal` **避免算第二遍**
     * （只有开关打开、且这份提案里有删除时才会有值；其余情况照旧由 emitProposal 现算）。
     */
    let lastValidation: ProposalValidation | undefined;
    /** "只宣布不动手"被踢了几脚 */
    let announceKicks = 0;

    /**
     * 收尾阶段允许的**工具表**：只留"能落地"的 mutation 工具。
     *
     * 为什么不只靠提示词：真机（2026-10-06 04:22 那次）里模型连跑 18 轮全在查资料，
     * 收尾催促发了两次它**照样继续查**，最后一段还只是"现在开始提交改动。第一轮：…"——
     * 一个工具都没调。结论：**确定性的事要用结构保证**，所以到点就把查询类工具从工具表里拿掉。
     */
    // 收尾阶段的工具表 = 本角色能落地的那些（不再无条件给全部 mutation）
    const wrapUpTools = roleTools.filter((t) => t.category === 'mutation');

    /**
     * ── 【计划阶段】（P1-7）──────────────────────────────────────────────
     *
     * 见 `chatRun.ts` 的 PLAN_PHASE 说明（为什么、以及"不靠求它别动手"的思路）。
     * 这里只负责**按轮切换两张表 + 两条出口**：
     *   · 计划阶段 → `planPhaseTools(roleTools)`（角色表 ∩ 只读白名单），并把
     *     `state.allowedTools` 一并收窄（工具表只是建议，真机上模型会凭记忆调没给它的工具）；
     *   · 计划定稿/读满预算 → 走既有的"角色表 → 收窄 → 收尾"这条老路，一个字都不改。
     *
     * 默认**关**（`QQBAT_PLAN_PHASE=1` 才开）：理由写在 `isPlanPhaseEnabled` 的注释里 ——
     * 它会改变每一轮的调用序列，而既有脚本化闸门（evals / react-loop…）都假设"第一轮就能调 mutation"，
     * 那些文件不在本任务的写范围内。翻默认值前先在 `tests/setup.ts` 钉一行（照 QQBAT_TOOL_GUARD 的先例）。
     */
    const planPhaseEnabled = isPlanPhaseEnabled() && planPhaseApplies(roleTools);
    const planReadonlyTools = planPhaseTools(roleTools);
    /** 计划阶段：只读计划中（定稿或读满预算后自动置 false） */
    let inPlanPhase = planPhaseEnabled;
    /** 已经跑完的计划轮数（同时写进 state.stats.planRounds） */
    let planRounds = 0;
    if (planPhaseEnabled) {
      logger.info(
        `[ai] 计划阶段已开启：最多 ${PLAN_PHASE_MAX_ROUNDS} 轮只读` +
          `（只读工具 ${planReadonlyTools.length} 个；其余 ${roleTools.length - planReadonlyTools.length} 个不开放` +
          '—— 改盘 / 有副作用的查询类）',
      );
    }
    while (rounds < MAX_ROUNDS) {
      /**
       * ⚠️ **发送前**量一次总量。
       *
       * 单发闸门（`toolResultBudget`）保证"一次工具结果 ≤ 8192 码点"，但它管不了累加：
       * 10 轮 × 每轮多个工具，最坏可以到几十万码点。以前唯一的反馈是 API 报 400
       * —— 用户看到一句看不懂的错，这轮已规划的操作也全丢。这里把"该收尾了"提到发送前。
       */
      const measurement = measureConversation(state.messages);
      logger.info(`[ai] 第 ${rounds + 1} 轮前：${describeMeasurement(measurement)}`);
      // 上下文占用是**本地估算**（功能参数，不是用量）—— 与厂商口径的 token 分开显示
      if (state.stats) {
        state.stats.contextTokens = measurement.estimatedTokens;
        // 同一份估算的明细，附带推给界面（0 token 的项没意义，先滤掉）
        state.stats.contextHeaviest = measurement.heaviest
          .filter((h) => h.tokens > 0)
          .map((h) => ({ label: String(h.role), tokens: h.tokens }));
        state.stats.contextChars = measurement.chars;
      }
      pushStats();
      if (measurement.estimatedTokens > CONVERSATION_TOKEN_BUDGET) {
        overBudget = true;
        break;
      }
      rounds += 1;

      /**
       * 收尾催促（2026-10-06）：模型不知道"轮数预算"，会一直查资料到轮数用光 ——
       * 真机上就是这么交出一个"只有 1 个操作"的计划的。到剩下几轮时明确催它提交。
       */
      if (rounds === MAX_ROUNDS - WRAP_UP_ROUNDS_BEFORE_END || rounds === MAX_ROUNDS - 1) {
        state.messages.push({ role: 'user', content: WRAP_UP_NUDGE });
        logger.info(`[ai] 已发出收尾催促（第 ${rounds} 轮，共 ${MAX_ROUNDS} 轮）`);
      }

      const inWrapUp = rounds >= MAX_ROUNDS - WRAP_UP_ROUNDS_BEFORE_END;
      /**
       * 本轮的工具表（三选一，与既有的两档是同一套骨架）：
       *   · 计划阶段 → 角色表 ∩ 只读白名单（P1-7）；
       *   · 收尾阶段 → 只剩能落地的 mutation（既有）；
       *   · 其余     → 角色表 − 被反复调用的查询工具（既有 narrowRepeatedTools）。
       *
       * 计划阶段里**照样**继续摘"被反复调用的查询工具"：真机那种 read_logs 连读 6 次，
       * 在计划阶段一样会犯（甚至更容易 —— 它这一轮只有读的工具可调）。
       */
      const planning = inPlanPhase;
      const roundTools: AiToolDefinition[] = planning
        ? narrowRepeatedTools(planReadonlyTools, state.toolCallCounts)
        : inWrapUp
          ? wrapUpTools
          : narrowRepeatedTools(roleTools, state.toolCallCounts);
      if (planning) {
        planRounds += 1;
        // 计划提示只在第一轮插：后面几轮它已经看过这一句了，重复插只是白烧上下文
        if (planRounds === 1) state.messages.push({ role: 'user', content: PLAN_PHASE_HINT });
        /**
         * ⚠️ **工具表只是建议**（真机上模型干过"凭记忆调一个没给它的工具"），所以**开放集**一并收窄：
         * 计划阶段仍调用 mutation 时，掉进 `dispatchToolCalls` 里**既有的**「工具未开放」拒绝分支，
         * 只是文案换成"计划阶段不开放" —— 没有第二套拒绝逻辑（见那里的注释）。
         */
        state.allowedTools = new Set(roundTools.map((t) => t.name));
        state.planPhase = true;
        if (state.stats) state.stats.planRounds = planRounds;
        // 日志格式与既有的「第 N 轮前：…」对齐（状态条另有 planRounds 一条）
        logger.info(
          `[ai] 第 ${rounds} 轮前：计划阶段（只读工具 ${roundTools.length} 个 / 最多 ${PLAN_PHASE_MAX_ROUNDS} 轮）`,
        );
      }
      await runOneRound(state, aiConfig, roundTools);
      pushStats();

      /**
       * ── 计划阶段的**两条出口**（P1-7）────────────────────────────────
       * ① 还在读（没说话 / 没说清）→ 继续只读计划（判据在 `shouldStayInPlanPhase`，纯函数）；
       * ② 计划定稿（纯文本）或读满预算 → **放开动手工具 + 催它照计划做**，然后继续循环。
       *
       * ⚠️ 纯文本**绝不能**落进下面那个"纯文本 = 收尾"分支 —— 那会把"先计划再动手"变成
       * "只说不做"：真机上模型的计划句五花八门（"我来新建 /签到 指令，再接两个节点…"），
       * `looksLikeAnnouncement` 只认其中一部分，拿它兜底一定会漏，而**漏掉的代价是用户什么也拿不到**
       * （本仓库历史上反复出过这个事故）。所以这里一律"放开 + 催一句"，多花一轮换"不丢活"。
       * 用户只是提问时不会白花：提示里明确给了"不用改就直接作答"这条出口。
       */
      if (planning) {
        const stay = shouldStayInPlanPhase({
          enabled: planPhaseEnabled,
          planRounds,
          hadToolCalls: state.hadToolCalls,
          saidSomething: state.fullResponse.trim().length > 0,
        });
        if (stay) continue;
        // 放开动手：开放集还原成角色表（工具表由下一轮的 roundTools 决定）
        inPlanPhase = false;
        state.planPhase = false;
        state.allowedTools = roleAllowedTools;
        logger.info(`[ai] 计划阶段结束（第 ${rounds} 轮，计划 ${planRounds} 轮）：放开动手工具`);
        state.messages.push({ role: 'user', content: PLAN_PHASE_OPEN_NUDGE });
        continue;
      }

      // 无 tool_calls 表示 LLM 返回纯文本 —— 通常这就是最终答复
      if (!state.hadToolCalls) {
        /**
         * 但有一类"**假收尾**"：它说"现在开始提交改动。第一轮：新增/删除/改配置。"然后就没有下文了
         * （真机 04:31：一个工具都没调用，用户界面什么也不会发生）。
         * 对这种情况**再踢一脚**（最多 MAX_ANNOUNCE_KICKS 次），并且只在"还没有任何待确认操作"时踢 ——
         * 已经有计划了就让它正常收尾，别画蛇添足。
         */
        const canKick =
          state.pendingOperations.length === 0 &&
          announceKicks < MAX_ANNOUNCE_KICKS &&
          looksLikeAnnouncement(state.fullResponse);
        if (canKick) {
          announceKicks += 1;
          state.messages.push({ role: 'user', content: ANNOUNCE_KICK_NUDGE });
          logger.info(`[ai] 检测到"只宣布不动手"，已催第 ${announceKicks} 次`);
          continue;
        }
        /**
         * ── P0-5 **提案自洽**：会破坏结构的删除，必须与它的重建在**同一份提案**里 ──
         *
         * 这里刻意放在**交付之前**：催一句让模型把重建补进同一份提案，是**唯一**能
         * 一次交付完整改动的时机；交付之后就是新的一份提案了（真机事故正是卡在这儿）。
         *
         * 三条边界：
         *   · 只在开关打开 **且** 这份提案里有删除时才读盘校验（别的路径一个字节都不变）；
         *   · 判据来自 `verifier.findIncompleteRebuild`（与卡片上那个数字**同源**）；
         *   · **不硬拦**：催 MAX_PLAN_FIX_KICKS 次还不补就照原样交付，由用户在卡片上决定。
         */
        if (
          isSelfConsistencyEnabled() &&
          state.pendingOperations.some((op) => op.kind === 'delete_node')
        ) {
          const validation = await validateProposalOperations(projectPath, state.pendingOperations);
          const incomplete = findIncompleteRebuild(
            state.pendingOperations,
            validation?.introduced ?? [],
          );
          if (incomplete) {
            if (planFixKicks < MAX_PLAN_FIX_KICKS) {
              planFixKicks += 1;
              state.messages.push({ role: 'user', content: incomplete.guidance });
              logger.info(
                `[ai] 提案自洽：${incomplete.orphanNodeIds.join('/')} 会被留下不可达，` +
                  `已催模型把重建补进同一份提案（第 ${planFixKicks} 次）`,
              );
              continue;
            }
            logger.info(
              `[ai] 提案自洽：已催 ${planFixKicks} 次仍未补全，按原样交付（用户可在卡片上决定）`,
            );
          }
          // 上面算过一次，别让 emitProposal 再算一遍
          lastValidation = validation;
        }
        break;
      }
    }

    // 已取消：**不交付任何东西**（不发 Proposal、不发 response），并且**不报错**。
    // 取消是用户的正常操作，不是故障 —— 报红会让用户以为是自己弄坏了什么。
    if (signal.aborted) {
      win.webContents.send('ai:warning', { projectPath, message: '已取消本次 AI 请求' });
      // 取消**不写记忆**（取消语义见 docs/ai/ai-agent-dsh-alignment.md）：半截对话写进去，
      // 下一轮模型会以为自己说过那些话。
      return;
    }

    // 这一轮确实产出了东西 → 落记忆（写失败只记日志，不让成功的对话变成失败）
    await rememberTurn(
      projectPath,
      withImageNote(userMessage, roundImages.length),
      state.fullResponse,
      state.pendingOperations.length,
      memoryFile,
    );

    // 上下文超限提前收尾：优先把已规划的操作交出去（与"轮数用尽"同一套取舍）
    if (overBudget) {
      // P0-4：上下文超限 = **没能正常收尾** ⇒ 运行事务要回滚（提案仍照既有逻辑交出去）
      autoTxDegraded = true;
      if (state.pendingOperations.length > 0) {
        await emitProposal(state, 'AI 生成的计划（部分，因上下文超限提前结束）');
      }
      win.webContents.send('ai:warning', {
        projectPath,
        message: '这轮对话的上下文已达上限，已提前结束；请分步提问。',
      });
      // 再补一条 response：warning 让界面收尾，response 让旧界面（没有 warning 监听）也能收尾（幂等）
      win.webContents.send('ai:response', { projectPath, message: state.fullResponse });
      return;
    }

    // 达到 MAX_ROUNDS 仍有 tool_calls → 视为超时
    if (rounds >= MAX_ROUNDS && state.hadToolCalls) {
      // P0-4：轮数用尽 = **没能正常收尾** ⇒ 运行事务要回滚（部分提案仍照既有逻辑交出去）
      autoTxDegraded = true;
      // 修复超时丢失 pendingOperations：即使超时，也优先把已累积的 mutation 操作
      // 组装成 Proposal 发给前端让用户确认，避免丢失已规划的工作。
      // 仅在无累积操作时才发错误提示。
      if (state.pendingOperations.length > 0) {
        await emitProposal(state, 'AI 生成的计划（部分，因超时提前结束）');
        win.webContents.send('ai:warning', {
          projectPath,
          message: 'AI 规划超时，已展示部分已规划操作供确认',
        });
      } else {
        win.webContents.send('ai:error', { projectPath, message: 'AI 规划超时，请简化需求' });
      }
      return;
    }

    // 有累积的 mutation 操作 → 组装 Proposal 让用户确认
    if (state.pendingOperations.length > 0) {
      await emitProposal(state, 'AI 生成的计划', lastValidation);
    } else {
      win.webContents.send('ai:response', { projectPath, message: state.fullResponse });
    }
  } catch (e) {
    /**
     * 失败必须留痕（2026-10-06 真机教训）：链路失败以前只发给渲染层 —— 日志里就只剩
     * "第 1 轮前"一行，事后完全看不出是**额度用尽** / key 错 / 网络断（那次 403 就是
     * 只在界面上出现过一次，日志里一个字都没有）。
     */
    logger.error('[ai] 本轮失败：', e);
    // P0-4：报错 = 没能正常收尾 ⇒ 运行事务回滚（取消另算，见 closeAutoTxRun 的优先级）
    autoTxErrored = true;

    if (signal.aborted) {
      // abort 会让 callLlm 抛 AbortError —— 那是"取消"，不是故障。发 warning，不发 error。
      win.webContents.send('ai:warning', { projectPath, message: '已取消本次 AI 请求' });
    } else {
      win.webContents.send('ai:error', {
        projectPath,
        message: e instanceof Error ? e.message : String(e),
      });
      /**
       * 出错也要把**已经规划好的改动**交出去（P1-4，2026-10-18）。
       *
       * 以前"出错就什么都不交"，代价是十几轮的成本与已规划操作全丢 —— 与「上下文超限 /
       * 规划超时」两条降级路径的处理不一致（那两条早就交"部分"卡片）。用户看着卡片决定
       * 要不要，比我们替他决定"失败了就都别要"更合理。
       *
       * **取消**不走这里：取消的语义就是"别做了"，一条都不交（见上面那个分支）。
       * 事务回滚会还原磁盘，但不影响这份**已规划操作**的提案 —— 它是"还想改什么"的清单，
       * 不是"已经改了什么"。
       */
      if (!win.isDestroyed() && stateRef && stateRef.pendingOperations.length > 0) {
        try {
          await emitProposal(stateRef, 'AI 生成的计划（部分，因错误提前结束）');
        } catch (proposalError) {
          // 交付部分提案失败不该盖掉真正的失败原因（错误回执已经发出去了）
          logger.warn('[ai] 出错后交付部分提案失败:', proposalError);
        }
      }
    }
  } finally {
    /**
     * ⚠️ **只有「登记的轮次还是我」时才收尾** —— 被顶掉的旧请求同样会走 finally，
     * 不校验的话它会把**新那一轮**的日志收掉（和 runningChats 那条守卫同一个道理）。
     */
    // 整轮结束（含被停止/顶掉）→ 解掉还挂着的批准等待，否则界面会一直转圈
    cancelApprovalsFor(projectPath);
    if (turnId && currentTurnId(projectPath) === turnId) {
      // 提出过操作也要留档：流程是「用户确认后」才落盘的，那会儿轮次已经结束了
      await endTurn(projectPath, { hadChanges: (stateRef?.pendingOperations.length ?? 0) > 0 });
      /**
       * P0-4：**运行事务的收尾**（提交 / 回滚）。
       *
       * 必须放在 `endTurn` **之后**：回滚要靠刚落盘的轮次日志还原磁盘
       * （`rollbackTurn` 读的就是它），顺序反了就还原不了。
       */
      await closeAutoTxRun({
        enabled: autoTxEnabled,
        opened: autoTxOpened,
        aborted: signal.aborted,
        errored: autoTxErrored,
        degraded: autoTxDegraded,
        projectPath,
        win,
        turnId,
      });
    }
    /**
     * **慢轮次留一条人可读的概览**（trace 是给机器/复盘的结构化数据，日志是给人看的）。
     *
     * 只在 >30s 时打：平时不值得刷屏，慢的时候"最慢的一步是什么"是最有用的一句话。
     * 顺带这也是 `traceSummary` 的**生产接线**（否则它只是"测试里调得好好的"——
     * deadExports 闸门正是为这种事存在的）。
     */
    if (Date.now() - turnStartedAt > 3e4) {
      try {
        const entries = await readTrace(projectPath, 100);
        logger.info(`[ai] 本轮耗时概览：\n${formatTraceSummary(summarizeTrace(entries), '本轮')}`);
      } catch {
        // 概览只是观测，失败不影响本轮结论
      }
    }
    if (runningChats.get(projectPath) === controller) {
      runningChats.delete(projectPath);
      /**
       * **失败也要发 idle**（不变量，有集成测试钉着）：这一条的意思是
       * "没有请求在飞了"，失败同样成立 —— 界面不能卡在"思考中"。
       *
       * 那"错误提示会不会被抹掉"？**由渲染层负责**：它收到 error 之后会记住，
       * 直到下一轮开始才允许 idle 覆盖（见 aiStore 的 onAgentState）。
       * 主进程只报告事实，界面负责显示策略 —— 两边各管一件事。
       */
      win.webContents.send('ai:agentState', { projectPath, state: 'idle' });
    }
  }
}


















