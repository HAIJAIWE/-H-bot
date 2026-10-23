// src/main/services/flow/turnProjection.ts
//
// **一轮的投影**（2026-10-18，对齐 DSH 的 session-projection 的最小一块）。
//
// DSH 的投影是一张**可合并的表**：消息 / 工具 / 文件改动 / 统计各是一份投影，视图按需组合。
// 我们还没有那张表，但已经有了三份**各自为政**的原料：
//   · turnJournal（这一轮改了哪些文件、改之前是什么）
//   · trace（这一轮跑了哪些工具、成功没有、多久）
//   · 轮次元信息（谁开始、那句话是什么）
// 于是"这一轮到底发生了什么"要三处各查一遍 —— 正是投影要消灭的那种重复。
//
// 这一版只做**一份**投影：`TurnProjection`。它先服务两个消费者（列表与撤回预览），
// 渲染层暂不改 —— 一次只搬一块，比把 UI 一起重排安全。
import type { TraceEntry } from '../ai/trace';
import { readTrace } from '../ai/trace';
import { listTurns, readTurn, type TurnFileChange, type TurnMeta } from './turnJournal';

export interface TurnProjection {
  id: string;
  startedAt: string;
  /** 触发这一轮的用户那句话 */
  userMessage: string;
  /** 这一轮动过的文件（created = 这一轮新建；modified = 这一轮之前就存在） */
  files: Array<{ path: string; change: 'created' | 'modified' }>;
  /** 逐文件的行数变化（界面「本轮改动」卡用；oversize 时 exact=false，不猜） */
  changes: TurnFileChange[];
  /** 这一轮有没有动过玩家数据（data/ 快照会一起还原） */
  data: boolean;
  /** 这一轮跑过的工具（来自 trace，按 turnId 过滤） */
  tools: Array<{ name: string; ok: boolean; ms: number }>;
  stats: {
    fileCount: number;
    toolCount: number;
    failedTools: number;
    /** 这一轮里模型调用 + 工具调用的累计耗时（毫秒；trace 里没有就当 0） */
    ms: number;
  };
}

/**
 * 从日志原料拼出一轮的投影。
 *
 * 刻意**不返回文件内容**（before）：那是撤回用的还原依据，投影是"给人看/做索引"的视图，
 * 把整份原文塞进去只会让调用方误以为它能拿去还原 —— 还原只有一个入口（rollbackTurn）。
 */
export function buildTurnProjection(
  meta: TurnMeta,
  preview: { restore: string[]; remove: string[]; changes?: TurnFileChange[]; data?: boolean } | null,
  trace: readonly TraceEntry[],
): TurnProjection {
  const files = [
    ...(preview?.remove ?? []).map((path) => ({ path, change: 'created' as const })),
    ...(preview?.restore ?? []).map((path) => ({ path, change: 'modified' as const })),
  ];
  const tools = trace
    .filter((e) => e.kind === 'tool' && e.turnId === meta.id)
    .map((e) => ({ name: e.name, ok: e.ok, ms: Number.isFinite(e.ms) ? e.ms : 0 }));
  const ms = trace
    .filter((e) => e.turnId === meta.id)
    .reduce((sum, e) => sum + (Number.isFinite(e.ms) ? e.ms : 0), 0);
  return {
    id: meta.id,
    startedAt: meta.startedAt,
    userMessage: meta.userMessage,
    files,
    changes: preview?.changes ?? [],
    data: preview?.data ?? false,
    tools,
    stats: {
      fileCount: files.length,
      toolCount: tools.length,
      failedTools: tools.filter((t) => !t.ok).length,
      ms,
    },
  };
}

/**
 * 最近若干轮的投影（新的在前）。
 *
 * 只读一次 trace 再在内存里按 turnId 分组：逐轮各读一次文件会把整份 trace 读 N 遍。
 */
export async function listTurnProjections(
  projectPath: string,
  limit = 20,
): Promise<TurnProjection[]> {
  const metas = (await listTurns(projectPath)).slice(0, Math.max(1, limit));
  if (metas.length === 0) return [];
  const trace = await readTrace(projectPath, 2000);
  const out: TurnProjection[] = [];
  for (const meta of metas) {
    const preview = await readTurn(projectPath, meta.id);
    out.push(buildTurnProjection(meta, preview, trace));
  }
  return out;
}
