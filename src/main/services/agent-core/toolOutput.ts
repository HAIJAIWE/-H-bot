// src/main/services/agent-core/toolOutput.ts
//
// **工具结果给模型看多少**：从 core.ts 拆出来的（2026-10-24）。两条规则咬在一起 ——
// 单条输出上限（`clampToolOutput`）与"超了先落盘再给节选"（`modelFacingOutput`）。
// 拆出来的理由：core.ts 已经是循环 + 工具表 + 文件遍历的大杂烩，而这一块是**策略**，
// 与循环控制无关；它也是本仓库被反复审的那条纪律（§12.1 / DSH spill-policy）的落点。

/**
 * 单个工具结果回灌给模型的默认字符上限（≈8k token）。
 *
 * 读一个 3000 行的文件 ≈ 100k 字符 ≈ 30k token，一次 `read_file` 就能把上下文撑爆；
 * 模型的反应不是"报错"，是**开始胡说 + 忘掉前面的约束**（助手链路的 tokenBudget 早做过，
 * 循环这一版此前是裸的）。保留**头尾**而不是只留头：文件末尾常常是"导出了什么"，
 * 只留头会让模型以为文件里没有它；省略了多少字要明写，它才知道自己看的是节选。
 */
export const MAX_TOOL_OUTPUT_CHARS = 24_000

/** 超长工具结果：保头尾，中间写清省略了多少字符 */
export function clampToolOutput(
  output: string,
  limit = MAX_TOOL_OUTPUT_CHARS,
  /** 完整内容的落盘路径（spill 成功时才有）；没给就如实说"没保存" */
  locator?: string,
): string {
  if (output.length <= limit) return output
  const head = Math.floor(limit * 0.6)
  const tail = limit - head
  const omitted = output.length - limit
  const howTo = locator
    ? '完整内容已存到 ' +
      locator +
      '；要看别处就用 search_text 在那份文件里搜关键词，或分段 read_file。'
    : '完整内容没有保存（这次没有可用的溢出存储），需要的话请用更小的范围重读。'
  return (
    output.slice(0, head) +
    '\n\n…（中间省略 ' +
    omitted +
    ' 个字符。' +
    howTo +
    '）…\n\n' +
    output.slice(output.length - tail)
  )
}

/**
 * 决定"模型看到的工具结果"：短的原样给，长的先落盘再给头尾节选。
 *
 * 三条规则（与 DSH 的 spill-policy 同构，实现是我们自己的）：
 *  1. 没超上限 → 原样；
 *  2. 超了且有溢出存储 → **完整落盘**，节选里带上路径与"怎么读回来"的指引；
 *  3. 超了但落盘失败 → **fail-open：不裁**。"没有出路的省略"比"上下文大一点"更糟
 *     （本仓库既有原则，见 ai/spillStore.ts 的注释）。
 *
 * 例外：**完全没有溢出存储**（脚本/测试）时按上限裁，并如实告诉模型"没保存" ——
 * 那种环境本来就没有恢复路径，留着原文只会把上下文撑爆。
 */
export async function modelFacingOutput(
  toolName: string,
  output: string,
  opts: {
    maxToolOutputChars?: number
    spill?: (name: string, text: string) => Promise<string | undefined>
  },
): Promise<string> {
  const limit = opts.maxToolOutputChars ?? MAX_TOOL_OUTPUT_CHARS
  if (output.length <= limit) return output
  if (!opts.spill) return clampToolOutput(output, limit)
  const locator = await opts.spill(toolName, output)
  return locator ? clampToolOutput(output, limit, locator) : output
}
