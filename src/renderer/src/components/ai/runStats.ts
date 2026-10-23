// src/renderer/src/components/ai/runStats.ts
//
// 状态条（`ChatPanel` 顶部那行）的**纯格式化**逻辑。
//
// 为什么单拎出来：这行数字最容易骗人 —— 一旦把本地估算写成"用量"、或把没有的用量
// 显示成 0，用户就会拿它当账看。所以判据放在这里，用单测一条条钉住：
//   · 轮 / 步：来自我们自己的循环，**永远真实**；
//   · tok / tok/s / 缓存命中：**只有厂商回传了 `usageReported` 才显示**，否则是 null（界面显示占位）；
//   · 上下文占用：**本地估算**，所以单独一个字段、单独一个图标，不与厂商口径混在一起。
import type { AiRunStats } from '@shared/types/ai';

export interface RunStatsView {
  rounds: number;
  steps: number;
  /** 输出速度（输出 token / 模型耗时秒）；拿不到用量时 null */
  tokPerSec: number | null;
  /** 本次运行累计 token（输入 + 输出）；拿不到用量时 null */
  totalTokens: number | null;
  /** 缓存命中率 %：命中 / 输入；没报缓存时 null */
  cacheHitPercent: number | null;
  /** 上下文占用 %：**本地估算** / 预算 */
  contextPercent: number | null;
}

/** 大数压成 12.3k / 1.2M（状态条只有一行，不铺开写） */
export function compactTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = (n / 1000).toFixed(1).replace(/\.0$/, '');
    return k + 'k';
  }
  const m = (n / 1_000_000).toFixed(1).replace(/\.0$/, '');
  return m + 'M';
}

export function formatRunStats(stats?: AiRunStats | null): RunStatsView | null {
  if (!stats) return null;
  const hasUsage = stats.usageReported && stats.promptTokens + stats.completionTokens > 0;
  const seconds = stats.llmMs / 1000;
  const tokPerSec =
    hasUsage && seconds > 0.5 ? Math.max(0, Math.round(stats.completionTokens / seconds)) : null;
  const totalTokens = hasUsage ? stats.promptTokens + stats.completionTokens : null;
  const cacheHitPercent =
    hasUsage && stats.cachedTokens > 0 && stats.promptTokens > 0
      ? Math.min(100, Math.round((stats.cachedTokens / stats.promptTokens) * 100))
      : null;
  const contextPercent =
    stats.contextBudget > 0
      ? Math.min(100, Math.max(0, Math.round((stats.contextTokens / stats.contextBudget) * 100)))
      : null;
  return {
    rounds: stats.rounds,
    steps: stats.steps,
    tokPerSec,
    totalTokens,
    cacheHitPercent,
    contextPercent,
  };
}
