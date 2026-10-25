// src/main/vendor/dsh/spill-local/store.ts
//
// @license MIT
// @copyright Copyright (c) 2026 DeepSeek
// @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
// @upstream packages/spill/spill-local/src/store.ts
// @upstream https://github.com/deepseek-ai/deepseek-harness
//
// 本仓库改动（2026-10-25）：
//  1. 删掉"在系统临时目录建默认根"那一层（`privateRoot` / `DEFAULT_ROOT_PREFIX` /
//     `mkdtempSync`）：我们的溢出目录跟着项目走（`<项目>/.qqbat/ai-spill`），
//     没有进程级默认根这一层；根由调用方传（见 services/ai/spillStore.ts）。
//  2. `encodeSegment` / `sessionDir` 收成模块私有（外部只需要 `saveTextFile`）。
//  3. 其余逐字保留：目录 0700 / 文件 0600、`wx` 独占创建、文件名分段的单射编码、
//     会话 id 取哈希前缀做子目录、失败时抛给调用方处理。

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

/** 判断错误是不是某个 errno（Node 的错误码挂在 `error.code` 上）。 */
export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

/**
 * 把任意字符串编码成一个**安全且可逆**的文件名分段。
 *
 * 只保留 `[A-Za-z0-9._-]`，其余按 UTF-16 code unit 写成 `~XXXX`（大写十六进制）。
 * 空串、`.`、`..` 三个特殊值单独占位，所以编码结果绝不会是 `.` 或 `..` ——
 * 也就是说 `../../etc/passwd`、绝对路径、NUL、路径分隔符都被中和成一个平面名字。
 */
function encodeSegment(raw: string): string {
  if (raw === '') return '~'
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!
    if (char !== '~' && /[A-Za-z0-9._-]/.test(char)) out += char
    else out += `~${raw.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/** 一个会话一个子目录；目录名是会话 id 的哈希前缀，id 本身不进路径。 */
function sessionDir(root: string, sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex')
  return join(root, `session-${digest.slice(0, 12)}`)
}

export interface SaveTextOptions {
  /** 溢出的根目录（我们的 = `<项目>/.qqbat/ai-spill`） */
  root: string
  /** 会话标识（我们传项目路径；只用于算子目录名） */
  sessionId: string
  /** 给人看的建议名（会被 `encodeSegment` 编码，前面还会加随机前缀） */
  suggestedName: string
  content: string
}

export interface SavedText {
  path: string
  bytes: number
}

/**
 * 落一份文本，返回真实路径与字节数。
 * - 目录 0700、文件 0600（内容可能含凭据，别继承 umask 的宽松默认）；
 * - `wx` 独占创建（绝不覆盖已有文件），撞名由随机前缀避免；
 * - 目录刚被别人删掉时（`ENOENT`）重建一次再试；
 * - 失败原样抛出 —— fail-open 的判定在调用方（`spillStore.ts` 记警告后保留原结果）。
 */
export async function saveTextFile(options: SaveTextOptions): Promise<SavedText> {
  const dir = sessionDir(options.root, options.sessionId)
  const path = join(
    dir,
    `${randomBytes(6).toString('hex')}-${encodeSegment(options.suggestedName)}`,
  )
  let handle: FileHandle | undefined
  for (;;) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      handle = await open(path, 'wx', 0o600)
      break
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue
      throw error
    }
  }
  try {
    await handle.writeFile(options.content)
  } finally {
    await handle.close()
  }
  return { path, bytes: Buffer.byteLength(options.content, 'utf8') }
}
