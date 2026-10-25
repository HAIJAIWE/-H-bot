// src/main/services/agent-core/sandbox.ts
//
// **命令沙箱的提供者契约**（2026-10-18，对齐 DSH 的 sandbox seam）。
//
// 现在只有一种实现：本地白名单子进程（node/pnpm/git/npx + 禁元字符 + 超时 + 不走 shell）。
// 抽出来的意义不是"现在有第二个实现"，而是**以后换隔离方式（容器 / 受限账户 / 远程）
// 时不用改循环** —— 循环只调 `runInSandbox()`。
//
// 白名单与禁元字符留在**本地实现**里，不抬到契约层：换个沙箱不代表规则一样
// （容器里可以放开权限，受限账户可能要更严）。
import { spawn } from 'node:child_process'
import { TextRetainer, type Omitted } from '../../vendor/dsh/output-retention'

export interface CommandRequest {
  /** 整条命令行（会被按空白切分，不走 shell） */
  command: string
  /** 工作目录（必须在工作区内 —— 由调用方保证） */
  cwd: string
  /** 超时（毫秒）；实现自己夹到合理区间 */
  timeoutMs?: number
}

export interface CommandResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  /** stdout 被省略了多少字节（只有超窗口才有）；工具层据此给模型写提示 */
  stdoutOmitted?: Omitted
  /** stderr 被省略了多少字节 */
  stderrOmitted?: Omitted
}

export interface SandboxProvider {
  /** 名字：日志/诊断里要说清是哪一种隔离 */
  name: string
  run(req: CommandRequest): Promise<CommandResult>
}

const ALLOWED_COMMANDS = new Set(['node', 'pnpm', 'pnpm.cmd', 'git', 'npx', 'npx.cmd'])
/**
 * 禁用的元字符。
 *
 * 引号也算：命令不走 shell（`spawn(..., { shell: false })`），所以 `node -e "1"` 里的引号
 * **不会被 shell 解释**，只会当成字面参数原样递给程序 —— 模型按 shell 的直觉写引号，
 * 拿到的是「退出码 0 但什么也没干」或莫名其妙的参数错误。与其让它以为跑通了，
 * 不如在入口就说清「这条命令的表达方式在这里不成立」。
 */
const FORBIDDEN = /[;&|><`$()"']/
/**
 * 单路输出（stdout / stderr）给模型看多少字节，开头与结尾各留多少。
 *
 * 旧实现是 `stdout.slice(0, 8000)`：**只留开头**。而命令失败的原因几乎都在结尾
 * （最后几行报错 / 堆栈 / 汇总），模型拿到"开头 8k"常常正好看不到那一句；而且
 * 它是在**收集完整个输出之后**才切的，一条刷屏命令能把内存吃满。
 * 现在用上游 output-retention 的 `TextRetainer`（headTail）：边收边裁，
 * 内存只留一个窗口，并且把"省了多少字节"如实报出去。
 */
const STREAM_HEAD_BYTES = 4000
const STREAM_TAIL_BYTES = 4000

/** 一路输出一个收流器（stdout / stderr 各一个，互不混淆） */
function streamRetainer(): TextRetainer {
  return new TextRetainer({
    kind: 'headTail',
    headBytes: STREAM_HEAD_BYTES,
    tailBytes: STREAM_TAIL_BYTES,
  })
}

/** 本地沙箱：白名单 + 禁元字符 + 超时 + 不走 shell */
export const localSandbox: SandboxProvider = {
  name: 'local',
  run(req) {
    const line = String(req.command ?? '').trim()
    if (!line) return Promise.resolve({ ok: false, code: null, stdout: '', stderr: '缺少 command' })
    if (FORBIDDEN.test(line)) {
      return Promise.resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: '命令包含不允许的元字符',
      })
    }
    const [cmd, ...args] = line.split(/\s+/)
    if (!ALLOWED_COMMANDS.has(cmd)) {
      return Promise.resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: '命令不在白名单: ' + cmd,
      })
    }
    const timeout = Math.min(Math.max(req.timeoutMs ?? 15000, 1000), 60000)
    return new Promise(resolvePromise => {
      const child = spawn(cmd, args, { cwd: req.cwd, shell: false })
      const stdout = streamRetainer()
      const stderr = streamRetainer()
      const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
      child.stdout.on('data', d => {
        stdout.push(d as Uint8Array)
      })
      child.stderr.on('data', d => {
        stderr.push(d as Uint8Array)
      })
      child.on('error', e => {
        clearTimeout(timer)
        const out = stdout.finish()
        const err = stderr.finish()
        resolvePromise({
          ok: false,
          code: null,
          stdout: out.text,
          stderr: err.text ? err.text + '\n' + String(e) : String(e),
          ...(out.truncated ? { stdoutOmitted: out.omittedBytes } : {}),
          ...(err.truncated ? { stderrOmitted: err.omittedBytes } : {}),
        })
      })
      child.on('close', code => {
        clearTimeout(timer)
        const out = stdout.finish()
        const err = stderr.finish()
        resolvePromise({
          ok: code === 0,
          code,
          stdout: out.text,
          stderr: err.text,
          ...(out.truncated ? { stdoutOmitted: out.omittedBytes } : {}),
          ...(err.truncated ? { stderrOmitted: err.omittedBytes } : {}),
        })
      })
    })
  },
}

let current: SandboxProvider = localSandbox

/** 当前沙箱（默认本地） */
export function getSandboxProvider(): SandboxProvider {
  return current
}

/**
 * 换一个沙箱实现（测试/未来的容器实现用）。
 * 传 null 恢复默认 —— 免得测试之间互相污染。
 */
export function setSandboxProvider(provider: SandboxProvider | null): void {
  current = provider ?? localSandbox
}

/** 循环调这个：不关心底下是本地还是容器 */
export function runInSandbox(req: CommandRequest): Promise<CommandResult> {
  return current.run(req)
}
