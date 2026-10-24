// tests/main/services/builtinNodes/dataNodeOps.test.ts
//
// 数据类节点的**纯函数实现**：JSON 操作 / 列表操作 / 随机 / 变量合并 / 变量赋值。
//
// 这几个函数迁移前对应 pytest 的 test_json_op、test_json_set、test_json_process、
// test_list_op、test_random、test_set_variable、test_memory_op 等文件；Python 栈删除后
// TS 侧没有任何行为断言（只有"目录里有这个节点""flow.json 能存下来"）。
// 本文件锁住当前实现（10/18 客户端还原 + 恢复期修的 upsert / merge / $. 路径归一化）。
import { describe, it, expect } from 'vitest'
import {
  jsonOp,
  splitJsonPath,
  listOp,
  asList$1 as asList,
  random,
  variableSet,
  variableMerge,
} from '@main/services/builtinNodes/dataNodes'

describe('jsonOp：解析与序列化', () => {
  it('parse 把 JSON 字符串变成对象', () => {
    expect(jsonOp('parse', '{"hp":10}').result).toEqual({ hp: 10 })
  })

  it('parse 直接收到对象时原样返回（节点间连线传的是对象）', () => {
    const obj = { hp: 10 }
    expect(jsonOp('parse', obj as never).result).toBe(obj)
  })

  it('非法 JSON：报错里说清怎么改（不是一句 Unexpected token）', () => {
    const r = jsonOp('parse', '{hp:10}')
    expect(r.result).toBeNull()
    expect(r.error).toContain('不是合法 JSON')
    expect(r.error).toContain('要写成对象')
  })

  it('stringify 输出带缩进的 JSON 文本', () => {
    const r = jsonOp('stringify', { hp: 10, bag: [1, 2] })
    expect(r.error).toBe('')
    expect(r.result).toBe(JSON.stringify({ hp: 10, bag: [1, 2] }, null, 2))
  })
})

describe('jsonOp：读字段（含 $.key 归一化）', () => {
  const data = { battle: { hp: 5, mp: 3 }, name: '勇者', list: [{ id: 1 }] }

  it('空路径 / $ / . → 整个对象', () => {
    for (const p of ['', '$', '.']) expect(jsonOp('get', data, p).result).toEqual(data)
  })

  it('点号路径与 $.前缀写法等价（面板默认值就是 $.key）', () => {
    expect(jsonOp('get', data, 'battle.hp').result).toBe(5)
    expect(jsonOp('get', data, '$.battle.hp').result).toBe(5)
  })

  it('路径不存在 → undefined 且不报错（由下游的"缺省"逻辑处理）', () => {
    const r = jsonOp('get', data, 'battle.attack')
    expect(r.result).toBeUndefined()
    expect(r.error).toBe('')
  })

  it('splitJsonPath 只去前导 $/.，不改其余语义', () => {
    expect(splitJsonPath('$.a.b')).toEqual(['a', 'b'])
    expect(splitJsonPath('a.b')).toEqual(['a', 'b'])
    expect(splitJsonPath('')).toEqual([])
  })
})

describe('jsonOp：写字段与删字段', () => {
  it('set 会为缺失的中间层补对象（不是抛 TypeError）', () => {
    const r = jsonOp('set', {}, 'a.b', 1)
    expect(r.result).toEqual({ a: { b: 1 } })
    expect(r.error).toBe('')
  })

  it('set 走不过去（中间层不是对象）→ 可操作错误', () => {
    const r = jsonOp('set', { a: 1 }, 'a.b', 2)
    expect(r.error).toContain('不是对象')
  })

  it('set 缺字段路径 → 明确要求填写', () => {
    expect(jsonOp('set', { a: 1 }, '', 2).error).toContain('需要填写')
  })

  it('delete 删掉最后一段，前面结构保留', () => {
    const r = jsonOp('delete', { a: { b: 1, c: 2 } }, '$.a.b')
    expect(r.result).toEqual({ a: { c: 2 } })
  })

  it('delete 路径走不通 → 报"走不通"而不是原生 TypeError', () => {
    const r = jsonOp('delete', { a: { b: 1 } }, 'a.x.y')
    expect(r.error).toContain('走不通')
  })
})

describe('jsonOp：合并', () => {
  it('merge 是浅合并：同名键覆盖、其余保留', () => {
    const r = jsonOp('merge', { hp: 10, mp: 3 }, '', { hp: 7, atk: 2 })
    expect(r.result).toEqual({ hp: 7, mp: 3, atk: 2 })
  })

  it('merge 接受 JSON 字符串补丁', () => {
    expect(jsonOp('merge', { hp: 10 }, '', '{"hp":1}').result).toEqual({ hp: 1 })
  })

  it('merge 收到数组 / null → 报错并保留原值', () => {
    const r = jsonOp('merge', { hp: 10 }, '', [1, 2])
    expect(r.error).toContain('JSON 对象')
    expect(r.result).toEqual({ hp: 10 })
  })

  it('未知模式 → 报未知 mode（不静默成功）', () => {
    expect(jsonOp('nope', {}).error).toContain('未知 mode')
  })
})

describe('listOp：取值与增删', () => {
  it('入参是 JSON 字符串时先解析（面板里就是这么存的）', () => {
    expect(listOp('append', '[1,2]', 3).result).toEqual([1, 2, 3])
  })

  it('入参不是 JSON 的字符串按单元素列表处理（不丢数据）', () => {
    expect(listOp('append', 'abc', 'd').result).toEqual(['abc', 'd'])
  })

  it('append / prepend / insert（索引越界夹紧）', () => {
    expect(listOp('append', [1], 2).result).toEqual([1, 2])
    expect(listOp('prepend', [1], 0).result).toEqual([0, 1])
    expect(listOp('insert', [1, 3], 2, 99).result).toEqual([1, 3, 2])
  })

  it('remove：删掉第一个相等元素；没有则 changed=false', () => {
    expect(listOp('remove', [1, 2, 2], 2)).toMatchObject({ result: [1, 2], changed: true })
    expect(listOp('remove', [1], 9)).toMatchObject({ result: [1], changed: false })
  })

  it('pop：默认删最后一个，index>0 时删指定位置', () => {
    expect(listOp('pop', [1, 2, 3]).result).toEqual([1, 2])
    expect(listOp('pop', [1, 2, 3], null, 1).result).toEqual([1, 3])
    expect(listOp('pop', []).changed).toBe(false)
  })

  it('get 越界 → null；size 返回元素个数', () => {
    expect(listOp('get', [1, 2], null, 5).result).toBeNull()
    expect(listOp('size', [1, 2, 3]).result).toBe(3)
  })
})

describe('listOp：查询与变换', () => {
  it('contains / index_of 用严格相等（对象要引用相同）', () => {
    expect(listOp('contains', [1, 2], 2).result).toBe(true)
    expect(listOp('index_of', ['a', 'b'], 'b').result).toBe(1)
    expect(listOp('index_of', ['a'], 'z').result).toBe(-1)
  })

  it('slice / sort / reverse / unique', () => {
    expect(listOp('slice', [1, 2, 3, 4], null, null, 1, 3).result).toEqual([2, 3])
    expect(listOp('sort', [3, 1, 2]).result).toEqual([1, 2, 3])
    expect(listOp('reverse', [1, 2]).result).toEqual([2, 1])
    expect(listOp('unique', [1, 1, 2]).result).toEqual([1, 2])
  })

  it('merge 拼两个列表；filter 留下相等元素', () => {
    expect(listOp('merge', [1], [2, 3]).result).toEqual([1, 2, 3])
    expect(listOp('filter', [1, 2, 1], 1).result).toEqual([1, 1])
  })

  it('reduce 把数字列表求和', () => {
    expect(listOp('reduce', [1, 2, 3]).result).toBe(6)
  })

  it('未知 mode → error，不静默返回空列表', () => {
    expect(listOp('nope', [1]).error).toContain('未知 mode')
  })
})

describe('listOp：upsert（背包"有就 +1、没有就新增"）', () => {
  it('没有同款 → 新增一条并把计数字段设为 delta', () => {
    const r = listOp('upsert', [], { name: '新手剑' }, null, 0, 10, 'name', 'count', 1)
    expect(r.result).toEqual([{ name: '新手剑', count: 1 }])
    expect(r.count).toBe(1)
  })

  it('已有同款 → 在原条目上累加，不新增', () => {
    const bag = [{ name: '新手剑', count: 2, desc: '旧' }]
    const r = listOp('upsert', bag, { name: '新手剑' }, null, 0, 10, 'name', 'count', 3)
    expect(r.result).toEqual([{ name: '新手剑', count: 5, desc: '旧' }])
    expect(r.result).toHaveLength(1)
  })

  it('没配匹配字段 / 元素不是对象 / 元素缺字段 / delta 不是数字 → 各自明确报错', () => {
    expect(listOp('upsert', [], { name: 'a' }).error).toContain('匹配字段')
    expect(listOp('upsert', [], 1, null, 0, 10, 'name').error).toContain('必须是一个对象')
    expect(listOp('upsert', [], { x: 1 }, null, 0, 10, 'name').error).toContain('没有「name」字段')
    expect(listOp('upsert', [], { name: 'a' }, null, 0, 10, 'name', 'count', 'x').error).toContain(
      '增量不是数字',
    )
  })
})

describe('random：边界与抽卡', () => {
  it('int 落在 [min,max] 闭区间内', () => {
    for (let i = 0; i < 200; i++) {
      const v = random('int', 3, 5).result
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(5)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('float 落在 [min,max) 内', () => {
    for (let i = 0; i < 200; i++) {
      const v = random('float', 0, 1).result
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('choice 只从列表里取；shuffle 保留全部元素', () => {
    expect(['a', 'b']).toContain(random('choice', 0, 1, ['a', 'b']).result)
    expect(random('shuffle', 0, 1, [1, 2, 3]).result.sort()).toEqual([1, 2, 3])
  })

  it('weighted 只抽权重 > 0 的值', () => {
    const pool = [
      { value: 'ssr', weight: 1 },
      { value: 'n', weight: 0 },
    ]
    for (let i = 0; i < 100; i++) expect(random('weighted', 0, 1, pool as never).result).toBe('ssr')
  })

  it('weighted 权重和 <= 0 → 报错而不是抽第一个', () => {
    const r = random('weighted', 0, 1, [{ value: 'a', weight: 0 }] as never)
    expect(r.result).toBeNull()
    expect(r.error).toContain('权重之和')
  })

  it('未知 mode → error', () => {
    expect(random('nope').error).toContain('未知 mode')
  })
})

describe('variableSet / variableMerge', () => {
  it('变量名合法 → 原样返回，error 空', () => {
    expect(variableSet({} as never, null as never, 42, 'hp')).toEqual({
      result: 42,
      var_name: 'hp',
      error: '',
    })
  })

  it('变量名非法 → 明确报错，但仍然把值透传出去', () => {
    const r = variableSet({} as never, null as never, 42, '1hp')
    expect(r.result).toBe(42)
    expect(r.error).toContain('非法变量名')
  })

  it('dict：按 key_names 组字典，null 输入跳过', async () => {
    const r = await variableMerge(null as never, null as never, 'dict', 1, null, 3, null, null, null, '["a","b","c"]')
    expect(r.result).toEqual({ a: 1, c: 3 })
    expect(r.count).toBe(2)
  })

  it('dict：没给 key_names 时用 v1/v2… 兜底', async () => {
    expect((await variableMerge(null as never, null as never, 'dict', 'x')).result).toEqual({ v1: 'x' })
  })

  it('list：过滤 null / undefined / 空串', async () => {
    const r = await variableMerge(null as never, null as never, 'list', 1, '', null, '', 5)
    expect(r.result).toEqual([1, 5])
  })

  it('concat：数组与 JSON 字符串都摊平', async () => {
    const r = await variableMerge(null as never, null as never, 'concat', [1], '[2,3]', 'x')
    expect(r.result).toEqual([1, 2, 3, 'x'])
  })

  it('未知模式 → 报错并说明支持哪些', async () => {
    const r = await variableMerge(null as never, null as never, 'nope')
    expect(r.error).toContain('支持 dict/list/concat')
  })
})
