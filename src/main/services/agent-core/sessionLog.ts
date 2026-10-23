// src/main/services/agent-core/sessionLog.ts
//
// **会话事件日志**（2026-10-18，复刻主流 harness 的 session 层）。
//
// 和现在的「消息数组」的区别：日志是**只追加的事实流**（seq 单调），消息是它的视图。
// 有了它才能：
//   · 重放：「这个结论是哪几步推出来的」；
//   · 恢复：崩溃后从最后一条完整事件续跑；
//   · fork：从某条事件分叉出另一条会话（复制对话、试两种改法）。
//
// 本文件不碰 fs：持久化由注入的 writer/loader 提供（便于测试与替换）。

export interface SessionEvent {
  /** 单调递增，从 1 开始 */
  seq: number;
  ts: string;
  /** 事件类型：turn.start / tool.call / tool.result / llm.call / note … */
  type: string;
  payload: unknown;
}

export type SessionEventInput = Omit<SessionEvent, 'seq' | 'ts'> & { ts?: string };

export interface SessionPersistence {
  append(event: SessionEvent): Promise<void> | void;
  load(): Promise<SessionEvent[]> | SessionEvent[];
}

export class SessionLog {
  private events: SessionEvent[] = [];

  constructor(private readonly persist?: SessionPersistence) {}

  /** 从持久层恢复（不改变已有内存事件之外的东西） */
  async restore(): Promise<number> {
    if (!this.persist) return this.events.length;
    const loaded = await this.persist.load();
    this.events = [...loaded].sort((a, b) => a.seq - b.seq);
    return this.events.length;
  }

  /** 追加一条事件；seq 由日志自己发（调用方不许指定，避免回放错位） */
  async append(input: SessionEventInput): Promise<SessionEvent> {
    const seq = (this.events.at(-1)?.seq ?? 0) + 1;
    const event: SessionEvent = {
      seq,
      ts: input.ts ?? new Date().toISOString(),
      type: input.type,
      payload: input.payload,
    };
    this.events.push(event);
    if (this.persist) await this.persist.append(event);
    return event;
  }

  /** 全部事件（只读快照） */
  all(): readonly SessionEvent[] {
    return this.events;
  }

  /** seq 之后的事件（恢复/增量拉取用） */
  since(seq: number): SessionEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  /** 从某条事件分叉出一条新日志（不复制持久层；fork 由调用方决定怎么写） */
  fork(upToSeq: number): SessionLog {
    const forked = new SessionLog();
    const kept = this.events.filter((e) => e.seq <= upToSeq);
    forked.adopt(kept);
    return forked;
  }

  /** 仅供 fork 内部：接管一批事件并重排 seq */
  private adopt(events: readonly SessionEvent[]): void {
    this.events = events.map((e, i) => ({ ...e, seq: i + 1 }));
  }
}
