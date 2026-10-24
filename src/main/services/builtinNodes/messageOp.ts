// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md

/**
* message_op —— 构造运行时事件契约消息段（不发送）。
*
* 输出 `segment` 供 `message_send(mode=segment)` 发送，因此本节点是纯构造函数：
* 不接触 bot / event，也不产生副作用（catalog 中 `sideEffects: []`）。
*
* 迁移说明：Python 运行时删除后本节点一度没有 handler（生成注释占位符、
* 运行时找不到 handler 静默跳过）。这里按 catalog 声明的 9 种段类型补齐实现。
*/
/** 段类型 → 必填字段校验所需的键 */
var SEGMENT_TYPES = [
	"at",
	"image",
	"face",
	"record",
	"share",
	"music",
	"poke",
	"reply",
	"forward"
];
/** 取字符串值（空串/null/undefined 归一为 ''） */
function str(value) {
	if (value === null || value === void 0) return "";
	return String(value);
}
function fail(error) {
	return {
		segment: null,
		success: false,
		error
	};
}
function ok(segment) {
	return {
		segment,
		success: true,
		error: ""
	};
}
/**
* 构造消息段。
*
* @param config - 节点数据端口解析后的 kwargs（segment_type 及对应字段）
* @returns `{ segment, success, error }`，与 catalog 的 `segment/success/error` 输出端口对应
*/
function messageOp(config = {}) {
	const segmentType = (str(config.segment_type) || "at").toLowerCase();
	if (!SEGMENT_TYPES.includes(segmentType)) return fail(`不支持的段类型: ${segmentType}（可用: ${SEGMENT_TYPES.join("/")}）`);
	const userId = str(config.user_id);
	const url = str(config.url);
	const file = str(config.file);
	const faceId = str(config.face_id);
	const title = str(config.title);
	const content = str(config.content);
	const imageUrl = str(config.image_url);
	const musicType = str(config.music_type) || "163";
	const audioUrl = str(config.audio_url);
	const singer = str(config.singer);
	const messageId = str(config.message_id);
	const forwardId = str(config.forward_id);
	switch (segmentType) {
		case "at":
			if (!userId) return fail("segment(at) 需要 user_id（要 @ 的 QQ 号）");
			return ok({
				type: "at",
				data: { qq: userId }
			});
		case "poke":
			if (!userId) return fail("segment(poke) 需要 user_id（要戳一戳的 QQ 号）");
			return ok({
				type: "poke",
				data: { qq: userId }
			});
		case "image":
			if (!url && !file) return fail("segment(image) 需要 url 或 file");
			return ok({
				type: "image",
				data: { file: file || url }
			});
		case "record":
			if (!url && !file) return fail("segment(record) 需要 url 或 file");
			return ok({
				type: "record",
				data: { file: file || url }
			});
		case "face":
			if (!faceId || Number.isNaN(Number(faceId))) return fail("segment(face) 需要数字类型的 face_id");
			return ok({
				type: "face",
				data: { id: String(Number(faceId)) }
			});
		case "share":
			if (!url) return fail("segment(share) 需要 url");
			return ok({
				type: "share",
				data: {
					url,
					title,
					content,
					image: imageUrl
				}
			});
		case "music": {
			const type = musicType.toLowerCase();
			if (type === "custom") {
				if (!audioUrl) return fail("segment(music custom) 需要 audio_url（音频直链）");
				return ok({
					type: "music",
					data: {
						type: "custom",
						url,
						audio: audioUrl,
						title,
						image: imageUrl,
						singer
					}
				});
			}
			if (type !== "163" && type !== "qq") return fail(`不支持的 music_type: ${musicType}（可用: 163/qq/custom）`);
			const songId = url || audioUrl;
			if (!songId) return fail(`segment(music ${type}) 需要 url（歌曲 ID）`);
			return ok({
				type: "music",
				data: {
					type,
					id: songId
				}
			});
		}
		case "reply":
			if (!messageId) return fail("segment(reply) 需要 message_id");
			return ok({
				type: "reply",
				data: { id: messageId }
			});
		case "forward":
			if (!forwardId) return fail("segment(forward) 需要 forward_id");
			return ok({
				type: "forward",
				data: { id: forwardId }
			});
		default: return fail(`不支持的段类型: ${segmentType}`);
	}
}
/** `# 标题`：QQ 渲染成加粗大字（图里的「世界的回响」就是这个） */
function mdTitle(text, level = 1) {
	const t = String(text ?? "").trim();
	if (!t) return "";
	return `${"#".repeat(level)} ${t}`;
}
/** `**加粗**`：正文里的强调（图里的「【哥布林战士】达成」） */
function mdBold(text) {
	const t = String(text ?? "");
	return t ? `**${t}**` : "";
}
/**
* `> 引用`：图1 里「海岸很宽，也不是每一步都归它管。」那根灰竖线的效果。
*
* 官方语法是**逐行**加 `> `，多行要给每一行都加，否则只有第一行进引用块。
*/
function mdQuote(text) {
	const raw = String(text ?? "");
	if (!raw.trim()) return "";
	return raw.split("\n").map((l) => l.trim() ? `> ${l}` : ">").join("\n");
}
/** `***`：水平分割线（图2 里各属性组之间的横线） */
function mdDivider() {
	return "***";
}
/** 无序列表；`items` 里的元素是**单行文本**（多行请自己拆成多项） */
function mdBullets(items) {
	return (items ?? []).map((i) => String(i ?? "").trim()).filter(Boolean).map((i) => `- ${i}`).join("\n");
}
/**
* 一组 `名称值` 行（图2 的「等级：Lv3 / 经验：0/100」那种排版）。
*
* ## 对齐怎么算的（真机 + 计算都调过）
*
* 直觉做法是"把中文按 2 个宽度算，再用**半角**空格补齐"—— **那样是不齐的**：
* 实测 `等级/经验/生命` 排出 9/11/13 的显示宽度。QQ 是**比例字体**，
* 一个中文字 ≈ 两个拉丁字但**不精确**，误差行行累积。
*
* 现在用**全角空格**（U+3000）跳到目标列：全角空格 ≈ 一个汉字宽，与标签本身同一量级，
* 误差不会累积。目标列取 `maxW + 2`，保证每个标签后至少一个全角空格（不会贴住）。
*
* 换算成"U+3000 个数"时按 2 宽 = 1 个全角空格折算，并对**奇数差**取整 ——
* 于是各行结束时的显示宽度最多相差 1（比例字体下这是能达到的最优，再追求严格等宽没有意义）。
*/
function mdKeyValues(pairs) {
	const rows = (pairs ?? []).map((p) => [String(p?.[0] ?? "").trim(), String(p?.[1] ?? "").trim()]).filter(([k]) => k);
	if (!rows.length) return "";
	const target = Math.max(...rows.map(([k]) => displayWidth(k))) + 2;
	return rows.map(([k, v]) => {
		const pad = Math.max(1, Math.round((target - displayWidth(k)) / 2));
		return `${k}${"　".repeat(pad)}${v}`;
	}).join("\n");
}
/**
* 条形进度（图2 里名字下面那排点）。
*
* 官方 markdown 没有进度条语法，只能用字符画 —— 但效果就是图里那种。
* `filled` 用实心块、其余用浅色块，宽度固定，避免不同数值下行宽跳动。
*/
function mdBar(current, max, width = 12) {
	const cur = Math.max(0, Number(current) || 0);
	const top = Math.max(1, Number(max) || 1);
	const w = Math.max(1, Math.min(40, Math.floor(width)));
	const filled = Math.max(0, Math.min(w, Math.round(cur / top * w)));
	return `${"▰".repeat(filled)}${"▱".repeat(w - filled)}`;
}
/** 把多个片段拼成 markdown，**空片段自动跳过**（不会留下空行；空行在 QQ 里会拉开很大间距） */
function mdJoin(parts) {
	return (parts ?? []).map((p) => p === null || p === void 0 ? "" : String(p)).filter((p) => p.trim() !== "").join("\n");
}
/**
* 显示宽度（中文/全角算 2，其余算 1）。
*
* 用于 `mdKeyValues` 的对齐：QQ 的字体不是等宽，但对齐到"全角宽度"在手机上看起来是齐的。
* 用 `String.length` 会把中文算 1，导致「等级」和「经验」两行差半格。
*/
function displayWidth(text) {
	let w = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		w += code > 11904 ? 2 : 1;
	}
	return w;
}
function cut(text, max) {
	const t = String(text ?? "");
	return t.length <= max ? t : t.slice(0, max - 1) + "…";
}
/**
* 把用户写的按钮行归一化成 QQ 的 InlineKeyboard。
*
* 宽进的三种写法都认：
*   · `"金创药"`                          → 文字与 data 相同
*   · `"/购买金创药"`                     → 文字=data
*   · `["搜一下", "https://example.com"]`  → [文字, 链接]
*   · `{ label, data }` / `{ label, url }` → 完整写法
*
* 严出的地方（都是官方硬要求，漏了按钮就不渲染或点了没反应）：
*   · `render_data.visited_label` 与 `action.unsupport_tips` **必填**，这里自动补
*   · `action.permission.type = 2`（所有人可点）
*   · 行数 ≤ 5、每行 ≤ 5、label ≤ 12 字、data ≤ 180 字
*
* **空按钮行会被整行丢掉**（`[]` 或全是空值），这样"根据状态决定有没有按钮"不需要额外分支。
*/
function buildKeyboard(rows) {
	const warnings = [];
	const out = [];
	for (const rawRow of rows ?? []) {
		const rowItems = Array.isArray(rawRow) ? rawRow : [rawRow];
		const buttons = [];
		for (const raw of rowItems) {
			const b = normalizeOne(raw);
			if (!b) {
				if (raw !== null && raw !== void 0 && raw !== "") warnings.push(`跳过无效按钮: ${JSON.stringify(raw).slice(0, 60)}`);
				continue;
			}
			if (buttons.length >= 5) {
				warnings.push(`一行最多 5 个按钮，「${b.render_data.label}」被丢掉`);
				continue;
			}
			buttons.push(b);
		}
		if (!buttons.length) continue;
		if (out.length >= 5) {
			warnings.push(`一条消息最多 5 行按钮，第 ${out.length + 1} 行（${buttons[0].render_data.label}…）被丢掉`);
			continue;
		}
		out.push({ buttons });
	}
	for (let r = 0; r < out.length; r++) for (let c = 0; c < out[r].buttons.length; c++) if (!out[r].buttons[c].id) out[r].buttons[c].id = `btn_${r}_${c}`;
	for (const row of out) for (const b of row.buttons) if (!b.action.data) warnings.push(`按钮「${b.render_data.label}」没有命令也没有链接，点了不会有反应`);
	return {
		keyboard: { rows: out },
		warnings
	};
}
/**
* 归一化**单个**按钮；无法识别的形状返回 null（由调用方记 warning）。
*
* 「一行按钮」是数组，这件事在 `buildKeyboard` 处理 —— 这里**只认单个按钮**：
* 字符串（文字=命令）、数字、对象。
*
* ⚠️ 不要在这里猜 `['文字', 'https://…']` 是"一个带链接的按钮"：
* 它和 `['/攻击', '/防御']`（两个按钮）在语法上无法区分，而猜错的后果是
* 按钮文字变成第一个字符（实测 `String(raw[0])` 取出 `'官'`，因为 `raw[0]` 已经是 `'官网'`，
* 外层再取一次 `[0]` 就拿到了字符串的首字符）。
* 要"文字 + 链接"请写对象：`{ label: '官网', url: 'https://…' }`。
*/
function normalizeOne(raw) {
	let label = "";
	let data = "";
	let url = "";
	/** 用户**显式给了** url 字段（哪怕值是空串）。区分"没给"与"给了但是空" —— 两件事不一样 */
	let urlProvided = false;
	let style = 1;
	let type;
	let id = "";
	let visitedLabel = "";
	let unsupportTips = "";
	if (typeof raw === "string" || typeof raw === "number") label = String(raw);
	else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const o = raw;
		label = String(o.label ?? o.text ?? "");
		data = o.data === void 0 || o.data === null ? "" : String(o.data);
		urlProvided = o.url !== void 0 && o.url !== null;
		url = urlProvided ? String(o.url) : "";
		style = o.style === 0 ? 0 : 1;
		type = o.type;
		id = o.id ? String(o.id) : "";
		visitedLabel = o.visitedLabel ? String(o.visitedLabel) : "";
		unsupportTips = o.unsupportTips ? String(o.unsupportTips) : "";
	} else return null;
	label = label.trim();
	data = data.trim();
	url = url.trim();
	if (!label) label = data || url;
	if (label && !data && !url && !urlProvided) data = label;
	if (!label && !data && !url) return null;
	const actionType = type ?? (url ? 0 : 2);
	const payload = actionType === 0 ? url : data;
	return {
		id,
		render_data: {
			label: cut(label, 12),
			visited_label: cut(visitedLabel || label, 12),
			style
		},
		action: {
			type: actionType,
			permission: { type: 2 },
			data: cut(payload, 180),
			unsupport_tips: cut(unsupportTips || (actionType === 0 ? `请手动打开 ${url}` : `当前客户端不支持按钮，请直接发送 ${data}`), 60)
		}
	};
}
/**
* 按钮预算检查（**发送前**告诉用户哪里超了，而不是让 QQ 静默不渲染）。
* 返回空数组 = 没问题。
*/
function checkKeyboardBudget(keyboard) {
	const problems = [];
	const rows = keyboard?.rows ?? [];
	if (rows.length > 5) problems.push(`按钮 ${rows.length} 行，超过官方上限 5 行`);
	rows.forEach((r, i) => {
		if (r.buttons.length > 5) problems.push(`第 ${i + 1} 行有 ${r.buttons.length} 个按钮，超过上限 5 个`);
	});
	return problems;
}
/** `InlineCommandInput` 认得的字段名 —— 用来把"少写一个字母"的笔误查出来（见 `normalizeInlineOne`） */
var INLINE_COMMAND_KEYS = /* @__PURE__ */ new Set([
	"label",
	"show",
	"data",
	"command",
	"mode",
	"reference"
]);
/**
* `<qqbot-cmd-input … />` / `<qqbot-cmd-enter … />` —— 消息正文里**可以点的一段文字**。
*
* 与「按钮」（`keyboard`）的区别（这是两套完全不同的官方能力，别混）：
*   · 按钮：消息**下方**客户端画的方块，结构化字段，走 `keyboard`；
*   · 可点指令：写在**正文里**的一段字，纯 markdown 文本，随消息内容一起发出去。
*
* 两个参数**都必须 urlencode**（官方原文），否则客户端不认；`/` 会被编码成 `%2F`，这是对的。
*
* @param command 点击后填入/发出的指令，如 `/签到`
* @param opts.show 消息里显示的文字（默认与 command 相同）
* @param opts.mode `input`（默认）或 `enter`
*/
function mdInlineCommand(command, opts = {}) {
	const cmd = cut(String(command ?? "").trim(), 100);
	if (!cmd) return "";
	const encoded = encodeURIComponent(cmd);
	if (opts.mode === "enter") return `<qqbot-cmd-enter text="${encoded}" />`;
	const show = cut(String(opts.show ?? "").trim() || cmd, 100);
	const reference = opts.reference === true || opts.reference === "true" ? " reference=\"true\"" : "";
	return `<qqbot-cmd-input text="${encoded}" show="${encodeURIComponent(show)}"${reference} />`;
}
/**
* 把用户写的「可点指令」归一化成 markdown 行。
*
* 行/列语义与 `buildKeyboard` 的 `buttons` **完全一致**（同一套记忆）：
*   · 外层数组 = 每项一行；内层数组 = 同一行里的多个标签
*   · `"/签到"`                            → 显示与指令都是 `/签到`
*   · `{ label: "[签到]", data: "/签到" }`  → 显示「[签到]」，点一下填 `/签到`
*   · 空行/空值自动跳过（这样"根据状态决定有没有这一行"不需要额外分支）
*
* 两种失败**不静默**：`enter`（群聊点了没反应）、以及"看着像标签但其实没给指令"。
*/
function buildInlineCommands(rows) {
	const warnings = [];
	const lines = [];
	for (const rawRow of rows ?? []) {
		const rowItems = Array.isArray(rawRow) ? rawRow : [rawRow];
		const tags = [];
		for (const raw of rowItems) {
			const tag = normalizeInlineOne(raw, warnings);
			if (tag) tags.push(tag);
		}
		if (tags.length) lines.push(tags.join(" "));
	}
	return {
		lines,
		warnings: [...new Set(warnings)]
	};
}
/** 归一化**单个**可点指令；空值返回空串（静默跳过），形状不认识时记 warning */
function normalizeInlineOne(raw, warnings) {
	let show = "";
	let data = "";
	let mode = "input";
	let reference;
	if (typeof raw === "string" || typeof raw === "number") {
		show = String(raw);
		data = String(raw);
	} else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const o = raw;
		show = String(o.show ?? o.label ?? "");
		data = String(o.data ?? o.command ?? "");
		if (o.mode === "enter") mode = "enter";
		reference = o.reference;
		const unknownKeys = Object.keys(raw).filter((k) => !INLINE_COMMAND_KEYS.has(k));
		if (unknownKeys.length) warnings.push(`可点指令里有认不出的字段 ${unknownKeys.join("/")}（已忽略）: ${JSON.stringify(raw).slice(0, 60)}`);
	} else {
		if (raw !== null && raw !== void 0 && raw !== "") warnings.push(`跳过无效的可点指令: ${JSON.stringify(raw).slice(0, 60)}`);
		return "";
	}
	show = show.trim();
	data = data.trim();
	if (!data) data = show;
	if (!show) show = data;
	if (!data) return "";
	if (data.length > 100) warnings.push(`可点指令「${data.slice(0, 20)}…」超过官方上限 100 字，已截断`);
	if (show.length > 100) warnings.push(`可点指令的文字「${show.slice(0, 20)}…」超过官方上限 100 字，已截断`);
	if (data.startsWith("[")) warnings.push(`可点指令「${data}」没单独给命令 —— 点击后填进输入框的就是「${data}」这串字本身。要发 \`/签到\` 请写成 { label: "${data}", data: "/签到" }`);
	if (mode === "enter") warnings.push("用了「回车指令」（点击直接发送）：官方明确**群聊和文字子频道不支持**，群里发了不会渲染成可点标签。群聊请用默认的「参数指令」（点击填入输入框）。");
	return mdInlineCommand(data, {
		show,
		mode,
		reference
	});
}
/**
* 拼一张卡片：标题 + 副标题 + 正文 + 属性表 + 进度条 + 引用 + 页脚 + 按钮。
*
* 只给真正有内容的段落留位置（空段落不产生空行）—— 这是"看起来像卡片"的关键：
* 图1/图2 之所以干净，是因为没有一堆空行把内容冲散。
*/
function composeCard(opts = {}) {
	const parts = [];
	const title = String(opts.title ?? "").trim();
	if (title) parts.push(mdTitle(title, opts.titleLevel ?? 1));
	const subtitle = String(opts.subtitle ?? "").trim();
	if (subtitle) parts.push(mdBold(subtitle));
	const body = (opts.body ?? []).map((l) => String(l ?? "").trim()).filter(Boolean);
	if (body.length) parts.push(body.join("\n"));
	const stats = (opts.stats ?? []).filter((p) => String(p?.[0] ?? "").trim());
	if (stats.length) parts.push(mdKeyValues(stats));
	const bars = (opts.bars ?? []).filter((b) => b && (Number(b.max) || 0) > 0);
	if (bars.length) parts.push(bars.map((b) => mdBar(b.current, b.max, b.width)).join("\n"));
	const inline = buildInlineCommands(opts.inlineCommands ?? []);
	if (inline.lines.length) parts.push(inline.lines.join("\n"));
	const quote = String(opts.quote ?? "").trim();
	if (quote) {
		parts.push("​");
		parts.push(mdQuote(quote));
	}
	const footer = String(opts.footer ?? "").trim();
	if (footer) {
		parts.push("​");
		parts.push(footer);
	}
	const { keyboard, warnings } = buildKeyboard(opts.buttons ?? []);
	warnings.push(...inline.warnings);
	return {
		markdown: mdJoin(parts),
		keyboard,
		warnings
	};
}
/** 一方的「名字 + 血条」行；血条上限为 0 时不出这条（避免 0/0 的假条） */
function battleSideLine(side, fallbackName) {
	const name = String(side?.name ?? "").trim() || fallbackName;
	const max = Number(side?.maxHp ?? 0) || 0;
	if (max <= 0) return null;
	const cur = Math.max(0, Math.min(max, Number(side?.hp ?? 0) || 0));
	return [name, `${mdBar(cur, max, Number(side?.barWidth ?? 0) || 12)} ${cur}/${max}`];
}
/**
* 拼一张**回合制战斗面板**：怪物信息 + 玩家信息 + 回合日志 + 行动按钮。
*
* ## 为什么是这个形状（官方能力的硬约束，不是设计偏好）
*
*   1. **改不了已发出的消息**：官方没有「编辑消息」接口（只能撤回重发），
*      所以每一回合都是**发一条新的完整面板**，而不是"原地刷新数值"；
*   2. **按钮文字在发出时就固定了**：`render_data.label` 不能事后改，
*      所以按钮上不能显示"血量/次数"这类会变的东西 —— 它们放在正文里；
*   3. markdown 没有表格/代码块，能用的是标题、加粗、引用、列表、分割线，
*      进度条只能用字符画（`mdBar`）。这里只用了官方明确列出的语法。
*
* 于是"动态数值"是这样实现的：**每回合重发一条**，数值在正文里更新。
*/
function composeBattle(opts = {}) {
	const parts = [];
	const monster = opts.monster ?? {};
	const mName = String(monster.name ?? "").trim() || "怪物";
	const mLevel = String(monster.level ?? "").trim();
	parts.push(mdTitle(`⚔️ ${mName}${mLevel ? ` Lv.${mLevel}` : ""}`, opts.titleLevel ?? 1));
	const tag = String(opts.monsterTag ?? "").trim();
	if (tag) parts.push(mdBold(tag));
	const lines = [battleSideLine(monster, "怪物"), battleSideLine(opts.player, "你")].filter((l) => l !== null);
	const mpLine = battleSideLine({
		name: "法力",
		hp: opts.player?.mp,
		maxHp: opts.player?.maxMp,
		barWidth: opts.player?.barWidth
	}, "法力");
	if (mpLine) lines.push(mpLine);
	if (lines.length) parts.push(mdKeyValues(lines));
	const round = String(opts.round ?? "").trim();
	const log = (opts.log ?? []).map((l) => String(l ?? "").trim()).filter(Boolean);
	if (round || log.length) {
		parts.push(mdDivider());
		if (round) parts.push(mdBold(`第 ${round} 回合`));
		if (log.length) parts.push(log.join("\n"));
	}
	const footer = String(opts.footer ?? "").trim();
	if (footer) {
		parts.push("​");
		parts.push(mdQuote(footer));
	}
	const prefix = String(opts.commandPrefix ?? "");
	const { keyboard, warnings } = buildKeyboard([(opts.actions && opts.actions.length ? opts.actions : [
		"普攻",
		"技能",
		"道具",
		"逃跑"
	]).map((a) => {
		if (a && typeof a === "object" && !Array.isArray(a)) return a;
		return {
			label: String(a ?? ""),
			data: `${prefix}${String(a ?? "")}`
		};
	})]);
	return {
		markdown: mdJoin(parts),
		keyboard,
		warnings
	};
}
/**
* 拼一个列表消息（`/商店`、`/排行` 这类）。
*
* 与 `composeCard` 分开是因为列表有**空态**语义：没有数据时要给一句提示，
* 而不是渲染一个空标题。卡片不需要空态（卡片本身就是"某件事发生的结果"）。
*/
function composeList(opts = {}) {
	const allItems = (opts.items ?? []).map((i) => String(i ?? "").trim()).filter(Boolean);
	if (!opts.paging) {
		const parts = [];
		const title = String(opts.title ?? "").trim();
		if (title) parts.push(mdTitle(title, opts.titleLevel ?? 1));
		parts.push(allItems.length ? mdBullets(allItems) : String(opts.emptyText ?? "").trim() || "—");
		const inline = buildInlineCommands(opts.inlineCommands ?? []);
		if (inline.lines.length) parts.push(inline.lines.join("\n"));
		const footer = String(opts.footer ?? "").trim();
		if (footer) {
			parts.push("​");
			parts.push(footer);
		}
		const { keyboard, warnings } = buildKeyboard(opts.buttons ?? []);
		warnings.push(...inline.warnings);
		return {
			markdown: mdJoin(parts),
			keyboard,
			warnings
		};
	}
	const warnings = [];
	const paging = opts.paging;
	const fixedRows = paging.fixedRows ?? [];
	const contentRows = Math.max(1, 4 - fixedRows.length);
	if (fixedRows.length + 1 >= 5) warnings.push(`固定按钮行 ${fixedRows.length} 行 + 翻页 1 行已经占满 5 行，本页没有内容按钮的位置`);
	/** 每行最多 QQ_KEYBOARD_MAX_PER_ROW 个 → 一页最多这么多条 */
	const maxPageSize = contentRows * 5;
	const requested = Number(paging.pageSize);
	let pageSize = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 8;
	if (pageSize > maxPageSize) {
		warnings.push(`每页 ${pageSize} 条放不进 ${contentRows} 行按钮，已压到 ${maxPageSize} 条`);
		pageSize = maxPageSize;
	}
	const total = allItems.length;
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const requestedPage = Number(paging.page);
	let page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;
	if (page > totalPages) {
		warnings.push(`第 ${page} 页不存在（共 ${totalPages} 页），已显示最后一页`);
		page = totalPages;
	}
	const start = (page - 1) * pageSize;
	const pageItems = allItems.slice(start, start + pageSize);
	const allRows = opts.buttons ?? [];
	const pageRows = allRows.length && allItems.length && allRows.length !== allItems.length ? allRows.slice(Math.floor(start / 5), Math.floor(start / 5) + contentRows) : allRows;
	const prefix = String(paging.commandPrefix ?? "").trim();
	const pageCmd = (p) => prefix ? `${prefix} ${p}` : String(p);
	const pagerButtons = [];
	if (page > 1) pagerButtons.push({
		label: "« 上一页",
		data: pageCmd(page - 1),
		style: 0
	});
	pagerButtons.push({
		label: `${page}/${totalPages}`,
		data: pageCmd(page)
	});
	if (page < totalPages) pagerButtons.push({
		label: "下一页 »",
		data: pageCmd(page + 1),
		style: 0
	});
	const { keyboard, warnings: kbWarnings } = buildKeyboard([
		...pageRows,
		...fixedRows,
		pagerButtons
	]);
	warnings.push(...kbWarnings);
	const parts = [];
	const title = String(opts.title ?? "").trim();
	if (title) parts.push(mdTitle(title, opts.titleLevel ?? 1));
	if (pageItems.length) parts.push(mdBullets(pageItems));
	else {
		const empty = String(opts.emptyText ?? "").trim();
		parts.push(empty || "—");
	}
	const inline = buildInlineCommands(opts.inlineCommands ?? []);
	if (inline.lines.length) parts.push(inline.lines.join("\n"));
	warnings.push(...inline.warnings);
	const footerBits = [`第 ${page}/${totalPages} 页`, `共 ${total} 条`];
	const givenFooter = String(opts.footer ?? "").trim();
	if (givenFooter) footerBits.push(givenFooter);
	const hint = String(paging.footerHint ?? "").trim();
	if (hint) footerBits.push(hint);
	parts.push("​");
	parts.push(footerBits.join("　"));
	return {
		markdown: mdJoin(parts),
		keyboard,
		warnings
	};
}

export { SEGMENT_TYPES, str, fail, ok, messageOp, mdTitle, mdBold, mdQuote, mdDivider, mdBullets, mdKeyValues, mdBar, mdJoin, displayWidth, cut, buildKeyboard, normalizeOne, checkKeyboardBudget, INLINE_COMMAND_KEYS, mdInlineCommand, buildInlineCommands, normalizeInlineOne, composeCard, battleSideLine, composeBattle, composeList };
