// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/** 透传（不校验）的类型 */
var PASSTHROUGH = /* @__PURE__ */ new Set([
	"any",
	"event",
	"object",
	"datetime"
]);
/**
* **运行时用**的保守归一 —— 与 {@link coercePortValue} 的区别（这是 2026-10-03 那次接线失败的教训）：
*
* `coercePortValue` 是**严格规格**（按声明类型硬转）。把它直接接到"值进 kwargs"上，
* 全量立刻 3 文件 5 例红，而且每一例都指向**"本来能用的值被改坏"**：
*   · 权限级别（string 口收到 number → 被转成 '3'）→ 比较不上；
*   · jsonOp 命名变量（数字被转成字符串）；
*   · agent_chat（合法值被拒 → 抛）。
*
* 所以运行时这一版只做两件事：
*   ① **拒绝明确不可用的值**（非数字进 number 口 / 非数组进 list 口 / 坏 JSON 进 json 口 …）；
*   ② 少量**显然更正确**的转换（对象进 string 口 → JSON 文本，而不是 `[object Object]`）。
*
* 明确**不做**的：把 number/boolean 塞进 string 口时改类型、把空串变成 null ——
* "已经能跑的值"一律不动（空值原样返回，连 null 都不换）。
*/
function normalizePortValueForRuntime(raw, dataType) {
	if (raw === null || raw === void 0 || raw === "") return {
		ok: true,
		value: raw
	};
	if (!dataType || PASSTHROUGH.has(dataType)) return {
		ok: true,
		value: raw
	};
	switch (dataType) {
		case "string": return {
			ok: true,
			value: typeof raw === "object" ? JSON.stringify(raw) : raw
		};
		case "number":
			if (typeof raw === "number") return Number.isFinite(raw) ? {
				ok: true,
				value: raw
			} : {
				ok: false,
				error: `端口声明为 number，但收到非有限数值：${String(raw)}`
			};
			if (typeof raw === "string" && Number.isFinite(Number(raw.trim()))) return {
				ok: true,
				value: Number(raw.trim())
			};
			return {
				ok: false,
				error: `端口声明为 number，但收到的值不是数字：${describe(raw)}`
			};
		case "boolean":
			if (typeof raw === "boolean") return {
				ok: true,
				value: raw
			};
			if (raw === 1 || raw === "1" || raw === "true") return {
				ok: true,
				value: true
			};
			if (raw === 0 || raw === "0" || raw === "false") return {
				ok: true,
				value: false
			};
			return {
				ok: true,
				value: raw
			};
		case "list":
			if (Array.isArray(raw)) return {
				ok: true,
				value: raw
			};
			if (typeof raw === "string") try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) return {
					ok: true,
					value: parsed
				};
			} catch {}
			return {
				ok: false,
				error: `端口声明为 list，但收到的不是数组：${describe(raw)}`
			};
		case "json":
			if (typeof raw === "object") return {
				ok: true,
				value: raw
			};
			if (typeof raw === "string") try {
				return {
					ok: true,
					value: JSON.parse(raw)
				};
			} catch (e) {
				return {
					ok: false,
					error: `端口声明为 json，但值不是合法 JSON：${describe(raw)}（${e instanceof Error ? e.message : String(e)}）`
				};
			}
			return {
				ok: false,
				error: `端口声明为 json，但收到的类型不可用：${describe(raw)}`
			};
		default: return {
			ok: true,
			value: raw
		};
	}
}
/** 给报错用的简短值描述（截断，避免日志被长文本刷屏） */
function describe(raw) {
	const text = typeof raw === "string" ? raw : JSON.stringify(raw);
	const s = text === void 0 ? String(raw) : text;
	return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

export { PASSTHROUGH, normalizePortValueForRuntime, describe };
