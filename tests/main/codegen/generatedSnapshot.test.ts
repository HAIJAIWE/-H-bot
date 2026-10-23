// tests/main/codegen/generatedSnapshot.test.ts
//
// 「导出可读 TypeScript」快照的**语法闸门**。
//
// 事故：这条链真机踩过 —— 快照里把用户配置的**原样片段**（Python 风格表达式、中文文案、SQL）
// 直接当语句写，于是一份 100 多节点的流程让快照报出 **25 处语法错误**，
// 而 `generateCode` 的 `errors` 仍然是 `[]`：**静默产坏码**。
// 表现是 `.ts` 快照一进 IDE 就往 Problems 面板灌几十条错，用户分不清哪条是真问题。
//
// 这个文件把"生成的东西必须能被 TS 解析器吃下去"变成断言 ——
// 用 TypeScript 自己的 `createSourceFile`（与 IDE 同一个解析器）而不是正则去猜。
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { generateCode } from '@main/codegen/generator'
import { getNodeRegistry } from '@main/nodes/registry'
import { registerAllBuiltinNodes } from '@main/nodes/builtin'
import type { FlowGraph, FlowNode } from '@shared/types/flow'

registerAllBuiltinNodes(getNodeRegistry())

/** 覆盖"曾经会吐出裸片段"的节点种类 */
const CHAIN: Array<[string, string, Record<string, unknown>]> = [
  // 表达式：Python 风格（函数形式 + 三元 + 反引号里的中文）
  ['n_expr', 'expression_eval', { mode: 'single', expression: 'clamp(int(get(v1,"hp",0)) * 2, 1, 999)' }],
  ['n_expr2', 'expression_eval', { mode: 'single', expression: '"" if not v1 else "\\n⬆ 升级！等级 " + str(int(v2) + 1)' }],
  ['n_expr3', 'expression_eval', { mode: 'formulas', formulas: [{ name: 'dmg', expression: 'atk * 2 - def' }] }],
  // 文本模板：中文文案（以前被当语句写）
  ['n_fmt', 'format_text', { template: '🎒 背包（{var1} 种）' }],
  // 查询：没有 sql 键（以前固定渲染出 `SELECT * FROM table`）
  ['n_query', 'query', { mode: 'list', key_pattern: 'user_*' }],
  ['n_persist', 'variable_persist', { mode: 'increment', key: 'exp', scope: 'user' }],
  ['n_group', 'group_op', { mode: 'ban' }],
  ['n_file', 'file_operate', { mode: 'write', file_path: 'data/x.txt' }],
  ['n_db', 'database_write', { mode: 'insert', table: 'monsters', data: '{"name":"史莱姆"}' }],
  ['n_http', 'http_request', { method: 'GET', url: 'https://example.com' }],
  // 用户填的文本以前被裸插进调用里（`console.info(你好)`）
  ['n_log', 'system_log', { level: 'info', message: '你好，世界' }],
  ['n_rand', 'random', { min_value: 1, max_value: 6 }],
  ['n_time', 'time_op', { mode: 'now' }],
  ['n_list', 'list_op', { mode: 'upsert' }],
  ['n_emb', 'embedding', { text: '你好' }],
  ['n_send', 'message_send', { mode: 'text', text: '⚔ 遭遇 史莱姆' }],
  // 控制流节点放最后：`loop` 是「终止型」节点，链在它这里收束（下游走 body/done 端口）
  ['n_loop', 'loop', { mode: 'times', max_iterations: 3 }],
]

function buildGraph(): FlowGraph {
  const trigger: FlowNode = {
    id: 't1',
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: {
      label: '收到消息',
      nodeKind: 'message_received',
      config: { match: 'command', command: '测试', prefix: '/' },
      inputs: [],
      outputs: [],
    },
  }

  const nodes: FlowNode[] = CHAIN.map(([id, kind, config], i) => ({
    id,
    type: 'action',
    position: { x: 0, y: i * 100 },
    data: { label: kind, nodeKind: kind, config, inputs: [], outputs: [] },
  }))

  const ids = ['t1', ...CHAIN.map(([id]) => id)]
  const edges = ids.slice(0, -1).map((source, i) => ({
    id: `e${i}`,
    source,
    sourcePort: i === 0 ? 'next' : 'out',
    target: ids[i + 1],
    targetPort: 'in',
  }))

  return {
    schemaVersion: '1.1',
    systems: [],
    nodes: [trigger, ...nodes],
    edges,
    variables: [],
    metadata: {
      name: 'snapshot-gate',
      version: '1.0',
      runtime: 'typescript',
      createdAt: '',
      updatedAt: '',
    },
  } as FlowGraph
}

const result = generateCode(buildGraph())

/** 用 TypeScript 自己的解析器检查语法（与 IDE 同一套） */
function parseDiagnostics(code: string): ts.Diagnostic[] {
  const sf = ts.createSourceFile('flow.generated.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  return (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
}

/** 取所有 `import { a, b } from "x"` 的 (模块 → 具名成员) */
function importsOf(code: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const re = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    map.set(m[2], [...(map.get(m[2]) ?? []), ...names])
  }
  return map
}

describe('导出快照：必须是语法合法的 TypeScript（只读大纲）', () => {
  it('生成的代码能被 TS 解析器解析（0 语法错误）', () => {
    const diags = parseDiagnostics(result.code)
    const detail = diags
      .slice(0, 5)
      .map((d) => {
        const sf = ts.createSourceFile('x.ts', result.code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
        const pos = sf.getLineAndCharacterOfPosition(d.start ?? 0)
        return `行 ${pos.line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
      })
      .join('\n')
    expect(diags.length, `快照有语法错误：\n${detail}`).toBe(0)
  })

  it('同一个模块不重复导入同名成员（重复标识符）', () => {
    for (const [mod, names] of importsOf(result.code)) {
      const dup = names.filter((n, i) => names.indexOf(n) !== i)
      expect(dup, `模块 ${mod} 重复导入了 ${dup.join(', ')}`).toEqual([])
    }
  })

  it('文件头说清"这不是可运行代码"，并显式 @ts-nocheck', () => {
    expect(result.code.startsWith('// @ts-nocheck')).toBe(true)
    expect(result.code).toContain('只读大纲，不是可运行代码')
  })

  it('原样片段被保留下来（改成注释，而不是丢掉）', () => {
    expect(result.code).toContain('clamp(int(get(v1,"hp",0)) * 2, 1, 999)')
    expect(result.code).toContain('🎒 背包（{var1} 种）')
    // 以前这里固定渲染出一句假 SQL
    expect(result.code).not.toContain('SELECT * FROM table')
  })

  it('占位调用仍在（快照的可读性契约）', () => {
    expect(result.code).toContain('sendMessage(')
    expect(result.code).toContain('saveVariable(')
  })

  it('generateCode 不谎报"零错误"：语法闸门兜住生成器', () => {
    // errors 是生成器自己报的问题（如缺 toolName）；这里断言的是
    // "即使 errors 为空，快照也必须真的能解析" —— 两条一起才叫闸门
    expect(Array.isArray(result.errors)).toBe(true)
    expect(parseDiagnostics(result.code)).toEqual([])
  })
})
