import { describe, it, expect } from 'vitest'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import { buildCatalog } from '@shared/nodes/catalog/build'
import type { NodeSpecV2 } from '@shared/types/nodeV2'

describe('NODE_CATALOG_V2 内置节点（中文目录 = 契约层 + 中文文案）', () => {
  it('共 76 个节点', () => {
    expect(NODE_CATALOG_V2).toHaveLength(76)
  })

  it('agent_chat 节点已注册到前端 catalog', () => {
    const ai = NODE_CATALOG_V2.find((n) => n.kind === 'agent_chat')
    expect(ai).toBeDefined()
    expect(ai!.group).toBe('AI')
    // group 是**稳定键**（NodePalette 用它判断图标、GROUP_ORDER 用它排序），不随语言变化
    expect(ai!.label).toBe('AI 智能体对话')
  })

  it('每个节点都有中文 summary（10-120 字）', () => {
    for (const node of NODE_CATALOG_V2) {
      expect(node.summary.length).toBeGreaterThanOrEqual(10)
      expect(node.summary.length).toBeLessThanOrEqual(120)
    }
  })

  it('每个节点都有 handler', () => {
    // handler.source 允许 'builtin'（运行时 Python handler）或 'declarative'
    // （声明性节点，如 table_define / panel_register，无运行时 handler，仅作画布声明）
    for (const node of NODE_CATALOG_V2) {
      expect(node.handler).toBeDefined()
      expect(['builtin', 'declarative']).toContain(node.handler.source)
    }
  })

  it('message_send 有正确的 sideEffects 和 handler', () => {
    const send = NODE_CATALOG_V2.find((n) => n.kind === 'message_send')!
    expect(send.sideEffects).toContain('message_send')
    expect(send.handler).toEqual({ source: 'builtin', module: 'message_send' })
    expect(send.exposedAsTool).toBe(true)
    expect(send.toolName).toBe('发消息')
  })

  it('http_request 暴露给 AI 工具', () => {
    const http = NODE_CATALOG_V2.find((n) => n.kind === 'http_request')!
    expect(http.exposedAsTool).toBe(true)
    expect(http.toolName).toBe('HTTP 请求')
  })

  it('branch_if 不暴露给 AI（纯控制流）', () => {
    const ifNode = NODE_CATALOG_V2.find((n) => n.kind === 'branch_if')!
    expect(ifNode.exposedAsTool).toBe(false)
  })
})

/**
 * 回归：上面那条 summary 测试**只查长度、不查语言**，名字却在说"中文 summary"。
 * 于是 `mode=single 单表达式求值…`、`select=查询行…`、`save/load/delete/…` 这类
 * **内部标识**一直躺在面向用户的文案里；界面上的下拉框叫「模式」，文案却写 `mode`，
 * 用户没法把两者对上（实测反馈："看不懂英文，我不是做的全中文么"）。
 *
 * 判定规则（刻意做窄，避免把"本来就该是英文"的东西误判）：
 *   ① 出现内部键名 `mode`（界面上叫「模式」）
 *   ② 出现「标识=值」写法（如 `mode=single`）；`qq = ?`、`==` 不会误判
 *   ③ 出现「英文标识 + 模式」（如 `forward 模式`）；中文写法的「合并转发」模式不算
 *   ④ 出现**带下划线**的内部标识（kind 或选项值）—— 带下划线的一定是内部标识
 *   ⑤ 出现「本节点某个选项的 value，且它的 label 与 value 不同」
 *
 * 为什么不用"全量标识黑名单"：会误伤本来就该用英文的地方 ——
 * `expression_eval` 的「表达式」帮助文本要列 Python 函数名（`len/int/random/…`），
 * HTTP 方法选项的 value 与 label 都是 `GET`，JSON 路径示例要写 `user.name`。
 * 规则⑤ 的 `value !== label` 正好把 `GET` 这类"界面词本来就是英文"的排除掉；
 * 规则④/⑤ 只看**本节点自己**的端口，所以别的节点的模式名出现在表达式帮助里也不算违规。
 *
 * ## 双语改造后为什么要分语言跑
 *
 * 规则 ①③⑤ 的前提是「英文串 = 内部标识」——这在**中文界面**成立，在**英文界面不成立**：
 * 英文界面的下拉框本来就叫 "Mode"，选项值 `text`/`forward`/`group` 也正是用户要读的英文词。
 * 照搬会把这些正常英文全判成违规（实测：`plain-text`、`"forward" mode` 都会被命中）。
 * 因此英文目录只保留**跨语言都成立**的两条：②（`标识=` 写法）与 ④（带下划线的 kind）。
 * 英文目录另外由 `tests/shared/nodes/catalogI18n.test.ts` 保证"不残留中文"。
 */
function scanInternalIdentifiers(specs: NodeSpecV2[], lang: 'zh' | 'en'): string[] {
  const offenders: string[] = []
  const allKinds = NODE_CATALOG_V2.map((n) => n.kind)

  const check = (nodeKind: string, where: string, text: string, ownOptionValues: string[]) => {
    if (!text) return
    const bad: string[] = []

    // 规则 ②：跨语言都成立 —— `mode=single` 这种写法在任何语言里都不是给用户看的
    const kv = text.match(/(?<![A-Za-z0-9_])[A-Za-z_]{2,}=/)
    if (kv) bad.push(`「标识=」写法 ${kv[0]}`)

    // 规则 ④：带下划线的 kind 一定是内部标识（跨语言都成立）
    const underscoredKind = allKinds
      .filter((k) => k.includes('_'))
      .find((k) => new RegExp(`\\b${k}\\b`).test(text))
    if (underscoredKind) bad.push(`内部 kind ${underscoredKind}`)

    // 规则 ①③⑤ 只对中文目录生效，理由见上方注释
    if (lang === 'zh') {
      if (/\bmode\b/.test(text)) bad.push('内部键名 mode')
      const modeWord = text.match(/(?<![A-Za-z0-9_])([a-z_]{2,})\s*模式/)
      if (modeWord) bad.push(`英文标识+模式 ${modeWord[1]} 模式`)
      const own = ownOptionValues
        .filter((v) => v.length >= 2 && /^[a-z][a-z_]*$/.test(v))
        .find((v) => new RegExp(`(?<![A-Za-z0-9_])${v}(?![A-Za-z0-9_])`).test(text))
      if (own) bad.push(`本节点的选项值 ${own}`)
    }

    for (const b of bad) offenders.push(`${nodeKind} ${where}: 出现${b}`)
  }

  for (const node of specs) {
    // 只收「value 与 label 不同」的选项：value===label 说明界面词本来就是英文（如 HTTP 方法）
    const ownOptionValues: string[] = []
    for (const p of [...node.inputs, ...node.outputs]) {
      for (const o of (p as { options?: Array<{ value: string; label: string }> }).options ?? []) {
        if (o.value && o.label && String(o.value) !== String(o.label)) ownOptionValues.push(String(o.value))
      }
    }
    check(node.kind, 'summary', node.summary, ownOptionValues)
    check(node.kind, 'description', node.description, ownOptionValues)
    for (const p of [...node.inputs, ...node.outputs]) {
      check(node.kind, `端口「${p.name}」`, p.description ?? '', ownOptionValues)
    }
  }
  return [...new Set(offenders)]
}

describe('用户读到的文案里不出现内部标识', () => {
  it('中文目录：全量规则（①②③④⑤）', () => {
    expect(scanInternalIdentifiers(NODE_CATALOG_V2, 'zh')).toEqual([])
  })

  it('英文目录：只拦「标识=」写法与带下划线的内部 kind', () => {
    expect(scanInternalIdentifiers(buildCatalog('en-US'), 'en')).toEqual([])
  })
})
