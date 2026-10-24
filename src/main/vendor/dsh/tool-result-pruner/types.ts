/**
 * 确定性工具结果剪枝的配置类型。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 *   packages/compaction/compaction-tool-result-pruner/src/types.ts
 *   https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：删掉 `PrunedEntry` / `PruneResult` —— 它们绑 `SessionSeq` / `ToolCallId`，
 * 而本仓库不搬 `pruneSession()`（要上游的 Session 与 shadow-price 协议）。
 */

/** 确定性工具结果剪枝的字符预算策略。 */
export interface ToolResultPruneConfig {
  /** 文本总长超过多少个 Unicode code point 才剪。默认 `8192`。 */
  thresholdChars?: number
  /** 最多保留多少个头部 code point。默认 `4096`。 */
  headChars?: number
  /** 最多保留多少个尾部 code point。默认 `1024`。 */
  tailChars?: number
}

/** 校验过、与调用方脱离、深度冻结的配置。 */
export interface ResolvedConfig {
  readonly thresholdChars: number
  readonly headChars: number
  readonly tailChars: number
}
