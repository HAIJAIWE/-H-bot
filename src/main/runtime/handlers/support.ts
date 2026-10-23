// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { cloneForEdit, isTruthyFlag, portToParam } from "../handlerUtils";
import { EXPRESSION_CONFIG_KEYS, namedVarKey } from "../../../shared/nodes/varRef";
import { listOp, timeOp } from "../../services/builtinNodes/dataNodes";

/**
* 解析 `end_node`（「结束」节点）的 `returns` 配置 → 子流程返回值对象。
*
* ## 为什么要有这段（2026-09-26 补）
*
* 目录里 `end_node` 的说明写着「流程终点（定义返回值/结束）」、summary 写着
* 「子流程=定义返回值字段映射。对标扣子 End 节点」，界面上还有一整个
* `EndNodeConfigEditor`（返回值表格 + 数据来源下拉）——**但 TS 运行时没有任何 end_node 实现**
* （`grep end_node src/main/runtime/` → 0 命中）。实测（探针，改之前）：
*
* ```
* [ts-interpreter] 节点 end 找不到节点实现 (handler): end_node
* call:result = null        ← 返回值丢了
* call:error  = ""          ← 而且**不报错**，子流程看起来是成功的
* ```
*
* 即：一个"节点在画布上、配置填好了、日志里报红、返回值静默为 null"的组合。
* 唯一能返回值的路只剩「流程控制」节点的"提前返回"模式 —— 而目录的文字从没提过它。
*
* ## 语义（与 `codegen/controlFlowEmitter.emitEndNode` 对齐）
*
* `returns` 是 `[{field, source}]`：
* - `field` = 返回字典的键名
* - `source` = `"<节点id>:<端口id>"`，取 `ctx.variables` 里那个键的值
*   （也接受 `__var__:<变量名>`，见 `shared/nodes/varRef.ts` —— 这样子流程能把自己的参数原样传回去）
*
* ## 与 Python codegen 有意不同的两点
*
* 1. **不"洗"字段名**。codegen 把 `field` 过一遍 `replace(/[^a-zA-Z0-9_]/g,'_')`，因为它要拼进
*    JS 源码；运行时拼的是对象字面量，键名本来就是任意字符串。洗名字会把中文键
*    （`"经验"`）**静默改写成 `"__"`** —— 用户按自己填的名字去 `get(result,"经验")` 就取不到，
*    而且不会报错。宁可原样保留。
* 2. **区分"节点没跑"与"配置写错"**。`source` 指向的**节点不存在**时才报错（多半是打错字）；
*    节点存在但这一轮没产出值（例如它在那条没走到的分支上）**不算错**，
*    只把该字段留成 `undefined`。否则任何"条件分支里才赋值的返回值"都会误报成红色节点。
*/
function resolveEndNodeReturns(raw, variables, nodeExists) {
	let list = raw;
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed) return {
			value: {},
			errors: []
		};
		try {
			list = JSON.parse(trimmed);
		} catch {
			return {
				value: {},
				errors: [`returns 不是合法 JSON：${raw}`]
			};
		}
	}
	if (!Array.isArray(list)) return {
		value: {},
		errors: []
	};
	const value = {};
	const errors = [];
	for (const entry of list) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry;
		const field = String(row.field ?? "").trim();
		if (!field) {
			errors.push("returns 里有一行没填字段名");
			continue;
		}
		const source = String(row.source ?? "").trim();
		if (!source) {
			errors.push(`字段 "${field}" 没选数据来源`);
			value[field] = void 0;
			continue;
		}
		if (source.startsWith("__var__:")) {
			value[field] = variables[source];
			continue;
		}
		const colonIdx = source.lastIndexOf(":");
		if (colonIdx <= 0 || colonIdx === source.length - 1) {
			errors.push(`字段 "${field}" 的数据来源 "${source}" 格式不对（应为 节点id:端口id）`);
			value[field] = void 0;
			continue;
		}
		if (nodeExists && !nodeExists(source.slice(0, colonIdx))) {
			errors.push(`字段 "${field}" 引用的节点不存在：${source}`);
			value[field] = void 0;
			continue;
		}
		value[field] = variables[source];
	}
	return {
		value,
		errors
	};
}
/** 将 kwargs（端口 ID 键）转换为 handler 参数对象（参数名键） */
function mapKwargsToParams(kwargs) {
	const params = {};
	for (const [portId, value] of Object.entries(kwargs)) params[portToParam(portId)] = value;
	return params;
}
/**
* 把"数据端口连进来的值"合并成变量表（`expression_eval` 的 v1/v2、`format_text` 的 var1/var2）。
*
* 事故（片段运行时验证抓到的）：这两个节点只看 `variables_json`，而**上游连线进来的值**是
* 以端口 id 为键的 kwargs（`v1` / `var1`…）—— 于是表达式里写 `v1 + 10` 永远报
* `v1 is not defined`，模板里写 `{var1}` 永远渲染成空。目录（`shared/nodes/builtinCatalog.ts`）
* 里这两个节点的端口就叫 `v1/v2`、`var1`，面板也是这么存的。
*
* 优先级：端口连进来的值 > variables_json（面板默认值）——连了线就该以线为准。
*/
function parseVarsJson(raw) {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw === "string" && raw.trim()) try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
	return {};
}
/**
* 端口变量判定：除了配置键与**内部键**（`__` 前缀，那是运行时自己的标记）之外，都是变量。
*
* 事故（搭 RPG 回合制战斗时撞到的）：端口命名成 `st`（比 v2 可读），表达式写 `get(st,"hp")`
* → `st is not defined`；而画布上那条线明明白白连着，节点只报一个没有消息的错误。
* 根因是这里原先只认 `/^v\d+$/` 这种**名字模式**，自定义端口名一律进不了变量表。
*
* ⚠️ `EXPRESSION_CONFIG_KEYS` 现在住在 `@shared/nodes/varRef` —— 因为界面上的
* 「可用的变量名」清单必须用**同一份**排除表，否则界面会把 `mode` 列成可用变量。
*/
function isExpressionVarKey(key) {
	if (key.startsWith("__")) return false;
	return !EXPRESSION_CONFIG_KEYS.has(key);
}
function mergePortVars(kwargs, isPortKey, opts = {}) {
	const vars = { ...parseVarsJson(kwargs?.variables_json ?? kwargs?.variables) };
	const matchPort = typeof isPortKey === "function" ? isPortKey : (k) => isPortKey.test(k);
	for (const [key, value] of Object.entries(kwargs ?? {})) {
		if (!matchPort(key) || value === void 0) continue;
		if (value === null && !opts.includeNull) continue;
		vars[key] = value;
	}
	return vars;
}
/**
* 解析 `expression_eval` 的 `formulas` 配置。
*
* 兼容数组与 JSON 字符串两种存法（渲染层的 `expressionVarSlots` 也是这么处理的 ——
* 早期版本把它当字符串存，后来的编辑器写数组，两种数据都还在盘上）。
* 没名字或没表达式的行直接丢掉：端口是按名字生成的，无名公式没有可写入的端口。
*/
function parseFormulas(raw) {
	let list = raw;
	if (typeof raw === "string") try {
		list = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(list)) return [];
	const out = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const name = String(item.name ?? "").trim();
		const expression = String(item.expression ?? "").trim();
		if (name && expression) out.push({
			name,
			expression
		});
	}
	return out;
}
/**
* `list_op` 的实现（含"直接读写命名变量"那套开关）。
*
* 拆成 4 个节点后**不抄代码**：老 `list_op` 与 `list_edit` / `list_query` / `list_transform` /
* `list_combine` 都走这里，区别只在"允许哪些模式"（越界由 makeListHandler 明确报错）。
*/
function runListOp(kwargs, hctx) {
	const mode = kwargs.mode ?? "append";
	const varName = String(kwargs.var_name ?? "").trim();
	const fromVariable = String(kwargs.source_from ?? "port") === "variable" && varName.length > 0;
	const portList = kwargs.source_list ?? kwargs.list ?? [];
	const call = (list) => listOp(mode, list, kwargs.item ?? kwargs.value ?? null, kwargs.index ?? null, kwargs.start ?? 0, kwargs.end ?? 10, String(kwargs.key_field ?? ""), String(kwargs.count_field ?? "count"), kwargs.delta ?? 1);
	if (!fromVariable) return call(portList);
	const execCtx = hctx?.ctx;
	if (!execCtx) return {
		result: null,
		error: "内部错误：拿不到执行上下文，无法读写命名变量"
	};
	const existing = execCtx.variables[namedVarKey(varName)];
	const base = existing === void 0 || existing === null ? [] : cloneForEdit(existing);
	const out = call(Array.isArray(base) ? base : []);
	if (!Boolean(out.error) && (/* @__PURE__ */ new Set([
		"append",
		"prepend",
		"insert",
		"remove",
		"pop",
		"shift",
		"sort",
		"reverse",
		"unique",
		"merge",
		"slice",
		"upsert"
	])).has(String(mode)) && isTruthyFlag(kwargs.write_back)) execCtx.variables[namedVarKey(varName)] = out.result;
	return out;
}
/** 拆分出的 4 个节点各自允许的模式（顺序即默认值） */
var LIST_NODE_MODES = {
	list_edit: [
		"append",
		"remove",
		"insert",
		"upsert"
	],
	list_query: [
		"contains",
		"size",
		"get",
		"index_of"
	],
	list_transform: [
		"sort",
		"reverse",
		"unique"
	],
	list_combine: [
		"merge",
		"slice",
		"pop"
	]
};
/** 按节点收窄模式：越界**明确报错**，不静默兜底 */
function makeListHandler(kind) {
	return (_bot, _event, kwargs, hctx) => {
		const allowed = LIST_NODE_MODES[kind];
		if (!allowed) return runListOp(kwargs, hctx);
		const mode = String(kwargs.mode ?? allowed[0]);
		if (!allowed.includes(mode)) return {
			result: null,
			changed: false,
			count: 0,
			total: 0,
			error: `节点「${kind}」不支持模式「${mode}」（可选：${allowed.join(" / ")}）`
		};
		return runListOp({
			...kwargs,
			mode
		}, hctx);
	};
}
/**
* `time_op` 拆分（2026-10-03）：8 个模式 → 3 个节点（读时间 / 判断是否今天 / 算时间）。
*
* 五个 kind **共用同一个实现**（dataNodes.timeOp），区别只在"允许哪些模式"。
* 位置参数按 timeOp 的签名逐位映射（mode, timestamp, fmt, timezone, target, unit, targetFmt, offset）——
* **没传的参数保持 undefined**，好让实现里的默认值继续生效（传空串会把默认值覆盖掉）。
*/
var TIME_NODE_MODES = {
	time_read: [
		"now",
		"timestamp",
		"format",
		"parse"
	],
	time_check: ["is_today"],
	time_calc: [
		"date_diff",
		"add",
		"sub"
	]
};
function makeTimeHandler(kind) {
	return (_bot, _event, kwargs) => {
		const allowed = TIME_NODE_MODES[kind];
		const mode = String(kwargs.mode ?? allowed[0]);
		if (!allowed.includes(mode)) return {
			result: "",
			error: `节点「${kind}」不支持模式「${mode}」（可选：${allowed.join(" / ")}）`
		};
		return timeOp(mode, kwargs.timestamp ?? null, kwargs.fmt, kwargs.timezone, kwargs.target ?? null, kwargs.unit, kwargs.target_fmt, kwargs.offset ?? null);
	};
}

export { resolveEndNodeReturns, mapKwargsToParams, parseVarsJson, isExpressionVarKey, mergePortVars, parseFormulas, runListOp, LIST_NODE_MODES, makeListHandler, TIME_NODE_MODES, makeTimeHandler };
