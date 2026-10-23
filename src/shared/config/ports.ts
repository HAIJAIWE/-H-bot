// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/**
* 端口归属表 —— 本仓库关于「谁可以监听哪个端口」的唯一真源。
*
* ## 为什么要有这个文件
*
* 2026-10-18 的隔离审计（docs/refactor/跨项目隔离重构执行计划.md 的 RT-01/RT-02/RT-11）
* 发现端口有**两个互不相认的坐标系**：
*   · 桌面侧：`translatorPort = 1000 + portBlock`（1001、1002…）
*   · 部署/文档侧：8080、`PORT`、`QQBOT_TRANSLATOR_PORT`
*
* 而 1000 段是**公用人造段**——本机任何本地服务都可能占用它，我们却没有任何
* 「这块端口归本项目」的声明。实测过的后果：运行时连到 127.0.0.1:8080 上的
* 第三方服务（Steam web helper）并反复 404；同机两个项目并行开发时只能靠运气不撞。
*
* ## 段位划分（43100–43199）
*
* | 段 | 用途 |
* | --- | --- |
* | 43101–43180 | 项目翻译器/总线：`port = TRANSLATOR_BASE + block`（80 块） |
* | 43181–43189 | 预留（未来子服务，业务不许直接用） |
* | 43190 | MCP SSE（默认值；仍可用 QQBAT_MCP_SSE_PORT 覆盖） |
* | 43191 | 开发期 CDP（QQBAT_CDP_PORT 的默认值） |
* | 43192–43199 | e2e / 冒烟脚本（替代旧的 39577 / 39678） |
*
* 为什么是 43100 而不是别的：
*   · Windows 默认动态端口段是 49152–65535，43100 段落在**注册端口段**（1024–49151），
*     不会被系统临时分配占走；
*   · 远离 8000/8080/1000/3000/5173 这些开发工具高频段。
*
* ⚠️ **这个段只是「我们声明归自己」，不是系统级仲裁。** 跨进程/跨产品的冲突只能靠
* 「段不重叠 + 启动自检」发现，不要以为有了常量就不会撞（见 P3 的端口租约文件）。
*/
/** 专属端口段（闭区间） */
var PORT_BAND = {
	min: 43100,
	max: 43199
};
/** 翻译器端口基准：`port = TRANSLATOR_BASE + block`，block 从 1 开始 → 43101 */
var TRANSLATOR_BASE = 43100;
/** MCP SSE 的默认端口（仅在显式启用 MCP 时使用） */
var MCP_SSE_PORT = 43190;
/** 开发期 Chrome DevTools Protocol 的默认端口（`QQBAT_CDP_PORT=1` 时生效） */
var CDP_PORT = 43191;
/**
* 由端口块编号计算翻译器端口。
*
* 块号越界时**夹到合法区间**而不是抛错：历史项目的 portBlock 可能来自更早的分配规则
* （例如旧 NapCat 段留下的 2/3），夹住比启动失败好。调用方若关心是否被夹，用
* `isBlockInRange` 自行判断。
*/
function translatorPortForBlock(block) {
	return TRANSLATOR_BASE + Math.min(Math.max(Math.trunc(block) || 1, 1), 80);
}
/** 端口是否落在专属段内 */
function isInPortBand(port) {
	return Number.isInteger(port) && port >= PORT_BAND.min && port <= PORT_BAND.max;
}
/** 端口块是否在可分配区间内 */
function isBlockInRange(block) {
	return Number.isInteger(block) && block >= 1 && block <= 80;
}
[
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
].reduce((acc, option) => {
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

export { PORT_BAND, TRANSLATOR_BASE, MCP_SSE_PORT, CDP_PORT, translatorPortForBlock, isInPortBand, isBlockInRange, BOT_TYPE_MIGRATION_MAP, migrateBotType };
