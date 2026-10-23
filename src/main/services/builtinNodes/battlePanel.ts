// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { checkKeyboardBudget, composeBattle } from "./messageOp";

/** markdown 长度上限（与「拼装消息」同一套判断：超了报错，不静默截断） */
var DEFAULT_MAX_MARKDOWN_LENGTH = 4e3;
function asString(v) {
	return v === void 0 || v === null ? "" : String(v);
}
/** 一行文本 / 数组 → 字符串列表（容忍中英文逗号、顿号、分号与换行） */
function asLines(value) {
	if (Array.isArray(value)) return value.map(asString).filter(Boolean);
	const s = asString(value).trim();
	if (!s) return [];
	return s.split(/[\n]+/).map((l) => l.trim()).filter(Boolean);
}
/** 一行文本 → 按钮文字列表（动作之间用逗号/空格分，不能按行分，因为按钮本来就在一行） */
function asActions(value) {
	if (Array.isArray(value)) return value.filter(Boolean);
	const s = asString(value).trim();
	if (!s) return [];
	return s.split(/[\s,;，、]+/).map((v) => v.trim()).filter(Boolean);
}
function battlePanel(_bot, _event = null, options = {}) {
	const maxLength = Number(options.max_length) > 0 ? Number(options.max_length) : DEFAULT_MAX_MARKDOWN_LENGTH;
	try {
		const composed = composeBattle({
			monster: {
				name: options.monster_name,
				level: options.monster_level,
				hp: options.monster_hp,
				maxHp: options.monster_max_hp,
				barWidth: options.bar_width
			},
			player: {
				name: options.player_name,
				hp: options.player_hp,
				maxHp: options.player_max_hp,
				mp: options.player_mp,
				maxMp: options.player_max_mp,
				barWidth: options.bar_width
			},
			monsterTag: options.monster_tag,
			round: options.round,
			log: asLines(options.log),
			footer: options.footer,
			actions: asActions(options.actions),
			commandPrefix: options.command_prefix
		});
		const warnings = [...composed.warnings];
		const markdown = composed.markdown;
		if (!markdown.trim() && composed.keyboard.rows.length > 0) return {
			success: false,
			markdown: "",
			keyboard: composed.keyboard,
			button_count: composed.keyboard.rows.length,
			error: "战斗面板必须有正文 —— QQ 只在 markdown 消息上渲染按钮",
			warnings
		};
		if (markdown.length > maxLength) return {
			success: false,
			markdown: "",
			keyboard: composed.keyboard,
			button_count: composed.keyboard.rows.length,
			error: `面板内容 ${markdown.length} 字，超过上限 ${maxLength} 字（截断会切坏 markdown 语法，所以不自动截）`,
			warnings
		};
		warnings.push(...checkKeyboardBudget(composed.keyboard));
		return {
			success: true,
			markdown,
			keyboard: composed.keyboard,
			button_count: composed.keyboard.rows.length,
			error: "",
			warnings
		};
	} catch (e) {
		return {
			success: false,
			markdown: "",
			keyboard: { rows: [] },
			button_count: 0,
			error: e instanceof Error ? `拼装战斗面板失败: ${e.message}` : `拼装战斗面板失败: ${String(e)}`,
			warnings: []
		};
	}
}

export { DEFAULT_MAX_MARKDOWN_LENGTH, asString, asLines, asActions, battlePanel };
