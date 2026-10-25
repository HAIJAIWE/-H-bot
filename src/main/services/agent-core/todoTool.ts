// src/main/services/agent-core/todoTool.ts
//
// `todo_write`：模型用它"把打算做的几步写下来"，界面据此显示任务清单。
//
// 为什么值得给模型这一个工具：多步任务里模型最容易跑偏（做到第 3 步忘了第 5 步），
// 而"写下清单、随手更新状态"是它自己就能做的纠偏动作 —— 不需要权限、不动盘。
// 语义与文案搬自 DSH 的 `packages/todo/tool-todo`（见 vendor/dsh/todo/）。
import type { Tool } from './core'
import {
  countTodos,
  describeTodoTool,
  formatTodoSummary,
  toTodoList,
} from '../../vendor/dsh/todo/todo-list'
import { setTodos } from './todoStore'

/** 我们的调度器允许并行跑工具，所以多个条目同时 in_progress 是合法的。 */
export const ALLOW_PARALLEL_IN_PROGRESS = true

/**
 * `todo_write` 工具定义。
 *
 * ⚠️ 它**不**在 `CORE_TOOLS` 里：那 6 个由内置插件（files/runtime/flow）认领，
 * `builtinHostPlugins` 会校验"一个不漏"，把新工具塞进去会让启动直接抛错。
 * 它由 core.ts 单独注册 —— 不归任何插件，因此预设的 plugins 白名单也删不掉它。
 */
export const TODO_TOOL: Tool = {
  name: 'todo_write',
  description: describeTodoTool(ALLOW_PARALLEL_IN_PROGRESS),
  readOnly: true,
  category: 'query',
  executionMode: 'parallel',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The COMPLETE task list, replacing any previous list.',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'What the task is — a short imperative line.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'pending (not started) | in_progress (now) | completed (done).',
            },
          },
          required: ['content', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['todos'],
  },
  async run(args, ctx) {
    const raw = args.todos
    if (!Array.isArray(raw)) throw new Error('todo_write 需要 todos 数组')
    const todos = toTodoList(
      raw as { content: string; status: string }[],
      ALLOW_PARALLEL_IN_PROGRESS,
    )
    setTodos(ctx.workspace, todos)
    return formatTodoSummary(countTodos(todos))
  },
}
