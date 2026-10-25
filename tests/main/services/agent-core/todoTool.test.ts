// tests/main/services/agent-core/todoTool.test.ts
//
// # todo_write：模型自己的多步清单
//
// 四件事：描述随并行策略只变一句、校验照上游口径（去空白/不重复/活跃数）、
// 写进按工作区隔离的 store、以及它真的注册进了循环的工具表。
import { describe, it, expect, beforeEach } from 'vitest'
import { listTools } from '@main/services/agent-core/core'
import { ALLOW_PARALLEL_IN_PROGRESS, TODO_TOOL } from '@main/services/agent-core/todoTool'
import { clearTodos, getTodos, setTodos } from '@main/services/agent-core/todoStore'
import {
  DESCRIPTION_HEAD,
  countTodos,
  describeTodoTool,
  formatTodoSummary,
  toTodoList,
} from '@main/vendor/dsh/todo/todo-list'

type Status = 'pending' | 'in_progress' | 'completed'
const item = (content: string, status: Status = 'pending') => ({ content, status })
const ctx = (workspace = 'C:/proj-a') => ({ workspace })

beforeEach(() => {
  clearTodos('C:/proj-a')
  clearTodos('C:/proj-b')
})

describe('vendor 纯函数（上游口径）', () => {
  it('并行 / 单活跃两种描述只差活跃那一句', () => {
    const parallel = describeTodoTool(true)
    const single = describeTodoTool(false)
    expect(parallel.startsWith(DESCRIPTION_HEAD)).toBe(true)
    expect(parallel).toContain('several only when work runs in parallel')
    expect(single).toContain('exactly one todo')
    expect(single).not.toContain('several only')
  })

  it('内容去首尾空白；空串与重复都拒（文案与上游一致）', () => {
    expect(toTodoList([{ content: '  看流程  ', status: 'pending' }], true)).toEqual([
      { content: '看流程', status: 'pending' },
    ])
    expect(() => toTodoList([{ content: '   ', status: 'pending' }], true)).toThrow(
      'invalid todo: `content` must be a non-empty string',
    )
    expect(() =>
      toTodoList(
        [
          { content: 'a', status: 'pending' },
          { content: ' a ', status: 'completed' },
        ],
        true,
      ),
    ).toThrow('invalid todos: duplicate content "a"')
  })

  it('不允许并行时两个 in_progress 报错；允许时放行', () => {
    const two = [
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'in_progress' },
    ]
    expect(() => toTodoList(two, false)).toThrow('at most one task may be in_progress (got 2)')
    expect(toTodoList(two, true)).toHaveLength(2)
  })

  it('计数与回执文案', () => {
    const counts = countTodos([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ])
    expect(counts).toEqual({ pending: 1, inProgress: 1, completed: 1 })
    expect(formatTodoSummary(counts)).toBe(
      'Updated todo list: 1 pending, 1 in progress, 1 completed.',
    )
  })
})

describe('todo_write 工具', () => {
  it('已注册进循环的工具表，且是只读的 query（计划模式也能用）', () => {
    expect(listTools().some(t => t.name === 'todo_write')).toBe(true)
    expect(TODO_TOOL.category).toBe('query')
    expect(TODO_TOOL.readOnly).toBe(true)
    expect(ALLOW_PARALLEL_IN_PROGRESS).toBe(true)
  })

  it('写进 store（按工作区隔离），返回一句计数回执', async () => {
    const out = await TODO_TOOL.run(
      { todos: [item('看流程', 'in_progress'), item('改节点')] },
      ctx('C:/proj-a'),
    )
    expect(out).toBe('Updated todo list: 1 pending, 1 in progress, 0 completed.')
    expect(getTodos('C:/proj-a')).toEqual([
      { content: '看流程', status: 'in_progress' },
      { content: '改节点', status: 'pending' },
    ])
    expect(getTodos('C:/proj-b')).toEqual([])
  })

  it('参数不是数组直接拒（不当成空清单悄悄写进去）', async () => {
    await expect(TODO_TOOL.run({ todos: 'x' }, ctx())).rejects.toThrow('todos')
    expect(getTodos('C:/proj-a')).toEqual([])
  })

  it('校验失败不覆盖上一份清单', async () => {
    setTodos('C:/proj-a', [item('旧的', 'completed')])
    await expect(
      TODO_TOOL.run({ todos: [item('a'), item('a')] }, ctx('C:/proj-a')),
    ).rejects.toThrow('duplicate')
    expect(getTodos('C:/proj-a')).toEqual([{ content: '旧的', status: 'completed' }])
  })
})
