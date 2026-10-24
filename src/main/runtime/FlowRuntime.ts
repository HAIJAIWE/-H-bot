// @ts-nocheck
/**
 * TS Flow 运行时
 *
 * 作为运行时事件 WebSocket 客户端连接翻译器（官方 QQ 网关桥接；路径见
 * shared/protocol/bus.ts 的 BUS_WS_PATH —— 服务端与客户端必须一致，写错就是
 * 握手 400 "运行时永远连不上"），接收事件并驱动 FlowInterpreter 执行，
 * 动作通过 WebSocket 回传。
 *
 * 历史：取代迁移前的 Python 机器人进程（bot.py），现状以本文件为准。
 */

import WebSocket from 'ws';
import { BUS_WS_PATH } from '../../shared/protocol/bus';
import { logger } from '../services/logger';
import { FlowInterpreter } from './FlowInterpreter';
import { dueTriggers, selectDueLifecycle } from './scheduler';
import type { HandlerBot } from './handlerRegistry';
import type { TriggerEvent } from './triggerMatcher';

/** 定时触发器的轮询间隔（毫秒）：判定精度到分钟级，1 秒问一次足够 */
const SCHEDULE_TICK_MS = 1000;

/** 待响应的 action 请求 */
interface PendingAction {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 运行时状态 */
export type RuntimeStatus = 'stopped' | 'connecting' | 'running' | 'error';

export interface RuntimeStatusInfo {
  status: RuntimeStatus;
  error?: string;
  connectedAt?: string;
  eventCount: number;
}

/**
 * TS Flow 运行时。
 * 每个项目一个实例，由主进程按项目创建并管理其连接与重连。
 */
export class FlowRuntime {
  private ws: WebSocket | null = null;
  private interpreter: FlowInterpreter;
  private pending = new Map<string, PendingAction>();
  private echoSeq = 0;
  private status: RuntimeStatus = 'stopped';
  private error: string | undefined;
  private connectedAt: string | undefined;
  private eventCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private selfId = '';
  /** 定时触发器轮询（见 startScheduler） */
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  /** 每个触发器上次触发时间（毫秒），键是触发器节点 id */
  private lastFired = new Map<string, number>();
  /** 调度重入闸门：上一轮还没跑完就不再开新一轮（见 tickSchedules） */
  private ticking = false;

  /** 状态变化回调 */
  private statusListeners = new Set<(info: RuntimeStatusInfo) => void>();
  /** 日志回调 */
  private logListeners = new Set<(line: string) => void>();

  constructor(
    private projectPath: string,
    private translatorPort: number,
    /** 网关主机。默认本机（Electron 内嵌翻译器）；远程部署时指向网关地址 */
    private host: string = '127.0.0.1',
  ) {
    this.interpreter = new FlowInterpreter(projectPath);
  }
  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'connecting') return;
    this.stopped = false;
    this.setStatus('connecting');
    this.connect();
    this.startScheduler();
    // `on_startup`（机器人启动）语义上就发生在这一刻 —— 早于翻译器连接就绪，
    // 刻意不依赖连接，只适合"不需要发消息的初始化"（节点说明里也是这么写的）。
    void this.fireStartupTriggers();
  }

  stop(): void {
    this.stopped = true;
    this.stopScheduler();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [echo, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('运行时已停止'));
      this.pending.delete(echo);
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.removeAllListeners();
      // ⚠️ 关闭"还在握手"的连接时，ws 会走 abortHandshake：它在
      // process.nextTick 里补发一个 'error'（"WebSocket was closed before the
      // connection was established"）。上面刚把监听器全摘了，这个 error 就没人接，
      // EventEmitter 直接升级成 uncaughtException → 崩溃收集器收到后退出进程
      // （用户视角：点了"停止"，窗口直接消失）。留一个空错误监听把它吃掉。
      ws.on('error', () => {});
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.setStatus('stopped');
  }

  getStatus(): RuntimeStatusInfo {
    return {
      status: this.status,
      error: this.error,
      connectedAt: this.connectedAt,
      eventCount: this.eventCount,
    };
  }

  onStatusChange(cb: (info: RuntimeStatusInfo) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onLog(cb: (line: string) => void): () => void {
    this.logListeners.add(cb);
    return () => this.logListeners.delete(cb);
  }

  private setStatus(status: RuntimeStatus, error?: string): void {
    this.status = status;
    this.error = error;
    if (status === 'running') this.connectedAt = new Date().toISOString();
    const info = this.getStatus();
    for (const cb of this.statusListeners) {
      try {
        cb(info);
      } catch {
        // ignore
      }
    }
  }

  private emitLog(line: string): void {
    for (const cb of this.logListeners) {
      try {
        cb(line);
      } catch {
        // ignore
      }
    }
  }

  // ============================================================
  // 生命周期（定时 / 启动 / 就绪）触发器调度
  // ============================================================
  //
  // 三个生命周期触发器的**触发时机**在这一个文件里定死，别处不再派发：
  //   on_startup → `start()` 那一刻（不等连接，只适合不发消息的初始化）
  //   on_ready   → WebSocket `open`（真的连上网关）之后一次
  //   scheduled  → 每秒问一次 `dueTriggers`，cron / interval 判定在 scheduler.ts
  // 三者都按触发器 id 在 `lastFired` 里记账，保证"每个只跑一次"或"按间隔跑"。

  /**
   * 每秒问一次"有没有到点的定时流程"，到点就派发一次。
   *
   * 判定与挑选都在 `scheduler.ts` 的纯函数里（`dueTriggers` / `isDue`，有假时钟测试），
   * 这里只负责轮询、记账（每个触发器上次触发时间）和调用解释器。
   * 之前这块**完全没有**：画布上放定时/启动触发器，流程永远不会跑且不报错。
   */
  private startScheduler(): void {
    if (this.scheduleTimer) return;
    this.scheduleTimer = setInterval(() => void this.tickSchedules(), SCHEDULE_TICK_MS);
  }

  private stopScheduler(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  /** 跑一轮调度（也可被"本地测试"手动调用一次，用来当场验证定时流程） */
  async tickSchedules(nowMs: number = Date.now()): Promise<number> {
    // 防重入：派发是 await 出去的（链里可能有 delay / 网络调用），而轮询每秒一次 ——
    // 没有这个闸门时，一条慢链会在跑完之前再被触发一次。
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const triggers = this.interpreter.listTriggers(['scheduled', 'on_ready']);
      if (triggers.length === 0) return 0;
      // 判定（含"没连上就推迟 on_ready"）在 scheduler.ts 的纯函数里，有假时钟单测。
      // 显式标出元素形状，否则下面 trigger.kind/trigger.id 全部报"不存在于 never"。
      const { due } = selectDueLifecycle(
        triggers,
        this.lastFired,
        nowMs,
        this.status === 'running',
      ) as { due: Array<{ id: string; kind?: string }>; deferred: unknown[] };

      let fired = 0;
      for (const trigger of due) {
        const kind = trigger.kind === 'on_ready' ? 'on_ready' : 'scheduled';
        const ran = await this.fireLifecycle(trigger.id, kind, nowMs);
        // 只有真的跑了才记账（`fireLifecycle` 在图上没有这个触发器时返回 false）。
        // 否则一个"图上已删除但仍在列表里"的触发器会把 lastFired 占住。
        if (ran) this.lastFired.set(trigger.id, nowMs);
        fired++;
      }
      return fired;
    } catch (e) {
      this.emitLog(`[调度] 定时触发器执行失败: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    } finally {
      this.ticking = false;
    }
  }

  /**
   * `on_startup`（机器人启动）：整个运行时实例只跑一次，在 `start()` 里同步发起。
   *
   * 与 `on_ready` 的区别是**不等连接** —— 节点说明里写明它早于就绪、只适合不发消息的初始化；
   * 与 `on_ready` 的一致之处是同样只跑一次（`dueTriggers` 对这两个 kind 走"没跑过就跑一次"，
   * **不看 config** —— 它们的 `defaultConfig` 是空的，交给 `isDue` 判会变成"没配 → 不触发"）。
   */
  private async fireStartupTriggers(): Promise<number> {
    const triggers = this.interpreter.listTriggers(['on_startup']);
    if (triggers.length === 0) return 0;
    const now = Date.now();
    const due = dueTriggers(triggers, this.lastFired, now);

    let fired = 0;
    for (const trigger of due) {
      const ran = await this.fireLifecycle(trigger.id, 'on_startup', now);
      if (ran) this.lastFired.set(trigger.id, now);
      fired++;
    }
    return fired;
  }

  /**
   * 派发一次生命周期触发器，并把它真的跑没跑如实**记进日志**。
   *
   * 这里刻意不吞异常也不谎报成功：用户在画布上放了定时/启动触发器却什么也没发生，
   * 是这一轮要根治的"静默失效"。跑不起来时日志里必须有那条链的报错。
   */
  private async fireLifecycle(
    triggerId: string,
    kind: 'scheduled' | 'on_ready' | 'on_startup',
    _nowMs: number,
  ): Promise<boolean> {
    try {
      const ran = await this.interpreter.fireLifecycle(kind, triggerId, this.bot);
      return ran;
    } catch (e) {
      this.emitLog(
        `[调度] ${kind} 触发器 ${triggerId} 执行失败: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  // ============================================================
  // WebSocket 连接
  // ============================================================

  private connect(): void {
    const url = `ws://${this.host}:${this.translatorPort}${BUS_WS_PATH}`;
    logger.info(`[ts-runtime] 连接翻译器: ${url}`);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.setStatus('error', e instanceof Error ? e.message : String(e));
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      logger.info('[ts-runtime] 已连接翻译器');
      this.emitLog('[ts-runtime] 已连接翻译器');
      this.setStatus('running');
      // `on_ready`（连接就绪）的名字就是它的语义：**连上网关之后**才触发。
      // 之前的实现把它当成"启动即触发"，在还没连上时就跑，于是流程里的发消息必然失败。
      void this.tickSchedules();
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const data = JSON.parse(raw.toString());
        this.handleMessage(data);
      } catch {
        // ignore malformed
      }
    });

    this.ws.on('close', () => {
      logger.warn('[ts-runtime] 翻译器连接断开');
      this.emitLog('[ts-runtime] 翻译器连接断开');
      if (!this.stopped) {
        this.setStatus('connecting');
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err: Error) => {
      logger.error(`[ts-runtime] WebSocket 错误: ${err.message}`);
      this.emitLog(`[ts-runtime] WebSocket 错误: ${err.message}`);
    });

    // 握手被拒绝（非 101）：最常见的原因是端口上的服务并不是本项目的翻译器
    // （例如被其它程序占用）。旧实现只抛出 "Unexpected server response: 404"，
    // 用户完全看不出该怎么办，这里给出可操作的提示。
    this.ws.on('unexpected-response', (_req, res) => {
      const code = res.statusCode ?? 0;
      const hint =
        code === 404
          ? `端口 ${this.translatorPort} 上的服务不是本项目的翻译器（多半被其它程序占用）。请关闭占用该端口的程序，或删除 .qqbat/project.json 里的 translatorPort 后重新启动机器人`
          : `端口 ${this.translatorPort} 拒绝 WebSocket 握手（HTTP ${code}）`;
      logger.error(`[ts-runtime] 连接被拒绝: ${hint}`);
      this.emitLog(`[ts-runtime] 连接被拒绝: ${hint}`);
      // 消费响应体，避免 socket 悬挂；随后 close 事件会触发重连
      res.resume();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, 3000);
  }

  // ============================================================
  // 事件处理
  // ============================================================

  private handleMessage(data: Record<string, unknown>): void {
    // action 响应（带 echo）
    if (data.echo !== undefined && (data.status === 'ok' || data.retcode !== undefined)) {
      const echo = String(data.echo);
      const pending = this.pending.get(echo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(echo);
        if (data.status === 'failed' || (data.retcode !== undefined && data.retcode !== 0)) {
          pending.reject(
            new Error(String(data.message ?? data.wording ?? `action 失败: retcode=${data.retcode}`)),
          );
        } else {
          pending.resolve(data.data ?? {});
        }
      }
      return;
    }

    // 事件分发
    const postType = data.post_type;
    if (postType === 'meta_event') {
      if (data.meta_event_type === 'lifecycle' && data.self_id) {
        this.selfId = String(data.self_id);
      }
      return;
    }

    if (postType !== 'message' && postType !== 'notice' && postType !== 'request') return;

    this.eventCount++;
    const event = data as TriggerEvent;
    if (event.self_id !== undefined) this.selfId = String(event.self_id);

    void this.dispatchEvent(postType, event);
  }

  private async dispatchEvent(postType: string, event: TriggerEvent): Promise<void> {
    try {
      let handled = false;
      if (postType === 'message') {
        handled = await this.interpreter.handleEvent(this.bot, event);
      } else if (postType === 'request') {
        handled = await this.interpreter.handleRequestEvent(this.bot, event);
      } else if (postType === 'notice') {
        handled = await this.interpreter.handleNoticeEvent(this.bot, event);
      }

      if (handled) {
        this.emitLog(`[ts-runtime] 事件已处理: ${postType}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[ts-runtime] 事件处理异常: ${msg}`);
      this.emitLog(`[ts-runtime] 事件处理异常: ${msg}`);
    }
  }

  // ============================================================
  // Bot 接口（handler 调用）
  // ============================================================

  /** BotInterface 实现：callApi → 协议动作 */
  get bot(): HandlerBot {
    return {
      callApi: (api: string, params: Record<string, unknown>) => this.callApi(api, params),
      self_id: this.selfId,
    };
  }

  /** 发送协议动作并等待响应 */
  callApi(api: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('翻译器未连接'));
    }

    const echo = `ts_${++this.echoSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`action 超时: ${api}`));
      }, timeoutMs);

      this.pending.set(echo, { resolve, reject, timer });

      try {
        this.ws!.send(JSON.stringify({ action: api, params, echo }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}
