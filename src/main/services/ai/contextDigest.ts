// src/main/services/ai/contextDigest.ts
//
// **被预算裁掉的历史的确定性摘要**（2026-10-19）。
//
// 现状：`historyToMessages` 按 token 预算留尾部，被丢掉的只由 `describeDropped` 告诉模型
// "有 N 条更早的对话被省略了" —— 模型知道"有",但不知道"是什么"。长任务里它就会重复问
// 已经答过的事（"你上次让我改的哪个文件？"）。
//
// 这里做**确定性摘要**（不调模型）：从被裁掉的条目里提炼"用户要求 + 助手结论"的首句，
// 有上限、可预测、零幻觉。真正的语义摘要（再调一次模型）留到以后，理由：
//   · 成本/延迟在每一轮都要付；
//   · 摘要本身会漂（同一段历史两次摘要不一致），排障时反而添乱。
import type { HistoryEntry } from './historyStore';

const MAX_LINE_CHARS = 90;
const MAX_TOTAL_CHARS = 1200;

function oneLine(text: string, max: number): string {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/**
 * @param entries 全量历史（含 attempt）
 * @param kept 预算内保留的那部分（同一个对象引用）
 * @returns 拼在历史注记里的摘要；没有可摘要内容时返回空串
 */
export function digestDroppedHistory(
  entries: readonly HistoryEntry[],
  kept: readonly HistoryEntry[],
): string {
  const keptSet = new Set(kept);
  const dropped = entries.filter((e) => e.role !== 'attempt' && !keptSet.has(e));
  // 只有一条消息时注记里的"N 条省略"已经够了；至少一对问答才值得摘要
  if (dropped.length < 2) return '';

  const lines: string[] = [];
  let used = 0;
  let cut = false;
  for (const entry of dropped) {
    const who = entry.role === 'user' ? '用户' : '助手';
    const line = '- ' + who + '：' + oneLine(entry.content, MAX_LINE_CHARS);
    if (used + line.length + 1 > MAX_TOTAL_CHARS) {
      cut = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (cut) lines.push('- …（更早的内容继续省略）');
  return ['【更早的对话（自动压缩，摘要非原文）】', ...lines].join('\n');
}

/**
 * 语义摘要的开关：`QQBAT_CONTEXT_SUMMARY=model` 才算开。
 *
 * 默认仍是确定性摘要（不调模型）—— 不是"没做完"，而是**成本与稳定性**的选择：
 * 每一轮都要付延迟和 token，且摘要会漂（排障时两条摘要对不上更糟）。
 * 要试语义摘要的用户自己打开环境变量，出事可以立刻关回去。
 */
export const MODEL_SUMMARY_ENV = 'QQBAT_CONTEXT_SUMMARY';

/** 摘要器接口：只要求"给一段 prompt 回一段文本"，方便测试注入假实现 */
export interface DigestLlm {
  summarize(prompt: string): Promise<string>;
}

/** 被裁掉、值得摘要的那些条目（attempt 是工具尝试记录，不进摘要） */
function droppedForDigest(
  entries: readonly HistoryEntry[],
  kept: readonly HistoryEntry[],
): HistoryEntry[] {
  const keptSet = new Set(kept);
  return entries.filter((e) => e.role !== 'attempt' && !keptSet.has(e));
}

/**
 * 给模型看的摘要请求。
 *
 * 明确三件事：**只保留事实**（用户要求、已定结论、改过的文件）、**不要客套**、
 * **不要猜**（原文没有的就写"未提及"）—— 这段是塞回上下文的，编造比省略更危险。
 */
export function buildDigestPrompt(dropped: readonly HistoryEntry[]): string {
  const lines = dropped.map((e) => {
    const who = e.role === 'user' ? '用户' : '助手';
    return who + '：' + oneLine(e.content, 400);
  });
  return [
    '下面是一段被上下文预算裁掉的对话历史。请压缩成给同一助手看的备忘录。',
    '要求：',
    '1. 只保留用户的要求、已达成的结论、改过/读过的文件与关键数值；',
    '2. 用简洁的条目，不要客套、不要重复原文；',
    '3. 原文没提到的事不要猜，宁可省略；',
    '4. 总长不超过 800 字。',
    '',
    '【对话】',
    ...lines,
  ].join('\n');
}

/**
 * 把"被裁掉的历史"变成一段注记。
 *
 * - 没给 `llm`（默认）：确定性摘要，零成本零幻觉；
 * - 给了 `llm`：先试语义摘要，**失败/空结果一律退回确定性摘要** —— 压缩是每轮都要走的路，
 *   模型服务抖一下不能让整轮对话报错。
 */
export async function summarizeDroppedHistory(
  entries: readonly HistoryEntry[],
  kept: readonly HistoryEntry[],
  llm?: DigestLlm,
): Promise<string> {
  const deterministic = digestDroppedHistory(entries, kept);
  if (!llm) return deterministic;
  const dropped = droppedForDigest(entries, kept);
  if (dropped.length < 2) return deterministic;
  try {
    const summary = (await llm.summarize(buildDigestPrompt(dropped))).trim();
    if (!summary) return deterministic;
    return '【更早的对话（模型摘要，非原文）】\n' + summary;
  } catch {
    return deterministic;
  }
}
