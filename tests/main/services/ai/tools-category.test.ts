// tests/main/services/ai/tools-category.test.ts
import { describe, it, expect } from 'vitest'
import { ALL_TOOL_DEFINITIONS, getToolCategory } from '@main/services/ai/tools'

describe('工具分类', () => {
  it('list_nodes 是 query 类（即使工具定义尚未添加，getToolCategory 仍按映射返回）', () => {
    expect(getToolCategory('list_nodes')).toBe('query')
  })

  it('add_node 是 mutation 类', () => {
    expect(getToolCategory('add_node')).toBe('mutation')
  })

  it('read_flow 是 query 类', () => {
    expect(getToolCategory('read_flow')).toBe('query')
  })

  it('write_code 是 mutation 类', () => {
    expect(getToolCategory('write_code')).toBe('mutation')
  })

  it('generate_code 是 mutation 类（即使工具定义尚未添加，getToolCategory 仍按映射返回）', () => {
    expect(getToolCategory('generate_code')).toBe('mutation')
  })

  it('connect_nodes 是 mutation 类', () => {
    expect(getToolCategory('connect_nodes')).toBe('mutation')
  })

  it('run_command 是 mutation 类（立即执行无确认是危险的，需用户确认）', () => {
    expect(getToolCategory('run_command')).toBe('mutation')
  })

  it('所有工具都有 category 字段', () => {
    for (const def of ALL_TOOL_DEFINITIONS) {
      expect(def.category).toBeDefined()
      expect(['query', 'mutation']).toContain(def.category)
    }
  })
})
