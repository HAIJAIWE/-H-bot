/**
 * 一批工具调用的调度算法（上游 `dsh-tools/batch`）。
 *
 * 规则：独占调用是屏障；并行调用走有界滚动池，启动前**重新分类**；派发可以重叠，
 * 但策略、结果、结果上下文一律按模型顺序提交；取消或调度器内部失败时停止补位，
 * 并把已启动的调用排空 —— 连同给没派发的调用补合成失败结果（重放要完整）。
 *
 * @license MIT
 * @copyright Copyright (c) 2026 DeepSeek
 * @upstream deepseek-ai/deepseek-harness @ dsh-v0.2.1-rc.3
 * @upstream packages/core/tools/src/batch.ts
 * https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/core/tools/src/batch.ts
 *
 * 本仓库改动：去掉 Session / SessionSeq / createToolResultMessage（落盘由宿主在 start/complete/skip
 * 里自己做）与 agent / toolSet / log / maxParallelToolCalls 覆写（并发上限由宿主给一个数）；
 * 泛型化 Exec / Slot 成 BatchPipeline（上游 ToolExecutionPipeline）；合成文案由宿主在 skip 里拼。
 */

/** 一个调用怎么和同批的其它调用共存：可并行 / 独占屏障 */
export type ToolExecutionMode = 'parallel' | 'exclusive'

/** 调度器眼里的一个调用：只有身份，参数与工具句柄都在具体 Exec 里 */
export interface BatchExec {
  callId: string
  name: string
}

/** `prepare` 的两种出口：真的派发，或者「不派发也算有结果」 */
export type BatchPrepared<Slot> = { kind: 'dispatch' } | { kind: 'settled'; slot: Slot }

/** `complete` 的返回值：这条结果是否要求本轮到此为止（上游 `concludesTurn`） */
export interface BatchCommit {
  concludesTurn?: boolean
}

/**
 * 宿主提供的执行实现。调度器只负责次序与并发，绝不自己碰工具。
 */
export interface BatchPipeline<Exec extends BatchExec, Slot> {
  /** 启动前重新读一次：注册表可能在提交过程中变了 */
  executionMode(exec: Exec): ToolExecutionMode
  /** 派发前的有序阶段（权限/参数检查等）；不派发就交一个现成结果 */
  prepare(exec: Exec): Promise<BatchPrepared<Slot>>
  /** 真正跑工具；只在这一步允许重叠 */
  dispatch(exec: Exec): Promise<Slot>
  /** 按模型顺序落地一条结果（会话/界面/回灌都在这） */
  complete(exec: Exec, slot: Slot): Promise<BatchCommit | void>
  /** 派发前通知（上游在 `tool/call` 落盘处） */
  start(exec: Exec): void
  /** 取消时给没派发的调用补一条合成结果 */
  skip(exec: Exec): Promise<void>
}

export interface BatchInput<Exec extends BatchExec> {
  execs: readonly Exec[]
  signal?: AbortSignal
  /** 同时最多几个在跑（上游从 executor 的配置里读，这里由宿主给） */
  maxParallel: number
  /**
   * 进度：这一组开始/结束（宿主可以据此把"你在重复"之类的提醒插在组之间）。
   * 上游没有这个钩子 —— 它由 pipeline.complete 自己处理。
   */
  onGroupDone?: () => Promise<void>
}

export interface BatchResult {
  consumed: number
  aborted: boolean
  concluded: boolean
}

/** 调度器自己出错（不是工具失败）时抛这个，带上已经落地的计数 */
export class ToolBatchExecutionError extends Error {
  constructor(
    override readonly cause: unknown,
    readonly partial: BatchResult,
  ) {
    super(`tool-call scheduler failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'ToolBatchExecutionError'
  }
}

interface GroupOutcome {
  consumed: number
  aborted: boolean
  concluded: boolean
}

/** 调度一整批调用：按组（屏障 / 并行池）推进，返回模型顺序的结果计数 */
export async function executeToolBatch<Exec extends BatchExec, Slot>(
  input: BatchInput<Exec>,
  pipeline: BatchPipeline<Exec, Slot>,
): Promise<BatchResult> {
  const { execs, signal } = input
  if (!Number.isInteger(input.maxParallel) || input.maxParallel < 1) {
    throw new RangeError('maxParallel must be a positive integer')
  }
  let consumed = 0
  let concluded = false
  try {
    let next = 0
    while (next < execs.length) {
      // 先提交再重新分类：注册表变化要能影响还没起步的调用
      const first = execs[next]
      const mode = pipeline.executionMode(first)
      const group = mode === 'parallel' ? execs.slice(next) : [first]
      const outcome = await runGroup(pipeline, input, group, mode, signal)
      next += outcome.consumed
      consumed = next
      concluded ||= outcome.concluded
      await input.onGroupDone?.()
      if (outcome.aborted) {
        // 组内已补过合成结果；组外剩下的一次性补齐
        for (const exec of execs.slice(next)) await pipeline.skip(exec)
        return { consumed: execs.length, aborted: true, concluded }
      }
    }
    return { consumed, aborted: false, concluded }
  } catch (error: unknown) {
    throw new ToolBatchExecutionError(error, { consumed, aborted: false, concluded })
  }
}

/**
 * 跑一个独占屏障或一个并行池。已启动的调用排空并提交，取消时给没启动的补合成结果。
 */
async function runGroup<Exec extends BatchExec, Slot>(
  pipeline: BatchPipeline<Exec, Slot>,
  input: BatchInput<Exec>,
  group: readonly Exec[],
  mode: ToolExecutionMode,
  signal: AbortSignal | undefined,
): Promise<GroupOutcome> {
  const slots: (Slot | undefined)[] = group.map(() => undefined)
  let nextToStart = 0
  let committed = 0
  let started = 0
  let aborted: boolean = signal?.aborted === true
  let concluded = false
  let schedulerFailure: { error: unknown } | undefined
  const throwSchedulerFailure = (): void => {
    if (schedulerFailure !== undefined) throw schedulerFailure.error
  }

  // `committed` 只在模型顺序上连续的槽位上前进
  const commitReady = async (): Promise<void> => {
    while (committed < group.length) {
      const slot = slots[committed]
      if (slot === undefined) break
      const commit = await pipeline.complete(group[committed], slot)
      concluded ||= commit?.concludesTurn === true
      committed++
    }
  }

  const inFlight = new Map<number, Promise<number>>()

  const startCall = async (index: number): Promise<void> => {
    const exec = group[index]
    pipeline.start(exec)
    started++
    const prepared = await pipeline.prepare(exec)
    throwSchedulerFailure()
    if (prepared.kind === 'dispatch') {
      const promise = pipeline.dispatch(exec).then(
        slot => {
          slots[index] = slot
          return index
        },
        (error: unknown) => {
          schedulerFailure ??= { error }
          return index
        },
      )
      inFlight.set(index, promise)
    } else {
      slots[index] = prepared.slot
    }
  }

  const fillPool = async (): Promise<void> => {
    while (!aborted && nextToStart < group.length && inFlight.size < input.maxParallel) {
      // 有序提交之后重新读模式：注册表变化可以插出一个屏障
      const nextCall = group[nextToStart]
      if (
        nextToStart > 0 &&
        mode === 'parallel' &&
        pipeline.executionMode(nextCall) !== 'parallel'
      ) {
        break
      }
      await startCall(nextToStart)
      nextToStart++
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // 中止可能发生在 prepare / 有续提交的 await 里
      if (signal?.aborted === true) aborted = true
    }
  }

  // 有序阶段（prepare）允许 await；只有 dispatch 这一段重叠。调度器失败时停止新派发，
  // 等所有已启动的派发结算之后再抛。
  try {
    await fillPool()
    while (inFlight.size > 0) {
      const settledIndex = await Promise.race(inFlight.values())
      inFlight.delete(settledIndex)
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      if (signal?.aborted === true) aborted = true
      await fillPool()
    }
  } catch (error: unknown) {
    schedulerFailure ??= { error }
    await Promise.allSettled(inFlight.values())
    throw schedulerFailure.error
  }

  if (aborted) {
    // 已启动的先落地；剩下的按模型顺序补合成结果，再让整轮取消
    for (const exec of group.slice(started)) await pipeline.skip(exec)
    return { consumed: group.length, aborted: true, concluded }
  }
  if (committed !== started) throw new Error('tool-call scheduler: uncommitted settled calls')
  return { consumed: started, aborted: false, concluded }
}
