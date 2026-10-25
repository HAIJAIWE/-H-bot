/**
 * todo 域的纯类型：清单里的一项、三种状态、计数。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 *   packages/todo/tool-todo/src/types.ts
 *   https://github.com/deepseek-ai/deepseek-harness
 *
 * 本仓库改动：删掉两个 `declare module`（`SessionEventMap` 的 `todo/write` 与
 * `SessionProjectionMap` 的 `todos`）—— 那是上游会话事件重放与投影注册表的类型扩增，
 * 我们没有那套运行时；`TodoItem` 与三态状态一字未改。另把状态集合与计数提成本文件的
 * 运行期类型/常量（上游的状态数组写在 index.ts 里、计数写在 execute 里）。
 */

/** 清单项的三态生命周期（模型与界面共用同一套说法）。 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** 合法的状态值（运行期判据；模型给的参数最终要过这一关）。 */
export const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']

/**
 * 清单里的一项 —— `todo/write` 整表快照的单位。
 *
 * 故意保持最小：一行人能读懂的 `content` + 三态 `status`。没有 id / 优先级 /
 * activeForm —— 每次写入都是整表替换（后写覆盖前写），条目不需要稳定身份。
 */
export interface TodoItem {
  /** 这件事是什么 —— 一句短的祈使句，界面上原样显示。 */
  content: string
  /** 现在处在哪一态；并行工作时允许多个 `in_progress`。 */
  status: TodoStatus
}

/** 三个状态各几个（工具返回与界面条都读它）。 */
export interface TodoCounts {
  pending: number
  inProgress: number
  completed: number
}
