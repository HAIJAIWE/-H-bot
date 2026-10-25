// src/main/vendor/dsh/output-retention/index.ts
//
// @license MIT
// @copyright Copyright (c) 2026 DeepSeek
// @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
// @upstream packages/util/output-retention/src/index.ts
// @upstream https://github.com/deepseek-ai/deepseek-harness
//
// 本仓库改动（2026-10-25）：
//  1. 只取两个 retainer 的机械算法（ItemRetainer / TextRetainer）与它们的类型；
//     上游同文件的"省略提示文案"三个导出没有搬（把 "Omitted N items" 这类英文
//     写死在库里），因为本项目工具回执是中文，提示由调用方写（见 toolRetention.ts）。
//  2. 因此也删掉了只有文案层使用的 RetentionNotice 类型。
//  3. 其余逐字保留：UTF-8 边界裁剪（trimTrailingPartialUtf8 /
//     trimLeadingContinuationUtf8）、suffix 只留窗口的滑动逻辑、finish() 的
//     "按实际返回的字节报告省略量"，以及上游全部注释。
//
// 上游对定位的说明仍然成立：这是**库**，不是 cordis 插件 —— 不收 ctx、不注册、
// 不发事件；两个 retainer 是唯一有状态的部分，状态属于实例，不跨调用。

export type Omitted = { kind: 'none' } | { kind: 'exact'; count: number } | { kind: 'unknown' }

/**
 * The caller receives this after each `push()`.
 */
export interface PushDecision {
  /** Was this whole unit / all of this chunk's bytes retained (nothing dropped)? */
  kept: boolean
  /** Cumulative: has the retainer omitted anything due to the budget yet? */
  truncated: boolean
}

/**
 * Final result for ordered logical units.
 *
 * `seen` means units OBSERVED by the retainer, not necessarily the total in the
 * upstream source. `kept` is `items.length`, surfaced explicitly so a notice
 * formatter need not re-count.
 */
export interface RetainedItems<T> {
  items: T[]
  truncated: boolean
  seen: number
  kept: number
  omitted: Omitted
}

/**
 * Final result for text streams.
 *
 * The returned `text` is safe to hand to a formatter: the retainer adds no
 * tool-specific headers, exit markers, XML tags, or recovery instructions, and
 * `omittedBytes` counts BYTES (not characters or lines) — text retention is
 * byte-oriented for process/body safety. UTF-8 boundaries at each cut are
 * preserved, so `text` never carries a replacement char introduced by the cut
 * itself.
 */
export interface RetainedText {
  text: string
  truncated: boolean
  omittedBytes: Omitted
}

/** Item retention strategy. Only `head` in v1; windows/grouped budgets wait for a second consumer. */
export type ItemRetentionStrategy = {
  /** Keep the first `maxItems` units. Use for `glob`, `grep`, and web sources. */
  kind: 'head'
  maxItems: number
}

/** Text retention strategy: keep a prefix, a suffix, or both, counted in bytes. */
export type TextRetentionStrategy =
  | {
      /** Keep the first `maxBytes` bytes. */
      kind: 'head'
      maxBytes: number
    }
  | {
      /** Keep the final `maxBytes` bytes. Requires reading to the end. */
      kind: 'tail'
      maxBytes: number
    }
  | {
      /** Keep a stable prefix and suffix, omitting the middle. Requires reading to the end. */
      kind: 'headTail'
      headBytes: number
      tailBytes: number
    }

/**
 * A neutral, tool-agnostic description of one retention outcome — the input to
 * {@link formatRetentionNotice}. It carries the mechanical facts (strategy,
 * unit, limit, kept count, {@link Omitted}); the tool supplies the recovery
 * words, because only the tool knows the recovery action ("narrow the pattern",
 * "fetch a more specific URL", "read the spill file").
 */

/** Assert a budget field is a non-negative integer (the retainer request contract). */
function assertBudget(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}

/**
 * Bounds an ordered stream of logical units, keeping the first `maxItems`
 * ({@link ItemRetentionStrategy} `head`). `push()` reports, per unit, whether it
 * was kept and whether the retained result is now truncated.
 *
 * Grouping, sorting, path mapping, per-unit preview truncation, and any
 * `incomplete` state stay OUTSIDE the retainer: it counts and keeps, nothing
 * more. The caller pushes prepared logical units and, after {@link finish},
 * groups/sorts the retained subset itself.
 */
export class ItemRetainer<T> {
  private readonly maxItems: number
  private readonly items: T[] = []
  private seen = 0
  private omittedCount = 0

  /** @param strategy Head strategy: `maxItems` (non-negative integer). */
  constructor(strategy: ItemRetentionStrategy) {
    assertBudget(strategy.maxItems, 'maxItems')
    this.maxItems = strategy.maxItems
  }

  /**
   * Offer one unit. Kept when the retainer is below `maxItems`; otherwise dropped
   * and counted as omitted. Callers keep pushing all observed units, so the final
   * {@link Omitted} count is exact.
   *
   * @param item The prepared logical unit (path, flat match, source).
   * @returns The per-push {@link PushDecision}.
   */
  push(item: T): PushDecision {
    this.seen++
    if (this.items.length < this.maxItems) {
      // Reached only below the cap, before any omission (items only grow, the
      // cap is fixed), so nothing has been dropped yet: truncated is always false.
      this.items.push(item)
      return { kept: true, truncated: false }
    }
    this.omittedCount++
    return {
      kept: false,
      truncated: true,
    }
  }

  /**
   * Finalize and report what was kept and omitted.
   *
   * @returns The {@link RetainedItems} snapshot (safe to group/sort downstream).
   */
  finish(): RetainedItems<T> {
    const truncated = this.omittedCount > 0
    return {
      items: this.items,
      truncated,
      seen: this.seen,
      kept: this.items.length,
      omitted: truncated ? { kind: 'exact', count: this.omittedCount } : { kind: 'none' },
    }
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder() // utf-8, non-fatal: internal malformed bytes → U+FFFD

/**
 * Drop a trailing incomplete UTF-8 sequence so a prefix cut never emits a
 * replacement char at the boundary. Walks back over continuation bytes
 * (`10xxxxxx`) to the lead byte; if fewer bytes follow it than the lead byte's
 * length declares, the sequence is incomplete and is trimmed. A complete tail,
 * or a run too long/short to be a valid lead, is returned untouched (any
 * genuinely malformed interior is left for the decoder to replace).
 */
function trimTrailingPartialUtf8(bytes: Uint8Array): Uint8Array {
  let i = bytes.length - 1
  // Continuation bytes are 0b10xxxxxx; scan back at most 3 (max sequence is 4).
  // Indices are bounds-checked by the loop guard, so the reads are in range.
  while (i >= 0 && ((bytes[i] as number) & 0xc0) === 0x80 && bytes.length - i <= 3) i--
  if (i < 0) return bytes
  const lead = bytes[i] as number
  const expected = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf8 ? 4 : 0
  // expected 0 → not a lead byte (stray continuation / invalid): leave it.
  if (expected === 0) return bytes
  return bytes.length - i < expected ? bytes.subarray(0, i) : bytes
}

/**
 * Drop leading continuation bytes (`10xxxxxx`) so a suffix cut starts on a
 * lead/ASCII byte instead of mid-codepoint.
 */
function trimLeadingContinuationUtf8(bytes: Uint8Array): Uint8Array {
  let i = 0
  // i < length guards the read.
  while (i < bytes.length && ((bytes[i] as number) & 0xc0) === 0x80) i++
  return bytes.subarray(i)
}

/**
 * Bounds a byte-oriented text stream, keeping a prefix, a suffix, or both
 * ({@link TextRetentionStrategy}). All three strategies share one prefix/suffix
 * accumulator: `head` is prefix-only, `tail` is suffix-only, `headTail` is both.
 *
 * Bytes, not characters: caps and `omittedBytes` are byte counts for process/
 * body safety. Chunks that straddle a codepoint are handled — {@link finish}
 * trims a partial codepoint at each cut so the returned text never introduces a
 * replacement char at the boundary. The retainer holds at most
 * `prefixCap + tailBytes + one chunk` in memory (old suffix chunks are dropped
 * as they slide out), so a large stream does not accumulate unbounded.
 */
export class TextRetainer {
  private readonly prefixCap: number
  private readonly suffixCap: number
  private readonly prefixChunks: Uint8Array[] = []
  private prefixHeld = 0
  private readonly suffixChunks: Uint8Array[] = []
  private suffixHeld = 0
  private total = 0

  /** @param strategy One {@link TextRetentionStrategy} variant; byte budgets must be non-negative integers. */
  constructor(strategy: TextRetentionStrategy) {
    switch (strategy.kind) {
      case 'head':
        assertBudget(strategy.maxBytes, 'maxBytes')
        this.prefixCap = strategy.maxBytes
        this.suffixCap = 0
        break
      case 'tail':
        assertBudget(strategy.maxBytes, 'maxBytes')
        this.prefixCap = 0
        this.suffixCap = strategy.maxBytes
        break
      case 'headTail':
        assertBudget(strategy.headBytes, 'headBytes')
        assertBudget(strategy.tailBytes, 'tailBytes')
        this.prefixCap = strategy.headBytes
        this.suffixCap = strategy.tailBytes
        break
    }
  }

  /**
   * Offer one chunk (a `Uint8Array`, or a `string` encoded as UTF-8). Prefix
   * bytes fill up to the prefix cap then stop; suffix bytes roll so only the
   * last `suffixCap` bytes are retained. `kept` is `true` only when no byte of
   * this chunk was dropped.
   *
   * @param chunk The next bytes of the stream (`Uint8Array` or UTF-8 `string`).
   * @returns The per-push {@link PushDecision}.
   */
  push(chunk: Uint8Array | string): PushDecision {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    const before = this.total
    this.total += bytes.length

    // Prefix: take only up to the cap; the rest of this chunk is "not prefixed".
    const room = this.prefixCap - this.prefixHeld
    const take = Math.max(0, Math.min(room, bytes.length))
    if (take > 0) {
      this.prefixChunks.push(bytes.subarray(0, take))
      this.prefixHeld += take
    }

    // Suffix: append the whole chunk, then drop whole leading chunks that have
    // fully slid out of the last `suffixCap` bytes (bounded memory).
    if (this.suffixCap > 0) {
      this.suffixChunks.push(bytes)
      this.suffixHeld += bytes.length
      let head = this.suffixChunks[0]
      while (head !== undefined && this.suffixHeld - head.length >= this.suffixCap) {
        this.suffixChunks.shift()
        this.suffixHeld -= head.length
        head = this.suffixChunks[0]
      }
      // The head chunk can still hold leading bytes beyond the last `suffixCap`
      // — a single chunk LARGER than the window is retained whole by the loop
      // above (dropping the only chunk would leave < cap). Trim those leading
      // bytes so the accumulator (and finish()'s concat) stays bounded by
      // `suffixCap` instead of allocating/copying the full chunk again;
      // finish() only ever reads the last `suffixLen ≤ suffixCap` bytes, so this
      // drops nothing it would return. (head.length > excess by the loop
      // invariant `suffixHeld - head.length < suffixCap`, so the slice is non-empty.)
      if (head !== undefined && this.suffixHeld > this.suffixCap) {
        const excess = this.suffixHeld - this.suffixCap
        this.suffixChunks[0] = head.subarray(excess)
        this.suffixHeld -= excess
      }
    }

    // Dropped = bytes that no side can keep. Compute cumulative omission the
    // SAME way finish() does (via omittedAt), so push and finish never disagree;
    // per-push we only need whether THIS chunk pushed the total past what the
    // two caps hold.
    const droppedThisChunk = this.omittedAt(this.total) > this.omittedAt(before)
    return {
      kept: !droppedThisChunk,
      truncated: this.omittedAt(this.total) > 0,
    }
  }

  /** Bytes omitted once `total` bytes have been seen: `total − keptPrefix − keptSuffix`. */
  private omittedAt(total: number): number {
    const prefixLen = Math.min(total, this.prefixCap)
    const suffixLen = Math.min(total - prefixLen, this.suffixCap)
    return total - prefixLen - suffixLen
  }

  /**
   * Finalize: decode the retained prefix and suffix (each trimmed to a UTF-8
   * boundary at its cut) and report the exact omitted byte count.
   *
   * @returns The {@link RetainedText} snapshot (safe to hand to a formatter).
   */
  finish(): RetainedText {
    const prefixLen = Math.min(this.total, this.prefixCap)
    const suffixLen = Math.min(this.total - prefixLen, this.suffixCap)

    const prefix = concat(this.prefixChunks) // exactly prefixLen bytes (prefixHeld === prefixLen)
    const suffix = concat(this.suffixChunks).subarray(this.suffixHeld - suffixLen)

    // With nothing omitted by budget, prefix and suffix are ADJACENT slices of
    // one stream (prefixLen + suffixLen === total), so the head|tail split is
    // artificial: a codepoint may span it. Decode the contiguous whole as one
    // buffer — trimming or decoding the halves separately here would corrupt a
    // boundary-spanning codepoint though no content was dropped. Only a real
    // omitted gap makes each side a true cut: trim each to a UTF-8 boundary and
    // decode separately so a codepoint is never reconstructed across the gap.
    const budgetOmitted = this.omittedAt(this.total)
    const [keptPrefix, keptSuffix] =
      budgetOmitted > 0
        ? [trimTrailingPartialUtf8(prefix), trimLeadingContinuationUtf8(suffix)]
        : [prefix, suffix]
    const text =
      budgetOmitted > 0
        ? decoder.decode(keptPrefix) + decoder.decode(keptSuffix)
        : decoder.decode(concat([prefix, suffix]))

    // Report omission against the bytes ACTUALLY returned, not the pre-trim
    // budget: a boundary trim drops partial-codepoint bytes too, so an exact
    // count derived from the budget alone would overstate the retained text (and
    // any "Omitted N bytes" notice built from it would be a lie).
    const omitted = this.total - keptPrefix.length - keptSuffix.length
    const truncated = omitted > 0

    return {
      text,
      truncated,
      omittedBytes: truncated ? { kind: 'exact', count: omitted } : { kind: 'none' },
    }
  }
}

/** Concatenate chunks into one contiguous buffer (their exact total length). */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
