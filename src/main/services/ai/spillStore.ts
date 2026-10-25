// src/main/services/ai/spillStore.ts
//
// # 溢出存储：把"裁掉的东西"挪到磁盘，而不是丢掉（本文件 = 适配层）
//
// 落盘机制（0700/0600、`wx` 独占创建、名字分段编码、会话子目录）与过期清扫都搬自
// DSH `spill-local`（`src/main/vendor/dsh/spill-local/{store,cleanup}.ts`，见
// docs/ai/agent-core-wiring.md §44）。这里只剩本项目的位置约定与 fail-open：
//   · 位置：`<项目>/.qqbat/ai-spill/session-<hash>/<随机前缀>-<时间>-<工具名>.txt`
//     —— 跟项目走（不是跟会话走）：用户能自己翻到，删项目就一起删了；
//   · 保留 7 天，写盘后节流（每小时）扫一次；只删过期普通文件，别的一律不碰；
//   · 写失败只警告 + 返回 undefined —— 调用方据此保留原结果（fail-open），
//     绝不给出一个"读不到"的省略路径。
import { join } from 'node:path'
import { logger } from '../infra/logger'
import { sweepSpillRoots } from '../../vendor/dsh/spill-local/cleanup'
import { saveTextFile } from '../../vendor/dsh/spill-local/store'

/** 溢出文件保留天数（清扫只删严格超期的普通文件） */
const SPILL_RETENTION_DAYS = 7
/** 清扫节流：同一个项目最多每小时扫一次（写盘很频繁，而清扫是 O(文件数)） */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const lastSweepAt = new Map<string, number>()

/** 溢出目录（相对项目根） */
function spillDir(projectPath: string): string {
  return join(projectPath, '.qqbat', 'ai-spill')
}

/** 把工具名归一成安全的文件名片段：只留字母数字下划线短横，其余变 `-` */
function safeName(toolName: string): string {
  return toolName.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'tool'
}

/** 文件名里的时间戳：`20261001-011530-123`（本地时间，可读优先） */
function stamp(now = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-` +
    `${p(now.getMilliseconds(), 3)}`
  )
}

/**
 * 扫一次某个项目的溢出目录：删掉 7 天前的普通文件、删掉清空后的会话目录。
 *
 * 永不影响调用方（内部已吞掉一切失败）—— 清扫是**维护**，不是业务流程的一步。
 */
export async function sweepProjectSpill(projectPath: string, now = Date.now()): Promise<void> {
  if (!projectPath) return
  try {
    await sweepSpillRoots({
      // 活着的进程还在往这个根里写：根目录本身（`ai-spill`）永远不删。
      roots: [{ path: spillDir(projectPath), pruneWhenEmpty: false }],
      cutoffMs: now - SPILL_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      warn: message => logger.warn(`[ai] ${message}`),
    })
  } catch (e) {
    logger.warn(`[ai] 溢出清扫失败（不影响本轮）: ${String(e)}`)
  }
}

/** 节流后 fire-and-forget 清扫：写盘路径上不能等它。 */
function scheduleSweep(projectPath: string): void {
  const now = Date.now()
  const last = lastSweepAt.get(projectPath) ?? 0
  if (now - last < SWEEP_INTERVAL_MS) return
  lastSweepAt.set(projectPath, now)
  void sweepProjectSpill(projectPath, now)
}

/**
 * 把完整结果写到磁盘。
 *
 * @returns 成功时返回**可读的绝对路径**；任何失败都返回 `undefined`（调用方据此走 fail-open）
 *
 * ⚠️ **绝不抛错**：写不成只是"这次没有恢复路径"，不该让一次工具调用失败。
 * 这与 DSH 的「存储失败……记录警告并保留原内容」是同一条规则。
 */
export async function saveSpillText(
  projectPath: string,
  toolName: string,
  text: string,
): Promise<string | undefined> {
  if (!projectPath || !text) return undefined
  try {
    const saved = await saveTextFile({
      root: spillDir(projectPath),
      // 会话子目录：我们按项目分（一个项目一份历史），所以会话 id 就用项目路径。
      sessionId: projectPath,
      suggestedName: `${stamp()}-${safeName(toolName)}.txt`,
      content: text,
    })
    scheduleSweep(projectPath)
    return saved.path
  } catch (e) {
    logger.warn(`[ai] 溢出入库失败（本次将保留原结果，不做不可恢复的裁剪）: ${String(e)}`)
    return undefined
  }
}
