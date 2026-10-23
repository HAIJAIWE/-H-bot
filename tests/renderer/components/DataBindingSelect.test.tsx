// tests/renderer/components/DataBindingSelect.test.tsx
import { describe, it, expect } from 'vitest'
import { collectBindingOptions, findBinding, getRelevantOutputIds } from '../../../src/renderer/src/components/blocks/DataBindingSelect'
import type { FlowNode, FlowEdge } from '../../../src/shared/types/flow'

const makeNode = (id: string, label: string, kind: string, outputs: any[], config: Record<string, unknown> = {}): FlowNode => ({
  id,
  type: 'action',
  position: { x: 0, y: 0 },
  data: { label, nodeKind: kind, config, inputs: [], outputs },
})

describe('DataBindingSelect', () => {
  it('collectBindingOptions 收集上游数据输出端口', () => {
    const upstream: FlowNode[] = [
      makeNode('n1', '读积分', 'fake_load', [
        { id: 'out', name: '执行', kind: 'control' },
        { id: 'result', name: '结果', kind: 'data', dataType: 'any' },
      ]),
      makeNode('n2', '获取QQ号', 'fake_uid', [
        { id: 'out', name: '执行', kind: 'control' },
        { id: 'user_id', name: 'QQ号', kind: 'data', dataType: 'string' },
      ]),
    ]
    const options = collectBindingOptions(upstream)
    expect(options).toHaveLength(2)
    expect(options[0].label).toBe('读积分 · 结果')
    expect(options[1].label).toBe('获取QQ号 · QQ号')
  })

  it('findBinding 找到已绑定的数据流边', () => {
    const edges: FlowEdge[] = [
      { id: 'e1', source: 'n1', sourcePort: 'result', target: 'n3', targetPort: 'a' },
      { id: 'e2', source: 'n1', sourcePort: 'out', target: 'n3', targetPort: 'in' },
    ]
    const binding = findBinding(edges, 'n3', 'a')
    expect(binding).toBeDefined()
    expect(binding?.source).toBe('n1')
    expect(binding?.sourcePort).toBe('result')
  })

  it('findBinding 忽略控制流边', () => {
    const edges: FlowEdge[] = [
      { id: 'e2', source: 'n1', sourcePort: 'out', target: 'n3', targetPort: 'in' },
    ]
    const binding = findBinding(edges, 'n3', 'in')
    expect(binding).toBeUndefined()
  })
})

describe('getRelevantOutputIds', () => {
  it('对未定义的节点 kind 返回 null（不过滤）', () => {
    expect(getRelevantOutputIds('unknown_kind', {})).toBeNull()
  })

  it('对未定义的 mode 返回 null（不过滤）', () => {
    expect(getRelevantOutputIds('variable_persist', { mode: 'unknown_mode' })).toBeNull()
  })

  it('variable_persist save 模式只返回 success/error', () => {
    const result = getRelevantOutputIds('variable_persist', { mode: 'save' })
    expect(result).toEqual(['success', 'error'])
  })

  it('variable_persist load 模式返回 result/success/error', () => {
    const result = getRelevantOutputIds('variable_persist', { mode: 'load' })
    expect(result).toEqual(['result', 'success', 'error'])
  })

  it('variable_persist increment 模式返回 result/old_value/success/error', () => {
    const result = getRelevantOutputIds('variable_persist', { mode: 'increment' })
    expect(result).toEqual(['result', 'old_value', 'success', 'error'])
  })

  it('message_received 使用 match 字段而非 mode 字段', () => {
    // match=command 时应返回 event/raw_message/args
    const result = getRelevantOutputIds('message_received', { match: 'command' })
    expect(result).toEqual(['event', 'raw_message', 'args'])
  })

  it('message_received match=regex 返回 matched/groups', () => {
    const result = getRelevantOutputIds('message_received', { match: 'regex' })
    expect(result).toEqual(['event', 'raw_message', 'matched', 'groups'])
  })

  it('http_request 使用 response_format 字段而非 mode 字段', () => {
    const result = getRelevantOutputIds('http_request', { response_format: 'json' })
    expect(result).toEqual(['status', 'data', 'error'])
  })

  it('http_request response_format=text 不包含 data', () => {
    const result = getRelevantOutputIds('http_request', { response_format: 'text' })
    expect(result).toEqual(['status', 'text', 'error'])
    expect(result).not.toContain('data')
  })

  it('time_op now 模式返回 6 个输出', () => {
    const result = getRelevantOutputIds('time_op', { mode: 'now' })
    expect(result).toHaveLength(6)
    expect(result).toContain('timestamp')
    expect(result).toContain('weekday')
  })

  it('time_op is_today 模式只返回 result/error', () => {
    const result = getRelevantOutputIds('time_op', { mode: 'is_today' })
    expect(result).toEqual(['result', 'error'])
  })

  it('file_operate exists 模式返回 exists/is_file/is_dir/success/error', () => {
    const result = getRelevantOutputIds('file_operate', { mode: 'exists' })
    expect(result).toEqual(['exists', 'is_file', 'is_dir', 'success', 'error'])
  })

  it('database_write insert 模式返回 lastrowid', () => {
    const result = getRelevantOutputIds('database_write', { mode: 'insert' })
    expect(result).toEqual(['success', 'lastrowid', 'error'])
  })

  it('database_write delete 模式返回 rows_deleted', () => {
    const result = getRelevantOutputIds('database_write', { mode: 'delete' })
    expect(result).toEqual(['success', 'rows_deleted', 'error'])
  })

  it('loop times 模式不返回 item/key', () => {
    const result = getRelevantOutputIds('loop', { mode: 'times' })
    expect(result).toEqual(['index', 'count'])
    expect(result).not.toContain('item')
    expect(result).not.toContain('key')
  })

  it('loop iterate 模式返回 item/key', () => {
    const result = getRelevantOutputIds('loop', { mode: 'iterate' })
    expect(result).toEqual(['index', 'count', 'item', 'key'])
  })
})

describe('collectBindingOptions 模式过滤', () => {
  it('variable_persist save 模式只收集 success/error（不含 result）', () => {
    const upstream: FlowNode[] = [
      makeNode('n1', '保存积分', 'variable_persist', [
        { id: 'out', name: '出口', kind: 'control' },
        { id: 'result', name: '结果', kind: 'data', dataType: 'any' },
        { id: 'success', name: '成功', kind: 'data', dataType: 'boolean' },
        { id: 'error', name: '错误', kind: 'data', dataType: 'string' },
        { id: 'exists', name: '存在', kind: 'data', dataType: 'boolean' },
      ], { mode: 'save' }),
    ]
    const options = collectBindingOptions(upstream)
    expect(options).toHaveLength(2)
    const portIds = options.map((o) => o.portId)
    expect(portIds).toContain('success')
    expect(portIds).toContain('error')
    expect(portIds).not.toContain('result')
    expect(portIds).not.toContain('exists')
  })

  it('variable_persist load 模式收集 result/success/error', () => {
    const upstream: FlowNode[] = [
      makeNode('n1', '读取积分', 'variable_persist', [
        { id: 'out', name: '出口', kind: 'control' },
        { id: 'result', name: '结果', kind: 'data', dataType: 'any' },
        { id: 'success', name: '成功', kind: 'data', dataType: 'boolean' },
        { id: 'error', name: '错误', kind: 'data', dataType: 'string' },
        { id: 'old_value', name: '旧值', kind: 'data', dataType: 'any' },
      ], { mode: 'load' }),
    ]
    const options = collectBindingOptions(upstream)
    expect(options).toHaveLength(3)
    const portIds = options.map((o) => o.portId)
    expect(portIds).toContain('result')
    expect(portIds).not.toContain('old_value')
  })

  it('未定义模式过滤的节点返回全部数据输出', () => {
    const upstream: FlowNode[] = [
      makeNode('n1', 'JSON操作', 'json_op', [
        { id: 'out', name: '出口', kind: 'control' },
        { id: 'result', name: '结果', kind: 'data', dataType: 'any' },
        { id: 'error', name: '错误', kind: 'data', dataType: 'string' },
      ]),
    ]
    const options = collectBindingOptions(upstream)
    expect(options).toHaveLength(2)
  })

  it('空 config 时 variable_persist 不过滤（返回全部）', () => {
    // 使用 fake kind 避免 findSpec 返回真实 spec，确保使用 makeNode 的 outputs
    const upstream: FlowNode[] = [
      makeNode('n1', '持久化', 'fake_persistent', [
        { id: 'out', name: '出口', kind: 'control' },
        { id: 'result', name: '结果', kind: 'data', dataType: 'any' },
        { id: 'success', name: '成功', kind: 'data', dataType: 'boolean' },
        { id: 'error', name: '错误', kind: 'data', dataType: 'string' },
      ], {}),  // 空 config，mode 为空字符串
    ]
    const options = collectBindingOptions(upstream)
    // fake kind 不在 MODE_OUTPUT_FILTER 中，返回 null（不过滤），返回全部 3 个数据输出
    expect(options).toHaveLength(3)
  })
})
