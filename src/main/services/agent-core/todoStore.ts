// src/main/services/agent-core/todoStore.ts
//
// 任务清单的**进程内**存储：按工作区（= 项目根）各存一份。
//
// 为什么不做成会话文件：清单是"这一轮打算怎么做"的临时脚手架，不是历史真相。
// 每轮开始清空（见 aiAgentCore 的 run 循环），界面靠 `ai:todo` 事件跟着它变。
// 真要留痕，历史里已有 `todo_write` 的工具调用与回执 —— 不必再存第二份。
import { resolve } from 'node:path'
import type { TodoItem } from '../../vendor/dsh/todo/types'

const LISTS = new Map<string, TodoItem[]>()

/** 覆盖式写入一张清单（整表替换，后写覆盖前写）。 */
export function setTodos(workspace: string, todos: readonly TodoItem[]): void {
  LISTS.set(
    resolve(workspace),
    todos.map(todo => ({ content: todo.content, status: todo.status })),
  )
}

/** 读当前清单（副本；没有就是空数组）。 */
export function getTodos(workspace: string): TodoItem[] {
  return (LISTS.get(resolve(workspace)) ?? []).map(todo => ({
    content: todo.content,
    status: todo.status,
  }))
}

/** 清空（每轮开始 / 结束时调）。 */
export function clearTodos(workspace: string): void {
  LISTS.delete(resolve(workspace))
}
