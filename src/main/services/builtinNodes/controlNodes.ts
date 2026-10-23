// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/** 一条 case 的判定（目录承诺：裸值 / 比较运算符 / `*` 通配 / 逗号多值） */
function matchesSwitchCase(key, raw) {
	const m = raw.trim();
	if (!m) return false;
	if (m === "*") return true;
	if (m.endsWith("*") && !m.slice(0, -1).includes("*")) return key.startsWith(m.slice(0, -1));
	const cmp = m.match(/^(>=|<=|!=|>|<)\s*(.+)$/);
	if (cmp) {
		const n = Number(key);
		const t = Number(cmp[2]);
		if (Number.isNaN(n) || Number.isNaN(t)) return false;
		switch (cmp[1]) {
			case ">=": return n >= t;
			case "<=": return n <= t;
			case ">": return n > t;
			case "<": return n < t;
			default: return n !== t;
		}
	}
	return m.split(",").map((s) => s.trim()).some((v) => v === key);
}
/**
* `branch_switch` 的**真机路由**（2026-09-26 修）。
*
* ## 原来坏在哪
*
* 目录契约是**一个 JSON 字符串**：`cases = '[{"match":"a","label":"分支A"}]'`
* （面板 `SwitchCaseEditor` 生成的就是它）。而 handler 把它原样交给上面的 `switchCase()`，
* 那里执行 `String(value) in cases` —— 对字符串用 `in` 直接抛
* `TypeError: Cannot use 'in' operator to search for 'a' in [...]`。
*
* 于是真机上：**永远走 `default` 出口**、节点标红、异常写下 `__chain_aborted__`
* 把默认分支截断在第一个节点。而历史上唯一覆盖它的测试传的是**旧的对象映射**
* （`cases: {a: '输出A'}`），恰好绕开了新契约 —— 缺陷因此一直不可见。
*
* 解释器那一侧其实早就按新契约写好了（`execSwitchCase` 读 `<节点id>:matched` 当出口名），
* 所以**只改这里**即可：返回目录承诺的 4 个输出端口值。
* 注意：**任何情况下都不返回 error** —— 没命中是正常情况（走 default），
* 返回 error 会让节点标红并打断链。
*/
function switchCaseRoute(value, casesRaw, defaultLabel = "default") {
	const key = String(value ?? "");
	const fallback = {
		matched: defaultLabel,
		matched_value: "",
		index: -1,
		is_default: true,
		error: ""
	};
	if (casesRaw && typeof casesRaw === "object" && !Array.isArray(casesRaw)) {
		const map = casesRaw;
		if (key in map) return {
			matched: String(map[key]),
			matched_value: key,
			index: 0,
			is_default: false,
			error: ""
		};
		return fallback;
	}
	let list = [];
	if (typeof casesRaw === "string") {
		const text = casesRaw.trim();
		if (text) try {
			const parsed = JSON.parse(text);
			if (Array.isArray(parsed)) list = parsed;
		} catch {
			return fallback;
		}
	} else if (Array.isArray(casesRaw)) list = casesRaw;
	for (let i = 0; i < list.length; i++) {
		const label = String(list[i]?.label ?? "");
		if (!label) continue;
		const m = String(list[i]?.match ?? "");
		if (matchesSwitchCase(key, m)) return {
			matched: label,
			matched_value: m,
			index: i,
			is_default: false,
			error: ""
		};
	}
	return fallback;
}
function loopControl(action, value = null) {
	if (action !== "continue" && action !== "break" && action !== "return") return {
		action: "continue",
		value,
		error: `未知的循环控制模式: ${String(action)}（可选 break / return）`
	};
	return {
		action,
		value,
		error: ""
	};
}
/**
* 延迟。
*
* 目录声明了两个数据出口：`result`(boolean) 与 `error`(string)。实现原来只返回
* `{success, error}` —— `result` **从来没有被写过**（`docs/architecture/audit-catalog-runtime-drift.md` C1：
* 下游拿到的是 undefined，而且不报错）。
*
* 端口声明的语义就是「是否等待完成」，而 `delay` 没有失败路径（等到了就是完成了），
* 所以这里如实地写 `result: true`，并把端口描述同步成实现真正做的事
* （描述不再是空的/含糊的，声明也不再悬空）。
*/
async function delay(ms = 1e3) {
	await new Promise((resolve) => setTimeout(resolve, ms));
	return {
		result: true,
		success: true,
		error: ""
	};
}
/**
* 计时节点。
*
* 目录契约：`mode = start / stop / elapsed`，端口 `timer_id`，输出 `elapsed`(秒) / `elapsed_ms`。
* 历史实现是 `setInterval(callback, ms)` —— 流程图里根本给不出 `callback`，
* 且它没注册进 `handlerRegistry`，跑到这里只会报"找不到 handler"。
*/
function timerOp(mode = "elapsed", timerId = "default") {
	try {
		const id = timerId || "default";
		if (mode === "start") {
			timerStarts.set(id, Date.now());
			return {
				elapsed: 0,
				elapsed_ms: 0,
				error: ""
			};
		}
		const startedAt = timerStarts.get(id);
		if (startedAt === void 0) return {
			elapsed: 0,
			elapsed_ms: 0,
			error: `计时器 ${id} 还没 start 过`
		};
		const ms = Date.now() - startedAt;
		if (mode === "stop") timerStarts.delete(id);
		return {
			elapsed: Math.round(ms / 10) / 100,
			elapsed_ms: ms,
			error: ""
		};
	} catch (e) {
		return {
			elapsed: 0,
			elapsed_ms: 0,
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
async function waitInput(_bot, _event, timeout = 3e4, prompt = "") {
	return {
		success: false,
		input: "",
		timeout: false,
		error: `等待未挂起（解释器未登记恢复现场；配置：超时 ${timeout}ms${prompt ? `，提示「${prompt}」` : ""}）`
	};
}
function systemLog(level = "info", message = "", data = null) {
	const raw = String(level ?? "info");
	const method = SYSTEM_LOG_CONSOLE_METHOD[raw] ?? "log";
	const text = method === "log" ? `[system_log:${raw}] ${message}` : message;
	console[method](text, data);
	return "";
}
function errorOp(error, mode = "return") {
	if (mode === "throw") throw error;
	return {
		success: false,
		error: String(error)
	};
}
/** timer 节点的计时表（按 timer_id，进程内） */
var timerStarts = /* @__PURE__ */ new Map();
/**
* 目录里的「级别」取值 → `console` 的**方法名**。
*
* 事故（`docs/architecture/audit-catalog-runtime-drift.md` B2）：目录给的取值是 `info|warning|error|debug`，
* 而 `console` **没有 `warning` 这个方法**（正确名字是 `warn`）。实现原来直接
* `console[level](message, data)`，于是用户在「级别」里选「警告」必定抛
* `TypeError: console[level] is not a function` —— 节点标红、整条链被 `__chain_aborted__`
* 截断，而错误信息里既没有 "system_log" 也没有修法。
*
* 把「目录取值」与「控制台方法名」拆成两张表之后，枚举取值再也不可能变成方法调用。
*/
var SYSTEM_LOG_CONSOLE_METHOD = {
	info: "info",
	warning: "warn",
	warn: "warn",
	error: "error",
	debug: "debug"
};

export { matchesSwitchCase, switchCaseRoute, loopControl, delay, timerOp, waitInput, systemLog, errorOp, timerStarts, SYSTEM_LOG_CONSOLE_METHOD };
