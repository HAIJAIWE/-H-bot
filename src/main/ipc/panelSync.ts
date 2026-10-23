// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";
import * as electron from "electron";
import { tryIpcAsync } from "./_shared";
import { applyPanel, getMenu, listPanels } from "../services/project/panelSync";

var scopeSchema = z.enum([
	"c2c",
	"group",
	"channel",
	"dm"
]);
var listSchema = z.object({
	projectPath: z.string().min(1),
	scope: scopeSchema
});
var itemSchema = z.object({
	type: z.enum(["command", "link"]),
	name: z.string().optional(),
	desc: z.string().optional(),
	link: z.string().optional()
});
var applySchema = z.object({
	projectPath: z.string().min(1),
	scope: scopeSchema,
	items: z.array(itemSchema),
	remark: z.string().default("指令面板"),
	/** true = 只报告将要发生什么，**不发任何写请求**（界面的"预览"） */
	dryRun: z.boolean().optional()
});
function registerPanelSyncIpc() {
	/**
	* panel:list — 列出某个场景下 QQ 上现有的面板（只读）。
	*
	* 界面用它显示"远端现状"，并据此点名**面板里有、图里已经没有了**的失效条目
	* （那种条目点了没反应，属于本仓库最防的静默故障）。
	*/
	electron.ipcMain.handle("panel:list", async (_event, args) => {
		const parsed = listSchema.safeParse(args);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpcAsync(() => listPanels(parsed.data.projectPath, parsed.data.scope));
	});
	/**
	* panel:apply — 把面板内容同步到 QQ。
	*
	* 语义（见 services/project/panelSync.ts）：一个场景**只保留一个**面板 ——
	* 认领一个改，同场景多余的删掉。内容一致时**一个写请求都不发**。
	* `dryRun: true` 时只 GET 一次列表，用来给确认框提供"将会发生什么"。
	*/
	electron.ipcMain.handle("panel:apply", async (_event, args) => {
		const parsed = applySchema.safeParse(args);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		const { projectPath, ...rest } = parsed.data;
		return tryIpcAsync(() => applyPanel(projectPath, rest));
	});
	/**
	* panel:menu — 读当前自定义菜单（只读，`GET /v2/menu`）。
	*
	* 出厂配置清单用它显示"线上菜单是什么样"，与图里的 `menu_config` 节点比对。
	*/
	electron.ipcMain.handle("panel:menu", async (_event, args) => {
		const parsed = listSchema.pick({ projectPath: true }).safeParse(args);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpcAsync(() => getMenu(parsed.data.projectPath));
	});
}

export { scopeSchema, listSchema, itemSchema, applySchema, registerPanelSyncIpc };
