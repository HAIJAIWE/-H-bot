// src/main/vendor/dsh/spill-local/cleanup.ts
//
// @license MIT
// @copyright Copyright (c) 2026 DeepSeek
// @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
// @upstream packages/spill/spill-local/src/cleanup.ts
// @upstream https://github.com/deepseek-ai/deepseek-harness
//
// 本仓库改动（2026-10-25）：
//  1. 删掉"发现系统临时目录里的默认根"那一套（`DEFAULT_ROOT_RE` /
//     `discoverDefaultRoots` / `gatherSweepRoots`）：我们没有进程级默认根，
//     每次清扫的根由调用方给（见 services/ai/spillStore.ts）。
//  2. 其余逐字保留：只删"本用户所有且组/他人不可写"的目录里的**过期普通文件**，
//     从不跟随符号链接、从不删非普通文件、任何失败都只警告不抛。

import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import { isErrno } from './store'

/**
 * 我们自己的会话目录名：`session-` + `sessionDir` 由 sha256 推出的 12 位小写十六进制。
 * 只认这个**精确形状**，所以同一个根下无关的 `session-backup` 永远不会被清扫。
 */
const SESSION_DIR_RE = /^session-[0-9a-f]{12}$/

/** 已存在且通过安全检查的根（规范路径 + 稳定身份，用于去重别名）。 */
interface ResolvedRoot {
  path: string
  identity: string
}

/** 一参数警告通道 —— 清扫失败时唯一的副作用（永不抛）。 */
export type WarnFn = (message: string) => void

/** 报告一次尽力而为的失败，同时不让警告通道自己把清理搞砸。 */
function warnSafely(warn: WarnFn, message: string): void {
  try {
    warn(message)
  } catch {
    // 警告通道是观测回调；即使它的实现抛错，清理也必须继续"尽力而为"。
  }
}

/** 别的本机用户能不能替换这个目录下的子项（不能才敢删）。 */
function isTrustedDirectory(stats: Stats): boolean {
  if (!stats.isDirectory()) return false
  if (process.platform === 'win32' || process.geteuid === undefined) return true
  return stats.uid === process.geteuid() && (stats.mode & 0o022) === 0
}

/** 去重同一个根的多个别名时用的稳定身份。 */
function rootIdentity(path: string, stats: Stats): string {
  if (process.platform === 'win32') return path.toLowerCase()
  return `${String(stats.dev)}:${String(stats.ino)}`
}

/**
 * 检查是否没有任何祖先目录允许别的本机用户替换它下面的子项。
 * 可写但带 sticky 位的祖先算安全（子项属当前用户）—— 这正是 /tmp 下的正常情形。
 */
async function hasProtectedAncestors(path: string): Promise<boolean> {
  if (process.platform === 'win32' || process.geteuid === undefined) return true
  const currentUid = process.geteuid()
  let child = path
  let childStats = await lstat(child)
  for (;;) {
    const parent = dirname(child)
    if (parent === child) return true
    const stats = await lstat(parent)
    if (!stats.isDirectory()) return false
    const writableByOthers = (stats.mode & 0o022) !== 0
    const sticky = (stats.mode & 0o1000) !== 0
    if (writableByOthers && !sticky) return false
    if (writableByOthers && childStats.uid !== currentUid) return false
    child = parent
    childStats = stats
  }
}

/**
 * 解析一个已存在的根，同时拒绝"清扫期间会被别的本机用户换掉"的目录。
 * 配置来的根允许本身是符号链接（`allowSymlink`）；发现来的不允许冒充。
 */
async function resolveRoot(
  path: string,
  allowSymlink: boolean,
  warn: WarnFn,
): Promise<ResolvedRoot | undefined> {
  let initial: Stats
  try {
    initial = await lstat(path)
  } catch (error: unknown) {
    if (!isErrno(error, 'ENOENT'))
      warnSafely(warn, `spill-local: failed to inspect root ${path}: ${String(error)}`)
    return undefined
  }
  if (initial.isSymbolicLink()) {
    if (!allowSymlink) return undefined
  } else if (!isTrustedDirectory(initial)) {
    warnSafely(
      warn,
      `spill-local: skipped unsafe root ${path}: expected a directory owned by the current user and not writable by group or others`,
    )
    return undefined
  }

  let canonical: string
  let stats: Stats
  try {
    canonical = await realpath(path)
    stats = await lstat(canonical)
  } catch (error: unknown) {
    if (!isErrno(error, 'ENOENT'))
      warnSafely(warn, `spill-local: failed to resolve root ${path}: ${String(error)}`)
    return undefined
  }
  let protectedAncestors = false
  try {
    protectedAncestors = await hasProtectedAncestors(canonical)
  } catch (error: unknown) {
    if (!isErrno(error, 'ENOENT')) {
      warnSafely(
        warn,
        `spill-local: failed to inspect ancestors of root ${canonical}: ${String(error)}`,
      )
    }
    return undefined
  }
  if (!isTrustedDirectory(stats) || !protectedAncestors) {
    warnSafely(
      warn,
      `spill-local: skipped unsafe root ${canonical}: expected a current-user-owned directory with protected write and ancestor permissions`,
    )
    return undefined
  }
  return { path: canonical, identity: rootIdentity(canonical, stats) }
}

/** 一个要清扫的根，外加"清空之后能不能把根目录本身也删掉"。 */
export interface SweepRoot {
  path: string
  /** 我们永远传 `false`：活着的进程还在往这个根里写，根目录本身不能删。 */
  pruneWhenEmpty: boolean
}

/** 清扫参数：要扫的根、过期界限、失败往哪报。 */
export interface SweepOptions {
  roots: SweepRoot[]
  /** epoch 毫秒界限：**严格早于**它的普通文件才删（边界上写下的文件保留）。 */
  cutoffMs: number
  warn: WarnFn
}

/** 删一个路径，把"被并发删掉了"当成成功。 */
async function unlinkIdempotent(path: string, warn: WarnFn): Promise<void> {
  try {
    await unlink(path)
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) return
    warnSafely(warn, `spill-local: failed to delete ${path}: ${String(error)}`)
  }
}

/**
 * 清扫一个会话目录：删过期的**普通文件**，其它一律跳过，最后报告目录是否已空。
 *
 * `dir` 必须是真目录 —— 调用方先 `lstat` 过、跳过 `session-*` 符号链接，
 * 所以这里绝不会顺着链接删到别人的树里。目录内部符号链接与任何非普通项都不动
 * （`lstat` 不跟随，所以塞进来的链接既删不掉、也改不了年龄判断）。
 */
async function sweepSessionDir(dir: string, cutoffMs: number, warn: WarnFn): Promise<boolean> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    warnSafely(warn, `spill-local: failed to read ${dir}: ${String(error)}`)
    return false
  }
  let remaining = names.length
  for (const name of names) {
    const path = join(dir, name)
    let stats: Stats
    try {
      stats = await lstat(path)
    } catch (error: unknown) {
      if (isErrno(error, 'ENOENT')) {
        remaining--
        continue
      }
      warnSafely(warn, `spill-local: failed to stat ${path}: ${String(error)}`)
      continue
    }
    // 只有普通文件会过期；符号链接与其它特殊项跳过（永不跟随）。
    if (!stats.isFile()) continue
    if (stats.mtimeMs >= cutoffMs) continue
    await unlinkIdempotent(path, warn)
    remaining--
  }
  return remaining === 0
}

/**
 * 一次性、尽力而为的清扫：对每个根，删掉 `session-*` 目录里的过期普通文件，
 * 并删掉清空后的会话目录。写盘侧在目录被删掉时会重建（ENOENT 重试），所以
 * 并发写不会被这里弄坏。所有失败都被吞在内部 —— 调用方 await 它永远不会 reject。
 */
export async function sweepSpillRoots(options: SweepOptions): Promise<void> {
  const { cutoffMs, warn } = options
  const roots = new Map<string, SweepRoot>()
  for (const candidate of options.roots) {
    const resolved = await resolveRoot(candidate.path, false, warn)
    if (resolved === undefined) continue
    const existing = roots.get(resolved.identity)
    roots.set(resolved.identity, {
      path: resolved.path,
      pruneWhenEmpty: (existing?.pruneWhenEmpty ?? true) && candidate.pruneWhenEmpty,
    })
  }
  for (const root of roots.values()) {
    let entries: string[]
    try {
      entries = await readdir(root.path)
    } catch (error: unknown) {
      // 根还不存在（从没溢出过）是最常见的情形，不是错误：ENOENT 静默。
      if (!isErrno(error, 'ENOENT'))
        warnSafely(warn, `spill-local: failed to read root ${root.path}: ${String(error)}`)
      continue
    }
    // 记下这个根里有没有"这一轮没收干净"的项；只有全收干净才允许删根本身。
    let rootEmptiable = true
    for (const name of entries) {
      // 只扫我们自己形状的 `session-<12 hex>`；无关的兄弟项（`session-backup`、
      // 散落的文件）一律不动，并且阻止删根。
      if (!SESSION_DIR_RE.test(name)) {
        rootEmptiable = false
        continue
      }
      const dir = join(root.path, name)
      let stats: Stats
      try {
        // 对会话项本身 lstat：`session-*` 符号链接绝不能被跟随
        // （顺着它 readdir/unlink 会删到别人的目标目录里）。
        stats = await lstat(dir)
      } catch (error: unknown) {
        if (!isErrno(error, 'ENOENT'))
          warnSafely(warn, `spill-local: failed to stat ${dir}: ${String(error)}`)
        continue
      }
      if (!isTrustedDirectory(stats)) {
        warnSafely(warn, `spill-local: skipped unsafe session directory ${dir}`)
        rootEmptiable = false
        continue
      }
      const empty = await sweepSessionDir(dir, cutoffMs, warn)
      if (!empty) {
        rootEmptiable = false
        continue
      }
      try {
        await rmdir(dir)
      } catch (error: unknown) {
        rootEmptiable = false
        if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTEMPTY')) {
          warnSafely(warn, `spill-local: failed to prune ${dir}: ${String(error)}`)
        }
      }
    }
    // 只有"发现来的、过去的默认根"才会被整体删掉；活着的根不删。
    if (root.pruneWhenEmpty && rootEmptiable) {
      try {
        await rmdir(root.path)
      } catch (error: unknown) {
        if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTEMPTY')) {
          warnSafely(warn, `spill-local: failed to prune root ${root.path}: ${String(error)}`)
        }
      }
    }
  }
}
