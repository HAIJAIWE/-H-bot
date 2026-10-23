// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { BASE_DATA_PREFIX } from "../../../shared/persist/baseKeys";
import { makeKey, persistentStore } from "./persistentStore";

function jsonOp(mode, data = "", path = "", value = null) {
	try {
		let obj;
		if (typeof data === "string") try {
			obj = JSON.parse(data);
		} catch (e) {
			return {
				result: null,
				error: `source 不是合法 JSON：${e instanceof Error ? e.message : String(e)}（要写成对象，如 {"hp": 10}；也可以直接连一个对象进来）`
			};
		}
		else obj = data;
		/** 沿路径走到倒数第二层；走不通（中间不是对象）时给可操作错误 */
		const walk = (keys) => {
			let cur = obj;
			for (let i = 0; i < keys.length - 1; i++) {
				const next = cur?.[keys[i]];
				if (next === null || next === void 0) return {
					node: null,
					error: `路径 ${path} 走不通：${keys.slice(0, i + 1).join(".")} 不存在（当前是 null/undefined）`
				};
				if (typeof next !== "object") return {
					node: null,
					error: `路径 ${path} 走不通：${keys.slice(0, i + 1).join(".")} 不是对象（是 ${typeof next}），不能再往里取字段`
				};
				cur = next;
			}
			return {
				node: cur,
				error: ""
			};
		};
		switch (mode) {
			case "parse": return {
				result: obj,
				error: ""
			};
			case "stringify": return {
				result: JSON.stringify(data, null, 2),
				error: ""
			};
			case "get": {
				const keys = splitJsonPath(path);
				if (keys.length === 0) return {
					result: obj,
					error: ""
				};
				let val = obj;
				for (const k of keys) val = val?.[k];
				return {
					result: val,
					error: ""
				};
			}
			case "set": {
				const keys = splitJsonPath(path);
				if (keys.length === 0) return {
					result: obj,
					error: "「设置字段」需要填写「字段路径」（如 hp 或 battle.hp）"
				};
				let val = obj;
				for (let i = 0; i < keys.length - 1; i++) {
					const cur = val[keys[i]];
					if (cur === null || cur === void 0) val[keys[i]] = {};
					else if (typeof cur !== "object") return {
						result: obj,
						error: `路径 ${path} 走不通：${keys.slice(0, i + 1).join(".")} 不是对象（是 ${typeof cur}），不能往里设置字段`
					};
					val = val[keys[i]];
				}
				val[keys[keys.length - 1]] = value;
				return {
					result: obj,
					error: ""
				};
			}
			case "delete": {
				const keys = splitJsonPath(path);
				if (keys.length === 0) return {
					result: obj,
					error: "「删除字段」需要填写「字段路径」（如 hp 或 battle.hp）"
				};
				const walked = walk(keys);
				if (walked.error) return {
					result: obj,
					error: walked.error
				};
				const node = walked.node;
				if (node && typeof node === "object") delete node[keys[keys.length - 1]];
				return {
					result: obj,
					error: ""
				};
			}
			/**
			* 「合并 JSON」：把 `value` 里的字段并进 `data`（**浅合并**，同名键覆盖）。
			*
			* 为什么是浅合并：这个模式的用法是"往一个结果字典里补几个字段"
			* （如把 `log` / `actions` / `footer` 并进回合结果），浅合并的语义最可预测；
			* 嵌套对象要整体替换还是递归合并没有共识，递归合并还会让"想清空一个子对象"
			* 变得做不到。要深层结构就用点号路径的「设置字段」逐条设。
			*
			* 历史缺陷（2026-09-26 实测）：目录的 `JSON_OP_MODE_OPTIONS` **提供了「合并 JSON」**
			* （`value` 端口的 showWhen 也认 'merge'），但实现里**没有这个分支** ——
			* 于是用户选中它必定拿到 `未知 mode: merge`，节点在画布上标红。
			* 一个"界面上可选、却永远不可能成功"的模式，比没有这个模式更糟。
			*/
			case "merge": {
				const patch = typeof value === "string" ? value.trim() ? JSON.parse(value) : {} : value;
				if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return {
					result: obj,
					error: "「合并 JSON」需要一段 JSON 对象（如 {\"hp\": 10}）"
				};
				return {
					result: {
						...obj,
						...patch
					},
					error: ""
				};
			}
			default: return {
				result: null,
				error: `未知 mode: ${mode}`
			};
		}
	} catch (e) {
		return {
			result: null,
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
/**
* JSON 字段路径归一化：**容忍面板默认值那种 `$.key` 写法**。
*
* 事故（`defaultUsableGate` 第一次跑抓出来的同族缺陷）：目录里 `key` 的默认值就是
* `'$.key'`（JSONPath 风格），而实现是按 `.` 硬切的 —— 第一段变成 `'$'`：
*   · `get` 只是取不到值（不报错，静默返回 undefined）；
*   · `set` 会造出一个叫 `$` 的键；
*   · **`delete` 直接抛** `TypeError: Cannot convert undefined or null to object`，
*     被 catch 之后原样交给用户（错误里既没有字段名也没有修法）。
*
* 归一化只做一件事：去掉开头的 `$` / `$.` / 前导点号 —— 其余路径语义一字未改
* （`a.b` 还是 `a.b`，`''` / `'$'` 仍然是"整个对象"）。
*/
function splitJsonPath(path) {
	const trimmed = path.trim();
	if (!trimmed || trimmed === "$" || trimmed === ".") return [];
	return trimmed.replace(/^\$\.?/, "").split(".").filter((k) => k.length > 0);
}
function listOp(mode, list = [], value = null, index = null, start = 0, end = 10, keyField = "", countField = "count", delta = 1) {
	const arr = asList$1(list);
	const total = arr.length;
	const clamp = (i, max) => Math.max(0, Math.min(Math.floor(Number(i) || 0), max));
	/**
	* 统一出口：count 默认按目录约定推导（列表类=len(result)，单元素类=0/1）。
	*
	* `result` 声明成 `unknown[]` 是为了让下游（含测试）能把它直接当作列表继续传递；
	* contains/index_of/get/size 等标量模式运行时返回的是标量，类型只是历史契约的收窄。
	*/
	const done = (result, changed, count) => ({
		result,
		changed,
		count: count ?? (Array.isArray(result) ? result.length : result === null || result === void 0 || result === false || result === -1 ? 0 : 1),
		total,
		error: ""
	});
	try {
		switch (mode) {
			case "append":
				arr.push(value);
				return done(arr, true);
			/**
			* upsert：按字段找同款，找到就把计数字段加 `delta`，没找到就整条塞进去。
			*
			* 为什么需要（真机缺口）：`remove`/`contains`/`index_of` 全是**严格相等**匹配
			* （`arr.indexOf(value)`），没法"按字段找对象"。于是背包最核心的一步
			* ——"有新手剑就 +1，没有就新增"——**做不到**，只能去写 JS 数组表达式。
			*
			* 用法：`value` 传要加的物品对象（如 `{name:"新手剑", desc:"..."}`），
			* `key_field` 传 `name`，`count_field` 传 `count`，`delta` 传 1。
			*/
			case "upsert": {
				if (!keyField) return {
					...done(arr, false),
					error: "upsert 模式需要「匹配字段」（如 name）"
				};
				if (!value || typeof value !== "object" || Array.isArray(value)) return {
					...done(arr, false),
					error: "upsert 模式的「操作元素」必须是一个对象"
				};
				const next = value;
				const keyValue = next[keyField];
				if (keyValue === void 0 || keyValue === null || keyValue === "") return {
					...done(arr, false),
					error: `upsert 模式：操作元素里没有「${keyField}」字段，无法判断同款`
				};
				const step = Number(delta);
				if (!Number.isFinite(step)) return {
					...done(arr, false),
					error: `upsert 模式的增量不是数字：${JSON.stringify(delta)}`
				};
				const at = arr.findIndex((it) => it && typeof it === "object" && !Array.isArray(it) && it[keyField] === keyValue);
				if (at >= 0) {
					const current = Number(arr[at][countField]);
					const base = Number.isFinite(current) ? current : 0;
					const merged = {
						...arr[at],
						[countField]: base + step
					};
					arr[at] = merged;
					return done(arr, true, merged[countField]);
				}
				const created = {
					...next,
					[countField]: step
				};
				arr.push(created);
				return done(arr, true, created[countField]);
			}
			case "prepend":
				arr.unshift(value);
				return done(arr, true);
			case "insert":
				arr.splice(clamp(index, arr.length), 0, value);
				return done(arr, true);
			case "remove": {
				const i = arr.indexOf(value);
				if (i >= 0) arr.splice(i, 1);
				return done(arr, i >= 0);
			}
			case "pop": {
				const i = Number(index) > 0 ? Math.min(Math.floor(Number(index)), arr.length - 1) : arr.length - 1;
				if (i < 0) return done(arr, false);
				arr.splice(i, 1);
				return done(arr, true);
			}
			case "shift": return done(arr, arr.shift() !== void 0);
			case "contains": {
				const has = arr.includes(value);
				return done(has, false, has ? 1 : 0);
			}
			case "index_of": {
				const i = arr.indexOf(value);
				return done(i, false, i >= 0 ? 1 : 0);
			}
			case "get": {
				const i = Math.max(0, Math.floor(Number(index) || 0));
				const item = i < arr.length ? arr[i] : null;
				return done(item ?? null, false, item === void 0 || item === null ? 0 : 1);
			}
			case "size": return done(total, false, total);
			case "length": return done([total], false);
			case "slice": {
				const sliced = arr.slice(Number(start) || 0, Number(end) || 0);
				return done(sliced, sliced.length !== total);
			}
			case "sort":
				arr.sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
				return done(arr, JSON.stringify(arr) !== JSON.stringify(list));
			case "reverse":
				arr.reverse();
				return done(arr, JSON.stringify(arr) !== JSON.stringify(list));
			case "unique": {
				const uniq = [...new Set(arr)];
				return done(uniq, uniq.length !== total);
			}
			case "merge": {
				const other = asList$1(value);
				return done(arr.concat(other), other.length > 0);
			}
			case "filter": {
				const filtered = arr.filter((x) => x === value);
				return done(filtered, filtered.length !== total);
			}
			case "map": return done(arr, false);
			case "reduce": return done(arr.reduce((a, b) => Number(a) + Number(b), 0), false, 1);
			default: return {
				result: [],
				changed: false,
				count: 0,
				total,
				error: `未知 mode: ${mode}`
			};
		}
	} catch (e) {
		return {
			result: [],
			changed: false,
			count: 0,
			total,
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
/**
* 把"列表"入参归一成数组。
*
* 面板/片段存的经常是 JSON 字符串（片段「添加物品」的 inventory 默认值就是 `'[]'`），
* 旧实现遇到字符串直接当空数组，等于把已有数据丢掉。
*/
function asList$1(input) {
	if (Array.isArray(input)) return [...input];
	if (typeof input === "string") {
		const trimmed = input.trim();
		if (!trimmed) return [];
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed;
		} catch {}
		return [input];
	}
	return [];
}
function random(mode, min = 0, max = 1, list = []) {
	try {
		const arr = asRandomList(list);
		switch (mode) {
			case "int": return {
				result: Math.floor(Math.random() * (max - min + 1)) + min,
				error: ""
			};
			case "float": return {
				result: Math.random() * (max - min) + min,
				error: ""
			};
			case "choice": return {
				result: arr[Math.floor(Math.random() * arr.length)],
				error: ""
			};
			case "shuffle": return {
				result: [...arr].sort(() => Math.random() - .5),
				error: ""
			};
			/**
			* 加权随机（抽卡用）：list = [{ value, weight }]，按权重占比抽一个，返回 value。
			*
			* 为什么现在才实现：节点目录与属性面板一直提供"加权选择"这个模式，但 handler 里没有它 ——
			* 选了就报「未知 mode: weighted」（片段库里的「抽卡」就是这么坏的）。
			*/
			case "weighted": {
				const items = arr.filter((it) => !!it && typeof it === "object");
				const weights = items.map((it) => Math.max(0, Number(it.weight) || 0));
				const total = weights.reduce((s, w) => s + w, 0);
				if (items.length === 0 || total <= 0) return {
					result: null,
					error: "weighted 需要 [{value,weight}] 且权重之和 > 0"
				};
				let r = Math.random() * total;
				for (let i = 0; i < items.length; i++) {
					r -= weights[i];
					if (r < 0) return {
						result: items[i].value,
						error: ""
					};
				}
				return {
					result: items[items.length - 1].value,
					error: ""
				};
			}
			default: return {
				result: null,
				error: `未知 mode: ${mode}`
			};
		}
	} catch (e) {
		return {
			result: null,
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
/** 把端口值拍成数组：面板里存的是 JSON 字符串，节点间连线传的是数组 */
function asRandomList(list) {
	if (Array.isArray(list)) return list;
	if (typeof list === "string" && list.trim()) try {
		const parsed = JSON.parse(list);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
	return [];
}
/**
* 时间节点。
*
* 目录契约是 `now / is_today / date_diff`（端口 fmt / timezone / timestamp / target / unit /
* target_fmt），而历史实现是另一套模式名（timestamp/format/parse/add/sub）—— 前三个模式
* 全部落进「未知 mode」，且 `fmt` 参数根本没用上（format 模式直接返回 ISO 串）。
* 这里按契约实现，旧模式保留兼容。
*
* ⚠️ 输出端口：目录声明的 9 个数据端口**每个都要在返回对象里出现**（见 `TimeOpResult`），
* 否则解释器给那个端口写的是 `undefined`（"声明了但从来不写"）。
*/
function timeOp(mode = "now", timestamp = null, fmt = "%Y-%m-%d %H:%M:%S", timezone = "", target = null, unit = "seconds", targetFmt = "%Y-%m-%d %H:%M:%S", offset = null) {
	try {
		const date = toDate(timestamp);
		/**
		* 按「单位」把毫秒换算成目标单位。
		*
		* ⚠️ 以前只区分 `ms` 与"其它（当秒）"—— 而目录的下拉给的是**秒/分/时/天**
		* （`TIME_OP_UNIT_OPTIONS`），选了「分/时/天」实际拿到的是**秒**：一个静默算错。
		* 四个值现在都真的生效（`ms`/`milliseconds` 仍然按毫秒原样返回，是老契约）。
		*/
		const toUnit = (ms) => {
			const u = String(unit);
			if (u === "milliseconds" || u === "ms") return ms;
			if (u === "minutes") return Math.floor(ms / 6e4);
			if (u === "hours") return Math.floor(ms / 36e5);
			if (u === "days") return Math.floor(ms / 864e5);
			return Math.floor(ms / 1e3);
		};
		switch (mode) {
			/**
			* 「当前时间」：目录为这个模式声明了 **5 个额外输出端口**
			* （`timestamp` / `datetime` / `date` / `time` / `weekday`）。
			* 以前这里只返回 `{result, error}` —— 那 5 个端口在变量表里**一个都不存在**，
			* 下游连了线也永远是 undefined，而且不报错（探针实测：`n:timestamp=undefined`）。
			*/
			case "now": return {
				result: toUnit(date.getTime()),
				timestamp: toUnit(date.getTime()),
				datetime: formatDate(date, fmt || "%Y-%m-%d %H:%M:%S", timezone),
				date: formatDate(date, "%Y-%m-%d", timezone),
				time: formatDate(date, "%H:%M:%S", timezone),
				weekday: (date.getDay() + 6) % 7,
				error: ""
			};
			case "timestamp": return {
				result: toUnit(date.getTime()),
				error: ""
			};
			case "is_today": {
				/**
				* ⚠️ **空值 → false，不是"今天"**。
				*
				* `toDate(null)` 返回"现在"是给 `now`/`date_diff` 用的（"和现在比"），
				* 但拿来判断"今天做过没有"就错了：没有记录 ≠ 今天做过。
				*
				* 后果实测（2026-10-03）：新玩家存档里没有 `signin_date` → `is_today(null)`
				* 走 `toDate(null)=now` → `ymd(now)===ymd(now)` **恒真** →
				* **全新玩家第一次签到就被告知"今天已经签到过了"**（永远签到不了）。
				* 这条是用户清空数据后重来、第一次真机测试时暴露的。
				*/
				if (timestamp === null || timestamp === void 0 || timestamp === "") return {
					result: false,
					error: ""
				};
				const ymd = (d) => {
					const p = new Intl.DateTimeFormat("en-CA", {
						timeZone: timezone || void 0,
						year: "numeric",
						month: "2-digit",
						day: "2-digit"
					}).formatToParts(d);
					const g = (t) => p.find((x) => x.type === t)?.value ?? "";
					return `${g("year")}-${g("month")}-${g("day")}`;
				};
				return {
					result: ymd(date) === ymd(/* @__PURE__ */ new Date()),
					error: ""
				};
			}
			case "date_diff": {
				const other = toDate(target ?? Date.now());
				const msDiff = date.getTime() - other.getTime();
				/**
				* 「时间差」同样声明了 3 个额外端口（`diff` / `seconds` / `is_past`），
				* 以前也一个都没写。三条口径都来自目录的端口说明：
				*   · `diff`    —— "按指定单位的时间差**绝对值**"（受「单位」影响，与 `result` 同口径取绝对值）；
				*   · `seconds` —— "时间差**绝对值秒数**"（**不受「单位」影响**：选了分钟也要给秒）；
				*   · `is_past` —— "目标时间是否早于源时间" ⇒ 源（timestamp）减目标（target）为正。
				*/
				return {
					result: toUnit(msDiff),
					diff: toUnit(Math.abs(msDiff)),
					seconds: Math.floor(Math.abs(msDiff) / 1e3),
					is_past: msDiff > 0,
					error: ""
				};
			}
			case "format": return {
				result: formatDate(date, fmt, timezone),
				error: ""
			};
			case "parse": return {
				result: toUnit(new Date(timestamp ?? Date.now()).getTime()),
				error: ""
			};
			case "add":
			case "sub": {
				const rawOffset = offset ?? 0;
				const offsetMs = Number(rawOffset);
				if (rawOffset !== "" && rawOffset !== null && !Number.isFinite(offsetMs)) return {
					result: "",
					error: `偏移量不是有效数字: ${String(rawOffset)}`
				};
				const ms = mode === "add" ? date.getTime() + offsetMs : date.getTime() - offsetMs;
				return {
					result: formatDate(new Date(ms), targetFmt || fmt, timezone),
					error: ""
				};
			}
			default: return {
				result: "",
				error: `未知 mode: ${mode}`
			};
		}
	} catch (e) {
		return {
			result: "",
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
/** 把时间戳/字符串转成 Date（数字小于 1e11 视为"秒"） */
function toDate(value) {
	if (value === null || value === void 0 || value === "") return /* @__PURE__ */ new Date();
	if (typeof value === "number") return new Date(value < 1e11 ? value * 1e3 : value);
	const asNumber = Number(value);
	if (!Number.isNaN(asNumber) && String(value).trim() !== "") return toDate(asNumber);
	return new Date(value);
}
/** 按 `%Y-%m-%d %H:%M:%S` 这类格式渲染（也接受 YYYY/MM/DD 写法），timezone 为空用本地时区 */
function formatDate(date, fmt, timezone) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone || void 0,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false
	}).formatToParts(date);
	const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
	const map = {
		"%Y": get("year"),
		YYYY: get("year"),
		"%m": get("month"),
		MM: get("month"),
		"%d": get("day"),
		DD: get("day"),
		"%H": get("hour"),
		HH: get("hour"),
		"%M": get("minute"),
		mm: get("minute"),
		"%S": get("second"),
		ss: get("second")
	};
	let out = fmt || "%Y-%m-%d %H:%M:%S";
	for (const [token, value] of Object.entries(map)) out = out.split(token).join(value);
	return out;
}
function variableSet(bot, event, value = null, varName = "x") {
	if (!varName || !VAR_NAME_RE.test(varName)) return {
		result: value,
		var_name: varName,
		error: `非法变量名: ${varName}（需以字母/下划线开头，仅含字母/数字/下划线）`
	};
	return {
		result: value,
		var_name: varName,
		error: ""
	};
}
async function variableMerge(_bot, _event, mode = "dict", v1 = null, v2 = null, v3 = null, v4 = null, v5 = null, v6 = null, keyNames = "[]") {
	const values = [
		v1,
		v2,
		v3,
		v4,
		v5,
		v6
	];
	const present = values.filter((v) => v !== null && v !== void 0 && v !== "");
	try {
		if (mode === "dict") {
			const names = asList$1(keyNames).map((n) => String(n));
			const dict = {};
			values.forEach((v, i) => {
				if (v === null || v === void 0) return;
				dict[names[i] || `v${i + 1}`] = v;
			});
			return {
				result: dict,
				count: Object.keys(dict).length,
				error: ""
			};
		}
		if (mode === "list") return {
			result: present,
			count: present.length,
			error: ""
		};
		if (mode === "concat") {
			const flat = present.flatMap((v) => asList$1(v));
			return {
				result: flat,
				count: flat.length,
				error: ""
			};
		}
		return {
			result: null,
			count: 0,
			error: `未知模式: ${mode}（支持 dict/list/concat）`
		};
	} catch (e) {
		return {
			result: null,
			count: 0,
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
async function variablePersist(bot, event, mode = "load", key = "", value = null, scope = "user", ttl = 0, defaultValue = null, amount = 1, autoSave = true, maxLength = 0, data = "", compareOp = ">=", threshold = 1, delta = -1, keys = "[]", item = null) {
	console.info(`[variable_persist] mode=${mode}, key=${JSON.stringify(key)}, scope=${scope}, ttl=${ttl}`);
	const result = {
		result: null,
		success: false,
		error: "",
		exists: false,
		is_default: false,
		old_value: null,
		new: false,
		saved: 0,
		values: {},
		count: 0,
		length: 0,
		keys_list: [],
		failed_key: "",
		ok: false,
		reason: "",
		__control_port__: ""
	};
	const modesWithoutKey = mode === "batch_load" || mode === "batch_save" || mode === "batch_update";
	if (!modesWithoutKey && (!key || !VAR_PERSIST_IDENT_RE.test(key))) {
		result.error = "非法变量名: " + key + "（需以字母/下划线开头，仅含字母/数字/下划线）";
		return result;
	}
	if (!modesWithoutKey && key.startsWith("__sys_")) {
		result.error = `${BASE_DATA_PREFIX} 是引擎保留前缀（基础数据），业务字段请换一个名字`;
		return result;
	}
	if (ttl < 0) {
		result.error = "非法 ttl: " + ttl;
		return result;
	}
	if (ttl > 86400) {
		result.error = `ttl 超出上限: ${ttl}（最大 ${MAX_PERSIST_TTL}）`;
		return result;
	}
	try {
		makeKey(key, scope, {
			user_id: event?.user_id,
			group_id: event?.group_id
		});
		switch (mode) {
			case "compare_update": {
				const cmp = await persistentStore.compareAndUpdate(key, scope, event, {
					op: String(compareOp || ">="),
					threshold: Number(threshold ?? 1),
					delta: Number(delta ?? -1),
					defaultVal: Number(defaultValue ?? 0)
				});
				result.ok = cmp.ok;
				result.success = cmp.ok;
				result.result = cmp.ok ? cmp.newValue : cmp.oldValue;
				result.old_value = cmp.oldValue;
				result.reason = cmp.reason;
				result.error = cmp.error;
				result.__control_port__ = cmp.ok ? "out" : "failed";
				break;
			}
			case "batch_update": {
				if (data === null || data === void 0 || data === "") {
					result.error = "批量更新的「数据」为空：请把上游表达式的结果连到 data 端口，并确认它输出的是 JSON 数组（如 to_json([{\"key\":\"gold\",\"op\":\"dec\",\"value\":50,\"expectOp\":\">=\",\"expect\":50}])）。";
					break;
				}
				let batchOps;
				try {
					const parsed = typeof data === "string" ? JSON.parse(data) : data;
					if (!Array.isArray(parsed)) {
						result.error = `批量更新的「数据」必须是 JSON 数组，实际收到 ${typeof parsed}`;
						break;
					}
					batchOps = parsed;
				} catch (e) {
					result.error = `批量更新的「数据」不是合法 JSON：${e instanceof Error ? e.message : String(e)}（原文前 200 字：${String(data).slice(0, 200)}）`;
					break;
				}
				const bu = await persistentStore.batchUpdateValues(batchOps, scope, event, ttl);
				result.ok = bu.ok;
				result.success = bu.ok;
				result.values = bu.values;
				result.old_value = bu.oldValues;
				result.count = bu.writtenKeys.length;
				result.keys_list = bu.writtenKeys;
				result.reason = bu.reason;
				result.error = bu.error;
				result.failed_key = bu.failedKey;
				result.__control_port__ = bu.ok ? "out" : "failed";
				break;
			}
			case "save":
				const saved = persistentStore.saveValue(key, value, scope, event, ttl);
				result.success = saved;
				if (!saved) result.error = `键「${key}」保存失败（存储不可用？详见日志）`;
				result.saved = saved ? 1 : 0;
				result.new = true;
				result.values = { [key]: value };
				result.count = 1;
				result.length = 1;
				result.keys_list = [key];
				break;
			case "load": {
				const loaded = persistentStore.loadValueSafe(key, scope, event);
				const loadedVal = loaded.value;
				if (loaded.failed) {
					result.success = false;
					result.error = `键「${key}」读取失败（存储不可用？详见日志）`;
				} else result.success = true;
				result.result = loadedVal !== null ? loadedVal : defaultValue;
				result.exists = loadedVal !== null;
				result.old_value = loadedVal;
				result.is_default = loadedVal === null;
				break;
			}
			case "delete": {
				const del = persistentStore.deleteValueSafe(key, scope, event);
				result.success = del.deleted;
				if (del.failed) result.error = `键「${key}」删除失败（存储不可用？详见日志）`;
				result.exists = !del.deleted;
				break;
			}
			case "exists": {
				const ex = persistentStore.loadValueSafe(key, scope, event);
				result.success = !ex.failed;
				if (ex.failed) result.error = `键「${key}」检查失败（存储不可用？详见日志）`;
				result.exists = ex.value !== null;
				break;
			}
			case "load_or_default": {
				const lod = persistentStore.loadValueSafe(key, scope, event);
				const loadedVal2 = lod.value;
				result.success = !lod.failed;
				if (lod.failed) result.error = `键「${key}」读取失败（存储不可用？详见日志）`;
				result.result = loadedVal2 !== null ? loadedVal2 : defaultValue;
				result.exists = loadedVal2 !== null;
				result.is_default = loadedVal2 === null;
				break;
			}
			case "increment":
				const incrResult = persistentStore.incrValue(key, Number(amount) || 1, scope, Number(defaultValue ?? 0), event);
				result.success = !incrResult.error;
				result.error = incrResult.error;
				result.result = incrResult.result;
				result.old_value = incrResult.oldValue;
				result.new = true;
				break;
			case "batch_load": {
				const keyList = asList$1(keys).map((k) => String(k)).filter(Boolean);
				const values = {};
				let loadFailed = false;
				for (const k of keyList) {
					const loaded = persistentStore.loadValueSafe(k, scope, event);
					if (loaded.failed) loadFailed = true;
					values[k] = loaded.value !== null ? loaded.value : defaultValue;
				}
				result.success = !loadFailed;
				if (loadFailed) result.error = "批量读取失败（存储不可用？详见日志）";
				result.values = values;
				result.count = keyList.length;
				result.keys_list = keyList;
				break;
			}
			case "batch_save": {
				const rawData = data;
				if (rawData === null || rawData === void 0 || rawData === "") {
					result.error = "批量保存的「数据」为空：请把上游表达式的结果连到 data 端口，并确认它输出的是 JSON 字符串（如 to_json({\"gold\": 10, \"bag\": [...]})）。如果上游是个表达式节点，先在它的「错误」端口上看看表达式有没有报错。";
					break;
				}
				let dict;
				if (typeof rawData === "string") {
					let parsed;
					try {
						parsed = JSON.parse(rawData);
					} catch {
						result.error = `批量保存的「数据」不是合法 JSON 字符串: ${rawData.slice(0, 200)}`;
						break;
					}
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
						result.error = `批量保存的「数据」必须是 JSON 对象（键→值），收到: ${rawData.slice(0, 200)}`;
						break;
					}
					dict = parsed;
				} else if (typeof rawData === "object" && !Array.isArray(rawData)) dict = rawData;
				else {
					result.error = `批量保存的「数据」类型不支持（应为 JSON 字符串或对象）: ${typeof rawData}`;
					break;
				}
				if (Object.keys(dict).length === 0) {
					result.error = "批量保存的「数据」是空对象 {}，没有任何键可以写入（检查上游表达式是否走到了提前返回的分支）";
					break;
				}
				const batchResult = persistentStore.batchSaveValues(dict, scope, event, ttl);
				if (batchResult.errors.length > 0) result.error = `批量保存部分失败: ${batchResult.errors.join("；")}`;
				result.success = batchResult.errors.length === 0;
				result.saved = batchResult.saved;
				result.values = dict;
				result.count = batchResult.saved;
				result.keys_list = batchResult.keysList || [];
				break;
			}
			case "list_append": {
				const appended = persistentStore.listAppendValue(key, item, scope, Number(maxLength) || 0, event);
				if (appended.error) {
					result.error = appended.error;
					break;
				}
				if (autoSave !== false) persistentStore.saveValue(key, appended.result, scope, event, ttl);
				result.success = true;
				result.result = appended.result;
				result.old_value = appended.result.slice(0, -1);
				result.new = true;
				result.values = { [key]: appended.result };
				result.count = appended.length;
				result.length = appended.length;
				result.keys_list = [key];
				break;
			}
			default: result.error = "未知模式: " + mode;
		}
		if (mode !== "save" && mode !== "load" && mode !== "delete" && mode !== "exists" && mode !== "load_or_default" && mode !== "increment") {}
	} catch (e) {
		result.error = (e instanceof Error ? e : new Error(String(e))).message;
	}
	return result;
}
/** 变量名合法字符 */
var VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
var VAR_PERSIST_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
var MAX_PERSIST_TTL = 86400;

export { jsonOp, splitJsonPath, listOp, asList$1, random, asRandomList, timeOp, toDate, formatDate, variableSet, variableMerge, variablePersist, VAR_NAME_RE, VAR_PERSIST_IDENT_RE, MAX_PERSIST_TTL };
