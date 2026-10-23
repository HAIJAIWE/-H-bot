// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

var KNOWLEDGE_PACKS = [
	{
		id: "signin",
		title: "签到 / 打卡 / 每日",
		keywords: [
			"签到",
			"打卡",
			"每日",
			"连签",
			"连续签到",
			"signin",
			"checkin",
			"daily"
		],
		body: [
			"· 现成片段：signin-flow（签到整链）、increment-counter（计数 +1）、cooldown-check（冷却/限次）、time-format（日期）",
			"· 形状：message_received → 读或建计数键 → +1 → 回复（回复里的 {var1} 要接计数的**数据输出**）",
			"· 先确认**一个**问题：一天一次，还是每次都能累加？（这决定要不要 cooldown-check）",
			"· 坑：键名全项目只能有一套 —— 用项目简报里已有的那个，别新造同义词（sign_days / checkin 混用会让老玩家的记录凭空消失）"
		].join("\n")
	},
	{
		id: "gacha",
		title: "抽奖 / 抽卡 / 概率",
		keywords: [
			"抽奖",
			"抽卡",
			"扭蛋",
			"十连",
			"单抽",
			"概率",
			"中奖",
			"开箱",
			"gacha",
			"lottery"
		],
		body: [
			"· 现成片段：gacha-pull（抽一次）、random-reply（随机文案）、inventory-add（发放奖品）",
			"· 形状：message_received → **先检查代价**（积分/次数够不够）→ 抽 → 发奖 → 回复结果",
			"· 顺序是硬要求：**先检查、后扣除**；扣了没发奖，玩家会来找你（真机上这类投诉最难查）",
			"· 概率不要写死在提示里：概率表放配置表，照现有写法来（read_flow / new_lookup），别自己编一套",
			"· 先确认**一个**问题：抽一次要花什么（积分/道具/免费次数）？奖池是配置表还是几条固定的？"
		].join("\n")
	},
	{
		id: "shop",
		title: "商店 / 购买 / 兑换 / 背包",
		keywords: [
			"商店",
			"购买",
			"兑换",
			"背包",
			"道具",
			"积分",
			"货币",
			"金币",
			"shop",
			"buy"
		],
		body: [
			"· 现成片段：shop-buy（购买整链）、inventory-view（看背包）、inventory-add（加道具）、read-player-data（读余额）",
			"· 形状：message_received → 查价 → **检查余额** → 扣除 → 发货 → 回复",
			"· 商品/价格放**配置表**（用 new_lookup 建一条「查表回复」指令），别为每件商品画一条链 —— 100 件商品该是 1 条链 + 100 行数据",
			"· 坑：余额与物品是同一个玩家键下的不同字段，扣了钱没加物品 = 玩家资产凭空消失（顺序：查 → 扣 → 加 → 回复）"
		].join("\n")
	},
	{
		id: "battle",
		title: "战斗 / 副本 / 回合 / 养成",
		keywords: [
			"战斗",
			"副本",
			"回合",
			"打怪",
			"怪物",
			"pk",
			"培养",
			"升级",
			"等级",
			"排行榜",
			"血量"
		],
		body: [
			"· 现成片段：combat-round（一个回合）、pk-attack（玩家互打）、cultivate（修炼/养成）、leaderboard（排行）",
			"· 形状：面板或指令 → 读双方状态 → 算伤害 → 写回状态 → 发结果面板（**多回合靠按钮继续**，别在一个节点里循环）",
			"· 状态一律写进变量（血量/攻击/防御），不要藏在节点配置里 —— 配置是设计，变量才是存档",
			"· 坑：面板按钮回调走 button_clicked，和指令是**两条不同入口**；只接一条会出现「点按钮没反应」",
			"· 先确认**一个**问题：谁先手、几回合结束？（这两条决定控制链形状）"
		].join("\n")
	},
	{
		id: "quest",
		title: "任务 / 接取 / 完成 / 奖励",
		keywords: [
			"任务",
			"接取",
			"领取",
			"完成度",
			"进度",
			"奖励",
			"quest",
			"mission"
		],
		body: [
			"· 现成片段：quest-accept（接任务）、check-exists（是否已接）、inventory-add（发奖）",
			"· 形状：接取（写进行中）→ 达成条件（计数/掉落）→ 领取奖励（**领完必须置为已完成**）",
			"· 坑：**重复领取**是这类需求第一大 bug —— 领取前必须查状态，领完立刻写回已领",
			"· 奖励与进度都按**玩家键**存，别用全局键（两个人会互相覆盖进度）"
		].join("\n")
	}
];
/**
* 选包：命中关键词就装，最多 limit 个（默认 2）。
*
* 排序：命中词数多的优先；同样多时**按注册顺序**（稳定，便于测试与日志比对）。
* 上限存在的理由和别处一样：**知识包是拿来换确定性的，不是拿来塞满上下文的**。
*/
function selectKnowledgePacks(requirement, limit = 2) {
	const text = (requirement ?? "").toLowerCase();
	if (!text.trim()) return [];
	const hits = KNOWLEDGE_PACKS.map((pack, index) => ({
		pack,
		index,
		score: pack.keywords.filter((k) => text.includes(k.toLowerCase())).length
	})).filter((h) => h.score > 0);
	hits.sort((a, b) => b.score - a.score || a.index - b.index);
	return hits.slice(0, Math.max(0, limit)).map((h) => h.pack);
}
/** 装载进来的包 —— 渲染成提示里的一节 */
function renderPacks(packs) {
	return packs.map((p) => ["### " + p.title, p.body].join("\n")).join("\n\n");
}
/**
* **没装的那些**也要有一行索引。
*
* 理由是本仓库那条老规矩：不能让模型把「没列出来的」当成「不存在」——
* 用户中途换话题（顺便把商店也做了）时，模型得知道「这个领域有知识包，值得按套路来」。
*/
function renderPackIndex(packs) {
	const loaded = new Set(packs.map((p) => p.id));
	const rest = KNOWLEDGE_PACKS.filter((p) => !loaded.has(p.id));
	if (rest.length === 0) return "";
	return `（本次没有装载的领域知识包：${rest.map((p) => p.title + "（" + p.id + "）").join("、")}。话题转到这些领域时，先按通用套路搭、并用 list_templates 查现成片段 —— 细节一律以工具返回为准。）`;
}

export { KNOWLEDGE_PACKS, selectKnowledgePacks, renderPacks, renderPackIndex };
