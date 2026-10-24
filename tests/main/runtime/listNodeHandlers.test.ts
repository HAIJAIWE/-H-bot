// tests/main/runtime/listNodeHandlers.test.ts
//
// 列表四个节点（list_edit / list_query / list_transform / list_combine）在**运行时表**里的行为。
//
// ## 为什么要测这层，而不是只测 listOp
//
// `list_op` 在 2026-10 被拆成 4 个节点，实现完全共用（support.ts 的 runListOp），
// 区别只有一处：**每个节点允许的模式**（LIST_NODE_MODES）。这层收窄是拆分的全部意义，
// 也是唯一能拦住"用户在列表编辑节点里选到排序"的地方 —— 但迁移前它由 pytest 的
// test_list_node_split 覆盖，Python 栈删除后 TS 侧一条断言都没有。
//
// 另外一层是"读写命名变量"（source_from=variable + write_back）：它决定节点是拿上游端口
// 的值还是直接改画布上的变量，接错就是"节点没效果但也不报错"。
import { describe, it, expect } from 'vitest'
import { getHandler } from '@main/runtime/handlerRegistry'
import { LIST_NODE_MODES } from '@main/runtime/handlers/support'
import { namedVarKey } from '@shared/nodes/varRef'

/** 造一个只带命名变量表的执行上下文（runListOp 只用 ctx.variables） */
function ctx(vars: Record<string, unknown> = {}) {
  return { ctx: { variables: vars, nodesById: new Map() } } as never
}

function call(kind: string, kwargs: Record<string, unknown>, hctx: unknown = ctx()) {
  const handler = getHandler(kind)
  expect(handler, '运行时表里应有 ' + kind).toBeTruthy()
  return (handler as any)(null, null, kwargs, hctx)
}

describe('模式收窄：每个节点只认自己的模式', () => {
  it('四个 split 节点都在运行时表里，且模式表与节点一一对应', () => {
    for (const kind of Object.keys(LIST_NODE_MODES)) expect(getHandler(kind)).toBeTruthy()
    expect(LIST_NODE_MODES.list_edit).toEqual(['append', 'remove', 'insert', 'upsert'])
    expect(LIST_NODE_MODES.list_query).toEqual(['contains', 'size', 'get', 'index_of'])
    expect(LIST_NODE_MODES.list_transform).toEqual(['sort', 'reverse', 'unique'])
    expect(LIST_NODE_MODES.list_combine).toEqual(['merge', 'slice', 'pop'])
  })

  it('不给 mode → 用该节点的第一个模式（append / contains / sort / merge）', () => {
    expect(call('list_edit', { source_list: [1] }).result).toEqual([1, null])
    expect(call('list_query', { source_list: [1, 2], value: 2 }).result).toBe(true)
    expect(call('list_transform', { source_list: [2, 1] }).result).toEqual([1, 2])
    expect(call('list_combine', { source_list: [1], value: [2] }).result).toEqual([1, 2])
  })

  it('越界模式：明确报错并列出可选值（不静默兜底成 append）', () => {
    const r = call('list_edit', { mode: 'sort', source_list: [2, 1] })
    expect(r.result).toBeNull()
    expect(r.changed).toBe(false)
    expect(r.error).toContain('节点「list_edit」不支持模式「sort」')
    expect(r.error).toContain('append / remove / insert / upsert')
  })

  it('四个节点的越界各自报自己的可选清单', () => {
    expect(call('list_query', { mode: 'append' }).error).toContain('contains / size / get / index_of')
    expect(call('list_transform', { mode: 'upsert' }).error).toContain('sort / reverse / unique')
    expect(call('list_combine', { mode: 'unique' }).error).toContain('merge / slice / pop')
  })

  it('老节点 list_op 仍然全模式可用（拆分不砍历史流程）', () => {
    expect(call('list_op', { mode: 'sort', source_list: [2, 1] }).result).toEqual([1, 2])
    expect(call('list_op', { mode: 'size', source_list: [1, 2, 3] }).result).toBe(3)
  })

  it('拆分节点走的还是同一份 listOp：参数照样生效（slice 的 start/end、upsert 的 key/count）', () => {
    expect(call('list_combine', { mode: 'slice', source_list: [1, 2, 3, 4], start: 1, end: 3 }).result).toEqual([2, 3])
    const bag = [{ name: '剑', count: 1 }]
    const r = call('list_edit', {
      mode: 'upsert',
      source_list: bag,
      value: { name: '剑' },
      key_field: 'name',
      count_field: 'count',
      delta: 2,
    })
    expect(r.result).toEqual([{ name: '剑', count: 3 }])
  })
})

describe('命名变量模式：source_from=variable', () => {
  it('从 ctx.variables 读「__var__:名字」，不改端口来源', () => {
    const c = ctx({ [namedVarKey('bag')]: ['apple'] })
    const r = call('list_edit', { mode: 'append', source_from: 'variable', var_name: 'bag', value: 'pear' }, c)
    expect(r.result).toEqual(['apple', 'pear'])
  })

  it('变量不存在时按空列表处理（不是报错，也不是 undefined 崩掉）', () => {
    const r = call('list_edit', { mode: 'append', source_from: 'variable', var_name: 'bag', value: 1 })
    expect(r.result).toEqual([1])
  })

  it('write_back 开：结果写回同一个变量', () => {
    const vars: Record<string, unknown> = { [namedVarKey('bag')]: [1] }
    call('list_edit', { mode: 'append', source_from: 'variable', var_name: 'bag', value: 2, write_back: true }, ctx(vars))
    expect(vars[namedVarKey('bag')]).toEqual([1, 2])
  })

  it('write_back 关（或没填）：变量保持原样 —— 只算不改', () => {
    const vars: Record<string, unknown> = { [namedVarKey('bag')]: [1] }
    call('list_edit', { mode: 'append', source_from: 'variable', var_name: 'bag', value: 2 }, ctx(vars))
    expect(vars[namedVarKey('bag')]).toEqual([1])
    call('list_query', { mode: 'size', source_from: 'variable', var_name: 'bag', write_back: true }, ctx(vars))
    // size 不是"变换类"模式 → 即使 write_back 打开也不写回
    expect(vars[namedVarKey('bag')]).toEqual([1])
  })

  it('write_back 认字符串 "true"（数据边连进来的布尔是字符串）', () => {
    const vars: Record<string, unknown> = { [namedVarKey('bag')]: ['a'] }
    call('list_edit', { mode: 'append', source_from: 'variable', var_name: 'bag', value: 'z', write_back: 'true' }, ctx(vars))
    expect(vars[namedVarKey('bag')]).toEqual(['a', 'z'])
  })

  it('写回失败（实现报错）时不动变量', () => {
    const vars: Record<string, unknown> = { [namedVarKey('bag')]: [{ a: 1 }] }
    const r = call(
      'list_edit',
      { mode: 'upsert', source_from: 'variable', var_name: 'bag', value: {}, write_back: true },
      ctx(vars),
    )
    expect(r.error).toContain('匹配字段')
    expect(vars[namedVarKey('bag')]).toEqual([{ a: 1 }])
  })

  it('开了 variable 模式却没填变量名 → 退回端口模式（不静默丢输入）', () => {
    const vars: Record<string, unknown> = {}
    const r = call(
      'list_edit',
      { mode: 'append', source_from: 'variable', var_name: '  ', source_list: ['port'], value: 'x', write_back: true },
      ctx(vars),
    )
    expect(r.result).toEqual(['port', 'x'])
    expect(Object.keys(vars)).toEqual([])
  })

  it('拿不到执行上下文 → 明确报错，而不是当成空列表继续（会把用户数据擦掉）', () => {
    const r = call(
      'list_edit',
      { mode: 'append', source_from: 'variable', var_name: 'bag', value: 1, write_back: true },
      {},
    )
    expect(r.result).toBeNull()
    expect(r.error).toContain('拿不到执行上下文')
  })
})

describe('json_op 的命名变量模式（同一套读写语义）', () => {
  it('source_from=variable：从变量读对象再取字段', () => {
    const vars: Record<string, unknown> = { [namedVarKey('save')]: { hp: 7 } }
    const r = call('json_op', { mode: 'get', source_from: 'variable', var_name: 'save', key: 'hp' }, ctx(vars))
    expect(r.result).toBe(7)
  })

  it('set + write_back：写回变量；关掉 write_back 时原对象不能被就地改掉', () => {
    const vars: Record<string, unknown> = { [namedVarKey('save')]: { hp: 7 } }
    call('json_op', { mode: 'set', source_from: 'variable', var_name: 'save', key: 'hp', value: 9 }, ctx(vars))
    expect(vars[namedVarKey('save')]).toEqual({ hp: 7 })
    call('json_op', { mode: 'set', source_from: 'variable', var_name: 'save', key: 'hp', value: 9, write_back: true }, ctx(vars))
    expect(vars[namedVarKey('save')]).toEqual({ hp: 9 })
  })

  it('get 模式即使 write_back 打开也不写回（读操作没有副作用）', () => {
    const vars: Record<string, unknown> = { [namedVarKey('save')]: { hp: 7 } }
    call('json_op', { mode: 'get', source_from: 'variable', var_name: 'save', key: 'hp', write_back: true }, ctx(vars))
    expect(vars[namedVarKey('save')]).toEqual({ hp: 7 })
  })

  it('变量尚不存在时：set 从 {} 开始建', () => {
    const vars: Record<string, unknown> = {}
    call('json_op', { mode: 'set', source_from: 'variable', var_name: 'save', key: 'hp', value: 1, write_back: true }, ctx(vars))
    expect(vars[namedVarKey('save')]).toEqual({ hp: 1 })
  })

  it('变量尚不存在时 get：报"source 不是合法 JSON"（现状，见下方注释）', () => {
    // 实现给空值传的是空串 ''，jsonOp 会先 JSON.parse('') 并失败 ——
    // 语义上"空对象取字段"应该得到 undefined，这里先如实锁住现状，
    // 免得以后有人把它当"能读到空值"用。要改成 {} 需另开一次行为变更。
    const r = call('json_op', { mode: 'get', source_from: 'variable', var_name: 'save', key: 'hp' }, ctx({}))
    expect(r.result).toBeNull()
    expect(r.error).toContain('不是合法 JSON')
  })
})
