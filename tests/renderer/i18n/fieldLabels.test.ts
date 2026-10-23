// tests/renderer/i18n/fieldLabels.test.ts
//
// 字段文案收敛的闸门。
//
// 背景：配置字段的显示名/说明曾有 3 份副本（propertyDrawerConstants、flowStore、
// labels.yaml），审计发现同一字段两处叫法不同。收敛到 `field.label.*` / `field.hint.*`
// 之后，最大的风险变成**漏配**：某个字段忘了加译文，界面就会露出内部 key（如 `key_names`）
// 或干脆没有提示。下面每条用例都对着这类静默退化。
import { describe, it, expect, afterEach } from 'vitest'
import { fieldHint, fieldLabel, findFieldKeyByLabel, portHint } from '@renderer/i18n/fieldLabels'
import { setLocale, t } from '@renderer/i18n'
import { INLINE_FIELDS_MAP } from '@renderer/lib/canvasConstants'
import { getDataTypeMeta } from '@renderer/components/blocks/iconMap'
import zhCN from '@renderer/i18n/zh-CN.json'
import enUS from '@renderer/i18n/en-US.json'

const fieldNs = (pack: unknown) =>
  (pack as { field: { label: Record<string, string>; hint: Record<string, string>; portHint: Record<string, string> } }).field

afterEach(() => {
  setLocale('zh-CN')
})

describe('字段文案：单一真相与回退语义', () => {
  it('已知字段返回当前语言的显示名', () => {
    setLocale('zh-CN')
    expect(fieldLabel('mode')).toBe('要做什么')
    expect(fieldLabel('var_name')).toBe('变量名')

    setLocale('en-US')
    expect(fieldLabel('mode')).toBe('What to do')
    expect(fieldLabel('var_name')).toBe('Variable name')
  })

  it('未知字段回退为字段 key 本身（不返回空串、不返回假文案）', () => {
    expect(fieldLabel('definitely_not_a_field')).toBe('definitely_not_a_field')
  })

  it('没有译文的说明返回 undefined（而不是一个假提示）', () => {
    expect(fieldHint('definitely_not_a_field')).toBeUndefined()
    expect(fieldHint('mode')).toBeTruthy()
  })

  it('端口引导提示按语言取', () => {
    setLocale('zh-CN')
    expect(portHint('value')).toContain('绑定上游')
    setLocale('en-US')
    expect(portHint('value')).toContain('Bind an upstream')
  })

  it('两份语言包的字段键集合一致（漏配即红）', () => {
    const zh = fieldNs(zhCN)
    const en = fieldNs(enUS)
    for (const ns of ['label', 'hint', 'portHint'] as const) {
      expect(Object.keys(zh[ns]).sort(), `${ns} 键集合不一致`).toEqual(Object.keys(en[ns]).sort())
    }
  })

  it('字段名不出现内部标识（下划线 key、内部模式值）', () => {
    // 收敛前 target_type 在报错里叫「目标类型」、面板叫「推送目标」，就是这类问题的极端表现。
    // 这里守更基本的一条：显示名里不能出现带下划线的内部 key。
    const offenders: string[] = []
    for (const pack of [zhCN, enUS]) {
      for (const [key, value] of Object.entries(fieldNs(pack).label)) {
        if (value.includes(key) && key.includes('_')) offenders.push(`${key} -> ${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('内联字段：画布与抽屉共用同一份文案', () => {
  it('每个内联字段的 labelKey 都能解析出显示名（不会露出内部 key）', () => {
    const offenders: string[] = []
    for (const [nodeKind, fields] of Object.entries(INLINE_FIELDS_MAP)) {
      for (const field of fields) {
        const labelKey = field.labelKey ?? field.key
        const text = fieldLabel(labelKey)
        // 解析失败时 fieldLabel 会把 key 原样返回 —— 对带下划线的 key 就是明显的内部标识泄漏
        if (labelKey.includes('_') && text === labelKey) {
          offenders.push(`${nodeKind}.${field.key} -> ${labelKey}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('内联字段的 placeholderKey 都能解析（英文下不残留中文）', () => {
    const keys = new Set<string>()
    for (const fields of Object.values(INLINE_FIELDS_MAP)) {
      for (const field of fields) if (field.placeholderKey) keys.add(field.placeholderKey)
    }
    expect(keys.size).toBeGreaterThan(0)

    setLocale('en-US')
    const offenders: string[] = []
    for (const key of keys) {
      const text = t(key)
      // 解析失败时 t() 会返回 key 的最后一段（如 `template`），也算漏配
      if (/[\u4e00-\u9fa5]/.test(text) || text === key.split('.').pop()) {
        offenders.push(`${key} -> ${text}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('dataType 徽标文案', () => {
  it('中文与英文都取自语言包，且不残留另一种语言', () => {
    setLocale('zh-CN')
    expect(getDataTypeMeta('string').label).toBe('文本')
    expect(getDataTypeMeta('list').label).toBe('列表')

    setLocale('en-US')
    expect(getDataTypeMeta('string').label).toBe('String')
    expect(getDataTypeMeta('list').label).toBe('List')
    expect(/[\u4e00-\u9fa5]/.test(getDataTypeMeta('boolean').label)).toBe(false)
  })

  it('未知 dataType 回退到 any 的文案（不露出内部值）', () => {
    setLocale('en-US')
    expect(getDataTypeMeta('weird_type').label).toBe('Any')
    expect(getDataTypeMeta(undefined).label).toBe('Any')
  })
})

describe('错误消息反查字段 key', () => {
  it('中文错误消息能反查出 key（renderer 与 shared 两层都可能产出中文）', () => {
    expect(findFieldKeyByLabel('推送目标')).toBe('target_type')
    expect(findFieldKeyByLabel('变量名')).toBe('var_name')
  })

  it('英文错误消息也能反查（跨语言扫描，英文界面下一键跳转不失效）', () => {
    expect(findFieldKeyByLabel('Variable name')).toBe('var_name')
    expect(findFieldKeyByLabel('What to do')).toBe('mode')
  })

  it('认不出的标签返回 null', () => {
    expect(findFieldKeyByLabel('这不是字段名')).toBeNull()
    expect(findFieldKeyByLabel('')).toBeNull()
  })
})
