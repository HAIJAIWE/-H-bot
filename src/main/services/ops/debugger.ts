// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
import { init_logger, logger } from "../infra/logger";
import { evalBooleanInHardenedSandbox } from "../../runtime/sandbox";

/**
* 条件断点表达式安全求值 —— 两层防御。
*
* **第一层：语法白名单**（本文件的职责）
* 1. 白名单正则：仅允许变量名、数字、字符串字面量、比较与逻辑运算符；
*    阻止属性访问（`.` / `[]`）、`;` `{` `}` 等语句字符。
* 2. 关键词黑名单：`new / eval / require / process / global / globalThis / window /
*    Function / constructor / prototype / __proto__`。
* 3. 拒绝函数调用模式：标识符后紧跟 `(` 直接拒绝。
*
* **第二层：硬化沙箱**（`runtime/sandbox.ts`，A2 替换掉原来手搓的 vm）
* 旧实现是 `vm.createContext(Object.freeze({ ...varMap }))` —— 与 WI-1 修掉的 P0 沙箱
* **同形态**：普通对象被 contextify 时 `this.constructor` 落在**宿主** Object 上，
* 于是 `this.constructor.constructor('return process')()` 可拿宿主 process。
* 现在求值走 `evalBooleanInHardenedSandbox`（null 原型 contextify + 引导脚本 +
* `codeGeneration:{strings:false,wasm:false}`，上下文里没有任何宿主函数可做跳板，
* 变量表也只以 JSON 字面量过界）。
*
* 为什么"正则够严"不能作为唯一理由：本轮的教训正是"正门挡住了、侧门一直开着"。
* 正则随时可能被放宽一个字符去支持某种写法；那时安全性不该跟着塌掉 —— 第二层就是
* 保证"正则漏了也拿不到宿主 process"。两层都要挡住，见
* `tests/main/services/debugger.test.ts` 的分层断言。
*/
var SAFE_CONDITION_RE = /^[a-zA-Z_][a-zA-Z0-9_ \d()<>=!+\-*/%&|^~'",]*$/;
var DANGEROUS_KEYWORDS = /\b(new|eval|require|process|global|globalThis|window|Function|constructor|prototype|__proto__)\b/;
/**
* 第一层判定：条件表达式是否通过白名单 / 黑名单 / 禁调用。
* 抽成独立导出是为了让测试能**分别**断言"这条向量被哪一层挡住"，
* 而不是只看到"反正没暂停"这个混合结果。
*/
function isBreakpointConditionAllowed(condition) {
	const trimmed = condition.trim();
	if (!trimmed) return true;
	if (!SAFE_CONDITION_RE.test(trimmed)) return false;
	if (DANGEROUS_KEYWORDS.test(trimmed)) return false;
	if (/[a-zA-Z_]\w*\s*\(/.test(trimmed)) return false;
	return true;
}
function evalBreakpointCondition(condition, varMap) {
	const trimmed = condition.trim();
	if (!trimmed) return true;
	if (!isBreakpointConditionAllowed(trimmed)) return false;
	return evalBooleanInHardenedSandbox(trimmed, varMap, {
		timeoutMs: 100,
		filename: "qqbat-breakpoint-condition"
	});
}
/**
* 调试器单例 — 管理断点、暂停/单步状态，并通过 IPC 推送状态变化。
*/
var DebuggerSingleton = class {
	breakpoints = /* @__PURE__ */ new Map();
	_state = {
		status: "idle",
		variables: [],
		callStack: []
	};
	/** 是否正在调试运行 */
	get isActive() {
		return this._state.status !== "idle";
	}
	/** 获取当前调试状态快照 */
	getState() {
		return {
			...this._state,
			variables: [...this._state.variables],
			callStack: [...this._state.callStack]
		};
	}
	/** 获取所有断点 */
	getBreakpoints() {
		return Array.from(this.breakpoints.values());
	}
	/** 获取某节点的断点 */
	getBreakpoint(nodeId) {
		return this.breakpoints.get(nodeId);
	}
	/** 设置断点列表（全量替换） */
	setBreakpoints(breakpoints) {
		this.breakpoints.clear();
		for (const bp of breakpoints) if (bp.enabled) this.breakpoints.set(bp.nodeId, bp);
	}
	/** 添加/更新单个断点 */
	updateBreakpoint(bp) {
		if (bp.enabled) this.breakpoints.set(bp.nodeId, bp);
		else this.breakpoints.delete(bp.nodeId);
	}
	/** 删除断点 */
	removeBreakpoint(nodeId) {
		this.breakpoints.delete(nodeId);
	}
	/** 检查某节点是否有断点 */
	hasBreakpoint(nodeId) {
		return this.breakpoints.has(nodeId);
	}
	/** 开始调试会话 */
	start() {
		this._state = {
			status: "running",
			variables: [],
			callStack: []
		};
		this.emitStateChanged();
	}
	/** 单步 — 执行到下一个节点 */
	stepOver() {
		this._state = {
			...this._state,
			status: "stepping"
		};
		this.emitStateChanged();
	}
	/** 步入 — 进入子流程 */
	stepInto() {
		this._state = {
			...this._state,
			status: "stepping"
		};
		this.emitStateChanged();
	}
	/** 步出 — 跳出当前流程 */
	stepOut() {
		this._state = {
			...this._state,
			status: "stepping"
		};
		this.emitStateChanged();
	}
	/** 继续执行 */
	continue() {
		this._state = {
			...this._state,
			status: "running",
			pausedNodeId: void 0
		};
		this.emitStateChanged();
	}
	/** 暂停 */
	pause() {
		this._state = {
			...this._state,
			status: "paused"
		};
		this.emitStateChanged();
	}
	/** 停止调试 */
	stop() {
		this._state = {
			status: "idle",
			variables: [],
			callStack: []
		};
		this.emitStateChanged();
	}
	/**
	* 当生成的代码执行到节点时调用此方法。
	* 如果节点有断点，自动暂停并更新变量。
	*/
	onNodeHit(nodeId, nodeLabel, variables) {
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const prevState = this._state;
		const existingIdx = prevState.callStack.findIndex((f) => f.nodeId === nodeId);
		let newCallStack;
		if (existingIdx >= 0) {
			newCallStack = [...prevState.callStack];
			newCallStack[existingIdx] = {
				nodeId,
				nodeLabel,
				enteredAt: now,
				variables: [...variables]
			};
		} else newCallStack = [...prevState.callStack, {
			nodeId,
			nodeLabel,
			enteredAt: now,
			variables: [...variables]
		}];
		let shouldPause = false;
		if (prevState.status === "running") {
			const bp = this.breakpoints.get(nodeId);
			if (bp?.enabled) {
				shouldPause = true;
				if (bp.condition) try {
					const varMap = {};
					for (const v of variables) varMap[v.name] = v.value;
					shouldPause = evalBreakpointCondition(bp.condition, varMap);
				} catch (e) {
					logger.warn("[debugger] 条件断点求值失败:", e);
					shouldPause = false;
				}
			}
		}
		this._state = {
			...prevState,
			variables: [...variables],
			callStack: newCallStack,
			status: shouldPause ? "paused" : prevState.status,
			pausedNodeId: shouldPause ? nodeId : prevState.status === "paused" ? prevState.pausedNodeId : void 0
		};
		this.emitStateChanged();
	}
	/** 更新当前暂停节点的变量值 */
	setVariables(variables) {
		this._state = {
			...this._state,
			variables: [...variables]
		};
		this.emitStateChanged();
	}
	/** 从调用栈移除已退出的帧 */
	onNodeExit(nodeId) {
		this._state = {
			...this._state,
			callStack: this._state.callStack.filter((f) => f.nodeId !== nodeId)
		};
		this.emitStateChanged();
	}
	/** 通过 IPC 向所有渲染进程推送状态变化 */
	emitStateChanged() {
		const state = this.getState();
		for (const win of electron.BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("debug:stateChanged", state);
	}
};
/** 全局唯一实例 */
var debuggerService = new DebuggerSingleton();

export { SAFE_CONDITION_RE, DANGEROUS_KEYWORDS, isBreakpointConditionAllowed, evalBreakpointCondition, DebuggerSingleton, debuggerService };
