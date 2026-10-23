// src/main/services/debugger.ts
import { BrowserWindow } from 'electron'
import vm from 'node:vm'
import type { Breakpoint, DebugState, DebugVar, DebugFrame } from '@shared/types/debug'
import { logger } from './logger'

export type DebugStateChangeCallback = (state: DebugState) => void

/**
 * 条件断点表达式安全求值。
 *
 * 多层防御（修复 C2 任意代码执行）：
 * 1. 白名单正则：仅允许变量名、数字、字符串字面量、比较与逻辑运算符；
 *    阻止属性访问（. / []）、new / eval / require / process 等关键字。
 * 2. 拒绝函数调用模式：标识符后紧跟 `(` 直接拒绝。
 * 3. 用 `vm.runInNewContext` 在隔离沙箱内求值，配合：
 *    - `timeout: 100` 防止死循环（如 `1 || 1 || ...`）
 *    - `contextCodeGeneration: { wasm: false, strings: false }` 阻断 `new WebAssembly.*` 与 `eval`/`Function`
 *    - sandbox 通过 `Object.freeze` 冻结，阻断原型链篡改
 *    - 沙箱内不注入 `globalThis`/`process`/`require` 等全局对象
 */
const SAFE_CONDITION_RE = /^[a-zA-Z_][a-zA-Z0-9_ \d()<>=!+\-*/%&|^~'",]*$/
const DANGEROUS_KEYWORDS = /\b(new|eval|require|process|global|globalThis|window|Function|constructor|prototype|__proto__)\b/

function evalBreakpointCondition(condition: string, varMap: Record<string, string>): boolean {
  const trimmed = condition.trim()
  if (!trimmed) return true
  // 白名单校验：拒绝非法字符
  if (!SAFE_CONDITION_RE.test(trimmed)) {
    return false
  }
  // 关键词黑名单：拒绝危险标识符
  if (DANGEROUS_KEYWORDS.test(trimmed)) {
    return false
  }
  // 拒绝函数调用模式：标识符后紧跟 (
  if (/[a-zA-Z_]\w*\s*\(/.test(trimmed)) {
    return false
  }

  try {
    // 冻结 sandbox 阻断原型链逃逸；只包含 varMap 的字符串值
    const sandbox = Object.freeze({ ...varMap })
    const ctx = vm.createContext(sandbox)
    const result = vm.runInNewContext(`Boolean(${trimmed})`, ctx, {
      timeout: 100,
      displayErrors: false,
      contextCodeGeneration: { wasm: false, strings: false }
    })
    return !!result
  } catch {
    // 任何求值异常都视为条件不满足（不暂停）
    return false
  }
}

/**
 * 调试器单例 — 管理断点、暂停/单步状态，并通过 IPC 推送状态变化。
 */
class DebuggerSingleton {
  private breakpoints: Map<string, Breakpoint> = new Map()
  private _state: DebugState = {
    status: 'idle',
    variables: [],
    callStack: []
  }

  /** 是否正在调试运行 */
  get isActive(): boolean {
    return this._state.status !== 'idle'
  }

  /** 获取当前调试状态快照 */
  getState(): DebugState {
    return { ...this._state, variables: [...this._state.variables], callStack: [...this._state.callStack] }
  }

  /** 获取所有断点 */
  getBreakpoints(): Breakpoint[] {
    return Array.from(this.breakpoints.values())
  }

  /** 获取某节点的断点 */
  getBreakpoint(nodeId: string): Breakpoint | undefined {
    return this.breakpoints.get(nodeId)
  }

  /** 设置断点列表（全量替换） */
  setBreakpoints(breakpoints: Breakpoint[]): void {
    this.breakpoints.clear()
    for (const bp of breakpoints) {
      if (bp.enabled) {
        this.breakpoints.set(bp.nodeId, bp)
      }
    }
  }

  /** 添加/更新单个断点 */
  updateBreakpoint(bp: Breakpoint): void {
    if (bp.enabled) {
      this.breakpoints.set(bp.nodeId, bp)
    } else {
      this.breakpoints.delete(bp.nodeId)
    }
  }

  /** 删除断点 */
  removeBreakpoint(nodeId: string): void {
    this.breakpoints.delete(nodeId)
  }

  /** 检查某节点是否有断点 */
  hasBreakpoint(nodeId: string): boolean {
    return this.breakpoints.has(nodeId)
  }

  /** 开始调试会话 */
  start(): void {
    this._state = {
      status: 'running',
      variables: [],
      callStack: []
    }
    this.emitStateChanged()
  }

  /** 单步 — 执行到下一个节点 */
  stepOver(): void {
    this._state = { ...this._state, status: 'stepping' }
    this.emitStateChanged()
  }

  /** 步入 — 进入子流程 */
  stepInto(): void {
    this._state = { ...this._state, status: 'stepping' }
    this.emitStateChanged()
  }

  /** 步出 — 跳出当前流程 */
  stepOut(): void {
    this._state = { ...this._state, status: 'stepping' }
    this.emitStateChanged()
  }

  /** 继续执行 */
  continue(): void {
    this._state = { ...this._state, status: 'running', pausedNodeId: undefined }
    this.emitStateChanged()
  }

  /** 暂停 */
  pause(): void {
    this._state = { ...this._state, status: 'paused' }
    this.emitStateChanged()
  }

  /** 停止调试 */
  stop(): void {
    this._state = {
      status: 'idle',
      variables: [],
      callStack: []
    }
    this.emitStateChanged()
  }

  /**
   * 当生成的代码执行到节点时调用此方法。
   * 如果节点有断点，自动暂停并更新变量。
   */
  onNodeHit(nodeId: string, nodeLabel: string, variables: DebugVar[]): void {
    const now = new Date().toISOString()
    const prevState = this._state

    // 构建新 callStack
    const existingIdx = prevState.callStack.findIndex((f) => f.nodeId === nodeId)
    let newCallStack: DebugFrame[]
    if (existingIdx >= 0) {
      newCallStack = [...prevState.callStack]
      newCallStack[existingIdx] = { nodeId, nodeLabel, enteredAt: now, variables: [...variables] }
    } else {
      newCallStack = [...prevState.callStack, { nodeId, nodeLabel, enteredAt: now, variables: [...variables] }]
    }

    // 条件断点求值 — 使用白名单正则校验后再求值，防止 eval 类注入
    let shouldPause = false
    if (prevState.status === 'running') {
      const bp = this.breakpoints.get(nodeId)
      if (bp?.enabled) {
        shouldPause = true
        if (bp.condition) {
          try {
            const varMap: Record<string, string> = {}
            for (const v of variables) varMap[v.name] = v.value
            shouldPause = evalBreakpointCondition(bp.condition, varMap)
          } catch (e) {
            logger.warn('[debugger] 条件断点求值失败:', e)
            shouldPause = false
          }
        }
      }
    }

    // 一次性提交新状态
    this._state = {
      ...prevState,
      variables: [...variables],
      callStack: newCallStack,
      status: shouldPause ? 'paused' : prevState.status,
      pausedNodeId: shouldPause ? nodeId : (prevState.status === 'paused' ? prevState.pausedNodeId : undefined)
    }

    this.emitStateChanged()
  }

  /** 更新当前暂停节点的变量值 */
  setVariables(variables: DebugVar[]): void {
    this._state = { ...this._state, variables: [...variables] }
    this.emitStateChanged()
  }

  /** 从调用栈移除已退出的帧 */
  onNodeExit(nodeId: string): void {
    this._state = {
      ...this._state,
      callStack: this._state.callStack.filter((f) => f.nodeId !== nodeId)
    }
    this.emitStateChanged()
  }

  /** 通过 IPC 向所有渲染进程推送状态变化 */
  private emitStateChanged(): void {
    const state = this.getState()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('debug:stateChanged', state)
      }
    }
  }
}

/** 全局唯一实例 */
export const debuggerService = new DebuggerSingleton()
