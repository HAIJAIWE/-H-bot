// src/main/services/ai/rag.ts
//
// **长期记忆（向量检索）** —— 2026-10-18，默认关。
//
// ## 只做一件确定的事
//
// 把**过去成功的对话轮次**（用户需求 + 最终答复）向量化，下次需求进来时检索 top-k
// 相似轮次，作为"相关历史"注入上下文 —— 只注入**文本**，不注入工具调用/提案。
//
// ## 为什么默认关
//
// 1. 每次写入/检索都要调嵌入模型（成本 + 延迟）；
// 2. 检索错的东西比没有更糟（会诱导模型照抄旧方案）。
// 所以先做成**可验证的开关**（QQBAT_RAG=1），跑一段时间看命中率再谈默认。
//
// ## 存储
//
// .qqbat/memory/vectors.jsonl：一行一条 {ts, text, vector}。
// 阈值 + top-k 都在这里，不做"智能重排"——确定性优先。
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { providerRegistry } from '@shared/types/ai-provider';
import { logger } from '../infra/logger';
import { resolveAuthorAiConfig } from './appAiConfig';
import { appendTrace } from './trace';

export const RAG_ENV = 'QQBAT_RAG';

export function isRagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RAG_ENV] === '1';
}

export interface MemoryRecord {
  ts: string;
  text: string;
  vector: number[];
}

export function memoryFilePath(projectPath: string): string {
  return join(projectPath, '.qqbat', 'memory', 'vectors.jsonl');
}

/** 余弦相似度；任一向量为空/维度不同 ⇒ 0（不猜） */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function appendMemory(
  projectPath: string,
  record: MemoryRecord,
): Promise<void> {
  try {
    const file = memoryFilePath(projectPath);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(record) + '\n', 'utf-8');
  } catch (e) {
    logger.warn('[rag] 写记忆失败（不影响对话）:', e);
  }
}

export async function loadMemory(projectPath: string): Promise<MemoryRecord[]> {
  try {
    const file = memoryFilePath(projectPath);
    if (!existsSync(file)) return [];
    const raw = await readFile(file, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as MemoryRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is MemoryRecord => !!r && Array.isArray(r.vector) && typeof r.text === 'string');
  } catch {
    return [];
  }
}

export interface RetrievedMemory {
  text: string;
  score: number;
}

/**
 * 检索 top-k（阈值过滤）。**纯函数式**：向量由调用方给，便于测试。
 */
export function rankBySimilarity(
  query: readonly number[],
  records: readonly MemoryRecord[],
  opts: { topK?: number; minScore?: number } = {},
): RetrievedMemory[] {
  const topK = opts.topK ?? 3;
  const minScore = opts.minScore ?? 0.72;
  return records
    .map((r) => ({ text: r.text, score: cosine(query, r.vector) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** 渲染成上下文（**要短**：它会挤占真正的任务上下文） */
export function renderRetrieved(hits: readonly RetrievedMemory[]): string {
  if (hits.length === 0) return '';
  return [
    '【相关历史（向量检索，仅供参考）】',
    ...hits.map((h, i) => `${i + 1}. （相似度 ${h.score.toFixed(2)}）${h.text}`),
    '注意：这些是**过去**的需求与结论，可能已过时；以当前项目事实为准。',
  ].join('\n');
}

/**
 * 作者侧嵌入器（用**作者助手那份配置**，与机器人侧的 embedText 分开）。
 * 没配模型 / provider 不支持嵌入 ⇒ null（调用方退回无记忆）。
 */
export async function authorEmbedder(
  projectPath: string,
): Promise<((text: string) => Promise<number[]>) | null> {
  const cfg = await resolveAuthorAiConfig(projectPath);
  if (!cfg) return null;
  try {
    const provider = providerRegistry.getOrCreate(cfg.provider, {
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      model: cfg.model,
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
    });
    return async (text: string) => {
      try {
        const vector = await provider.embed(text);
        return Array.isArray(vector) ? vector : [];
      } catch {
        return [];
      }
    };
  } catch {
    return null;
  }
}

/**
 * 写一轮记忆（用调用方给的 embedder，便于测试与复用作者的 provider）。
 * embed 失败/空向量 ⇒ 不写（宁可不记，也不记一条 0 向量污染检索）。
 */
export async function recordTurnMemory(input: {
  projectPath: string;
  userText: string;
  assistantText: string;
  embed: (text: string) => Promise<number[]>;
  maxChars?: number;
}): Promise<boolean> {
  const maxChars = input.maxChars ?? 800;
  const text = `用户：${input.userText.slice(0, maxChars)}\n结论：${input.assistantText.slice(0, maxChars)}`;
  try {
    const vector = await input.embed(text);
    if (!vector || vector.length === 0) return false;
    await appendMemory(input.projectPath, { ts: new Date().toISOString(), text, vector });
    return true;
  } catch (e) {
    logger.warn('[rag] 记忆向量化失败（跳过本条）:', e);
    return false;
  }
}

/**
 * 检索这一轮相关的历史。
 */
export async function retrieveMemories(input: {
  projectPath: string;
  query: string;
  embed: (text: string) => Promise<number[]>;
  topK?: number;
  minScore?: number;
}): Promise<RetrievedMemory[]> {
  try {
    const records = await loadMemory(input.projectPath);
    if (records.length === 0) return [];
    const vector = await input.embed(input.query);
    if (!vector || vector.length === 0) return [];
    const hits = rankBySimilarity(vector, records, {
      topK: input.topK ?? 3,
      minScore: input.minScore ?? 0.72,
    });
    /**
     * **命中率统计**（2026-10-18）：每次检索写一行 trace。
     * 目的不是好看，是决定 RAG 要不要默认开 —— 没有这行数据就是拍脑袋。
     */
    void appendTrace(input.projectPath, {
      ts: new Date().toISOString(),
      kind: 'tool',
      name: 'rag',
      ms: 0,
      ok: hits.length > 0,
      inChars: String(input.query ?? '').length,
      outChars: hits.reduce((n, h) => n + h.text.length, 0),
      note: ['hits=', String(hits.length), ' top=', ((hits[0]?.score ?? 0).toFixed(2)), ' pool=', String(records.length)].join(''),
    });
    return hits;
  } catch (e) {
    logger.warn('[rag] 检索失败（当没有历史）:', e);
    return [];
  }
}
