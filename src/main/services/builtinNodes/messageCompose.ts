// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { checkKeyboardBudget, composeCard, composeList } from "./messageOp";

/**
* 默认 markdown 长度上限。
*
* QQ 官方文档没有给出 markdown 的字符上限；实测超长消息会发送失败或客户端卡住。
* 取一个保守值（2000 字 ≈ 手机上要好几次滚动），超了**明确报错**而不是截断 ——
* 截断会切坏 markdown 语法（比如把 `**加粗**` 切一半），报错让人去改内容。
*/
var DEFAULT_MAX_MARKDOWN_LENGTH$1 = 2e3;
function asString$2(v) {
	if (v === null || v === void 0) return "";
	if (typeof v === "object") try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
	return String(v);
}
/** 把端口值解析成数组：已经是数组就用；JSON 字符串就 parse；单个值包成一项 */
function asList(value) {
	if (value === null || value === void 0 || value === "") return [];
	if (Array.isArray(value)) return value;
	if (typeof value === "string") {
		const t = value.trim();
		if (!t) return [];
		if (t.startsWith("[") || t.startsWith("{")) try {
			const parsed = JSON.parse(t);
			if (Array.isArray(parsed)) return parsed;
			return [parsed];
		} catch {
			return [value];
		}
		return t.split("\n").map((l) => l.trim()).filter(Boolean);
	}
	return [value];
}
/**
* 把 `stats` 端口解析成 `[名称, 值]` 对。
*
* 支持的形状（都是用户在画布上会顺手写出来的）：
*   · `{ "等级": "Lv3", "生命": "821/821" }` —— 对象，最直观
*   · `[["等级","Lv3"], ["生命","821/821"]]` —— 二元组数组
*   · `["等级","Lv3","生命","821/821"]` —— 扁平数组，两两配对
*   · `"等级:Lv3\n生命:821/821"` —— 多行文本，冒号分隔
*/
function asPairs(value) {
	if (value === null || value === void 0 || value === "") return [];
	if (typeof value === "string") {
		const t = value.trim();
		if (t.startsWith("{")) try {
			const obj = JSON.parse(t);
			return Object.entries(obj).map(([k, v]) => [k, asString$2(v)]);
		} catch {}
		if (t.startsWith("[")) try {
			return asPairs(JSON.parse(t));
		} catch {}
		return t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
			const idx = l.search(/[:：]/);
			return idx < 0 ? [l, ""] : [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
		}).filter(([k]) => k);
	}
	if (Array.isArray(value)) {
		if (value.length > 0 && !Array.isArray(value[0]) && typeof value[0] !== "object") {
			const out = [];
			for (let i = 0; i + 1 < value.length; i += 2) out.push([asString$2(value[i]), asString$2(value[i + 1])]);
			if (value.length % 2 === 1) out.push([asString$2(value[value.length - 1]), ""]);
			return out;
		}
		return value.map((item) => {
			if (Array.isArray(item)) return [asString$2(item[0]), asString$2(item[1])];
			if (item && typeof item === "object") {
				const o = item;
				return [asString$2(o.name ?? o.key ?? o.label), asString$2(o.value ?? o.text)];
			}
			return [asString$2(item), ""];
		});
	}
	if (typeof value === "object") return Object.entries(value).map(([k, v]) => [k, asString$2(v)]);
	return [];
}
/** 把 `bars` 端口解析成进度条数组 */
function asBars(value) {
	const list = asList(value);
	const out = [];
	for (const item of list) if (item && typeof item === "object" && !Array.isArray(item)) {
		const o = item;
		out.push({
			current: o.current ?? o.value ?? o.cur,
			max: o.max ?? o.total,
			width: o.width === void 0 ? void 0 : Number(o.width)
		});
	} else if (Array.isArray(item)) out.push({
		current: item[0],
		max: item[1]
	});
	else if (typeof item === "string") {
		const m = item.match(/^\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/);
		if (m) out.push({
			current: m[1],
			max: m[2]
		});
	}
	return out.filter((b) => Number(b.max) > 0);
}
/**
* 把节点的分页配置归一化成 `ListPaging`；**没给分页就返回 undefined**（不是分页模式）。
*
* 两种写法都认：
*   · 简化：`page` + `page_size` + `page_command`（画布上最常用）
*   · 完整：`paging_json` 传对象/JSON 字符串（要 `fixedRows` 这种高级字段时用），
*     它会**覆盖**简化写法的同名字段。
*
* 只有 `page`（或 `paging_json.page`）有值时才分页 —— 否则 `/商店` 那种"一页够放"的
* 列表会莫名其妙出现页码行。
*/
function resolvePaging(config) {
	let full = {};
	const raw = config.paging_json;
	if (raw && typeof raw === "object" && !Array.isArray(raw)) full = raw;
	else if (typeof raw === "string" && raw.trim().startsWith("{")) try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) full = parsed;
	} catch {}
	const page = config.page ?? full.page;
	if (page === void 0 || page === null || page === "") return void 0;
	return {
		page,
		pageSize: config.page_size ?? full.pageSize ?? full.page_size,
		commandPrefix: asString$2(config.page_command ?? full.commandPrefix ?? full.command_prefix),
		fixedRows: full.fixedRows ?? full.fixed_rows,
		footerHint: full.footerHint ?? full.footer_hint
	};
}
/**
* 拼装消息。**不发送**。
*
* @returns `{ markdown, keyboard, button_count, success, error, warnings }`
*   与目录里的输出端口一一对应。`markdown` 为空表示这次没有内容可发（`success` 仍为 true，
*   由调用方决定要不要发）—— 视图不需要内容时（比如只是"按了按钮"）走这条路。
*/
function messageCompose(config = {}) {
	const layout = asString$2(config.layout || "card").toLowerCase();
	const maxLength = Number(config.max_length) > 0 ? Number(config.max_length) : DEFAULT_MAX_MARKDOWN_LENGTH$1;
	try {
		const shared = {
			title: config.title,
			footer: config.footer,
			buttons: asList(config.buttons).length ? asList(config.buttons) : asList(config.buttons_json),
			inlineCommands: asList(config.inline_commands),
			titleLevel: Number(config.title_level) === 2 ? 2 : Number(config.title_level) === 3 ? 3 : 1
		};
		const composed = layout === "list" ? composeList({
			...shared,
			items: asList(config.items).length ? asList(config.items) : asList(config.body),
			emptyText: config.empty_text,
			paging: resolvePaging(config)
		}) : composeCard({
			...shared,
			subtitle: config.subtitle,
			body: asList(config.body).map(asString$2),
			stats: asPairs(config.stats),
			bars: asBars(config.bars),
			quote: config.quote
		});
		const markdown = composed.markdown;
		const warnings = [...composed.warnings];
		if (!markdown.trim() && composed.keyboard.rows.length > 0) return {
			markdown: "",
			keyboard: composed.keyboard,
			button_count: composed.keyboard.rows.length,
			success: false,
			error: "按钮消息必须有 markdown 内容 —— QQ 只在 markdown 消息（msg_type=2）上渲染按钮。请至少填标题或正文（或者干脆不要按钮）。",
			warnings
		};
		if (markdown.length > maxLength) return {
			markdown: "",
			keyboard: composed.keyboard,
			button_count: composed.keyboard.rows.length,
			success: false,
			error: `markdown 内容 ${markdown.length} 字，超过上限 ${maxLength} 字。请精简内容或分多条发送（截断会切坏 markdown 语法，所以这里不自动截）。`,
			warnings
		};
		warnings.push(...checkKeyboardBudget(composed.keyboard));
		return {
			markdown,
			keyboard: composed.keyboard,
			button_count: composed.keyboard.rows.length,
			success: true,
			error: "",
			warnings
		};
	} catch (e) {
		return {
			markdown: "",
			keyboard: { rows: [] },
			button_count: 0,
			success: false,
			error: e instanceof Error ? `拼装消息失败: ${e.message}` : `拼装消息失败: ${String(e)}`,
			warnings: []
		};
	}
}

export { DEFAULT_MAX_MARKDOWN_LENGTH$1, asString$2, asList, asPairs, asBars, resolvePaging, messageCompose };
