/**
 * 字符计量：把文本折算成「按 4 个字符 1 token」计价时可用的字符数。
 *
 * 上游 `estimate.ts` 直接用 `text.length / 4`：英文够用，中文会把「已经 80k 了」
 * 算成「才 20k」（一个汉字在 UTF-16 里就是 1 个单位），压到一半才发现爆了。
 *
 * 本仓库沿用旧 `estimateTokens` 的口径：ASCII 记 1、其余字符记 4 —— 与
 * `CHARS_PER_TOKEN = 4` 相乘后等价于「宽字符 1 字符 = 1 token」，同一段中文
 * 改走上游算法后数字不变。
 *
 * 这是**本仓库适配层**，不是上游文件（见同目录 README 的「本仓库适配层」）。
 *
 * @param text - 要计量的文本
 * @returns 折算后的字符数（不是 token 数）
 */
export function measureChars(text: string): number {
  let units = 0
  for (const ch of text) {
    units += (ch.codePointAt(0) ?? 0) < 0x80 ? 1 : 4
  }
  return units
}
