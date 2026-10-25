// src/main/services/agent-core/toolTimeout.ts
//
// **一次工具调用的超时语义**（2026-10-26，第 55 批）。
//
// 语义对齐上游 DSH `packages/guard/timeout-policy/src/index.ts`（81 行）：
// 工具自己声明 `timeoutMs`；执行时派生一个"到点就 abort"的 deadline signal，
// 在调用期间**临时替换** `exec.signal`，调用结束后若超时就改写结果。
//
// 与上游的差异（写进 docs/ai/agent-core-batch55 §7）：本仓**额外保留硬停兜底**。
// 上游"只等不杀"依赖工具都监听 signal；本仓大量工具（旧域适配器、插件、沙箱命令）
// 根本不读它，只派生 signal 会让一次超时挂死整轮 —— 所以同一个毫秒数上再套一层
// Promise.race：循环不再等，但工具 promise 在后台继续（无法回收，见设计文档 §10 风险 1）。
import type { Tool, ToolRunOutcome } from './core'
import type { ToolContext } from './toolGate'

/** 超时文案的唯一真源（调度器输出 = `[工具失败] ` + 这句；测试断言同源） */
export function toolTimeoutMessage(ms: number): string {
  return `工具执行超时（${ms}ms）`
}

/**
 * 给 promise 加超时：到点拒绝（消息里带毫秒数），并**清掉计时器**。
 * 计时器不清理会让 Node 进程多挂 ms 毫秒（脚本退出时尤其明显）。
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = '工具执行'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms)
    p.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      e => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * 执行一个工具，套上它自己声明的超时；**不声明就原样调用**（不引入隐式默认，
 * 见设计文档 §6.1：隐式默认会让"忘了声明"继续隐形）。
 *
 * 超时判定看 `deadline.aborted`，不看工具抛了什么 —— 工具可能在 abort 后
 * 抛 DOMException('This operation was aborted')，直接按文本分类会被归成"取消"。
 * 外部取消（父 signal）先到时：deadline 没触发，原错误原样上抛，保持
 * `toolPipeline.dispatch` 既有的"body 开始就等它结束再改判"语义。
 */
export async function runToolWithDeadline(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string | ToolRunOutcome> {
  const ms = tool.timeoutMs
  if (!ms || ms <= 0) return tool.run(args, ctx)
  const deadline = AbortSignal.timeout(ms)
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline
  try {
    return await withTimeout(tool.run(args, { ...ctx, signal }), ms)
  } catch (error) {
    if (deadline.aborted) throw new Error(toolTimeoutMessage(ms))
    throw error
  }
}
