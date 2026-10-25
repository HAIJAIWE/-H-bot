/**
 * 任务清单（`todo_write`）的纯函数：模型看的描述、校验与规范化、计数、一句回执。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 *   packages/todo/tool-todo/src/index.ts
 *   https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：把 `describe()` / `toTodoList()` 从 Cordis 的 `apply(ctx, config)` 里
 * 提出来并导出（`describe` 改名 `describeTodoTool`），**校验与文案一字没改**；
 * 新增 `countTodos()` / `formatTodoSummary()`（上游把这两段直接写在 execute/render 里）；
 * 参数 JSON Schema 搬去 `src/main/services/agent-core/todoTool.ts`，本文件不碰
 * zod / Session / 投影注册表。
 */

import type { TodoCounts, TodoItem, TodoStatus } from './types'

export const DESCRIPTION_HEAD =
  'Record and update a task list to plan multi-step work and show progress; skip it for trivial ' +
  'single-step tasks. Add one todo per concrete step before you start. '

export const DESCRIPTION_PARALLEL =
  'While work remains, keep the todos being worked on `in_progress`, several only when work runs in parallel. '

export const DESCRIPTION_SINGLE = 'While work remains, keep exactly one todo `in_progress`. '

export const DESCRIPTION_TAIL = 'Mark each todo `completed` as soon as it is done.'

/**
 * 这一次激活给模型看的工具描述。变化点只有活跃状态那一句 ——
 * 并行策略改的也只有这一句。
 * @param allowParallel - 是否允许多个条目同时 `in_progress`
 * @returns 拼好的工具描述
 */
export function describeTodoTool(allowParallel: boolean): string {
  return (
    DESCRIPTION_HEAD +
    (allowParallel ? DESCRIPTION_PARALLEL : DESCRIPTION_SINGLE) +
    DESCRIPTION_TAIL
  )
}

/**
 * 做 JSON Schema 表达不了的约束校验，并生成规范化的清单：
 * 内容去空白后非空、不重复；除非部署允许并行，最多一个 `in_progress`。
 * @param raw - 模型给的清单（状态枚举与未知键已由 schema 挡过）
 * @param allowParallel - 是否允许多个条目同时 `in_progress`
 * @returns 规范化后的清单
 */
export function toTodoList(
  raw: readonly { content: string; status: string }[],
  allowParallel: boolean,
): TodoItem[] {
  const todos: TodoItem[] = []
  const seen = new Set<string>()
  let active = 0
  for (const item of raw) {
    const content = item.content.trim()
    if (content.length === 0) {
      throw new Error('invalid todo: `content` must be a non-empty string')
    }
    if (seen.has(content)) {
      throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`)
    }
    seen.add(content)
    if (item.status === 'in_progress') active++
    todos.push({ content, status: item.status as TodoItem['status'] })
  }
  if (!allowParallel && active > 1) {
    throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`)
  }
  return todos
}

/**
 * 数一遍三态各几个（顺序与上游 render 里的 pending/inProgress/completed 一致）。
 * @param todos - 已规范化的清单
 * @returns 三个状态的计数
 */
export function countTodos(todos: readonly TodoItem[]): TodoCounts {
  const count = (status: TodoStatus): number => todos.filter(todo => todo.status === status).length
  return {
    pending: count('pending'),
    inProgress: count('in_progress'),
    completed: count('completed'),
  }
}

/**
 * 工具回执的那一句话（模型据此确认"我写的被收下了"）。
 * @param counts - 三个状态的计数
 * @returns 单行回执
 */
export function formatTodoSummary(counts: TodoCounts): string {
  return `Updated todo list: ${counts.pending} pending, ${counts.inProgress} in progress, ${counts.completed} completed.`
}
