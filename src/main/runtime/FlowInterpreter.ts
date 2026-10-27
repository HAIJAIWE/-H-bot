/**
 * TS Flow 解释器 —— 从迁移前的 Python 实现移植
 *
 * 事件驱动：触发匹配 → 链执行 → 节点 handler 调用 → 数据流传递 → 控制流路由。
 *
 * ## 怎么读这个文件（2026-10 三步拆分：1855 → 964 行）
 *
 * 剩下的是**互相咬合的那部分**：事件分发 + 等待恢复是一个状态机，链执行是走图，
 * 两者的依赖各 10~11 项，凑不出干净的缝 —— 所以到此为止（不是"还没拆完"）。
 * 搬出去的三块，各自文件头都写了"为什么在这"：
 *   · `controlFlow.ts`  —— 7 个控制流执行器 + 分派表（本文件只负责调用）
 *   · `nodeInputs.ts`    —— 参数从哪来（数据边 > config > 默认值 > autoResolve）
 *                            与结果往哪写（按端口 id 保守归一后写变量表）
 *   · `nodeEvents.ts`    —— 节点事件（enter/exit/error）与失败上报（失败可见性）
 *
 * 按"读者想干什么"找入口：
 *   · 某条消息为什么没触发   → `handleEvent` → `dispatchEvent`（匹配在 triggerMatcher）
 *   · wait_input 超时 / 恢复  → `suspendForWaitInput` / `settleExpiredWaits` / `resumeFromWait`
 *   · 一个节点怎么被执行     → `execBlock`（走链）→ `execNormalNode`（调 handler）
 *   · 参数为什么是空的       → nodeInputs.ts（本文件只负责转交）
 *   · 失败为什么没标红       → nodeEvents.reportFailure（本文件只负责调用）
 *   · 子流程 / 循环 / 分支   → controlFlow.ts
 */

import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { FlowEdge, FlowGraph, FlowNode } from '../../shared/types/flow';
import { NODE_CATALOG_V2 } from '../../shared/nodes/builtinCatalog';
import { normalizeFlow } from '../../shared/nodes/flowNormalize';
import {
  findPlatformMismatches,
  type PlatformMismatch,
} from '../../shared/nodes/platformCheck';
import type { PlatformFamily } from '../../shared/domain/platform/registry';
import { logger } from '../services/logger';
import { emitBotLog, emitNodeEvent } from '../services/runner/runtimeEvents';
import { buildGraphIndexes, ExecContext } from './ExecContext';
import type { ControlOutIndex, DataInIndex } from './ExecContext';
import { getHandler } from './handlerRegistry';
import type { HandlerBot, HandlerContext } from './handlerRegistry';
import { safeEvalDetailed, safeEvalExpression } from './safeEval';
import { matchTrigger } from './triggerMatcher';
import { runWithProjectRoot } from '../services/builtinNodes/storeContext';
import type { TriggerEvent, TriggerNode } from './triggerMatcher';
import {
  fingerprintFromEvent,
  matchWait,
  messageTextFromEvent,
  registerWait,
  takeExpired,
} from './waitRegistry';
import type { PendingWait, WaitScope } from './waitRegistry';
/**
 * 控制流终止型 handler（执行后 return，不继续）。
 *
 * ⚠️ 这里的名字必须与类里的方法名**完全一致**（历史上曾写成 `_execIfBranch` 这类
 * 带下划线的旧名，而实际方法是 `execIfBranch`，导致所有控制流节点一执行就抛
 * `this[terminating] is not a function` 并中断整条链）。修改方法名时务必同步此表 ——
 * `tests/runtime/control-flow-dispatch.test.ts` 会做结构性校验。
 */
export const CONTROL_FLOW_TERMINATING: Record<string, string> = {
  branch_if: 'execIfBranch',
  try_catch: 'execTryCatch',
  parallel_exec: 'execParallel',
  retry_exec: 'execRetryExec',
  parallelExec: 'execParallel',
};

/** 控制流继续型 handler（返回 done_next 继续执行） */
export const CONTROL_FLOW_CONTINUING: Record<string, string> = {
  loop: 'execLoop',
  branch_switch: 'execSwitchCase',
  subflow_call: 'execSubflowCall',
};

/**
 * 控制流的历史 kind 别名（早期命名，已由 `migrateLegacyKinds` 迁移为规范名）。
 *
 * 它们**不在节点目录**（`NODE_CATALOG_V2`）中，这是预期行为：保留映射只是为了兼容
 * 未走迁移路径的极旧流程。新增别名时请同时更新此集合，结构性测试会据此区分
 * 「有意保留的别名」与「拼错的 kind」。
 */
export const LEGACY_CONTROL_FLOW_KINDS = new Set(['parallelExec']);

/** 长等待 handler（不设 30s 超时） */
const LONG_WAIT_HANDLERS = new Set(['wait_input', 'delay']);

/** 默认循环最大迭代次数 */
const DEFAULT_LOOP_MAX_ITERATIONS = 10_000;

/** subflow 最大递归深度 */
const MAX_SUBFLOW_DEPTH = 16;

/** 普通节点执行超时（ms） */
const NODE_TIMEOUT_MS = 30_000;

/** 链提前返回信号 */
export class ChainReturnError extends Error {
  constructor(public value: unknown = null) {
    super('chain_return');
    this.name = 'ChainReturnError';
  }
}

/** 生成短 trace id */
function shortTraceId(): string {
  return Math.random().toString(16).slice(2, 10);
}

interface GraphMeta {
  nodesById: Map<string, FlowNode>;
  triggers: FlowNode[];
  controlOut: ControlOutIndex;
  dataIn: DataInIndex;
}

/** 配置 API 绑定边（`source === '__config_api__'`）的载荷 */
interface ConfigApiBinding {
  table?: string;
  field?: string;
  dbPath?: string;
  where?: string;
  mode?: string;
  order?: string;
  whereParamRef?: { literalValue?: unknown; nodeId?: string; portId?: string } | null;
}

/** 解释器可选回调（预览等场景需要拿到链执行结束后的上下文） */
export interface FlowInterpreterOptions {
  /**
   * 链执行完成后回调（无论成功/异常）。
   * 用于流程预览收集变量快照 —— 正常运行时不传，零开销。
   */
  onChainContext?: (ctx: ExecContext) => void;
  /**
   * 预览模式：等待节点不登记真实挂起记录 —— 预览跑在临时克隆项目上，登记下来的等待
   * 既不会被真实消息唤醒（克隆目录不会收到事件），也会留在进程级挂起表里直到超时。
   * 预览下等待节点如实结束本次预览（见 docs/basic-nodes.md）。
   */
  isPreview?: boolean;
}

/**
 * Flow 解释器。
 * 每个项目一个实例，缓存 flow.json 和索引。
 */
export class FlowInterpreter {
  private flowCache: { graph: FlowGraph; mtimeMs: number } | null = null;
  private metaCache: { graphRef: FlowGraph; meta: GraphMeta } | null = null;
  private customScanned = false;

  constructor(
    private projectPath: string,
    private options: FlowInterpreterOptions = {},
  ) {}

  /**
   * 平台预检（第 65 批）：返回图中在当前平台跑不了的节点（空数组 = 干净）。
   *
   * 只读（走 loadFlow 的 mtime 缓存），不执行任何节点；`projectPlatform` 为空时
   * 直接返回空数组（项目没绑平台 → 不校验，历史项目照常可运行）。
   */
  platformMismatches(projectPlatform: PlatformFamily | undefined): PlatformMismatch[] {
    if (!projectPlatform) return [];
    const graph = this.loadFlow();
    return graph ? findPlatformMismatches(graph, projectPlatform) : [];
  }

  /** 加载 flow.json（带 mtime 缓存） */
  private loadFlow(): FlowGraph | null {
    const flowPath = join(this.projectPath, '.qqbat', 'flow.json');
    try {
      const stat = statSync(flowPath);
      const mtimeMs = stat.mtimeMs;

      if (this.flowCache && this.flowCache.mtimeMs === mtimeMs) {
        return this.flowCache.graph;
      }

      const raw = readFileSync(flowPath, 'utf-8');
      const parsed = JSON.parse(raw) as FlowGraph;
      // 统一真相层：补齐缺失的端口定义（模板创建的流程不保存端口）。
      // 解释器按端口列表取参数，端口为空 → handler 拿到空 kwargs → 静默不执行。
      const { graph: graph, changes } = normalizeFlow(parsed);
      if (changes.length > 0) {
        logger.info(
          `[ts-interpreter] 已为 ${changes.length} 个节点补全端口定义（flow.json 未保存端口）`,
        );
      }
      this.flowCache = { graph, mtimeMs };
      this.metaCache = null;
      return graph;
    } catch (e) {
      logger.error(`[ts-interpreter] flow.json 加载失败: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** 构建图元数据（带缓存） */
  private getGraphMeta(graph: FlowGraph): GraphMeta {
    if (this.metaCache && this.metaCache.graphRef === graph) {
      return this.metaCache.meta;
    }

    const nodesById = new Map<string, FlowNode>();
    const triggers: FlowNode[] = [];

    for (const node of graph.nodes ?? []) {
      nodesById.set(node.id, node);
      if (node.type === 'trigger') triggers.push(node);
    }

    const { controlOut, dataIn } = buildGraphIndexes(graph.edges ?? []);
    const meta: GraphMeta = { nodesById, triggers, controlOut, dataIn };
    this.metaCache = { graphRef: graph, meta };
    return meta;
  }

  // ============================================================
  // 事件入口
  // ============================================================

  /** 处理消息事件（message_received 触发器） */
  async handleEvent(bot: HandlerBot, event: TriggerEvent | null): Promise<boolean> {
    return this.dispatchEvent(bot, event, '', true);
  }

  /** 处理请求事件（request_received 触发器） */
  async handleRequestEvent(bot: HandlerBot, event: TriggerEvent | null): Promise<boolean> {
    return this.dispatchEvent(bot, event, '请求', false);
  }

  /** 处理通知事件（notice_received 触发器） */
  async handleNoticeEvent(bot: HandlerBot, event: TriggerEvent | null): Promise<boolean> {
    return this.dispatchEvent(bot, event, '通知', false);
  }

  /**
   * 列出指定 kind 的触发器（含 id 与 config）。
   *
   * 给调度器用：它需要知道"这个项目里有哪些定时/启动触发器、各自配了什么"，
   * 才能用 `isDue` 判断该不该触发（见 runtime/scheduler.ts）。
   */
  listTriggers(kinds: string[]): Array<{ id: string; kind: string; config: Record<string, unknown> }> {
    const graph = this.loadFlow();
    if (!graph) return [];
    const wanted = new Set(kinds);
    return (graph.nodes ?? [])
      .filter((n) => n.type === 'trigger' && wanted.has(n.data?.nodeKind ?? ''))
      .map((n) => ({
        id: n.id,
        kind: n.data?.nodeKind ?? '',
        config: (n.data?.config ?? {}) as Record<string, unknown>,
      }));
  }

  /**
   * 派发一次生命周期事件（定时 / 启动），**只**选中指定的那个触发器。
   *
   * 事件的 `__lifecycle__` 决定哪一类触发器命中，`__lifecycle_trigger__` 决定具体是哪一个
   * （同一个项目里可以有好几个定时流程，调度器要能分别触发）。
   *
   * @returns 被点名的那个触发器是否**真的跑了**。图上没有这个 id 时返回 false ——
   *   调用方（调度器）据此记账，避免"图上根本没有的触发器"占着已触发状态。
   */
  async fireLifecycle(
    kind: 'scheduled' | 'on_ready' | 'on_startup',
    triggerId: string,
    bot: HandlerBot,
  ): Promise<boolean> {
    // 图上没有这个触发器就别派发：否则会白白跑一趟触发匹配（还可能误触发同类流程）。
    const exists = this.listTriggers([kind]).some((t) => t.id === triggerId);
    if (!exists) return false;

    const firedAtMs = Date.now();
    const event = {
      post_type: 'meta_event',
      message_type: '',
      self_id: '',
      __lifecycle__: kind,
      __lifecycle_trigger__: triggerId,
      // 触发时间：scheduled 的 `time` / on_startup 的 `started_at` 端口从这里取值
      __fired_at__: new Date(firedAtMs),
      __fired_at_ms__: firedAtMs,
    } as unknown as TriggerEvent;
    const label = kind === 'scheduled' ? '定时' : kind === 'on_startup' ? '启动' : '就绪';
    return this.dispatchEvent(bot, event, label, false);
  }

  /**
   * 事件分发**唯一入口**：把整条链路包在项目根上下文里。
   *
   * 为什么要包：玩家存档/变量库是「每项目一个库」（`{项目}/data/players/persistent.db`），
   * 路径来自 `storeContext.currentProjectRoot()`。不注入上下文时它会回退到
   * `app.getAppPath()` / 进程 cwd —— 库就落到安装目录里，切项目后读的仍是同一份数据。
   *
   * 为什么包在**这一层**：等待链恢复（`settleWaitsAndResume`）也在这里发生，
   * 那条链上 await 之后的代码仍属于同一个上下文（AsyncLocalStorage 会跟着走）。
   */
  private async dispatchEvent(
    bot: HandlerBot,
    event: TriggerEvent | null,
    kind: string,
    _checkWaitInput: boolean,
  ): Promise<boolean> {
    return runWithProjectRoot(this.projectPath, () =>
      this.dispatchEventInner(bot, event, kind, _checkWaitInput),
    );
  }

  private async dispatchEventInner(
    bot: HandlerBot,
    event: TriggerEvent | null,
    kind: string,
    _checkWaitInput: boolean,
  ): Promise<boolean> {
    // D2 · 跨事件等待：先把到期的等待结算到「超时」出口，再看这条消息是否唤醒某条挂起的链。
    // 必须先于触发匹配 —— 被唤醒的链不该再被普通触发器重新触发一次（否则同一条消息跑两条链）。
    if (await this.settleWaitsAndResume(bot, event, kind)) return true;

    const graph = this.loadFlow();
    if (!graph) {
      logger.error(`[ts-interpreter] ${kind}事件处理中止: flow.json 加载失败`);
      return false;
    }

    const { nodesById, triggers, controlOut, dataIn } = this.getGraphMeta(graph);

    for (const trigger of triggers) {
      const triggerOutputs = matchTrigger(trigger as TriggerNode, event);
      if (triggerOutputs === null) continue;

      const traceId = shortTraceId();
      logger.info(
        `[ts-interpreter:${traceId}] ${kind}事件触发匹配: ${trigger.data?.nodeKind} (${trigger.data?.label ?? ''})`,
      );

      const ctx = new ExecContext(
        graph,
        nodesById,
        graph.edges ?? [],
        {},
        traceId,
        controlOut,
        dataIn,
      );

      for (const [portId, value] of Object.entries(triggerOutputs)) {
        ctx.variables[`${trigger.id}:${portId}`] = value;
      }

      try {
        await this.execChain(trigger, ctx, bot, event);
        logger.info(`[ts-interpreter:${traceId}] ${kind}链执行完成`);
      } catch (e) {
        if (e instanceof ChainReturnError) {
          logger.info(`[ts-interpreter:${traceId}] ${kind}链提前返回: ${e.value}`);
        } else {
          logger.error(`[ts-interpreter:${traceId}] ${kind}链执行异常: ${e instanceof Error ? e.message : e}`);
        }
      } finally {
        // 预览等场景需要链结束后的变量快照（正常运行时该回调不存在）
        try {
          this.options.onChainContext?.(ctx);
        } catch {
          /* 观察者异常不影响执行 */
        }
      }

      delete ctx.variables['__break_loop__'];
      delete ctx.variables['__chain_aborted__'];
      return true; // 一次事件只触发一条链
    }

    return false;
  }

  // ============================================================
  // 链执行
  // ============================================================

  private async execChain(trigger: FlowNode, ctx: ExecContext, bot: HandlerBot, event: TriggerEvent | null): Promise<void> {
    const nextNode = ctx.findControlNext(trigger);
    if (!nextNode) return;
    await this.execBlock(nextNode, ctx, bot, event, new Set());
  }

  // ============================================================
  // D2 · 跨事件等待（wait_input 真实现）
  // ============================================================
  //
  // 机制：等待节点登记"恢复现场"后结束本次事件；下一条消息到达时用指纹唤醒并从
  // received 出口继续（变量从快照恢复）；到期未回复则走 timeout 出口。
  //
  // 已知边界（第一版就接受，不假装可靠）：
  // - 挂起表在内存里，进程重启后等待中的链不会恢复（用户表现为最终无响应）；
  // - 超时在"下一条事件到达"时结算，尚未接心跳定时器 —— 长时间无人说话时超时会顺延；
  // - 挂起期间修改流程并删除出口节点时，唤醒会明确报错而不是伪造后续动作。

  /**
   * 结算到期等待 + 用本事件唤醒匹配的等待。
   *
   * @returns true 表示本事件已被"恢复的链"消费，不再参与普通触发匹配。
   */
  private async settleWaitsAndResume(
    bot: HandlerBot,
    event: TriggerEvent | null,
    kind: string,
  ): Promise<boolean> {
    // 1) 超时分支：只结算本项目的等待（别的项目的记录交给它自己的解释器）
    for (const wait of takeExpired(Date.now(), this.projectPath)) {
      if (!wait.timeoutNodeId) {
        const msg = `等待超时，但没有接「超时出口」（链 ${wait.chainId}）—— 结束该等待，不伪造后续动作`;
        logger.warn(`[ts-interpreter] ${msg}`);
        emitBotLog(this.projectPath, msg, 'warn', wait.chainId);
        continue;
      }
      await this.resumeFromWait(bot, wait, null, 'timeout');
    }

    // 2) 唤醒：只有带"谁 / 哪个会话"的事件才可能唤醒等待（定时器等无指纹事件不参与）
    if (!event) return false;
    const fp = fingerprintFromEvent(this.projectPath, event);
    if (!fp.userId && !fp.chatId) return false;

    const wait = matchWait(fp);
    if (!wait) return false;

    logger.info(
      `[ts-interpreter] ${kind}事件唤醒等待链 ${wait.chainId}（会话 ${fp.chatType ?? '?'}:${fp.chatId ?? fp.userId ?? '?'}）`,
    );
    await this.resumeFromWait(bot, wait, event, 'received');
    return true;
  }

  /**
   * 等待节点：发送提示（可选）→ 登记恢复现场 → 结束本次事件。
   *
   * @returns true = 已挂起（本次事件到此为止）；false = 未挂起（预览模式或参数/图结构拿不到），
   *          交回普通 handler 路径，由它给出诚实的失败原因。
   */
  private async suspendForWaitInput(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
  ): Promise<boolean> {
    const startedAt = Date.now();
    const handler = getHandler('wait_input');
    if (!handler) return false;

    let kwargs: Record<string, unknown>;
    try {
      kwargs = await this.resolveInputKwargs(node, ctx, bot, event, handler);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[ts-interpreter:${ctx.traceId}] 等待节点 ${node.id} 入参解析失败: ${msg}`);
      return false;
    }

    this.emitNodeEvent(node.id, 'enter', ctx.traceId);
    ctx.recordExecuted(node.id);

    // 预览：不登记真实挂起（见 FlowInterpreterOptions.isPreview 的说明）
    if (this.options.isPreview) {
      const msg = `[预览] 等待节点 ${node.id} 在此挂起：真实运行会等回复或超时后再继续`;
      emitBotLog(this.projectPath, msg, 'info', ctx.traceId);
      this.emitNodeEvent(node.id, 'exit', ctx.traceId, Date.now() - startedAt);
      // 预览需要链结束时的变量快照（与正常链结束一致）
      try {
        this.options.onChainContext?.(ctx);
      } catch {
        /* 观察者异常不影响执行 */
      }
      return true;
    }

    const rawScope = String(kwargs.scope ?? 'any_in_group');
    const knownScopes: WaitScope[] = ['trigger_user', 'any_in_group', 'specific_user'];
    const scope: WaitScope = knownScopes.includes(rawScope as WaitScope)
      ? (rawScope as WaitScope)
      : 'any_in_group';
    if (scope !== rawScope) {
      logger.warn(`[ts-interpreter:${ctx.traceId}] 未知的「等谁」取值 ${rawScope}，按 any_in_group 处理`);
    }

    const timeoutSeconds = Number(kwargs.timeout) > 0 ? Number(kwargs.timeout) : 60;
    const resumeNode = ctx.findControlNext(node, 'out');
    const timeoutNode = ctx.findControlNext(node, 'timeout');
    const fp = event ? fingerprintFromEvent(this.projectPath, event) : null;

    const prompt = String(kwargs.prompt ?? '').trim();
    if (prompt) await this.trySendText(bot, event, ctx, prompt);

    registerWait({
      projectPath: this.projectPath,
      scope,
      userId: fp?.userId,
      chatType: fp?.chatType,
      chatId: fp?.chatId,
      chainId: ctx.chainId,
      waitNodeId: node.id,
      resumeNodeId: resumeNode?.id ?? '',
      timeoutNodeId: timeoutNode?.id,
      variables: { ...ctx.variables },
      timeoutMs: timeoutSeconds * 1000,
      inputVarName: 'input',
      expectedPattern: String(kwargs.expected_pattern ?? '').trim() || undefined,
      invalidMessage: String(kwargs.invalid_message ?? '').trim() || undefined,
      maxRetries: Number(kwargs.max_retries) > 0 ? Number(kwargs.max_retries) : 0,
    });

    const msg =
      `等待回复：${scope}，最长 ${timeoutSeconds} 秒（链 ${ctx.chainId}）` +
      (timeoutNode ? '，已接超时出口' : '，未接超时出口（超时后不会有动作）');
    logger.info(`[ts-interpreter:${ctx.traceId}] [节点 ${node.id}] ${msg}`);
    emitBotLog(this.projectPath, `[节点 ${node.id} 等待回复] ${msg}`, 'info', ctx.traceId);
    this.emitNodeEvent(node.id, 'exit', ctx.traceId, Date.now() - startedAt);
    return true;
  }

  /** 从等待的恢复现场继续执行链（received = 收到回复 / timeout = 超时） */
  private async resumeFromWait(
    bot: HandlerBot,
    wait: PendingWait,
    event: TriggerEvent | null,
    reason: 'received' | 'timeout',
  ): Promise<void> {
    const graph = this.loadFlow();
    if (!graph) {
      const msg = `无法恢复等待链 ${wait.chainId}：flow.json 加载失败`;
      logger.error(`[ts-interpreter] ${msg}`);
      emitBotLog(this.projectPath, msg, 'error', wait.chainId);
      return;
    }

    const { nodesById, controlOut, dataIn } = this.getGraphMeta(graph);
    const targetId = reason === 'timeout' ? wait.timeoutNodeId : wait.resumeNodeId;
    const startNode = targetId ? nodesById.get(targetId) : undefined;
    if (!startNode) {
      const msg =
        reason === 'timeout'
          ? `等待超时，但超时出口没有接节点（链 ${wait.chainId}）`
          : `收到回复，但等待出口没有接节点（链 ${wait.chainId}，目标 ${targetId || '(空)'}）—— 可能节点已被删除`;
      logger.warn(`[ts-interpreter] ${msg}`);
      emitBotLog(this.projectPath, msg, 'warn', wait.chainId);
      return;
    }

    const traceId = shortTraceId();
    const ctx = new ExecContext(
      graph,
      nodesById,
      graph.edges ?? [],
      { ...wait.variables },
      traceId,
      controlOut,
      dataIn,
      0,
      wait.chainId,
    );

    const text = reason === 'received' ? messageTextFromEvent(event) : '';
    const fp = reason === 'received' ? fingerprintFromEvent(this.projectPath, event) : null;

    // 期望格式校验：不匹配时按配置提示并重试（重试耗尽才按原出口继续，并标记 is_valid=false）
    let valid = true;
    if (reason === 'received' && wait.expectedPattern) {
      valid = this.testPattern(text, wait.expectedPattern, traceId);
      const retries = wait.retries ?? 0;
      const maxRetries = Math.max(0, wait.maxRetries ?? 0);
      if (!valid && retries < maxRetries) {
        if (wait.invalidMessage) await this.trySendText(bot, event, ctx, wait.invalidMessage);
        registerWait({ ...wait, retries: retries + 1 });
        logger.info(
          `[ts-interpreter:${traceId}] 回复不符合期望格式，继续等待（重试 ${retries + 1}/${maxRetries}）`,
        );
        return;
      }
    }

    // 把结果写回等待节点的输出端口，供下游数据边使用
    if (wait.waitNodeId) {
      ctx.variables[`${wait.waitNodeId}:reply`] = text;
      ctx.variables[`${wait.waitNodeId}:timed_out`] = reason === 'timeout';
      ctx.variables[`${wait.waitNodeId}:user_id`] = fp?.userId ?? '';
      ctx.variables[`${wait.waitNodeId}:is_valid`] = valid;
    }
    if (wait.inputVarName) ctx.variables[`__var__:${wait.inputVarName}`] = text;

    try {
      await this.execBlock(startNode, ctx, bot, event, new Set());
      logger.info(`[ts-interpreter:${traceId}] 等待链 ${wait.chainId} 从节点 ${startNode.id} 恢复执行完成`);
    } catch (e) {
      if (e instanceof ChainReturnError) {
        logger.info(`[ts-interpreter:${traceId}] 等待链恢复后提前返回: ${e.value}`);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[ts-interpreter:${traceId}] 等待链恢复执行异常: ${msg}`);
        emitBotLog(this.projectPath, `[等待链 ${wait.chainId}] 恢复执行异常: ${msg}`, 'error', traceId);
      }
    } finally {
      try {
        this.options.onChainContext?.(ctx);
      } catch {
        /* 观察者异常不影响执行 */
      }
    }
  }

  /** 期望格式校验（正则非法时按"不校验"处理并记日志，不静默失败） */
  private testPattern(text: string, pattern: string, traceId: string): boolean {
    try {
      return new RegExp(pattern).test(text);
    } catch {
      logger.warn(`[ts-interpreter:${traceId}] expected_pattern 不是合法正则：${pattern}（本次不校验）`);
      return true;
    }
  }

  /** 尽力发送一条文本（发送失败只记日志：不该因为提示发不出去就丢掉等待状态） */
  private async trySendText(
    bot: HandlerBot,
    event: TriggerEvent | null,
    ctx: ExecContext,
    text: string,
  ): Promise<void> {
    const send = getHandler('message_send');
    if (!send) {
      logger.warn(`[ts-interpreter:${ctx.traceId}] 未注册 message_send，提示消息未发送: ${text}`);
      return;
    }
    try {
      await send(bot, event, { text }, { projectPath: this.projectPath, ctx, event });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[ts-interpreter:${ctx.traceId}] 提示消息发送失败: ${msg}`);
      emitBotLog(this.projectPath, `提示消息发送失败: ${msg}`, 'warn', ctx.traceId);
    }
  }

  private async execBlock(
    startNode: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    visited: Set<string>,
  ): Promise<void> {
    let current: FlowNode | null = startNode;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const nodeKind = current.data?.nodeKind ?? '';
      const label = current.data?.label ?? nodeKind;
      logger.debug(`[ts-interpreter:${ctx.traceId}] 执行节点: ${current.id} (${label})`);

      // 终止型控制流
      const terminating = CONTROL_FLOW_TERMINATING[nodeKind];
      if (terminating) {
        const fn = (this as unknown as Record<string, unknown>)[terminating];
        if (typeof fn !== 'function') {
          // 结构性配置错误（映射表方法名与实现不一致）不应静默中断整条链
          this.reportDispatchError(current, terminating, ctx.traceId);
          return;
        }
        await (fn as (...a: unknown[]) => Promise<void>).call(
          this,
          current,
          ctx,
          bot,
          event,
          visited,
        );
        return;
      }

      // 继续型控制流
      const continuing = CONTROL_FLOW_CONTINUING[nodeKind];
      if (continuing) {
        const fn = (this as unknown as Record<string, unknown>)[continuing];
        if (typeof fn !== 'function') {
          this.reportDispatchError(current, continuing, ctx.traceId);
          return;
        }
        const doneNext = await (fn as (...a: unknown[]) => Promise<unknown>).call(
          this,
          current,
          ctx,
          bot,
          event,
          visited,
        );
        if (!doneNext) return;
        current = doneNext as FlowNode;
        continue;
      }

      // 等待节点：登记恢复现场后结束本次事件（不阻塞线程）；下一条消息到达时从对应出口继续
      if (nodeKind === 'wait_input' && (await this.suspendForWaitInput(current, ctx, bot, event))) {
        return;
      }

      // 普通节点（返回它选择的控制出口；null = 走普通出口）
      const chosenPort = await this.execNormalNode(current, ctx, bot, event);
      ctx.recordExecuted(current.id);

      // break_loop 信号
      if (ctx.variables['__break_loop__']) return;
      // 硬失败（handler 抛异常）不继续往后跑：否则后面的节点会拿空数据产出一条
      // 看起来正常的假结果 —— 对小白来说这正是"流程明明跑了、结果全是错的"。
      // 只拦硬失败；handler 正常返回的 `{success:false, error}` 属于业务失败，
      // 交给 try_catch 的 catch 分支 / 失败出口处理。
      if (ctx.variables['__chain_aborted__']) return;

      // 链路推进
      let nextNode: FlowNode | null;
      if (chosenPort === null) {
        nextNode = ctx.findControlNext(current);
      } else {
        nextNode = ctx.findControlNext(current, chosenPort);
        if (!nextNode) {
          // 选了出口却没接线：必须说出来，否则现象是"流程跑到一半什么都没发生"
          const msg = `节点 ${current.id}（${nodeKind}）选择了「${chosenPort}」出口，但该出口没有连线 —— 链到此结束`;
          logger.warn(`[ts-interpreter:${ctx.traceId}] ${msg}`);
          emitBotLog(this.projectPath, msg, 'warn', ctx.traceId);
          return;
        }
      }
      if (!nextNode) return;
      current = nextNode;
    }
  }

  // ============================================================
  // 普通节点执行
  // ============================================================

  private async execNormalNode(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
  ): Promise<string | null> {
    const nodeId = node.id;
    const nodeKind = node.data?.nodeKind ?? '';

    const handler = getHandler(nodeKind);
    if (!handler) {
      const msg = `找不到节点实现 (handler): ${nodeKind}`;
      logger.warn(`[ts-interpreter:${ctx.traceId}] 节点 ${nodeId} ${msg}`);
      emitBotLog(this.projectPath, `[节点 ${nodeId} ${nodeKind}] ${msg}`, 'warn', ctx.traceId);
      this.emitNodeEvent(nodeId, 'error', ctx.traceId, 0, msg);
      return null;
    }

    // 节点事件：驱动指标面板的节点执行计数与前端执行高亮
    const startedAt = Date.now();
    this.emitNodeEvent(nodeId, 'enter', ctx.traceId);

    try {
      const kwargs = await this.resolveInputKwargs(node, ctx, bot, event, handler);
      const handlerCtx: HandlerContext = { projectPath: this.projectPath, ctx, event };

      let result: unknown;
      if (LONG_WAIT_HANDLERS.has(nodeKind)) {
        result = await handler(bot, event, kwargs, handlerCtx);
      } else {
        result = await Promise.race([
          handler(bot, event, kwargs, handlerCtx),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`TimeoutError: 节点 ${nodeKind} 执行超时 30 秒`)), NODE_TIMEOUT_MS),
          ),
        ]);
      }

      this.assignOutputs(node, ctx, result);
      this.reportNodeFailure(nodeId, nodeKind, result, ctx.traceId, Date.now() - startedAt);
      this.emitNodeEvent(nodeId, 'exit', ctx.traceId, Date.now() - startedAt);

      // loop_control：把「跳出循环 / 提前返回」翻译成解释器认识的两个信号。
      // 历史缺陷：`__break_loop__` 全代码库**只有读、没有写** —— 这个节点的返回值
      // 从没人翻译过，于是 loop_control(break) 永远是个空操作（循环照跑满次数）。
      if (nodeKind === 'loop_control' && result && typeof result === 'object') {
        const action = (result as { action?: unknown }).action;
        if (action === 'break' || action === 'return') {
          ctx.variables['__break_loop__'] = true;
        }
        if (action === 'return') {
          ctx.variables['__return__'] = (result as { value?: unknown }).value ?? null;
        }
      }

      // 节点可以指定走哪条控制出口（D3 条件更新：「条件不满足 → 失败出口」）：
      // 结果里带 `__control_port__` 就按它选出口，否则 null = 走普通出口。
      // ⚠️ 空字符串要当成"没指定"（handler 的初始值就是 ''，早期版本没排除它，
      // 导致 variable_persist 的 save/delete 等模式在第一个节点后就断链 —— 由真实端到端跑出来的）。
      const chosen = (result as { __control_port__?: unknown } | null | undefined)?.__control_port__;
      if (chosen === undefined || chosen === null || chosen === '') return null;
      return String(chosen);
    } catch (e) {
      const errorMsg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      logger.error(`[ts-interpreter:${ctx.traceId}] 节点 ${nodeId} (${nodeKind}) 执行错误: ${errorMsg}`);
      // 同步到「输出」面板：节点内部多用 console.* 记日志，界面上看不到，
      // 会导致「流程跑了但什么都没发生」这种无从排查的现象（实测踩到过）
      emitBotLog(this.projectPath, `[节点 ${nodeId} ${nodeKind}] 执行失败: ${errorMsg}`, 'error', ctx.traceId);
      this.emitNodeEvent(nodeId, 'error', ctx.traceId, Date.now() - startedAt, errorMsg);
      ctx.variables['__last_error__'] = errorMsg;
      ctx.variables[`${nodeId}:error`] = errorMsg;
      // 硬失败信号：链推进会在这里停下（见 execBlock 的 `__chain_aborted__` 检查），
      // 直到 try_catch 的处理分支把它清掉。
      ctx.variables['__chain_aborted__'] = errorMsg;
      // 为数据输出端口填充 None，避免下游 KeyError
      for (const port of node.data?.outputs ?? []) {
        if (port.kind === 'data') {
          if (!(`${nodeId}:${port.id}` in ctx.variables)) {
            ctx.variables[`${nodeId}:${port.id}`] = null;
          }
        }
      }
      return null;
    }
  }

  /**
   * 报告控制流分派错误（映射表里的方法名不存在）。
   * 单独抽出来是为了让失败在「输出」面板可见，而不是只留一条主进程 console 日志。
   */
  private reportDispatchError(node: FlowNode, methodName: string, traceId?: string): void {
    const msg = `控制流处理器缺失: ${node.data?.nodeKind} -> ${methodName}()`;
    logger.error(`[ts-interpreter:${traceId}] ${msg}`);
    emitBotLog(this.projectPath, `[节点 ${node.id} ${node.data?.nodeKind}] ${msg}`, 'error', traceId);
    this.emitNodeEvent(node.id, 'error', traceId, 0, msg);
  }

  /**
   * 报告节点返回的失败信息。
   *
   * 背景：节点 handler 普遍返回 `{ success, error }` 而不是抛异常（例如
   * `message_send` 发送失败），解释器此前只把结果写进输出变量 —— 用户看到的
   * 现象是「流程执行了但没有任何反应」，而失败详情只出现在主进程 console 里。
   * 这里把非空的 `error` 同步到「输出」面板，并**回写节点错误状态**，
   * 让画布上对应的节点直接变红并显示原因。
   */
  private reportNodeFailure(
    nodeId: string,
    nodeKind: string,
    result: unknown,
    traceId?: string,
    duration?: number,
  ): void {
    if (!result || typeof result !== 'object') return;
    const errorMsg = (result as { error?: unknown }).error;
    if (typeof errorMsg !== 'string' || !errorMsg.trim()) return;
    const success = (result as { success?: unknown }).success;
    // success 为 true（或未声明）时才可能只是提示性信息，降级为 warn 仍然值得显示
    const level = success === true ? 'warn' : 'error';
    emitBotLog(
      this.projectPath,
      `[节点 ${nodeId} ${nodeKind}] 返回失败: ${errorMsg}`,
      level,
      traceId,
    );
    // 真失败（success 非 true）才标红：`success: true` 附带说明文字属于提示，
    // 把节点标红会让用户以为流程坏了。
    if (success !== true) {
      this.emitNodeEvent(nodeId, 'error', traceId, duration, errorMsg);
    }
  }

  /**
   * 广播节点执行事件到运行时事件总线。
   *
   * 迁移说明：这些事件原先由 Python 子进程打印 `[NODE:...]` 标记后被解析；
   * 现在解释器在主进程内执行，直接调用总线（`ipc/metrics.ts` 统计节点执行/错误，
   * `ipc/runtime.ts` 转发到渲染层）。
   *
   * `message` 只在出错时传：渲染层用它把**真实原因**写到画布节点上。
   */
  private emitNodeEvent(
    nodeId: string,
    status: 'enter' | 'exit' | 'error',
    traceId?: string,
    duration?: number,
    message?: string,
  ): void {
    try {
      emitNodeEvent(this.projectPath, {
        nodeId,
        timestamp: new Date().toISOString(),
        status,
        ...(duration !== undefined ? { duration } : {}),
        ...(message ? { message } : {}),
        ...(traceId ? { traceId } : {}),
      });
    } catch (e) {
      // 事件总线异常不应影响流程执行
      logger.debug(`[ts-interpreter] 节点事件广播失败: ${String(e)}`);
    }
  }

  /**
   * 解析节点需要读取的 data 端口 id 列表。
   *
   * 正常情况下直接用节点里保存的端口定义。但**并非所有 flow.json 都保存了端口**
   * （旧流程 / 由模板或脚本生成的流程只有 `config`，`inputs: []`），此时若直接返回空列表，
   * handler 会拿到空 kwargs —— 现象是「流程执行了但什么都没发生」：例如
   * `message_send` 读不到 mode/markdown/text，在 `text 不能为空` 处静默返回。
   * （实测踩到过：节点配置齐全但全部节点 inputs 为空，机器人完全不回复。）
   *
   * 因此按「节点目录 → 配置键本身」逐级兜底。
   */
  private resolveDataPortIds(
    node: FlowNode,
    nodeKind: string,
    inputs: Array<{ id: string; kind: string }>,
    config: Record<string, unknown>,
  ): string[] {
    const declared = inputs.filter((p) => p.kind === 'data').map((p) => p.id);
    if (declared.length > 0) return declared;

    const spec = NODE_CATALOG_V2.find((s) => s.kind === nodeKind);
    const fromCatalog = (spec?.inputs ?? [])
      .filter((p) => p.kind === 'data')
      .map((p) => p.id);
    if (fromCatalog.length > 0) {
      logger.debug(
        `[ts-interpreter] 节点 ${node.id} (${nodeKind}) 缺少端口定义，已按节点目录补全 ${fromCatalog.length} 个入参`,
      );
      return fromCatalog;
    }

    return Object.keys(config);
  }

  /** 解析节点输入参数（数据边 > config > handler 默认值 > auto_resolve） */
  private async resolveInputKwargs(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    _handler: unknown,
  ): Promise<Record<string, unknown>> {
    const nodeId = node.id;
    const nodeKind = node.data?.nodeKind ?? '';
    const inputs = node.data?.inputs ?? [];
    const config: Record<string, unknown> = node.data?.config ?? {};

    const dataPortIds = this.resolveDataPortIds(node, nodeKind, inputs, config);

    const kwargs: Record<string, unknown> = {};

    for (const portId of dataPortIds) {
      const edge = ctx.findDataEdge(nodeId, portId);
      let value: unknown;

      if (edge) {
        if (edge.source === '__config_api__' && edge.configApi) {
          value = await this.resolveConfigApiValue(edge, ctx, bot, event);
        } else {
          value = ctx.variables[`${edge.source}:${edge.sourcePort}`];
        }
      } else {
        value = config[portId];
        // 兜底只在"节点没有端口定义"时生效 —— 这是它最初的用途（旧流程图/模板不存端口）。
        // 现代图有端口定义时不要替用户猜上游值：`condition` / `where_params` 这类端口被塞进
        // 布尔或对象会直接崩（真机探针在 database_write 上连抓三次），而"没连线"本来就该是空。
        // 控制流节点（branch_if 的 value、loop 的 list、subflow 的 args）走各自的显式兜底，不受影响。
        if (inputs.length === 0 && (value === null || value === undefined || value === '' || value === '""')) {
          const autoValue = ctx.autoResolve(portId);
          if (autoValue !== null && autoValue !== undefined) value = autoValue;
        }
      }

      kwargs[portId] = value;
    }

    // 目录里有些开关只写在 `defaultConfig` 里（不是端口，例如 error_op 的 `mode`、
    // branch_if 的 `expression`），面板把它们存进 config —— handler 按 kwargs 取名时
    // 同样需要这些键，否则「抛错/断言」这类模式永远走默认分支（error_op 因此从没抛过错）。
    for (const [key, value] of Object.entries(config)) {
      if (!(key in kwargs) && value !== undefined) kwargs[key] = value;
    }

    // expression_eval / format_text：合并全局变量到 variables_json
    if ((nodeKind === 'expression_eval' || nodeKind === 'format_text') && 'variables_json' in kwargs) {
      const globalVars = ctx.collectGlobalVars();
      if (Object.keys(globalVars).length > 0) {
        const existing = kwargs.variables_json;
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
          kwargs.variables_json = { ...globalVars, ...existing };
        } else if (typeof existing === 'string' && existing.trim()) {
          try {
            const parsed = JSON.parse(existing);
            if (parsed && typeof parsed === 'object') {
              kwargs.variables_json = { ...globalVars, ...parsed };
            }
          } catch {
            // 保留原值
          }
        } else {
          kwargs.variables_json = globalVars;
        }
      }
    }

    // expression_eval 兼容：mode/formulas 从 config 补齐
    if (nodeKind === 'expression_eval') {
      if (kwargs.mode === null || kwargs.mode === undefined) {
        const modeCfg = config.mode;
        if (modeCfg !== undefined) kwargs.mode = modeCfg;
      }
      if (kwargs.formulas === null || kwargs.formulas === undefined) {
        const formulasCfg = config.formulas;
        if (formulasCfg !== undefined) kwargs.formulas = formulasCfg;
      }
    }

    return kwargs;
  }

  /** 解析配置 API 绑定边（database_write select 查询） */
  private async resolveConfigApiValue(
    edge: FlowEdge,
    ctx: ExecContext,
    _bot: HandlerBot,
    _event: TriggerEvent | null,
  ): Promise<unknown> {
    const api = (edge.configApi ?? {}) as ConfigApiBinding;
    const table = api.table ?? '';
    const field = api.field ?? '';
    const dbPath = api.dbPath ?? '';
    const where = api.where ?? '';
    const mode = api.mode ?? 'query';
    const isQueryAll = mode === 'query_all';
    const isQueryRow = mode === 'query_row';

    if (!table || !dbPath) return isQueryAll ? [] : null;

    // 解析 WHERE 参数
    const whereParams: unknown[] = [];
    const ref = api.whereParamRef;
    if (ref && typeof ref === 'object') {
      if ('literalValue' in ref) {
        whereParams.push(ref.literalValue);
      } else if (ref.nodeId && ref.portId) {
        const refValue = ctx.variables[`${ref.nodeId}:${ref.portId}`];
        if (refValue !== undefined && refValue !== null) whereParams.push(refValue);
      }
    }

    // 调用 database_write handler
    const dbHandler = getHandler('database_write');
    if (!dbHandler) return isQueryAll ? [] : null;

    try {
      // ⚠️ handler 的统一签名是 `(bot, event, kwargs, hctx)`，不是"直接吃一个参数对象"。
      // 这里曾把参数对象当成第一个实参（= 当成 bot）传进去，于是 handler 拿到的 kwargs 为空、
      // 直接返回「未知模式: undefined」，配置绑定**永远取不到值**（真机实测的第二处缺陷）。
      // 同时必须传 hctx.projectPath：handler 用它注入 project_root，否则相对 db_path 会按进程 cwd 解析。
      const result = (await dbHandler(
        _bot,
        _event,
        {
          mode: 'select',
          table,
          condition: where,
          db_path: dbPath,
          where_params: whereParams,
          result_field: field,
          limit: isQueryAll ? 1000 : 1,
          // 随机取一行靠它：没有 order 时 `LIMIT 1` 永远返回第一行
          order: typeof api.order === 'string' ? api.order : '',
        },
        { projectPath: this.projectPath, ctx, event: _event },
      )) as { success?: boolean; rows?: unknown[]; value?: unknown } | null;

      if (!result?.success) return isQueryAll ? [] : null;
      if (isQueryAll) return result.rows ?? [];
      // query_row：把**整行**作为对象交给端口（读怪物/技能一行，一次拿全字段）
      if (isQueryRow) return (result.rows ?? [])[0] ?? null;
      return result.value ?? null;
    } catch (e) {
      logger.warn(`[ts-interpreter] 配置 API 查询失败: ${e instanceof Error ? e.message : e}`);
      return isQueryAll ? [] : null;
    }
  }

  /** 为节点输出端口分配结果 */
  private assignOutputs(node: FlowNode, ctx: ExecContext, result: unknown): void {
    const nodeId = node.id;
    const outputs = node.data?.outputs ?? [];
    const dataOutputs = outputs.filter((p) => p.kind === 'data');

    if (dataOutputs.length > 0) {
      if (dataOutputs.length === 1) {
        ctx.variables[`${nodeId}:${dataOutputs[0].id}`] = result;
      } else {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          ctx.variables[`${nodeId}:${dataOutputs[0].id}`] = result;
          return;
        }
        for (const port of dataOutputs) {
          ctx.variables[`${nodeId}:${port.id}`] = (result as Record<string, unknown>)[port.id];
        }
      }
      return;
    }

    // 端口定义丢失：按 key 赋值
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      for (const [key, value] of Object.entries(result)) {
        ctx.variables[`${nodeId}:${key}`] = value;
      }
      if (!('result' in result)) {
        ctx.variables[`${nodeId}:result`] = result;
      }
    } else {
      ctx.variables[`${nodeId}:result`] = result;
      ctx.variables[`${nodeId}:out`] = result;
    }
  }

  // ============================================================
  // 控制流
  // ============================================================

  /** branch_if：按表达式结果走 true/false 分支 */
  private async execIfBranch(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    visited: Set<string>,
  ): Promise<void> {
    const nodeId = node.id;
    const config = node.data?.config ?? {};

    // 解析 value 端口
    const valueEdge = ctx.findDataEdge(nodeId, 'value');
    let upstreamValue: unknown = null;
    if (valueEdge) {
      upstreamValue = ctx.variables[`${valueEdge.source}:${valueEdge.sourcePort}`];
    } else {
      // ⚠️ 只有「没连线」才去猜上游。连了线但值为 null 是**真实取值**（例如"这次没掉落"），
      // 以前这里把两者混为一谈，于是 autoResolve 会捡到**别的**上游节点的值：
      // 搭 RPG 主线实测到 —— 掉落为空时它捡到了"掉落表数组"（非空），
      // 条件判定成"有掉落"，流程走进发放分支并报「操作元素必须是一个对象」。
      // 走错分支是静默的（没有报错就执行了错误逻辑），比报错危险得多。
      upstreamValue = ctx.autoResolve('value');
    }

    const variables = ctx.buildExprVariables(upstreamValue);
    const expression = (config.expression ?? '') as string;

    let result: boolean;
    if (expression) {
      result = Boolean(safeEvalExpression(expression, variables));
    } else {
      result = Boolean(upstreamValue);
    }

    logger.debug(`[ts-interpreter:${ctx.traceId}] branch_if ${nodeId} expression=${expression} → ${result}`);

    const branchPort = result ? 'true' : 'false';
    const nextNode = ctx.findControlNext(node, branchPort);
    if (nextNode) {
      await this.execBlock(nextNode, ctx, bot, event, new Set(visited));
    }
  }

  /** loop：times / iterate / while 三种模式 */
  private async execLoop(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    visited: Set<string>,
  ): Promise<FlowNode | null> {
    const nodeId = node.id;
    const config = node.data?.config ?? {};
    let mode = config.mode ?? 'times';
    if (mode === 'count') mode = 'times';

    let maxIter = parseInt(String(config.max_iterations ?? DEFAULT_LOOP_MAX_ITERATIONS), 10);
    if (Number.isNaN(maxIter)) maxIter = DEFAULT_LOOP_MAX_ITERATIONS;

    const bodyStart = ctx.findControlNext(node, 'body');

    // ---- while ----
    if (mode === 'while') {
      const expression = (config.expression ?? '') as string;
      let iteration = 0;
      while (iteration < maxIter) {
        ctx.variables[`${nodeId}:index`] = iteration;
        ctx.variables[`${nodeId}:count`] = maxIter;

        const valueEdge = ctx.findDataEdge(nodeId, 'value');
        let upstreamValue: unknown = null;
        if (valueEdge) {
          upstreamValue = ctx.variables[`${valueEdge.source}:${valueEdge.sourcePort}`];
        } else {
          // 同 branch_if：连了线就以线为准，哪怕值是 null（否则会猜到一个无关的上游值，
          // 让 while 循环该停不停 / 该跑不跑）
          upstreamValue = ctx.autoResolve('value');
        }

        const variables = ctx.buildExprVariables(upstreamValue);
        const condition = safeEvalExpression(expression, variables);
        if (!condition) break;

        if (bodyStart) {
          await this.execBlock(bodyStart, ctx, bot, event, new Set(visited));
          if (ctx.variables['__break_loop__']) {
            delete ctx.variables['__break_loop__'];
            break;
          }
        }
        iteration++;
      }

      ctx.variables[`${nodeId}:result`] = iteration;
      return ctx.findControlNext(node, 'done');
    }

    // ---- iterate ----
    if (mode === 'iterate') {
      const listEdge = ctx.findDataEdge(nodeId, 'list');
      let data: unknown;
      if (!listEdge) {
        data = ctx.autoResolve('list');
        if (data === null || data === undefined) return ctx.findControlNext(node, 'done');
      } else {
        data = ctx.variables[`${listEdge.source}:${listEdge.sourcePort}`];
      }

      let items: Array<[unknown, unknown]>;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        items = Object.entries(data);
      } else if (Array.isArray(data)) {
        items = data.map((v, i) => [i, v]);
      } else {
        items = [];
      }

      if (items.length > maxIter) items = items.slice(0, maxIter);
      const total = items.length;

      for (const [key, item] of items) {
        ctx.variables[`${nodeId}:item`] = item;
        ctx.variables[`${nodeId}:key`] = key;
        ctx.variables[`${nodeId}:count`] = total;
        ctx.variables[`${nodeId}:index`] = typeof key === 'number' ? key : 0;

        if (bodyStart) {
          await this.execBlock(bodyStart, ctx, bot, event, new Set(visited));
          if (ctx.variables['__break_loop__']) {
            delete ctx.variables['__break_loop__'];
            break;
          }
        }
      }
      return ctx.findControlNext(node, 'done');
    }

    // ---- times ----
    let count = parseInt(String(config.count ?? 0), 10);
    if (Number.isNaN(count)) count = 0;
    if (count > maxIter) count = maxIter;
    const total = count;

    for (let i = 0; i < count; i++) {
      ctx.variables[`${nodeId}:index`] = i;
      ctx.variables[`${nodeId}:count`] = total;

      if (bodyStart) {
        await this.execBlock(bodyStart, ctx, bot, event, new Set(visited));
        if (ctx.variables['__break_loop__']) {
          delete ctx.variables['__break_loop__'];
          break;
        }
      }
    }

    return ctx.findControlNext(node, 'done');
  }

  /** branch_switch：调用 handler 获取 matched 后路由分支 */
  private async execSwitchCase(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    visited: Set<string>,
  ): Promise<FlowNode | null> {
    const nodeId = node.id;
    const config = node.data?.config ?? {};

    await this.execNormalNode(node, ctx, bot, event);
    const matched = ctx.variables[`${nodeId}:matched`] as string | undefined;

    const matchedPort =
      !matched || matched === 'default' ? ((config.default ?? 'default') as string) : matched;
    const nextNode = ctx.findControlNext(node, matchedPort);
    if (nextNode) {
      await this.execBlock(nextNode, ctx, bot, event, new Set(visited));
    }
    return null;
  }

  /** try_catch：try/catch/finally 分支 */
  private async execTryCatch(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    visited: Set<string>,
  ): Promise<void> {
    const nodeId = node.id;
    const tryNode = ctx.findControlNext(node, 'try');
    const catchNode = ctx.findControlNext(node, 'catch');
    const finallyNode = ctx.findControlNext(node, 'finally');

    try {
      try {
        // ⚠️ execBlock 自己会把节点异常 catch 掉并记进 `__last_error__`
        // （见 execBlock 的 catch），所以这里**不能只等异常冒泡** ——
        // 否则 try_catch 的 catch 分支永远不会执行（这个节点以前就是个摆设）。
        if (tryNode) {
          delete ctx.variables['__last_error__'];
          delete ctx.variables['__chain_aborted__'];
          await this.execBlock(tryNode, ctx, bot, event, new Set(visited));
        }
        const chainError = ctx.variables['__last_error__'];
        if (chainError) {
          ctx.variables[`${nodeId}:error_message`] = String(chainError);
          ctx.variables[`${nodeId}:result`] = 'error';
          // 失败已被捕获：清掉硬失败信号，让 catch 分支与后续流程能继续
          delete ctx.variables['__chain_aborted__'];
          if (catchNode) {
            await this.execBlock(catchNode, ctx, bot, event, new Set(visited));
          }
        } else {
          ctx.variables[`${nodeId}:result`] = 'ok';
          ctx.variables[`${nodeId}:error_message`] = '';
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.variables[`${nodeId}:error_message`] = msg;
        ctx.variables[`${nodeId}:result`] = 'error';
        if (catchNode) {
          await this.execBlock(catchNode, ctx, bot, event, new Set(visited));
        }
      }
    } finally {
      if (finallyNode) {
        try {
          await this.execBlock(finallyNode, ctx, bot, event, new Set(visited));
        } catch (e) {
          logger.warn(`[ts-interpreter:${ctx.traceId}] try_catch finally 异常: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  /** retry_exec：重试 body 链，按结果走 success/failed */
  private async execRetryExec(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    visited: Set<string>,
  ): Promise<void> {
    const config = node.data?.config ?? {};
    let maxRetries = parseInt(String(config.max_retries ?? 3), 10);
    if (Number.isNaN(maxRetries) || maxRetries < 1) maxRetries = 1;
    let delaySec = parseFloat(String(config.delay ?? 1));
    if (Number.isNaN(delaySec) || delaySec < 0) delaySec = 0;

    const bodyNode = ctx.findControlNext(node, 'body');
    const successNode = ctx.findControlNext(node, 'success');
    const failedNode = ctx.findControlNext(node, 'failed');

    let lastError = '';
    let attempts = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      attempts = attempt;
      if (!bodyNode) {
        lastError = '';
        break;
      }
      // 每次尝试前清掉上一轮的失败信号（execBlock 用 `__last_error__` 记录、用
      // `__chain_aborted__` 停链，两者都会被上一轮留下）
      delete ctx.variables['__last_error__'];
      delete ctx.variables['__chain_aborted__'];
      try {
        await this.execBlock(bodyNode, ctx, bot, event, new Set(visited));
      } catch (e) {
        if (e instanceof ChainReturnError) throw e;
        ctx.variables['__last_error__'] = e instanceof Error ? e.message : String(e);
      }
      // ⚠️ execBlock **自己会把节点异常 catch 掉**并记进 `__last_error__`，所以失败判断
      // 必须看这个信号，不能等它抛错 —— 以前这里靠 catch，于是循环第一次就 break，
      // retry_exec **从来没有真正重试过**（真跑测试抓到的）。
      const attemptError = ctx.variables['__last_error__'];
      if (!attemptError) {
        lastError = '';
        break;
      }
      lastError = String(attemptError);
      if (attempt < maxRetries && delaySec > 0) {
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    }

    // 失败已被这个节点接管（它自己走 failed 出口）：清掉硬失败信号，
    // 否则 body 一失败整条链就停，success/failed 两个出口都不会执行。
    delete ctx.variables['__chain_aborted__'];

    this.assignOutputs(node, ctx, { attempts, error: lastError });

    const nextNode = lastError ? failedNode : successNode;
    if (nextNode) {
      await this.execBlock(nextNode, ctx, bot, event, new Set(visited));
    }
  }

  /** parallel_exec：并行执行多个分支 */
  private async execParallel(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    visited: Set<string>,
  ): Promise<void> {
    const config = node.data?.config ?? {};

    let branches: unknown = config.branches ?? '[]';
    let parseError = '';
    if (typeof branches === 'string') {
      try {
        branches = JSON.parse(branches);
      } catch (e) {
        parseError = `branches JSON 解析失败: ${e instanceof Error ? e.message : e}`;
        branches = [];
      }
    } else if (!Array.isArray(branches)) {
      parseError = 'branches 类型非法';
      branches = [];
    }

    if (!branches || (branches as unknown[]).length === 0) {
      this.assignOutputs(node, ctx, {
        results: [],
        count: 0,
        error: parseError || '无并行分支',
      });
      // ⚠️ 这里不能"就地死掉"：没有分支可跑时仍要按普通出口把流程往下走，
      // 否则整条链**静默停在这个节点**、下游一个都不执行（而面板上根本没有配置
      // 分支的入口 —— 目录里没声明 `branches` 端口，用户填不了，于是必然走到这里）。
      const next = ctx.findControlNext(node, 'out');
      if (next) await this.execBlock(next, ctx, bot, event, new Set(visited));
      return;
    }

    const subContexts: ExecContext[] = [];
    const tasks: Promise<void>[] = [];

    for (const branch of branches as Array<Record<string, unknown>>) {
      const headId = (branch?.chain_head ?? branch?.head ?? branch?.node_id) as string | undefined;
      if (headId && !visited.has(headId)) {
        const subCtx = ctx.spawn();
        subContexts.push(subCtx);
        const headNode = ctx.nodesById.get(headId);
        if (headNode) {
          tasks.push(this.execBlock(headNode, subCtx, bot, event, new Set(visited)));
        }
      }
    }

    if (tasks.length > 0) {
      const results = await Promise.allSettled(tasks);
      const outputResults: Array<{ success: boolean; error: string }> = [];
      const errors: string[] = [];

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errors.push(`分支${i}: ${msg}`);
          outputResults.push({ success: false, error: msg });
        } else {
          outputResults.push({ success: true, error: '' });
        }
      });

      // 合并子上下文变量（last-write-wins）
      for (const subCtx of subContexts) {
        for (const [k, v] of Object.entries(subCtx.variables)) {
          ctx.variables[k] = v;
        }
      }

      this.assignOutputs(node, ctx, {
        results: outputResults,
        count: outputResults.length,
        errors,
        error: errors.join('; '),
      });
    } else {
      this.assignOutputs(node, ctx, { results: [], count: 0, error: '' });
    }

    // 继续执行后续节点
    const outPorts = (node.data?.outputs ?? []).filter((p) => p.kind === 'control');
    if (outPorts.length > 0) {
      const nextNode = ctx.findControlNext(node, outPorts[0].id);
      if (nextNode) {
        await this.execBlock(nextNode, ctx, bot, event, visited);
      }
    }
  }

  /** subflow_call：调用子流程 */
  private async execSubflowCall(
    node: FlowNode,
    ctx: ExecContext,
    bot: HandlerBot,
    event: TriggerEvent | null,
    _visited: Set<string>,
  ): Promise<FlowNode | null> {
    const nodeId = node.id;
    const config = node.data?.config ?? {};
    const subflowId = (config.subflow_id ?? '') as string;

    const setResult = (result: unknown, error: string): void => {
      ctx.variables[`${nodeId}:result`] = result;
      ctx.variables[`${nodeId}:error`] = error;
    };

    if (ctx.subflowDepth >= MAX_SUBFLOW_DEPTH) {
      setResult(null, `子流程递归深度超过 ${MAX_SUBFLOW_DEPTH}，可能存在循环调用`);
      return ctx.findControlNext(node);
    }

    if (!subflowId) {
      setResult(null, 'subflow_id 未配置');
      return ctx.findControlNext(node);
    }

    const defineNode = ctx.nodesById.get(subflowId);
    if (!defineNode || defineNode.data?.nodeKind !== 'subflow_defined') {
      setResult(null, `找不到 ID 为 ${subflowId} 的子流程定义`);
      return ctx.findControlNext(node);
    }

    // 解析 args
    const argsEdge = ctx.findDataEdge(nodeId, 'args');
    let argsValue: unknown;
    if (argsEdge) {
      argsValue = ctx.variables[`${argsEdge.source}:${argsEdge.sourcePort}`];
    } else {
      argsValue = config.args;
      // 同 branch_if：连了线就以线为准（哪怕值是 null）；只有"线也没有、配置也没填"
      // 才去猜上游，否则会捡到一个无关节点的输出当参数。
      if (argsValue === null || argsValue === undefined) {
        argsValue = ctx.autoResolve('args');
      }
    }

    let argsDict: Record<string, unknown> = {};
    if (argsValue && typeof argsValue === 'object' && !Array.isArray(argsValue)) {
      argsDict = argsValue as Record<string, unknown>;
    } else if (typeof argsValue === 'string' && argsValue.trim()) {
      try {
        const parsed = JSON.parse(argsValue);
        if (parsed && typeof parsed === 'object') argsDict = parsed;
      } catch {
        // 保留空 dict
      }
    }

    // 创建子上下文（variables 隔离）
    const subCtx = new ExecContext(
      ctx.graph,
      ctx.nodesById,
      ctx.edges,
      {},
      ctx.traceId,
      undefined,
      undefined,
      ctx.subflowDepth + 1,
    );

    // 注入参数
    const params = defineNode.data?.config?.params ?? [];
    if (Array.isArray(params)) {
      for (const p of params) {
        const paramName = typeof p === 'string' ? p : p?.name;
        if (paramName && paramName in argsDict) {
          subCtx.variables[`__var__:${paramName}`] = argsDict[paramName];
        }
      }
    }
    for (const [k, v] of Object.entries(argsDict)) {
      subCtx.variables[`__var__:${k}`] = v;
    }

    try {
      const bodyStart = ctx.findControlNext(defineNode, 'next') ?? ctx.findControlNext(defineNode);
      if (bodyStart) {
        await this.execBlock(bodyStart, subCtx, bot, event, new Set());
      }
      const returnValue = subCtx.variables['__return__'] ?? null;
      setResult(returnValue, '');
    } catch (e) {
      if (e instanceof ChainReturnError) {
        setResult(e.value, '');
      } else {
        setResult(null, e instanceof Error ? e.message : String(e));
      }
    }

    return ctx.findControlNext(node);
  }
}
