// src/main/services/agent-core/toolRetention.ts
//
// 工具回执的"留多少、省了多少"（2026-10-25）。算法在
// `src/main/vendor/dsh/output-retention`（上游 ItemRetainer / TextRetainer），
// 这里只放**本项目的措辞**：上游那三个文案导出把 "Omitted N items" 写死在库里，
// 而我们的工具回执是中文，所以提示由这两层拼。
//
// 为什么要有这一层而不是在 core.ts 里就地写：core.ts 贴着 800 行闸门，
// 而且"省略提示长什么样"是产品文案，不该混进循环骨架。
import { ItemRetainer } from '../../vendor/dsh/output-retention'
import type { CommandResult } from './sandbox'

/**
 * 有序条目（目录项 / 命中行）按上限保留，并如实回报省了多少。
 *
 * 与旧写法的区别：旧代码 `rows.slice(0, 200)` 里那句"还有 N 个"是**猜**的
 * （拿未过滤的 `entries.length` 减保留数，噪音目录也算进去了）；retainer 是
 * 一条一条 push 进去的，seen / kept / omitted 都是真数。
 */
export function retainEntries(rows: readonly string[], maxItems: number): string {
  if (rows.length === 0) return ''
  const retainer = new ItemRetainer<string>({ kind: 'head', maxItems })
  for (const row of rows) retainer.push(row)
  const kept = retainer.finish()
  const more =
    kept.omitted.kind === 'exact'
      ? '\n…（还有 ' + kept.omitted.count + ' 个没列；要看就再列那个子目录）'
      : ''
  return kept.items.join('\n') + more
}

/**
 * 命令输出被 headTail 裁过时，给模型补一句"你看到的不是全部"。
 *
 * 原文案（旧实现）什么都没有 —— 输出被 `slice(0, 8000)` 截断后模型以为命令
 * 就输出这么多。现在至少三件事说清楚：哪一路少了、少了多少字节、怎么拿到中间那段。
 */
export function streamOmittedNote(result: CommandResult): string {
  const parts: string[] = []
  if (result.stdoutOmitted?.kind === 'exact')
    parts.push('stdout 省了 ' + result.stdoutOmitted.count + ' 字节')
  if (result.stderrOmitted?.kind === 'exact')
    parts.push('stderr 省了 ' + result.stderrOmitted.count + ' 字节')
  if (parts.length === 0) return ''
  return (
    '\n（' +
    parts.join('，') +
    '：只保留开头与结尾。要看中间那段就把命令收窄 —— 加筛选条件，或让命令自己 head/tail）'
  )
}
