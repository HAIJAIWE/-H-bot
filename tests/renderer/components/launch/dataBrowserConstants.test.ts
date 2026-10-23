// tests/renderer/components/launch/dataBrowserConstants.test.ts
import { describe, it, expect } from 'vitest'
import {
  extractCharacterFields,
  FIELD_ALIASES,
} from '@renderer/components/launch/dataBrowserConstants'
import type { DataTemplate } from '@renderer/types/ipc'

/** 构造单条 _persistent 行 */
function p(key: string, value: unknown, scope = 'user') {
  return { key, value, scope }
}

/** 构造一个最小 DataTemplate，含一组带 category 声明的字段 */
function buildTemplate(
  fields: { key: string; label: string; category?: DataTemplate['groups'][0]['fields'][0]['category'] }[]
): DataTemplate {
  return {
    version: 1,
    groups: [
      {
        id: 'g1',
        label: '测试组',
        icon: '👤',
        fields: fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: 'number' as const,
          default: 0,
          category: f.category,
        })),
      },
    ],
  }
}

describe('extractCharacterFields - 无 template 参数（fallback 到 FIELD_ALIASES）', () => {
  it('FIELD_ALIASES 已知的字段按 alias.category 分类', () => {
    // level 是 FIELD_ALIASES 中的已知字段
    const rows = [p('level', 10), p('exp', 100)]
    const result = extractCharacterFields(rows)
    expect(result.characterFields).toHaveLength(2)
    const levelField = result.characterFields.find((f) => f.key === 'level')
    expect(levelField).toBeDefined()
    expect(levelField?.category).toBe('level')
    expect(levelField?.label).toBe('等级')
  })

  it('FIELD_ALIASES 未知的字段归入 otherFields', () => {
    const rows = [p('custom_unknown_field', 'someValue')]
    const result = extractCharacterFields(rows)
    expect(result.characterFields).toHaveLength(0)
    expect(result.otherFields).toHaveLength(1)
    expect(result.otherFields[0].key).toBe('custom_unknown_field')
  })
})

describe('extractCharacterFields - template 参数优先', () => {
  it('template 声明的 category 覆盖 FIELD_ALIASES 的 category', () => {
    // level 默认 category='level'，模板声明为 'combat'
    const template = buildTemplate([
      { key: 'level', label: '战斗等级', category: 'combat' },
    ])
    const rows = [p('level', 10)]
    const result = extractCharacterFields(rows, template)
    expect(result.characterFields).toHaveLength(1)
    expect(result.characterFields[0].category).toBe('combat')
    // 模板声明的 label 优先
    expect(result.characterFields[0].label).toBe('战斗等级')
  })

  it('template 声明的 category 让未识别字段进入 characterFields（不再归入 otherFields）', () => {
    // 自定义字段 custom_mana 不在 FIELD_ALIASES 中
    const template = buildTemplate([
      { key: 'custom_mana', label: '法力值', category: 'combat' },
    ])
    const rows = [p('custom_mana', 50)]
    const result = extractCharacterFields(rows, template)
    expect(result.characterFields).toHaveLength(1)
    expect(result.characterFields[0].key).toBe('custom_mana')
    expect(result.characterFields[0].category).toBe('combat')
    expect(result.characterFields[0].label).toBe('法力值')
    expect(result.otherFields).toHaveLength(0)
  })

  it('template 中未声明 category 的字段仍走 FIELD_ALIASES fallback', () => {
    // 模板中 level 没有 category，应回退到 FIELD_ALIASES 的 'level'
    const template = buildTemplate([
      { key: 'level', label: '等级' }, // 无 category
    ])
    const rows = [p('level', 10)]
    const result = extractCharacterFields(rows, template)
    expect(result.characterFields).toHaveLength(1)
    expect(result.characterFields[0].category).toBe('level')
  })

  it('template 同时声明多个字段，未在 template 中的已知字段仍按 FIELD_ALIASES 分类', () => {
    const template = buildTemplate([
      { key: 'custom_mana', label: '法力值', category: 'combat' },
    ])
    // level 不在 template 中，但 FIELD_ALIASES 已知
    const rows = [p('level', 10), p('custom_mana', 50), p('totally_unknown', 'x')]
    const result = extractCharacterFields(rows, template)
    expect(result.characterFields).toHaveLength(2)
    const level = result.characterFields.find((f) => f.key === 'level')
    const mana = result.characterFields.find((f) => f.key === 'custom_mana')
    expect(level?.category).toBe('level')
    expect(mana?.category).toBe('combat')
    // totally_unknown 既不在 template 也不在 FIELD_ALIASES，归入 otherFields
    expect(result.otherFields).toHaveLength(1)
    expect(result.otherFields[0].key).toBe('totally_unknown')
  })

  it('template=null 等同于不传 template', () => {
    const rows = [p('level', 10)]
    const result = extractCharacterFields(rows, null)
    expect(result.characterFields).toHaveLength(1)
    expect(result.characterFields[0].category).toBe('level')
  })

  it('模板声明需使用与 rawKey 一致的 key（rpg_ 前缀不会被剥离）', () => {
    // getRawKey 只按 ':' 分割，不会把 rpg_level 转成 level
    // 因此模板要覆盖 rpg_level 的分类，需要直接声明 rpg_level
    const template = buildTemplate([
      { key: 'rpg_level', label: '战斗等级', category: 'combat' },
    ])
    const rows = [p('rpg_level', 10)]
    const result = extractCharacterFields(rows, template)
    expect(result.characterFields).toHaveLength(1)
    expect(result.characterFields[0].category).toBe('combat')
    expect(result.characterFields[0].label).toBe('战斗等级')
  })
})
