import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  NodeRegistry,
  getNodeRegistry,
  _resetRegistryForTesting
} from '@main/nodes/registry'
import type { NodeSpecV2 } from '@shared/types/nodeV2'

// 构造 NodeSpecV2 的辅助函数
function makeSpec(overrides: Partial<NodeSpecV2>): NodeSpecV2 {
  return {
    kind: 'test',
    type: 'action',
    label: '测试',
    group: '动作',
    icon: 'T',
    description: '',
    summary: '',
    sideEffects: [],
    tags: [],
    handler: { source: 'builtin', module: 'test' },
    exposedAsTool: false,
    defaultConfig: {},
    inputs: [],
    outputs: [],
    ...overrides
  }
}

describe('NodeRegistry', () => {
  let registry: NodeRegistry

  beforeEach(() => {
    registry = new NodeRegistry()
  })

  it('注册并查找内置节点', () => {
    const spec = makeSpec({ kind: 'test_node' })
    registry.registerBuiltin(spec)
    expect(registry.find('test_node')).toEqual(spec)
  })

  it('listAll 合并内置+自定义', () => {
    registry.registerBuiltin(makeSpec({ kind: 'b1' }))
    registry.registerCustom(
      makeSpec({ kind: 'c1', type: 'custom', handler: { source: 'custom', funcName: 'c1' } })
    )
    expect(registry.listAll()).toHaveLength(2)
  })

  it('getToolExposedNodes 返回 exposedAsTool=true 的节点', () => {
    registry.registerBuiltin(
      makeSpec({
        kind: 'tool1',
        exposedAsTool: true,
        toolName: '工具1',
        toolArgs: ['x']
      })
    )
    registry.registerBuiltin(makeSpec({ kind: 'notool', summary: '非工具' }))
    const tools = registry.getToolExposedNodes()
    expect(tools).toHaveLength(1)
    expect(tools[0].kind).toBe('tool1')
  })

  it('find 找不到返回 undefined', () => {
    expect(registry.find('nonexistent')).toBeUndefined()
  })

  it('clearCustom 清空自定义节点', () => {
    registry.registerCustom(
      makeSpec({ kind: 'c1', type: 'custom', handler: { source: 'custom', funcName: 'c1' } })
    )
    registry.clearCustom()
    expect(registry.find('c1')).toBeUndefined()
  })

  // 修复 H3: registerCustom/registerAiGenerated 添加重复注册告警
  it('修复 H3: custom 与 builtin 同名时应告警且 find 返回 builtin', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builtinSpec = makeSpec({ kind: 'shared_kind', label: '内置' })
    const customSpec = makeSpec({
      kind: 'shared_kind',
      label: '自定义覆盖',
      type: 'custom',
      handler: { source: 'custom', funcName: 'shared_kind' }
    })
    registry.registerBuiltin(builtinSpec)
    registry.registerCustom(customSpec)
    // find 优先返回 builtin
    expect(registry.find('shared_kind')?.label).toBe('内置')
    // 应有告警
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = warnSpy.mock.calls.map((c) => String(c[0])).join(' ')
    expect(warnMsg).toContain('影子化')
    warnSpy.mockRestore()
  })

  it('修复 H3: 重复注册 builtin 应告警', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registry.registerBuiltin(makeSpec({ kind: 'dup', label: '第一' }))
    registry.registerBuiltin(makeSpec({ kind: 'dup', label: '第二' }))
    expect(registry.find('dup')?.label).toBe('第二')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('修复 H3: 重复注册 custom 应告警', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registry.registerCustom(
      makeSpec({ kind: 'cdup', handler: { source: 'custom', funcName: 'cdup' } })
    )
    registry.registerCustom(
      makeSpec({ kind: 'cdup', handler: { source: 'custom', funcName: 'cdup' } })
    )
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = warnSpy.mock.calls.map((c) => String(c[0])).join(' ')
    expect(warnMsg).toContain('重复注册')
    warnSpy.mockRestore()
  })

  it('修复 H3: AI 生成节点与 builtin/custom 同名应告警影子化', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registry.registerBuiltin(makeSpec({ kind: 'ai_dup' }))
    registry.registerAiGenerated(
      makeSpec({ kind: 'ai_dup', handler: { source: 'ai_generated', code: 'pass' } })
    )
    expect(warnSpy).toHaveBeenCalled()
    const warnMsg = warnSpy.mock.calls.map((c) => String(c[0])).join(' ')
    expect(warnMsg).toContain('影子化')
    warnSpy.mockRestore()
  })

  // 修复 L4: getToolExposedNodes 缓存，注册新节点后失效
  it('修复 L4: getToolExposedNodes 缓存正确失效', () => {
    registry.registerBuiltin(makeSpec({ kind: 't1', exposedAsTool: true }))
    const first = registry.getToolExposedNodes()
    expect(first).toHaveLength(1)
    // 注册新工具节点后，缓存应失效，重新计算
    registry.registerBuiltin(makeSpec({ kind: 't2', exposedAsTool: true }))
    const second = registry.getToolExposedNodes()
    expect(second).toHaveLength(2)
  })

  it('修复 L4: clearCustom 后 getToolExposedNodes 缓存失效', () => {
    registry.registerCustom(
      makeSpec({
        kind: 'ct',
        exposedAsTool: true,
        handler: { source: 'custom', funcName: 'ct' }
      })
    )
    expect(registry.getToolExposedNodes()).toHaveLength(1)
    registry.clearCustom()
    expect(registry.getToolExposedNodes()).toHaveLength(0)
  })

  // 修复 M4: builtin 初始化标记
  it('修复 M4: markBuiltinInitialized / isBuiltinInitialized 工作', () => {
    expect(registry.isBuiltinInitialized()).toBe(false)
    registry.markBuiltinInitialized()
    expect(registry.isBuiltinInitialized()).toBe(true)
  })
})

describe('getNodeRegistry 单例', () => {
  afterEach(() => {
    _resetRegistryForTesting()
  })

  it('返回同一个实例', () => {
    const a = getNodeRegistry()
    const b = getNodeRegistry()
    expect(a).toBe(b)
  })

  // 修复 M4: _resetRegistryForTesting 重置单例
  it('修复 M4: _resetRegistryForTesting 重置单例', () => {
    const a = getNodeRegistry()
    _resetRegistryForTesting()
    const b = getNodeRegistry()
    expect(a).not.toBe(b)
  })
})
