// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { BASE_DATA_KEYS, isBaseDataKey } from "./baseKeys";

/** 简写 → 规范名（`lv` 与 `level` 是同一个概念） */
var NAME_ALIASES = {
	lv: "level",
	rpg_level: "level",
	rpg_exp: "exp",
	rpg_hp: "hp",
	rpg_mp: "mp",
	coin: "gold",
	money: "gold",
	inventory: "cardDeck",
	items: "cardDeck",
	equipment: "equip",
	spirit_stone: "spiritStones",
	score: "points"
};
/** 规范名 → 中文标签（缺省名由调用方回退到 key 本身） */
var LABELS = {
	level: "等级",
	exp: "经验",
	hp: "生命值",
	hp_max: "最大生命值",
	mp: "法力值",
	mp_max: "最大法力值",
	atk: "攻击力",
	def: "防御力",
	gold: "金币",
	spiritStones: "灵石",
	points: "积分",
	bag: "背包",
	cardDeck: "背包",
	equip: "装备",
	skills: "技能",
	title: "称号",
	nickname: "昵称",
	realm: "境界",
	sect: "宗门",
	cultivation: "修为",
	stamina: "体力",
	vip: "VIP",
	permission: "权限等级",
	registered_at: "注册时间",
	last_active: "最后活跃",
	last_active_date: "最后活跃日期",
	signin_count: "签到次数",
	signin_streak: "连续签到",
	last_signin_date: "上次签到日期",
	message_count: "消息数",
	command_count: "命令次数",
	interaction_count: "互动次数",
	ban_status: "封禁状态",
	ban_until: "封禁截止",
	mute_status: "禁言状态",
	mute_until: "禁言截止",
	preferences: "个人偏好",
	notify_enabled: "通知开关",
	daily_revenue: "日收入",
	signin_date: "签到日期",
	[BASE_DATA_KEYS.registeredAt]: "注册时间",
	[BASE_DATA_KEYS.lastActive]: "最后在线",
	[BASE_DATA_KEYS.lastActiveDate]: "最后在线日期",
	[BASE_DATA_KEYS.msgCount]: "消息计数",
	[BASE_DATA_KEYS.nickname]: "昵称"
};
/** 规范名 → 语义分类 */
var SEMANTICS = {
	level: "level",
	exp: "growth",
	cultivation: "growth",
	hp: "combat",
	hp_max: "combat",
	mp: "combat",
	mp_max: "combat",
	atk: "combat",
	def: "combat",
	stamina: "combat",
	gold: "economy",
	spiritStones: "economy",
	points: "economy",
	daily_revenue: "economy",
	bag: "collection",
	cardDeck: "collection",
	equip: "collection",
	skills: "collection",
	title: "status",
	realm: "status",
	sect: "status",
	vip: "status",
	permission: "status",
	ban_status: "status",
	ban_until: "status",
	mute_status: "status",
	mute_until: "status",
	notify_enabled: "status"
};
/** 分类 → 默认模板里的分组（id / 名称 / 图标） */
var GROUPS = {
	base: {
		id: "base",
		label: "基础数据",
		icon: "🪪"
	},
	level: {
		id: "growth",
		label: "等级经验",
		icon: "📈"
	},
	growth: {
		id: "growth",
		label: "等级经验",
		icon: "📈"
	},
	combat: {
		id: "combat",
		label: "战斗属性",
		icon: "⚔️"
	},
	economy: {
		id: "economy",
		label: "经济",
		icon: "💰"
	},
	collection: {
		id: "collection",
		label: "物品",
		icon: "🎒"
	},
	status: {
		id: "status",
		label: "状态",
		icon: "🏷️"
	}
};
/** 规范名（去掉别名） */
function canonicalFieldName(key) {
	return NAME_ALIASES[key] ?? key;
}
/** 中文标签；查不到返回 undefined（让调用方决定回退） */
function semanticLabel(key) {
	return LABELS[canonicalFieldName(key)];
}
/** 语义分类；查不到按"值长什么样"兜底 */
function semanticOf(key, value) {
	if (isBaseDataKey(key)) return "base";
	const known = SEMANTICS[canonicalFieldName(key)];
	if (known) return known;
	if (Array.isArray(value) || typeof value === "object" && value !== null) return "collection";
	if (typeof value === "number") return "economy";
	return "status";
}
/** 分组定义（默认模板用） */
function groupFor(semantic) {
	return GROUPS[semantic];
}
/**
* 推断字段类型。
*
* 判据（按可信度从高到低）：
*   1. 名字里带 `_at` / `_date` / `_until` → datetime/date（这是约定，不是猜）；
*   2. 实际值的 typeof；
*   3. 名字里带 `_count` / `count` / `_num` → number。
*
* 都没有证据时返回 `text` —— **宁可宽也不能错**（模板是给机器人初始化玩家字段用的）。
*/
function inferFieldType(key, value) {
	const k = key.toLowerCase();
	if (/_at$|_time$/.test(k)) return "datetime";
	if (/_date$/.test(k)) return "date";
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "number") return Number.isInteger(value) ? "number" : "number";
	if (typeof value === "string") return /^-?\d+(\.\d+)?$/.test(value.trim()) ? "number" : "text";
	if (Array.isArray(value) || typeof value === "object" && value !== null) return "json";
	if (/count|_num$|_total$/.test(k)) return "number";
	return "text";
}
/**
* 推断默认值。
*
* **只给有证据的默认值**：`increment` / `load_or_default` 这类模式说明流程期望一个起始值。
* 没有任何证据时**不给默认值**（返回 `undefined`）—— 编一个默认值就是编数据。
*
* @param modes 流程里这个字段用到的读写模式（来自 `variable_persist` 节点）
*/
function inferDefaultValue(key, type, modes) {
	if (!(modes.includes("increment") || modes.includes("load_or_default"))) return void 0;
	if (type === "number") return canonicalFieldName(key) === "level" ? 1 : 0;
	if (type === "boolean") return false;
}
/**
* 这个字段是不是"由流程/引擎自己写入、不该由模板预填充默认值"。
*
* 两类：
*   1. **引擎基础数据**（`__sys_*`：注册时间/最后在线/消息计数/昵称）—— 运行时维护；
*   2. **引擎内部状态** —— 实测 RPG 项目会写这些 key：
*      `battle`（战斗进行态）、`monster_hp`（当前怪血量）、
*      `actions`（可行动作列表）、`footer`（分页脚注）、`log`（日志文本）。
*      给它们预填 `''` 或 `0` 是错的：它们该由流程在运行时写入，
*      模板预填充只会让"未初始化"看起来像"有数据"。
*
* 判据是**名单式**（不是名字启发式）：判错一个字段的后果只是"玩家初始化时多写一行
* 无意义默认值"，不是数据损坏，所以名单足够。
*/
var ENGINE_MANAGED_KEYS = /* @__PURE__ */ new Set([
	"last_signin_date",
	"battle",
	"monster_hp",
	"actions",
	"footer",
	"log"
]);
function isAutoManaged(key) {
	if (isBaseDataKey(key)) return true;
	return ENGINE_MANAGED_KEYS.has(key);
}
/**
* 这些字段是**项目自己的运行状态**，不是"玩家属性"。
*
* 实测（RPG 项目）：`battle` / `monster_hp` / `actions` / `footer` / `log` 由战斗系统的
* 节点在运行时写入 —— 里面装的是"当前怪血量""可行动作列表""战斗日志文本"这类东西。
*
* 为什么要在显示上把它们分出来：它们是**长文本与内部状态**，
* 混进数值网格会让"等级/金币"旁边出现一格 `你使用【普攻】…`（还因列宽不够被截断），
* 用户完全无法从卡片上读出玩家属性 —— 而卡片本来只该显示
* **"玩家有什么、等级多少、金币多少"**。
*
* 保守起见是**名单式**：只有确认是运行状态的才收进去，
* 不确定的业务字段宁可留在网格里（少收比多收安全）。
*/
var ENGINE_STATE_KEYS = /* @__PURE__ */ new Set([
	"battle",
	"monster_hp",
	"actions",
	"footer",
	"log"
]);
/** 是不是"项目自己的运行状态"（卡片上收进折叠区，不进数值网格） */
function isEngineStateField(key) {
	return ENGINE_STATE_KEYS.has(key);
}
/**
* 这些字段**不进数据模板**。
*
* 为什么不进：模板是"玩家的数据结构"（用户能在编辑器里加默认值、枚举、说明，
* 机器人据此给新玩家初始化行）。而运行状态是**一次战斗/一次交互的中间产物** ——
* 把 `log`（战斗日志文本）当数据结构声明出来，对用户没有任何意义，只会让模板变长。
*
* 它们仍然存在于 `_persistent` 里、也能在数据浏览器的 `_persistent` 列表看到，
* 所以"看不见"不等于"丢了"。
*
* 判据仍用同一份名单（**一处定义**）：显示上折叠、模板里剔除，是同一批字段的两面。
*/
function isTemplateExcludedField(key) {
	return ENGINE_STATE_KEYS.has(key);
}
/**
* 语义分类 → 模板字段的 `category`（`FieldCategory`，角色卡分组用）。
*
* 注意 `FieldCategory` **没有** `growth` 这一项（它的成员是
* `identity/level/economy/combat/exploration/cultivation/collection/business/martial/social_base/status/stats`），
* 所以"成长"类（经验/修为）落到 `level` —— 角色卡的"等级经验"就是这么分的。
*/
function toFieldCategory(semantic) {
	switch (semantic) {
		case "base":
		case "status": return "status";
		case "level":
		case "growth": return "level";
		case "combat": return "combat";
		case "economy": return "economy";
		case "collection": return "collection";
		default: return "status";
	}
}
/** 枚举字段的已知选项（模板里要声明 enum 的字段） */
var KNOWN_ENUM_OPTIONS = {
	permission: [
		{
			value: "member",
			label: "普通成员"
		},
		{
			value: "admin",
			label: "管理员"
		},
		{
			value: "owner",
			label: "群主"
		}
	],
	ban_status: [{
		value: "none",
		label: "正常"
	}, {
		value: "banned",
		label: "已封禁"
	}],
	mute_status: [{
		value: "none",
		label: "正常"
	}, {
		value: "muted",
		label: "已禁言"
	}]
};

export { NAME_ALIASES, LABELS, SEMANTICS, GROUPS, canonicalFieldName, semanticLabel, semanticOf, groupFor, inferFieldType, inferDefaultValue, ENGINE_MANAGED_KEYS, isAutoManaged, ENGINE_STATE_KEYS, isEngineStateField, isTemplateExcludedField, toFieldCategory, KNOWN_ENUM_OPTIONS };
