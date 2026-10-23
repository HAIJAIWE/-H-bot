// src/main/services/ai/trace.ts
//
// **结构化 trace**（评审文档 P1）：每次模型调用 / 工具调用落**一行 JSON**。
//
// ## 为什么（现在的痛）
//
// 排障全靠文本日志里搜 `[ai]`：能看出"第几轮、发了提案"，但看不出
// **哪一步慢、哪一步失败、每步多大**。多智能体上线后更明显 —— 一次对话里
// 有主循环、复核（llm）、侦察（静态）好几个阶段，文本日志分不清谁是谁。
//
// ## 设计取舍
//
// · **一行一个 JSON**（`ai-trace.jsonl`）：可直接 `jq`/`node -e` 聚合，不用先解析文本；
// · **写在项目目录**（`.qqbat/ai-trace.jsonl`）：跟这个项目的对话绑在一起，换项目不会串；
// · **失败静默**：trace 是诊断增益，绝不因为它写不进去而影响对话；
// · **有上限**：超过 `MAX_TRACE_BYTES` 自动只留最近的（否则一个长期项目能写到几百 MB）。
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TraceEntry {
  /** ISO 时间 */
  ts: string;
  /** 'llm' = 一次模型调用；'tool' = 一次工具执行 */
  kind: 'llm' | 'tool';
  /** 模型名 / 工具名 */
  name: string;
  /** 耗时（毫秒） */
  ms: number;
  ok: boolean;
  /** 角色（builder/coder；复核阶段是 verifier） */
  agent?: string;
  /**
   * 这次运行属于哪一轮（P1-7，2026-10-18）。
   *
   * 以前 trace 每行都是孤立的：同一个项目的多次对话、复核调用、MCP 调用混在一个文件里，
   * 「这次任务到底做了什么」只能靠时间窗口猜。带上 turnId 之后，
   * 一次运行的所有行（模型调用 + 每次工具）可以被同一个键筛出来。
   */
  turnId?: string;
  /** 补充说明：失败原因、跳过的原因、结果大小等 */
  note?: string;
  /**
   * 本次**输入**的字符数（模型调用：整个 prompt；工具调用：参数）。
   *
   * ⚠️ 这是**量级估算**，不是计费口径 —— provider 目前不回传真实 usage（见评审文档 P2）。
   * 它够用的场景：比较"同一需求跑几轮、每轮喂进去多少"、"哪个工具结果最占地方"。
   */
  inChars?: number;
  /** 本次**输出**的字符数（模型回复 / 工具结果） */
  outChars?: number;
}

/** 超过这个大小就只保留最近的（1 MB ≈ 数千行，足够复盘一次对话） */
export const MAX_TRACE_BYTES = 1_000_000;
/** 裁剪时保留多少行 */
export const KEEP_LINES = 500;

export function traceFilePath(projectPath: string): string {
  return join(projectPath, '.qqbat', 'ai-trace.jsonl');
}

/**
 * 记一条 trace（**失败静默**：写不进去只当没发生）。
 *
 * 超过 MAX_TRACE_BYTES 时只保留最近 KEEP_LINES 行 —— 长期项目不能无限长。
 */
export async function appendTrace(projectPath: string, entry: TraceEntry): Promise<void> {
  try {
    const file = traceFilePath(projectPath);
    await appendFile(file, JSON.stringify(entry) + '\n', 'utf-8');
    const info = await stat(file);
    if (info.size > MAX_TRACE_BYTES) {
      const raw = await readFile(file, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      // 按**字节**从尾部留，而不是「留最后 N 行」—— 单行也可能很大（病态行/超长结果），
      // 只按行数裁会让文件仍然超限（自测踩过：一行 1MB + 一行正常，裁完还是 1MB）。
      const kept: string[] = [];
      let bytes = 0;
      for (let i = lines.length - 1; i >= 0 && kept.length < KEEP_LINES; i -= 1) {
        const line = lines[i];
        const size = Buffer.byteLength(line, 'utf-8') + 1;
        // 单行本身就超上限：放弃它（留着会让文件永远收不住），继续看更早的行
        if (size > MAX_TRACE_BYTES) continue;
        if (bytes + size > MAX_TRACE_BYTES && kept.length > 0) break;
        kept.unshift(line);
        bytes += size;
      }
      await writeFile(file, kept.join('\n') + '\n', 'utf-8');
    }
  } catch {
    // trace 是诊断增益：写不进去只当没发生
  }
}

/** 读最近 limit 条 trace（坏行跳过；文件不存在返回空） */
export async function readTrace(projectPath: string, limit = 200): Promise<TraceEntry[]> {
  try {
    const raw = await readFile(traceFilePath(projectPath), 'utf-8');
    const entries: TraceEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as TraceEntry);
      } catch {
        // 跳过坏行
      }
    }
    return limit > 0 ? entries.slice(-limit) : entries;
  } catch {
    return [];
  }
}

