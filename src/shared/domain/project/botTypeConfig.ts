// @ts-nocheck
// 由 10/18 打包产物还原（chunk: renderer-index.js）；见 _recovery/README-recovery.md

var BOT_TYPES = [
	{
		value: "qq",
		label: "QQ 机器人框架",
		desc: "节点库只显示与 QQ 平台相关的节点（收发消息 / 群·频道 / 互动 / 上下文等）；新建项目仍是空白画布"
	},
	{
		value: "general",
		label: "通用机器人",
		desc: "节点库显示全部节点；「玩家数据」面板按通用字段分组"
	},
	{
		value: "game",
		label: "游戏机器人",
		desc: "节点库显示全部节点（游戏玩法会用到各类节点）；「玩家数据」面板按角色属性/战斗分组"
	}
];
/**
* **平台专属标签**（新增一个平台时，把它的标签加到这里）。
*
* 架构：节点分两类 ——
*   · **通用节点**（不带来这里任何一个标签）：控制流 / 变量 / 数据 / 列表 / 存档 / AI / 文本 …，
*     任何平台的机器人都要用 ✓
*   · **专属节点**（带其中一个标签）：只在对应平台的项目里出现 ✓
* 于是"QQ 机器人框架"挡住的是**别的平台**的专属节点 ✓，而不是通用节点 ——
* 通用 + 本平台专属 = 够你开发一个机器人 ✓
*/
var PLATFORM_TAGS = [
	"QQ",
	"飞书",
	"微信",
	"钉钉"
];
/**
* 类型 → 平台策略。
*
* - `own`  ：**通用 + 本平台专属**（QQ 项目 = 通用 + QQ 专属）
* - `none` ：**只显示通用**（"通用框架"不绑平台，所以**不相关的平台专属一律不出现** ✓）
* - `all`  ：不限制（保留给"我就是要看全部"的场景）
*/
var BOT_TYPE_PLATFORM = {
	qq: {
		platform: "QQ",
		mode: "own"
	},
	general: {
		platform: null,
		mode: "none"
	},
	game: {
		platform: "QQ",
		mode: "own"
	}
};
/**
* 这个节点在当前项目类型下，是否出现在节点库里（纯函数，可单测）。
*
* 规则：**通用内容（不带平台标签）始终可见**；专属内容按类型的平台策略 ——
* QQ/游戏项目显示「通用 + QQ 专属」，**通用项目只显示通用**（不相关的平台专属一律不出现 ✓）。
* 也就是说 QQ 项目里出现的是「通用 + QQ 专属」，飞书项目里是「通用 + 飞书专属」✓。
*/
function specVisibleForBotType(spec, botType) {
	return isPlatformVisible(spec.tags, botType);
}
/**
* **通用判定**：带这些标签的"东西"在当前项目类型下是否可见。
*
* 节点、UI 入口（工具栏按钮等）都用它 —— 规则只有一条：
* **不带任何平台标签的（通用）永远可见；带平台标签的只有"本平台"的才可见** ✓
* 于是 QQ 项目挡住飞书/微信专属，反过来也一样 ✓
*/
function isPlatformVisible(tags, botType) {
	const policy = BOT_TYPE_PLATFORM[botType ?? "general"];
	if (policy.mode === "all") return true;
	const owns = (tags ?? []).filter((tag) => PLATFORM_TAGS.includes(tag));
	if (policy.mode === "none") return owns.length === 0;
	return owns.length === 0 || policy.platform !== null && owns.includes(policy.platform);
}
BOT_TYPES.reduce((acc, option) => {
	acc[option.value] = option.label;
	return acc;
}, {});

/** 旧 BotType → 新 BotType 映射（用于迁移；templateId 随模板库一并移除） */
var BOT_TYPE_MIGRATION_MAP = {
	functional: { botType: "general" },
	rpg: { botType: "game" },
	cultivation: { botType: "game" },
	wuxia: { botType: "game" },
	card: { botType: "game" },
	management: { botType: "game" }
};
/** 迁移旧 botType 值为新值（未知值一律按 general 处理） */
function migrateBotType(oldBotType) {
	if (!oldBotType) return { botType: "general" };
	if (oldBotType === "qq" || oldBotType === "general" || oldBotType === "game") return { botType: oldBotType };
	const migration = BOT_TYPE_MIGRATION_MAP[oldBotType];
	if (!migration) return { botType: "general" };
	return migration;
}

/** 机器人类型 id：以上方 BOT_TYPES 的 value 为准（权威联合类型在 shared/types/project.ts） */
export type { BotType } from '../../types/project';

export { BOT_TYPES, PLATFORM_TAGS, BOT_TYPE_PLATFORM, specVisibleForBotType, isPlatformVisible, migrateBotType };
