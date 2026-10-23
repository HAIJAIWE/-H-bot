// tests/runtime/expressionEvalNode.test.ts
//
// `expression_eval` 节点统一求值器后的回归。
//
// 修复前：这个节点走 `new Function('vars','with(vars){ return <表达式> }')` —— 一个**独立的纯 JS
// 求值器**，与 `branch_if` 用的 `safeEval`（带 Python→JS 翻译）是两套语义。于是：
//   · 目录里教的 Python 写法（clamp / randint / choice / f-string / and-or-not）**全部不生效**
//   · 同一个表达式写在 branch_if 里能跑，写在这里就报错
//   · 求值失败被压成 `false` 塞进流程 —— **静默的假值**
//
// 现在统一走 safeEval，错误如实报到「错误」端口。
import { describe, it, expect } from 'vitest'
import { safeEvalDetailed, safeEvalExpression } from '@main/runtime/safeEval'
import { getHandler } from '@main/runtime/handlerRegistry'

const ctx = {} as never

/** 直接调节点的 runtime handler（与解释器走的是同一个） */
function call(expression: string, extra: Record<string, unknown> = {}): Record<string, any> {
  const handler = getHandler('expression_eval')!
  expect(handler).toBeTruthy()
  return handler({} as never, null, { expression, ...extra }, ctx) as Record<string, any>
}

describe('expression_eval：目录里承诺的 Python 写法现在真的能用', () => {
  it('clamp / min / max / round（原来 clamp 未定义，直接报错）', () => {
    expect(call('clamp(hp, 0, 999)', { variables_json: { hp: 1500 } })).toEqual({
      result: 999,
      error: '',
    })
    expect(call('max(a, b)', { variables_json: { a: 10, b: 20 } }).result).toBe(20)
    expect(call('round(x, 1)', { variables_json: { x: 3.14159 } }).result).toBe(3.1)
  })

  it('随机函数 randint / choice（原来没有，只能写 Math.random）', () => {
    for (let i = 0; i < 20; i++) {
      const r = call('randint(1, 6)').result
      expect(r).toBeGreaterThanOrEqual(1)
      expect(r).toBeLessThanOrEqual(6)
    }
    const picked = call('choice(["石头","剪刀","布"])').result
    expect(['石头', '剪刀', '布']).toContain(picked)
  })

  it('算术 / 比较 / and-or-not / 三元 / in —— 与 branch_if 同一套语义', () => {
    expect(call('atk - def', { variables_json: { atk: 100, def: 30 } }).result).toBe(70)
    expect(call('hp > 0 and hp < 100', { variables_json: { hp: 50 } }).result).toBe(true)
    expect(call('10 if hp > 0 else 0', { variables_json: { hp: 5 } }).result).toBe(10)
    expect(call('"前缀" in name', { variables_json: { name: '前缀abc' } }).result).toBe(true)
    expect(call('True').result).toBe(true)
    expect(call('None').result).toBe(null)
  })

  it('函数形式取字典字段 get（打怪读怪物一行时会用到）', () => {
    expect(call('get(monster, "hp", 0)', { variables_json: { monster: { hp: 88 } } }).result).toBe(88)
    expect(call('get(monster, "mp", 0)', { variables_json: { monster: { hp: 88 } } }).result).toBe(0)
  })

  it('端口变量 v1..v11 也进作用域', () => {
    expect(call('clamp(v1, 0, 999)', { v1: 1500 }).result).toBe(999)
    expect(call('v1 + v2', { v1: 3, v2: 4 }).result).toBe(7)
  })
})

describe('expression_eval：求值失败不再静默（关键修复）', () => {
  it('未知变量 → 错误端口有值（原来压成 false，流程里悄悄拿到假值）', () => {
    const r = call('unknown_var + 1')
    expect(r.result).toBe(null)
    expect(r.error).toContain('unknown_var')
  })

  it('语法错 → 错误端口有值', () => {
    expect(call('1 +').error).not.toBe('')
    expect(call('((').error).not.toBe('')
  })

  it('空表达式 → 错误端口有值', () => {
    expect(call('   ').error).toContain('空')
  })

  it('危险表达式 → 被拦下并说明原因', () => {
    expect(call('process.exit(1)').error).toContain('禁止')
    expect(call('require("fs")').error).toContain('禁止')
  })

  it('目录已明说不支持的写法 → 报错而不是给个错值', () => {
    // Python 方法调用（要写 upper(s)，或用 JS 原生 s.toUpperCase()）
    expect(call('s.upper()', { variables_json: { s: 'abc' } }).error).not.toBe('')
    // 列表推导（要用 JS 的 lst.filter(...) / lst.map(...)）
    expect(call('[x for x in lst]', { variables_json: { lst: [1] } }).error).not.toBe('')
    // f-string 的格式说明符（要写 round(v, 2)）
    expect(call('f"{v:,.2f}"', { variables_json: { v: 1234.5 } }).error).not.toBe('')
  })

  it('JS 原生写法仍然可用（求值器底层就是 JS）', () => {
    // Math 是全局，白名单只限制"传进来的参数名"，不限制全局
    expect(call('Math.max(1, 2)').result).toBe(2)
    expect(call('s.toUpperCase()', { variables_json: { s: 'abc' } }).result).toBe('ABC')
    expect(call('lst.filter(x => x > 1)', { variables_json: { lst: [1, 2, 3] } }).result).toEqual([
      2, 3,
    ])
  })
})

describe('expression_eval：formulas 模式（多公式批量计算，原来完全没有运行时）', () => {
  const FORMULAS = [
    { name: 'damage', expression: 'clamp(atk * 2 - def, 1, 999)' },
    { name: 'crit', expression: 'randint(1, 100) <= crit_rate' },
  ]

  it('每个公式按名字写进结果对象（端口由 getExpressionEvalOutputs 按名字生成）', () => {
    const r = call('', {
      mode: 'formulas',
      formulas: FORMULAS,
      variables_json: { atk: 100, def: 30, crit_rate: 100 },
    })
    expect(r.error).toBe('')
    expect(r.damage).toBe(170)
    expect(r.crit).toBe(true) // crit_rate=100 → 必中
  })

  it('formulas 用 JSON 字符串存也能跑（两种历史数据都认）', () => {
    const r = call('', {
      mode: 'formulas',
      formulas: JSON.stringify(FORMULAS),
      variables_json: { atk: 10, def: 0, crit_rate: 0 },
    })
    expect(r.damage).toBe(20)
    expect(r.crit).toBe(false)
  })

  it('某个公式报错时，其它公式照样出值，错误里点名是哪个公式', () => {
    const r = call('', {
      mode: 'formulas',
      formulas: [
        { name: 'ok', expression: '1 + 1' },
        { name: 'broken', expression: 'nope + 1' },
      ],
    })
    expect(r.ok).toBe(2)
    expect(r.broken).toBe(null)
    expect(r.error).toContain('broken')
  })

  it('没配置公式 → 明确报错（不是静默返回空）', () => {
    expect(call('', { mode: 'formulas', formulas: [] }).error).toContain('没有配置')
    expect(call('', { mode: 'formulas', formulas: '[坏JSON' }).error).toContain('没有配置')
  })

  it('没名字或没表达式的行被丢掉（无名公式没有可写入的端口）', () => {
    const r = call('', {
      mode: 'formulas',
      formulas: [
        { name: '', expression: '1' },
        { name: 'kept', expression: '2' },
        { name: 'noexpr', expression: '  ' },
      ],
    })
    expect(r.kept).toBe(2)
    expect(Object.keys(r).sort()).toEqual(['error', 'kept', 'result'])
  })

  it('single 模式不受影响（老图行为不变）', () => {
    expect(call('1 + 1').result).toBe(2)
    expect(call('1 + 1', { mode: 'single' }).result).toBe(2)
  })
})

describe('safeEvalExpression：给 branch_if 用的旧语义必须保持不变', () => {
  it('失败仍然返回 false（分支走假），不会变成 null 或抛错', () => {
    expect(safeEvalExpression('unknown_var + 1', {})).toBe(false)
    expect(safeEvalExpression('1 +', {})).toBe(false)
    expect(safeEvalExpression('', {})).toBe(false)
    expect(safeEvalExpression('process.exit(1)', {})).toBe(false)
  })

  it('成功时返回真实值', () => {
    expect(safeEvalExpression('clamp(hp, 0, 999)', { hp: 1500 })).toBe(999)
    expect(safeEvalExpression('hp > 50', { hp: 80 })).toBe(true)
  })
})

describe('safeEvalDetailed：错误信息可读', () => {
  it('ok / value / error 三者自洽', () => {
    expect(safeEvalDetailed('1 + 1', {})).toEqual({ ok: true, value: 2, error: '' })
    const bad = safeEvalDetailed('nope + 1', {})
    expect(bad.ok).toBe(false)
    expect(bad.value).toBe(null)
    expect(bad.error).not.toBe('')
  })
})
