// src/main/schemas/runtime.ts
import { z } from 'zod'

export const startBotSchema = z.object({
  projectPath: z.string().min(1)
})

export const stopBotSchema = z.object({
  projectPath: z.string().min(1)
})

export const getBotStatusSchema = z.object({
  projectPath: z.string().min(1)
})

// 运行时控制台命令白名单：仅允许安全的内置命令或符合严格字符集的简单命令。
// 禁止包含 shell 元字符、换行符或过长字符串，防止通过 stdin 注入恶意输入。
const ALLOWED_COMMANDS = new Set([
  'help', 'status', 'info', 'version', 'plugins', 'reload',
  'stop', 'exit', 'quit', 'logs', 'debug', 'env', 'config'
])
const SAFE_COMMAND_REGEX = /^[a-zA-Z0-9_\- ]{1,200}$/
// 命令参数中允许的额外字符（仅用于白名单命令的扩展参数）
const SAFE_ARG_REGEX = /^[a-zA-Z0-9_\- /.:=]{0,200}$/

const commandSchema = z.string()
  .min(1)
  .max(200)
  .refine(
    (cmd) => {
      const trimmed = cmd.trim()
      const normalized = trimmed.toLowerCase()
      // 1. 命中内置白名单：允许带简单参数，如 "help send_message"
      const base = normalized.split(/\s+/)[0]
      if (ALLOWED_COMMANDS.has(base)) {
        const rest = trimmed.slice(base.length).trim()
        return rest === '' || SAFE_ARG_REGEX.test(rest)
      }
      // 2. 非白名单命令必须仅含字母/数字/下划线/连字符/空格
      return SAFE_COMMAND_REGEX.test(trimmed)
    },
    { message: '命令不在白名单中或包含非法字符' }
  )

export const sendCommandSchema = z.object({
  projectPath: z.string().min(1),
  command: commandSchema
})

export const restartBotSchema = z.object({
  projectPath: z.string().min(1)
})

export const injectTestMessageSchema = z.object({
  projectPath: z.string().min(1),
  message: z.string().min(1),
  // 消息类型：'group'（默认，群聊）或 'c2c'（私聊），原实现硬编码 group
  chatType: z.enum(['group', 'c2c']).optional(),
  // chatId：群聊时为 group_id，私聊时为 user_id；缺省时使用测试占位值
  chatId: z.number().optional()
})
