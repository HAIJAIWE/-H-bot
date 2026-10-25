/**
 * 连续重复工具调用检测（纯算法）。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 * @upstream packages/guard/repeat-tool-reminder/src/index.ts
 * @upstream https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：只取纯算法（规范化参数 / 通配符 / 阈值校验 / 两段提醒文案 / 链计数），
 * 去掉 Cordis 的 `apply` + `ctx.on('tools/post-execute')` + `createUserMessage` + schemastery 配置；
 * 计数链由调用方持有（我们按「一次循环运行」一条链），阈值配置由调用方传对象。
 */

/** 连续重复到这些次数就提醒（上游默认 [3, 5, 8]：先温和、后点名）。 */
export const DEFAULT_REPEAT_THRESHOLDS: readonly number[] = [3, 5, 8]

/** 提醒里引用参数的字符上限（只约束模型可见文本，检测永远比完整字符串）。 */
export const DEFAULT_ARGUMENTS_PREVIEW_CHARS = 500

/** 第一次命中阈值时的温和提醒。 */
export const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. ' +
  'Carefully analyze the previous result before calling again: if the task is ' +
  'not complete, try a different approach or different arguments instead of ' +
  'repeating the call.'

/** 之后命中阈值时的点名提醒：工具名、连续次数、规范化参数。 */
export function detailedReminder(
  toolName: string,
  count: number,
  canonicalArguments: string,
): string {
  return (
    'Repeated tool call detected:\n' +
    `- tool: ${toolName}\n` +
    `- consecutive_calls: ${count}\n` +
    `- arguments: ${canonicalArguments}\n` +
    'The repeated calls are not making progress. Do not call this tool with ' +
    'these exact arguments again. Inspect the latest result and choose a ' +
    'different action, different arguments, or finish the task if enough ' +
    'evidence has been gathered.'
  )
}

/** 深键排序：只差属性顺序的两个参数对象要规范化成同一个字符串。 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** 调用的规范字符串：深键排序后 stringify（模型给的参数是无序对象）。 */
export function canonicalizeArguments(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** 把 `*` 通配符编译成锚定正则（其余正则元字符按字面匹配）。 */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/** 头部截断规范化参数，并标出省略了多少字符。 */
export function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * 校验阈值并按升序返回（上台阶规则读 `thresholds[0]` 作为温和档，顺序在这里归一）。
 * 非法配置直接抛错 —— 不静默回退。
 */
export function validateThresholds(values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(
        `repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`,
      )
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}
