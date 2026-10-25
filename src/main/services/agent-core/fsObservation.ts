// src/main/services/agent-core/fsObservation.ts
//
// **文件观察门**（2026-10-26，第 55 批）。
//
// 语义对齐上游 DSH `packages/fs/fs-observation-policy/src/**`（ObservedStateGate，159 行）：
// 上游按「观察到的版本」决定写盘方式 —— 没观察过 ⇒ 只在不存在时创建；观察过 ⇒
// 用观察到的 version 做 CAS，磁盘变了就拒绝。本仓没有独立 fs 服务、也没有 edit_file，
// 唯一的覆盖写入口是 `write_file`（整文件覆盖），所以这里把同一套判定收敛成：
//
//   · 这一轮没读过 + 文件存在      → 拒绝（模型是凭记忆在覆盖）
//   · 读过 + 读完之后磁盘没再变    → 允许
//   · 读过 + 读完之后磁盘又变了    → 拒绝（会盖掉别人/用户的新改动）
//   · 文件不存在（无论读没读过）    → 允许（新建/重建）
//
// 与上游的差异（写进 docs/ai/agent-core-batch55 §7）：
//   · 作用域 = **一次运行**，不是 session 级 —— 跨轮的"读过"会过期，记住了反而危险；
//   · 版本只有 `{mtimeMs,size}`（不存内容哈希，不值得）；
//   · 只由 read_file / write_file 两个点记录（本仓没有第三个写盘入口）。
import { stat } from 'node:fs/promises'

/** 一次文件观察的版本。mtimeMs 是毫秒浮点，NTFS/ext4 精度都远好于 1ms */
export interface FsObservation {
  mtimeMs: number
  size: number
}

/**
 * 写前拒绝文案（**逐字**，模型会据此去补读；测试与文档引用同一句）。
 * 前缀 `[工具失败] ` 由调度器统一加（见 scheduler.ts）。
 */
export const NOT_OBSERVED_MESSAGE =
  '文件已存在，但这一轮还没读过它 —— 先用 read_file 读一遍，确认要改什么再覆盖。'

/** 观察之后磁盘又变了的拒绝文案（逐字） */
export const STALE_OBSERVATION_MESSAGE =
  '文件在你读过之后又变了（磁盘上的版本和当时不一样）—— 先重新读一遍，再写。'

/** null = 不存在；其它错误上抛（它决定写不写，不能静默放行） */
async function stateOf(absPath: string): Promise<FsObservation | null> {
  try {
    const info = await stat(absPath)
    if (!info.isFile()) return null
    return { mtimeMs: info.mtimeMs, size: info.size }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * 一次运行内的"哪些文件被读过、版本是多少"。
 *
 * 不用 WeakMap 包 session：循环是短生命周期对象，Map 随 gate 一起被回收；
 * 上游用 WeakMap 是因为它的 owner 是长期存在的 session。这里 owner 就是 gate 自己。
 */
export class FsObservationGate {
  private readonly observed = new Map<string, FsObservation>()

  /** 测试/诊断：当前记录的版本（没记录 = undefined） */
  versionOf(absPath: string): FsObservation | undefined {
    return this.observed.get(absPath)
  }

  /**
   * read_file 成功之后记录观察。**绝不抛错**：读都成功了，stat 抖动不该把正常读变成失败；
   * 记不上就删掉旧记录 —— 后面写会被"还没读过"拦住（fail-closed），方向安全。
   */
  async noteRead(absPath: string): Promise<void> {
    try {
      const current = await stateOf(absPath)
      if (current) this.observed.set(absPath, current)
      else this.observed.delete(absPath)
    } catch {
      this.observed.delete(absPath)
    }
  }

  /** write_file 落盘之前校验；不满足就 throw（文案见上） */
  async assertWritable(absPath: string): Promise<void> {
    const prior = this.observed.get(absPath)
    const current = await stateOf(absPath)
    if (!prior) {
      // 没读过：不存在 = 新建（允许）；存在 = 凭记忆覆盖（拒绝）
      if (current) throw new Error(NOT_OBSERVED_MESSAGE)
      return
    }
    // 读过但文件已经被删：重建由模型内容决定，允许
    if (!current) return
    if (current.mtimeMs !== prior.mtimeMs || current.size !== prior.size) {
      throw new Error(STALE_OBSERVATION_MESSAGE)
    }
  }

  /** write_file 成功之后记录新版本（之后还可以继续写同一个文件） */
  async noteWrite(absPath: string): Promise<void> {
    try {
      const current = await stateOf(absPath)
      if (current) this.observed.set(absPath, current)
      else this.observed.delete(absPath)
    } catch {
      this.observed.delete(absPath)
    }
  }
}
