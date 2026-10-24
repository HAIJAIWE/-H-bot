/**
 * 确定性工具结果剪枝的配置解析。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 *   packages/compaction/compaction-tool-result-pruner/src/config.ts
 *   https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：上游的 `deepFreeze` 来自 `@deepseek-ai/dsh-util-values`，这里换成本文件里
 * 一个十几行的等价实现（同一个语义：递归 `Object.freeze`），避免为一个小工具引入整个包。
 */

import type { ResolvedConfig, ToolResultPruneConfig } from './types'

/** 被剪掉的中间段统一替换成这个标记。 */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

/** coding agent 的工具输出默认预算（低摩擦档）。 */
export const DEFAULTS: ResolvedConfig = deepFreeze({
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
})

const CONFIG_KEYS: ReadonlySet<string> = new Set(['thresholdChars', 'headChars', 'tailChars'])

/**
 * 数 Unicode code point 数，不劈代理对。
 * @param text - 要数的文本
 * @returns code point 数
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * 校验并解析剪枝预算。
 * @param config - 原始插件配置
 * @returns 与之脱离、深度冻结的配置
 */
export function resolveConfig(config: ToolResultPruneConfig = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `ToolResultPruneConfig: unknown key "${key}" ` +
          '(allowed: thresholdChars, headChars, tailChars)',
      )
    }
  }

  const resolved: ResolvedConfig = {
    thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
    headChars: config.headChars ?? DEFAULTS.headChars,
    tailChars: config.tailChars ?? DEFAULTS.tailChars,
  }
  assertPositiveInteger('thresholdChars', resolved.thresholdChars)
  assertNonNegativeInteger('headChars', resolved.headChars)
  assertNonNegativeInteger('tailChars', resolved.tailChars)

  const emittedChars = resolved.headChars + codePointLength(PRUNE_MARKER) + resolved.tailChars
  if (emittedChars > resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: headChars + marker + tailChars (${emittedChars}) ` +
        `must be at most thresholdChars (${resolved.thresholdChars})`,
    )
  }
  return deepFreeze(structuredClone(resolved))
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a positive integer`)
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a non-negative integer`)
  }
}

/**
 * 递归冻结（上游 `deepFreeze` 的等价实现，只够本文件用）。
 * @param value - 要冻结的值
 * @returns 同一个值
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}
