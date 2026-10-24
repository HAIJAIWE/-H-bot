// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

async function performHttpRequest(url, method = "GET", headers = {}, body = null, timeout = 3e4, options = {}) {
	const target = String(url || "").trim();
	if (!target) return {
		status: 0,
		data: null,
		text: "",
		error: "url 不能为空"
	};
	let parsed;
	try {
		parsed = new URL(target);
	} catch {
		return {
			status: 0,
			data: null,
			text: "",
			error: `url 非法: ${target}`
		};
	}
	if (!["http:", "https:"].includes(parsed.protocol)) return {
		status: 0,
		data: null,
		text: "",
		error: `只支持 http/https，收到 ${parsed.protocol}`
	};
	const normalized = normalizeHeaders(headers);
	if (normalized.error) return {
		status: 0,
		data: null,
		text: "",
		error: normalized.error
	};
	const headerMap = normalized.value;
	if (options.params !== null && options.params !== void 0 && options.params !== "") {
		let query = {};
		if (typeof options.params === "string") try {
			const p = JSON.parse(options.params);
			if (p && typeof p === "object" && !Array.isArray(p)) query = p;
		} catch {
			return {
				status: 0,
				data: null,
				text: "",
				error: `params 不是合法 JSON: ${options.params}`
			};
		}
		else if (typeof options.params === "object" && !Array.isArray(options.params)) query = options.params;
		for (const [k, v] of Object.entries(query)) {
			if (v === null || v === void 0) continue;
			parsed.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
		}
	}
	const maxBytes = Number(options.maxResponseSize) > 0 ? Number(options.maxResponseSize) : HTTP_MAX_RESPONSE_BYTES;
	const timeoutMs = Math.min(Math.max(Number(timeout) || 3e4, 1e3), HTTP_MAX_TIMEOUT_MS);
	const upperMethod = String(method || "GET").toUpperCase();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const init = {
			method: upperMethod,
			headers: headerMap,
			signal: controller.signal
		};
		if (body !== null && body !== void 0 && upperMethod !== "GET" && upperMethod !== "HEAD") {
			init.body = typeof body === "string" ? body : JSON.stringify(body);
			if (!Object.keys(headerMap).some((h) => h.toLowerCase() === "content-type") && typeof body !== "string") init.headers = {
				...headerMap,
				"Content-Type": "application/json"
			};
		}
		const res = await fetch(parsed.toString(), init);
		const raw = await res.text();
		const truncated = raw.length > maxBytes;
		const text = truncated ? raw.slice(0, maxBytes) : raw;
		let data = text;
		const contentType = res.headers.get("content-type") ?? "";
		const format = String(options.responseFormat ?? "auto").toLowerCase();
		if (format === "json" || format !== "text" && format !== "binary" && (contentType.includes("json") || /^\s*[[{]/.test(text))) try {
			data = JSON.parse(text);
		} catch (e) {
			if (format === "json") {
				const msg = e instanceof Error ? e.message : String(e);
				return {
					status: res.status,
					data: null,
					text,
					error: `响应不是合法 JSON: ${msg}`
				};
			}
			data = text;
		}
		return {
			status: res.status,
			data,
			text,
			error: res.ok ? "" : `HTTP ${res.status} ${res.statusText}${truncated ? "（响应体过大已截断）" : ""}`
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			status: 0,
			data: null,
			text: "",
			error: e instanceof Error && e.name === "AbortError" ? `请求超时（${timeoutMs}ms）` : `请求失败: ${msg}`
		};
	} finally {
		clearTimeout(timer);
	}
}
/**
* `headers` 归一化 —— **字符串与对象都要收**。
*
* ## 为什么必须有这一步
*
* `headers` 端口的目录默认值是**字符串** `'{}'`（`dataType: 'json'` 的端口在面板上是
* JSON 文本域，存下来的本来就是文本；`params` / `body` / `cases` 全是同一套写法），
* 而 `fetch` 只接受对象 / `Headers`。原实现把值直接塞进 `init.headers`，于是
* **新建一个 http_request 节点、只填 url、不碰请求头**必定拿到：
*
* ```
* 请求失败: Headers constructor: Argument 1 could not be converted to one of:
*           sequence<sequence<ByteString>>, record<ByteString, ByteString>.
* ```
*
* ——错误信息里既没有 "headers" 也没有修法。历史 `flow.json` 里躺着的同样是字符串，
* 所以这里必须两种形态都收（与 `params` 的处置保持一致）。
*
* 解析失败**不静默当成空对象**：请求头是用户明确写下的东西，写错了要说清写错在哪。
*/
function normalizeHeaders(raw) {
	if (raw === null || raw === void 0 || raw === "") return {
		value: {},
		error: ""
	};
	let obj = raw;
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed) return {
			value: {},
			error: ""
		};
		try {
			obj = JSON.parse(trimmed);
		} catch (e) {
			return {
				value: {},
				error: `headers 不是合法 JSON：${e instanceof Error ? e.message : String(e)}。请求头要写成对象，如 {"Authorization":"Bearer xxx"}；不想带自定义请求头就留空或写 {}`
			};
		}
	}
	if (obj === null || obj === void 0) return {
		value: {},
		error: ""
	};
	if (typeof obj !== "object" || Array.isArray(obj)) return {
		value: {},
		error: `headers 必须是 JSON 对象（键 = 请求头名，值 = 字符串），实际收到 ${Array.isArray(obj) ? "数组" : typeof obj}：${JSON.stringify(obj)}`
	};
	const value = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === null || v === void 0) continue;
		value[k] = typeof v === "string" ? v : String(v);
	}
	return {
		value,
		error: ""
	};
}
async function httpRequest(_bot, _event, url = "", method = "GET", headers = {}, body = null, timeout = 30, params = null, responseFormat = "auto", maxResponseSize = 0) {
	return performHttpRequest(url, method, headers, body, (Number(timeout) || 30) * 1e3, {
		params,
		responseFormat,
		maxResponseSize
	});
}
async function apiCall(bot, _event, action = "", params = null) {
	const api = String(action || "").trim();
	if (!api) return {
		success: false,
		result: null,
		data: null,
		error: "action 不能为空（如 get_group_list）"
	};
	let parsed = {};
	if (params !== null && params !== void 0 && params !== "") {
		if (typeof params === "string") try {
			const p = JSON.parse(params);
			parsed = p && typeof p === "object" ? p : {};
		} catch {
			return {
				success: false,
				result: null,
				data: null,
				error: `params 不是合法 JSON: ${params}`
			};
		}
		else if (typeof params === "object") parsed = params;
	}
	try {
		const data = await bot.callApi(api, parsed);
		return {
			success: true,
			result: data,
			data,
			error: ""
		};
	} catch (e) {
		return {
			success: false,
			result: null,
			data: null,
			error: (e instanceof Error ? e : new Error(String(e))).message
		};
	}
}
async function checkPermission(bot, event, role = "admin") {
	const need = String(role || "admin").trim() || "admin";
	if (!(need in PERMISSION_LEVELS)) return permissionResult(false, false, `权限级别非法: ${need}（支持 ${Object.keys(PERMISSION_LEVELS).join(" / ")}）`);
	const userId = event?.user_id !== void 0 && event?.user_id !== null ? String(event.user_id) : "";
	if (!userId) return permissionResult(false, false, "无法判断权限：触发事件里没有 user_id");
	if (superAdminIds().includes(userId)) return permissionResult(true, true, "", "super_admin");
	if (need === "super_admin") return permissionResult(true, false, "");
	if (event?.message_type === "private" || event?.group_id === void 0 || event?.group_id === null) return permissionResult(true, false, "", "guest");
	let memberRole = "";
	try {
		const resp = await bot.callApi("get_group_member_info", {
			group_id: String(event.group_id),
			user_id: userId,
			no_cache: false
		});
		const payload = resp?.data ?? resp;
		memberRole = String(payload?.role ?? "");
	} catch (e) {
		return permissionResult(false, false, `查询群成员信息失败：${e instanceof Error ? e.message : String(e)}`);
	}
	const haveLevel = ROLE_LEVELS[memberRole] ?? 0;
	const needLevel = PERMISSION_LEVELS[need];
	return permissionResult(true, haveLevel >= needLevel, "", memberRole || "guest");
}
/**
* 组装返回值。
*
* ⚠️ **`passed` / `user_role` / `error` 都是目录声明的输出端口 id，必须出现在返回对象里** ——
* 运行时按端口 id 把返回值写进 `ctx.variables['<节点>:<端口>']`，下游数据线才拿得到。
* 第一版只返回了 `hasPermission`，于是 `passed` 端口永远是 undefined，
* 下游模板里的 `{var1}` 原样打在消息里（实测冒烟抓到：`/管理员` 输出字面量 `{var1}`）。
* 两个键都保留：`passed` 供端口映射，`hasPermission` 供直接调用方（如单测）读。
*
* `user_role`（目录 `builtinCatalog` 的 `{ id: 'user_role', description: '实际角色' }`）
* 则**从来没被写过**：目录承诺了、下游连了线，读到的一直是 undefined。语义如下
* （层级见 `PERMISSION_LEVELS`「超级管理员 > 群主 > 管理员 > 成员 > 游客」）：
*
* - 机器人主人 → `'super_admin'`；
* - 群聊 → **原样返回的 role**（`owner` / `admin` / `member`；不认识的值也原样带出）：
*   端口叫"实际角色"，那它就该是群里的事实，而不是我们归一化之后的看法
*   （归一化只用于比较，见 `ROLE_LEVELS[...] ?? 0`）；
* - 群聊但返回的 role 为空 → `'guest'`；
* - 私聊非超管 → `'guest'`：契约明说"私聊只有超级管理员生效"，对这个会话而言他确实只是游客；
* - **判断不出来**（级别非法 / 事件里没有 user_id / 查群失败）→ `''`：`user_role` 是对人的断言，
*   不知道就不编造；这几种情况 `success=false` 且 `error` 非空，调用方必须看 `error`。
*
* 为什么"已知非成员"用 `'guest'` 而不是 `''`：`'guest'` 是层级里的一档（0 级），
* 而空串要和"这个端口压根没被写过"区分开 —— 后者正是 `user_role` 一直没被写的同一个坑。
*/
function permissionResult(success, hasPermission, error, userRole = "") {
	return {
		success,
		hasPermission,
		passed: hasPermission,
		user_role: userRole,
		error
	};
}
/** 机器人主人名单：环境变量 `SUPER_ADMIN_IDS`，逗号分隔。每次读，便于测试注入。 */
function superAdminIds() {
	return String(process.env.SUPER_ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
var HTTP_MAX_RESPONSE_BYTES = 5242880;
/**
* http_request / api_call 的真实实现（两个节点参数一致，api_call 是历史别名）。
*
* 历史：两者都直接 `return { status: 200, data: null, error: '' }` —— **假装请求成功**。
* 流程里"调用接口"看着通过、拿到的 data 永远是 null，是本项目最容易被误判为
* "节点坏了/网络不通"的坑之一。这里改成真正发请求。
*
* 约束（本地工具场景，避免把一次配置失误变成无限等待/超大内存）：
*   - 超时上限 120s（默认 30s），用 AbortController
*   - 响应体上限 5MB（超出截断并给出提示）
*   - 只发 http/https；其它协议直接报错
*   - 返回 { status, data, error }，error 非空即失败；JSON 响应自动解析，其余返回文本
*/
var HTTP_MAX_TIMEOUT_MS = 12e4;
/** 权限层级：数字越大权限越高。契约见目录 summary「超级管理员 > 群主 > 管理员 > 成员 > 游客」。 */
var PERMISSION_LEVELS = {
	guest: 0,
	member: 1,
	admin: 2,
	owner: 3,
	super_admin: 4
};
/** 网关 `get_group_member_info` 返回的 role → 层级（返回别的值一律按最低处理） */
var ROLE_LEVELS = {
	member: 1,
	admin: 2,
	owner: 3
};

export { performHttpRequest, normalizeHeaders, httpRequest, apiCall, checkPermission, permissionResult, superAdminIds, HTTP_MAX_RESPONSE_BYTES, HTTP_MAX_TIMEOUT_MS, PERMISSION_LEVELS, ROLE_LEVELS };
