// src/main/services/agent-core/contextOverflow.ts
//
// **厂商已经报"上下文超了"之后的救火**（2026-10-26，对齐 DSH `compaction-basic` 的
// `context-overflow` 触发）。
//
// 为什么不能只靠 `thresholdRatio`：预算与厂商的真实窗口不是同一个数（我们按 4 字符 1 token
// 保守估，厂商按自己的 tokenizer 算），再加上系统提示、工具 schema、图片这些"不在估算里"
// 的固定开销，本地估算低于阈值、厂商仍然可能回 400。这时再走一遍"保留尾部 + 摘要"的
// 压力策略已经晚了 —— 只能把中段几乎全压掉，再赌一次请求。
//
// 三条纪律：
// 1. **只认溢出**：400/413/422 且正文像上下文超限；429、500、网络错误原样抛，不拿压缩当万灵药。
// 2. **一次**：调用方（core.ts）只重试一次；救火后仍 400 就把原错误交给上层（界面会看到原因）。
// 3. **没变化就不重试**：`applyCompaction(..., 'overflow')` 什么都没改时返回 null，
//    调用方据此保留**原始** 400 的报错 —— "压缩失败"不该盖掉"上下文超了"这个真因。

import type { ChatTurn } from './core'
import { applyCompaction, type CompactionOptions, type CompactionOutcome } from './contextGate'

/**
 * 各家 400 正文的常见说法（中英各留几条）。
 *
 * 不追求穷举 —— 认不出来时上层照旧报错，只是少了自动救火；认错了去压一次也无害
 * （压缩本身幂等，压不动就返回 null）。
 */
const OVERFLOW_TEXT =
  /context[_ -]?(length|window)|maximum context|too many (input )?tokens|token (count|limit)[^。\n]{0,20}(exceed|too (many|large))|prompt (is )?too long|input (is )?too long|reduce the length|上下文(长度|窗口)|超出[^。\n]{0,12}(上下文|token|令牌)|(上下文|输入)[^。\n]{0,10}(过长|太长|超限)/i

/** 这些状态码才可能是"请求太大"；429/5xx 有别的恢复路径（重试/退避） */
const OVERFLOW_STATUS = new Set([400, 413, 422])

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error ?? '')
}

/**
 * 这个错误是不是"厂商嫌上下文太大"。
 *
 * 带了 `status` 的（ProviderHttpError）先按状态码筛；没有状态码的普通 Error
 * 只能看正文 —— 测试里的假 provider、以及个别把状态码丢掉的适配层都会走这条。
 */
export function isContextOverflowError(error: unknown): boolean {
  if (error === null || error === undefined) return false
  const status = (error as { status?: unknown }).status
  if (typeof status === 'number' && !OVERFLOW_STATUS.has(status)) return false
  return OVERFLOW_TEXT.test(messageOf(error))
}

/**
 * 把当前 messages 压到"只留最后一条"（工具配对由 `retreatToBalancedCut` 兜着）。
 *
 * 返回 null = 没有任何变化（没配压缩 / 没得压 / 剪与压都不划算），调用方应保留原错误。
 */
export async function compactForContextOverflow(
  messages: ChatTurn[],
  opts?: CompactionOptions,
): Promise<CompactionOutcome | null> {
  return applyCompaction(messages, opts, 'overflow')
}
