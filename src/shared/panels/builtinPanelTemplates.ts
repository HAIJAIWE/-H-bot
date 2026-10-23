// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

/** 创建按钮的辅助函数 */
function btn(id, label, data, style = 1) {
	return {
		id,
		render_data: {
			label,
			style
		},
		action: {
			type: 2,
			permission: { type: 2 },
			data
		}
	};
}
/** 行的辅助函数 */
function row(...buttons) {
	return { buttons };
}
/** 主菜单按钮的 data 前缀统一使用 / 命令格式 */
var BUILTIN_PANEL_TEMPLATES = [
	{
		templateId: "main_menu",
		name: "主菜单面板",
		description: "游戏主菜单，包含所有子系统的入口按钮",
		keyboard: { rows: [
			row(btn("btn_character", "👤 角色", "/角色"), btn("btn_inventory", "🎒 背包", "/背包"), btn("btn_skills", "⚡ 技能", "/技能")),
			row(btn("btn_shop", "🏪 商店", "/商店"), btn("btn_quest", "📜 任务", "/任务"), btn("btn_signin", "📅 签到", "/签到")),
			row(btn("btn_gacha", "🎴 抽卡", "/抽卡"), btn("btn_close", "✖ 关闭", "/关闭菜单", 0))
		] }
	},
	{
		templateId: "inventory",
		name: "背包面板",
		description: "背包系统，查看物品、装备/使用/丢弃",
		keyboard: { rows: [
			row(btn("btn_item1", "物品1", "/查看物品 1"), btn("btn_item2", "物品2", "/查看物品 2"), btn("btn_item3", "物品3", "/查看物品 3")),
			row(btn("btn_equip", "⚔ 装备", "/装备物品"), btn("btn_use", "💊 使用", "/使用物品"), btn("btn_drop", "🗑 丢弃", "/丢弃物品", 0)),
			row(btn("btn_back", "← 返回菜单", "/菜单"))
		] }
	},
	{
		templateId: "skills",
		name: "技能面板",
		description: "技能系统，查看/升级/装备/使用技能",
		keyboard: { rows: [
			row(btn("btn_skill1", "技能1", "/查看技能 1"), btn("btn_skill2", "技能2", "/查看技能 2"), btn("btn_skill3", "技能3", "/查看技能 3")),
			row(btn("btn_upgrade", "⬆ 升级", "/升级技能"), btn("btn_equip_skill", "🎯 装备", "/装备技能"), btn("btn_use_skill", "✨ 使用", "/使用技能")),
			row(btn("btn_back", "← 返回菜单", "/菜单"))
		] }
	},
	{
		templateId: "shop",
		name: "商店面板",
		description: "商店系统，浏览/购买/出售商品",
		keyboard: { rows: [
			row(btn("btn_goods1", "商品1", "/查看商品 1"), btn("btn_goods2", "商品2", "/查看商品 2"), btn("btn_goods3", "商品3", "/查看商品 3")),
			row(btn("btn_buy", "💰 购买", "/购买"), btn("btn_sell", "💱 出售", "/出售")),
			row(btn("btn_back", "← 返回菜单", "/菜单"))
		] }
	},
	{
		templateId: "quest",
		name: "任务面板",
		description: "任务系统，查看/接取/放弃/完成任务",
		keyboard: { rows: [
			row(btn("btn_quest1", "任务1", "/查看任务 1"), btn("btn_quest2", "任务2", "/查看任务 2"), btn("btn_quest3", "任务3", "/查看任务 3")),
			row(btn("btn_accept", "✅ 接取", "/接取任务"), btn("btn_abandon", "❌ 放弃", "/放弃任务", 0), btn("btn_complete", "🎉 完成", "/完成任务")),
			row(btn("btn_back", "← 返回菜单", "/菜单"))
		] }
	},
	{
		templateId: "signin",
		name: "签到面板",
		description: "每日签到系统，签到/补签/查看记录",
		keyboard: { rows: [
			row(btn("btn_signin_now", "📅 立即签到", "/签到")),
			row(btn("btn_repair", "🔧 补签", "/补签"), btn("btn_record", "📊 签到记录", "/签到记录")),
			row(btn("btn_back", "← 返回菜单", "/菜单"))
		] }
	},
	{
		templateId: "character",
		name: "角色面板",
		description: "角色信息系统，查看属性/装备/加点",
		keyboard: { rows: [
			row(btn("btn_attrs", "📊 属性", "/查看属性"), btn("btn_equip_view", "⚔ 装备", "/查看装备")),
			row(btn("btn_add_str", "💪 力量+1", "/加点 力量"), btn("btn_add_int", "🧠 智力+1", "/加点 智力"), btn("btn_add_agi", "👟 敏捷+1", "/加点 敏捷")),
			row(btn("btn_back", "← 返回菜单", "/菜单"))
		] }
	},
	{
		templateId: "gacha",
		name: "抽卡面板",
		description: "抽卡系统，单抽/十连/查看卡池",
		keyboard: { rows: [
			row(btn("btn_single", "🎯 单抽", "/单抽"), btn("btn_ten", "💎 十连", "/十连")),
			row(btn("btn_pool", "🎴 查看卡池", "/查看卡池"), btn("btn_switch_pool", "🔄 切换卡池", "/切换卡池")),
			row(btn("btn_back", "← 返回菜单", "/菜单"))
		] }
	}
];
/** 按模板 ID 查找 */
function getPanelTemplate(templateId) {
	return BUILTIN_PANEL_TEMPLATES.find((t) => t.templateId === templateId);
}
/**
* 将模板转换为完整的 ButtonPanel（生成 id 和时间戳）
*/
function instantiatePanelTemplate(template) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const keyboard = JSON.parse(JSON.stringify(template.keyboard));
	for (const row of keyboard.rows) {
		if (!row?.buttons) continue;
		for (const btn of row.buttons) if (btn?.id) {}
	}
	return {
		name: template.name,
		description: template.description,
		keyboard,
		createdAt: now,
		updatedAt: now
	};
}

export { btn, row, BUILTIN_PANEL_TEMPLATES, getPanelTemplate, instantiatePanelTemplate };
