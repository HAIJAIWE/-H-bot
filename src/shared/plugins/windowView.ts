// src/shared/plugins/windowView.ts
//
// **可执行窗口包的视图协议**（第 74 批，P4b-1）。
//
// 第 73 批只允许"声明式清单"，第三方画不了自己的界面。本批给清单加 `entry`：
// 一份自包含 JS 跑在 **Blob module worker** 里（没有 DOM、没有 Node），只能通过
// postMessage 和宿主交换两种东西：
//   - 宿主 → worker：`init`（版本/包 id/声明的能力）、`context`（只读会话快照）
//   - worker → 宿主：`view`（一棵受限的视图树，宿主用自己的组件画）、`command`（请求动作）
//
// 安全边界在三条上：① worker 里没有 DOM/Node，碰不到 React 树和主进程；
// ② 视图树是**数据**，宿主只认白名单节点、限制深度/数量/文本长度；
// ③ 命令必须先在清单里声明 capability，宿主再按白名单执行。
//
// 本文件必须是纯 TS（可被 node 直跑）：不 import electron、fs、React。

/** 视图协议版本：宿主与 worker 都用它协商，不匹配就不解释对方的包 */
export const WINDOW_VIEW_API_VERSION = 1

/** 视图树硬上限（防御恶意/失控的 worker 把渲染进程拖死） */
export const WINDOW_VIEW_MAX_DEPTH = 6
export const WINDOW_VIEW_MAX_NODES = 300
export const WINDOW_VIEW_MAX_ITEMS = 200
export const WINDOW_VIEW_MAX_TEXT = 4000
export const WINDOW_VIEW_MAX_PAYLOAD = 500

/** 窗口能请求的动作（清单里用 capabilities 声明，宿主按白名单执行） */
export const WINDOW_VIEW_COMMANDS = ['send-message', 'stop', 'select-thread'] as const
export type WindowViewCommand = (typeof WINDOW_VIEW_COMMANDS)[number]

/** 一个列表项：带 command 时点它是可执行动作（payload 是动作参数） */
export interface WindowViewListItem {
  title: string
  detail?: string
  active?: boolean
  command?: WindowViewCommand
  payload?: string
}

/** 受限视图树：只认这几种节点，别的一律丢弃（不是渲染失败，是安全边界） */
export type WindowViewNode =
  | { type: 'stack'; children: WindowViewNode[]; gap?: 'sm' | 'md' | 'lg' }
  | { type: 'header'; title: string; subtitle?: string }
  | { type: 'text'; content: string; muted?: boolean }
  | { type: 'message'; role: 'user' | 'assistant' | 'system'; content: string }
  | { type: 'list'; items: WindowViewListItem[] }
  | {
      type: 'button'
      label: string
      command: WindowViewCommand
      payload?: string
      primary?: boolean
      disabled?: boolean
    }
  | { type: 'divider' }
  | { type: 'empty'; text: string }

/** worker 交回来的一次完整视图 */
export interface WindowView {
  root: WindowViewNode
}

export type WindowViewValidation =
  { ok: true; view: WindowView; issues: string[] } | { ok: false; issues: string[] }

type Rec = Record<string, unknown>

function isRecord(value: unknown): value is Rec {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCommand(value: unknown): value is WindowViewCommand {
  return typeof value === 'string' && (WINDOW_VIEW_COMMANDS as readonly string[]).includes(value)
}

/** 取一个受限长度的字符串：超长记一条 issue 并截断（文本超长不该让整棵视图作废） */
function text(value: unknown, max: number, issues: string[], field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    issues.push(`${field}: 必须是字符串`)
    return undefined
  }
  if (value.length > max) {
    issues.push(`${field}: 超过 ${max} 字符（已截断）`)
    return value.slice(0, max)
  }
  return value
}

/** 只把白名单里的布尔字段拷出来（未知字段丢弃，不透传） */
function pickBool(raw: Rec, key: string, issues: string[], field: string): boolean | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    issues.push(`${field}.${key}: 必须是布尔`)
    return undefined
  }
  return value
}

/**
 * 递归校验一个节点。`budget` 是整个视图共享的节点计数（不是每个子树各 300），
 * 这样 `stack` 嵌套再多也绕不过上限。
 */
function validateNode(
  raw: unknown,
  depth: number,
  budget: { remaining: number },
  issues: string[],
  path: string,
): WindowViewNode | undefined {
  if (depth > WINDOW_VIEW_MAX_DEPTH) {
    issues.push(`${path}: 嵌套超过 ${WINDOW_VIEW_MAX_DEPTH} 层`)
    return undefined
  }
  if (budget.remaining <= 0) {
    issues.push(`${path}: 节点数超过 ${WINDOW_VIEW_MAX_NODES}`)
    return undefined
  }
  if (!isRecord(raw)) {
    issues.push(`${path}: 节点必须是对象`)
    return undefined
  }
  budget.remaining -= 1

  const type = raw.type
  switch (type) {
    case 'stack': {
      const children = raw.children
      if (!Array.isArray(children)) {
        issues.push(`${path}.children: 必须是数组`)
        return undefined
      }
      const picked: WindowViewNode[] = []
      for (let i = 0; i < children.length; i += 1) {
        const child = validateNode(children[i], depth + 1, budget, issues, `${path}.children[${i}]`)
        if (child) picked.push(child)
      }
      const gap = raw.gap === 'sm' || raw.gap === 'md' || raw.gap === 'lg' ? raw.gap : undefined
      return { type: 'stack', children: picked, ...(gap ? { gap } : {}) }
    }
    case 'header': {
      const title = text(raw.title, WINDOW_VIEW_MAX_TEXT, issues, `${path}.title`)
      if (title === undefined) {
        issues.push(`${path}.title: 必填，字符串`)
        return undefined
      }
      const subtitle = text(raw.subtitle, WINDOW_VIEW_MAX_TEXT, issues, `${path}.subtitle`)
      return { type: 'header', title, ...(subtitle !== undefined ? { subtitle } : {}) }
    }
    case 'text': {
      const content = text(raw.content, WINDOW_VIEW_MAX_TEXT, issues, `${path}.content`)
      if (content === undefined) {
        issues.push(`${path}.content: 必填，字符串`)
        return undefined
      }
      const muted = pickBool(raw, 'muted', issues, path)
      return { type: 'text', content, ...(muted !== undefined ? { muted } : {}) }
    }
    case 'message': {
      const role = raw.role
      if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        issues.push(`${path}.role: 必须是 user / assistant / system`)
        return undefined
      }
      const content = text(raw.content, WINDOW_VIEW_MAX_TEXT, issues, `${path}.content`)
      if (content === undefined) {
        issues.push(`${path}.content: 必填，字符串`)
        return undefined
      }
      return { type: 'message', role, content }
    }
    case 'list': {
      const items = raw.items
      if (!Array.isArray(items)) {
        issues.push(`${path}.items: 必须是数组`)
        return undefined
      }
      if (items.length > WINDOW_VIEW_MAX_ITEMS) {
        issues.push(`${path}.items: 超过 ${WINDOW_VIEW_MAX_ITEMS} 项（已截断）`)
      }
      const picked: WindowViewListItem[] = []
      for (let i = 0; i < Math.min(items.length, WINDOW_VIEW_MAX_ITEMS); i += 1) {
        const item = items[i]
        const field = `${path}.items[${i}]`
        if (!isRecord(item)) {
          issues.push(`${field}: 必须是对象`)
          continue
        }
        const title = text(item.title, WINDOW_VIEW_MAX_TEXT, issues, `${field}.title`)
        if (title === undefined) {
          issues.push(`${field}.title: 必填，字符串`)
          continue
        }
        const detail = text(item.detail, WINDOW_VIEW_MAX_TEXT, issues, `${field}.detail`)
        const active = pickBool(item, 'active', issues, field)
        let command: WindowViewCommand | undefined
        if (item.command !== undefined) {
          if (!isCommand(item.command)) {
            issues.push(`${field}.command: 未知动作（可用：${WINDOW_VIEW_COMMANDS.join(' / ')}）`)
          } else {
            command = item.command
          }
        }
        const payload = text(item.payload, WINDOW_VIEW_MAX_PAYLOAD, issues, `${field}.payload`)
        picked.push({
          title,
          ...(detail !== undefined ? { detail } : {}),
          ...(active !== undefined ? { active } : {}),
          ...(command !== undefined ? { command } : {}),
          ...(payload !== undefined ? { payload } : {}),
        })
      }
      return { type: 'list', items: picked }
    }
    case 'button': {
      const label = text(raw.label, WINDOW_VIEW_MAX_TEXT, issues, `${path}.label`)
      if (label === undefined) {
        issues.push(`${path}.label: 必填，字符串`)
        return undefined
      }
      if (!isCommand(raw.command)) {
        issues.push(`${path}.command: 未知动作（可用：${WINDOW_VIEW_COMMANDS.join(' / ')}）`)
        return undefined
      }
      const payload = text(raw.payload, WINDOW_VIEW_MAX_PAYLOAD, issues, `${path}.payload`)
      const primary = pickBool(raw, 'primary', issues, path)
      const disabled = pickBool(raw, 'disabled', issues, path)
      return {
        type: 'button',
        label,
        command: raw.command,
        ...(payload !== undefined ? { payload } : {}),
        ...(primary !== undefined ? { primary } : {}),
        ...(disabled !== undefined ? { disabled } : {}),
      }
    }
    case 'divider':
      return { type: 'divider' }
    case 'empty': {
      const message = text(raw.text, WINDOW_VIEW_MAX_TEXT, issues, `${path}.text`)
      if (message === undefined) {
        issues.push(`${path}.text: 必填，字符串`)
        return undefined
      }
      return { type: 'empty', text: message }
    }
    default:
      issues.push(`${path}.type: 未知节点类型 ${String(type)}`)
      return undefined
  }
}

/**
 * 校验 worker 交回来的视图。`issues` 非空时**仍返回 view**（能画的都画出来），
 * 这样第三方写错一个字段是"少画一块"，而不是整个窗口白屏。
 */
export function validateWindowView(raw: unknown): WindowViewValidation {
  const issues: string[] = []
  if (!isRecord(raw)) return { ok: false, issues: ['view: 必须是对象 { root }'] }
  const root = validateNode(raw.root, 0, { remaining: WINDOW_VIEW_MAX_NODES }, issues, 'root')
  if (root === undefined) {
    issues.push('root: 视图根节点无效')
    return { ok: false, issues }
  }
  return { ok: true, view: { root }, issues }
}

// ---------------------------------------------------------------------------
// worker ⇄ 宿主 的消息形状
// ---------------------------------------------------------------------------

/** 宿主发给 worker 的初始化消息（第一条，先于任何 context） */
export interface WindowEntryInitMessage {
  type: 'init'
  apiVersion: number
  packageId: string
  /** 清单里声明过、宿主会执行的命令白名单 */
  capabilities: WindowViewCommand[]
}

/** 宿主投影给 worker 的只读会话快照（只留窗口要用的字段） */
export interface WindowEntryContext {
  projectPath: string
  threadId: string
  threads: { id: string; title: string; messageCount: number }[]
  messages: { role: string; content: string }[]
  streaming: boolean
  running: boolean
  pendingApproval: { toolName: string } | null
}

/** 宿主 → worker */
export type WindowEntryInbound =
  WindowEntryInitMessage | { type: 'context'; context: WindowEntryContext }

/** worker → 宿主 */
export type WindowEntryOutbound =
  | { type: 'view'; view: unknown }
  | { type: 'command'; command: WindowViewCommand; payload?: string }
