// src/main/services/agent-core/terminalTools.ts
//
// 6 个终端工具：terminal_open/send/read/signal/close/list
//
// 用于在 agent-core 里提供持久的交互式 shell 会话，让模型能连续运行命令、保留状态。
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Tool } from './core'
import { ShellSession } from './terminal'
import { assertWithinProject, joinSafe } from '../infra/pathGuard'

type ManagedSession = {
  id: string
  name: string
  session: ShellSession
  workspace: string
  createdAt: number
}

const MAX_TERMINAL_SESSIONS = 4
const MAX_RESULT_BYTES = 262_144

const sessions = new Map<string, ManagedSession>()

function truncateOutput(output: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(output)
  if (bytes.length <= MAX_RESULT_BYTES) return output
  const cutBytes = MAX_RESULT_BYTES - 30
  const decoder = new TextDecoder()
  const truncated = decoder.decode(bytes.slice(0, cutBytes))
  return truncated + '\n…（输出超过 256 KB，已截断）'
}

function generateId(): string {
  return 'term-' + Math.random().toString(36).slice(2, 8)
}

export function killAllAgentTerminals(): void {
  for (const s of sessions.values()) {
    try {
      s.session.kill()
    } catch {
      // Ignore
    }
  }
  sessions.clear()
}

function extractString(arg: unknown, fieldName: string): string {
  const val = typeof arg === 'string' ? arg : String(arg ?? '')
  if (!val && fieldName !== 'text') throw new Error(`缺少参数：${fieldName}`)
  return val
}

export const TERMINAL_TOOLS: Tool[] = [
  {
    name: 'terminal_open',
    description:
      '打开一个持久的 PowerShell 会话，只在需要持久终端状态或交互式 stdin 时使用；一次性命令请用 run_command',
    category: 'mutation',
    readOnly: false,
    executionMode: 'exclusive',
    timeoutMs: 20000,
    approval: args => ({ kind: 'tool', tool: 'terminal_open', args }),
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: '可选的工作目录，必须位于项目根目录内' },
        name: { type: 'string', description: '可选的会话名称' },
        shell: { type: 'string', description: '可选的 shell 路径，默认使用 powershell.exe' },
      },
      required: [],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const currentWorkspace = ctx.workspace
      const cwdArg = args.cwd
      const cwd = typeof cwdArg === 'string' ? cwdArg : currentWorkspace

      let resolvedCwd: string
      try {
        assertWithinProject(currentWorkspace, cwd)
        resolvedCwd = joinSafe(currentWorkspace, cwd)
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e ?? '')
        return `错误码：OPEN_FAILED - 工作目录越界：${errorMsg}`
      }

      await mkdir(resolvedCwd, { recursive: true })

      const existingByWorkspace = Array.from(sessions.values()).filter(
        s => s.workspace === currentWorkspace,
      )
      if (existingByWorkspace.length >= MAX_TERMINAL_SESSIONS) {
        const oldest = existingByWorkspace.reduce((a, b) => (a.createdAt < b.createdAt ? a : b))
        return `错误码：TOO_MANY_SESSIONS - 同一工作区最多 ${MAX_TERMINAL_SESSIONS} 个会话，请先关闭其他会话（建议先关闭：${oldest.name})`
      }

      const sessionNameArg = args.name
      const sessionName = typeof sessionNameArg === 'string' ? sessionNameArg : generateId()
      const shellArg = args.shell
      const shell = typeof shellArg === 'string' ? shellArg : undefined
      const session = new ShellSession({ cwd: resolvedCwd, shell })
      session.start()

      const id = generateId()
      sessions.set(id, {
        id,
        name: sessionName,
        session,
        workspace: currentWorkspace,
        createdAt: Date.now(),
      })

      let output = ''
      const initialRead = session.readSince(0)
      output = truncateOutput(initialRead.chunk)
      if (!output) output = '(无初始输出)\n'

      const actualShell = shell ?? 'powershell.exe'
      return `会话 ${sessionName}（${id}）已打开\ncwd: ${resolvedCwd}\nshell: ${actualShell}\npid: ${session.pid}\n启动输出：\n${output}`
    },
  },
  {
    name: 'terminal_send',
    description: '向指定的终端会话发送一行命令（可选自动提交），等待就绪后返回新产生的输出',
    category: 'mutation',
    readOnly: false,
    executionMode: 'exclusive',
    timeoutMs: 120000,
    approval: args => ({
      kind: 'command',
      command: String(args.text ?? '')
        .trimStart()
        .split('\n')[0],
    }),
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '目标会话 ID' },
        text: { type: 'string', description: '要发送的命令文本' },
        submit: { type: 'boolean', description: '是否在末尾补 \\n（默认 true）', default: true },
      },
      required: ['sessionId', 'text'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const currentWorkspace = ctx.workspace
      const sessionIdArg = args.sessionId
      if (typeof sessionIdArg !== 'string') {
        return '错误码：NO_SESSION - 无效的会话 ID'
      }
      const sessionInfo = sessions.get(sessionIdArg)
      if (!sessionInfo) {
        return '错误码：NO_SESSION - 找不到该会话'
      }
      if (sessionInfo.workspace !== currentWorkspace) {
        return '错误码：FOREIGN_SESSION - 该会话属于其他工作区'
      }

      const textArg = args.text
      const text = typeof textArg === 'string' ? textArg : ''
      const result = await sessionInfo.session.send(text, {
        submit: args.submit !== false,
      })

      let outputText = truncateOutput(result.output)
      if (!outputText) outputText = '(无输出)\n'

      const waitReasonText =
        result.waitReason === 'stdin_read'
          ? '就绪原因：stdin_read（看到提示符，表示命令可能已接受输入）'
          : result.waitReason === 'inferred_idle'
            ? '就绪原因：inferred_idle（输出安静了 400ms，不代表命令已退出）'
            : result.waitReason === 'timeout'
              ? '就绪原因：timeout（等待超时 10s）'
              : result.waitReason === 'session_exit'
                ? '就绪原因：session_exit（shell 会话已退出）'
                : `就绪原因：${result.waitReason}`

      return `${outputText}\n${waitReasonText}`
    },
  },
  {
    name: 'terminal_read',
    description: '读取指定终端会话从某个 cursor 位置以来的累积输出',
    category: 'query',
    readOnly: true,
    executionMode: 'parallel',
    timeoutMs: 5000,
    isConcurrencySafe: args => !!args.sessionId,
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '目标会话 ID' },
        cursor: {
          type: 'number',
          description: '可选的起始光标位置（绝对偏移），不填则从 0 开始读',
        },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const currentWorkspace = ctx.workspace
      const sessionIdArg = args.sessionId
      if (typeof sessionIdArg !== 'string') {
        return '错误码：NO_SESSION - 无效的会话 ID'
      }
      const sessionInfo = sessions.get(sessionIdArg)
      if (!sessionInfo) {
        return '错误码：NO_SESSION - 找不到该会话'
      }
      if (sessionInfo.workspace !== currentWorkspace) {
        return '错误码：FOREIGN_SESSION - 该会话属于其他工作区'
      }

      // cursor 默认为 0（不传时从开头读）
      const cursorArg = args.cursor
      const cursor = typeof cursorArg === 'number' ? cursorArg : 0
      const result = sessionInfo.session.readSince(cursor)
      const chunk = truncateOutput(result.chunk)

      return `cursor: ${result.cursor}\n增量输出：\n${chunk || '(无新增输出)'}`
    },
  },
  {
    name: 'terminal_signal',
    description: '向终端会话发送信号（如 SIGINT 中断运行中的命令）',
    category: 'mutation',
    readOnly: false,
    executionMode: 'exclusive',
    timeoutMs: 5000,
    approval: args => ({ kind: 'tool', tool: 'terminal_signal', args }),
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '目标会话 ID' },
        signal: {
          type: 'string',
          enum: ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP'],
          description: '要发送的信号',
        },
      },
      required: ['sessionId', 'signal'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const currentWorkspace = ctx.workspace
      const sessionIdArg = args.sessionId
      if (typeof sessionIdArg !== 'string') {
        return '错误码：NO_SESSION - 无效的会话 ID'
      }
      const sessionInfo = sessions.get(sessionIdArg)
      if (!sessionInfo) {
        return '错误码：NO_SESSION - 找不到该会话'
      }
      if (sessionInfo.workspace !== currentWorkspace) {
        return '错误码：FOREIGN_SESSION - 该会话属于其他工作区'
      }

      const sigArg = args.signal
      const sig = typeof sigArg === 'string' ? sigArg : ''
      if (!['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP'].includes(sig)) {
        return `错误码：无效信号 - ${sig} 不是支持的信号之一`
      }
      const success = sessionInfo.session.signal(
        sig as 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP',
      )
      if (!success) {
        return `警告：该平台不支持信号 ${sig}，会话未改变`
      }
      return `已向会话 ${sessionInfo.name} 发送信号 ${sig}，进程应已响应`
    },
  },
  {
    name: 'terminal_close',
    description: '关闭指定的终端会话并释放资源',
    category: 'mutation',
    readOnly: false,
    executionMode: 'exclusive',
    timeoutMs: 15000,
    approval: args => ({ kind: 'tool', tool: 'terminal_close', args }),
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '要关闭的会话 ID' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const currentWorkspace = ctx.workspace
      const sessionIdArg = args.sessionId
      if (typeof sessionIdArg !== 'string') {
        return '错误码：NO_SESSION - 无效的会话 ID'
      }
      const sessionInfo = sessions.get(sessionIdArg)
      if (!sessionInfo) {
        return '错误码：NO_SESSION - 找不到该会话'
      }
      if (sessionInfo.workspace !== currentWorkspace) {
        return '错误码：FOREIGN_SESSION - 该会话属于其他工作区'
      }

      const name = sessionInfo.name
      sessionInfo.session.kill()
      sessions.delete(sessionIdArg)

      return `会话 ${name}（${sessionIdArg}）已关闭并清理`
    },
  },
  {
    name: 'terminal_list',
    description: '列出当前所有打开的终端会话及其状态',
    category: 'query',
    readOnly: true,
    executionMode: 'parallel',
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    parameters: {},
    async run(_args, ctx) {
      const currentWorkspace = ctx.workspace
      const mySessions = Array.from(sessions.values()).filter(s => s.workspace === currentWorkspace)

      if (mySessions.length === 0) {
        return '当前没有打开的终端会话。'
      }

      const lines = ['当前打开的会话：']
      for (const s of mySessions) {
        const alive = s.session.alive ? '活动' : '非活动'
        const status = s.session.pid != null ? `pid=${s.session.pid}` : '未分配 pid'
        lines.push(`- ${s.name} (${s.id}): ${alive}, ${status}`)
      }
      return lines.join('\n')
    },
  },
]
