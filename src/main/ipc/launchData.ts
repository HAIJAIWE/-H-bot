// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
import { checkIdentitySchema, dataTemplateSchema, deletePlayerSchema, deleteRecordSchema, getPlayerSchemaSchema, getSchemaSchema, insertRecordSchema, listDataSourcesSchema, listPlayersSchema, mergePlayersSchema, queryPlayerTablesSchema, queryTableSchema, savePlayerSchemaSchema, searchPlayerSchema, uidMappingSchema, updatePlayerUidSchema, updateRecordSchema } from "../schemas/launchData";
import { tryIpc, tryIpcAsync } from "./_shared";
import { botManager } from "../services/bot/botManager";
import { getPlayersWithUid, getUidMapping, mergeUidMapping, updatePlayerUid } from "../services/bot/uidMappingService";
import { checkIdentity } from "../services/bot/identityService";
import { getPlayerSchema, savePlayerSchema } from "../services/project/playerSchemaService";
import { saveSchemaSchema } from "../schemas/plugins";
import { deriveTemplateFromProject, getDataTemplate, saveDataTemplate } from "../services/project/dataTemplateService";
import { backfillPlayerBaseData, countPlayersMissingBaseData } from "../services/project/playerBaseDataService";
import { deletePlayer, deleteRecord, getSchema, init_dataService, insertRecord, listDataSources, listPlayers, mergePlayers, queryPlayerTables, queryTable, saveSchema, searchPlayer, updateRecord } from "../services/project/dataService";
import { assertPathWithinBase } from "../services/infra/pathGuard";

var DATA_FILE_EXTS$1 = [
	".db",
	".sqlite",
	".json"
];
function registerLaunchDataIpc() {
	electron.ipcMain.handle("launch:listDataSources", async (_e, projectPath) => {
		const parsed = listDataSourcesSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => listDataSources(parsed.data[0]));
	});
	electron.ipcMain.handle("launch:getSchema", async (_e, filePath) => {
		const parsed = getSchemaSchema.safeParse([filePath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS$1);
			return getSchema(parsed.data[0]);
		});
	});
	electron.ipcMain.handle("launch:queryTable", async (_e, filePath, tableName, page, pageSize, cursor) => {
		const parsed = queryTableSchema.safeParse([
			filePath,
			tableName,
			page,
			pageSize,
			cursor
		]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS$1);
			return queryTable(parsed.data[0], parsed.data[1], parsed.data[2], parsed.data[3], parsed.data[4]);
		});
	});
	electron.ipcMain.handle("launch:updateRecord", async (_e, filePath, tableName, rowid, changes) => {
		const parsed = updateRecordSchema.safeParse([
			filePath,
			tableName,
			rowid,
			changes
		]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS$1);
			updateRecord(parsed.data[0], parsed.data[1], parsed.data[2], parsed.data[3]);
			return null;
		});
	});
	electron.ipcMain.handle("launch:insertRecord", async (_e, filePath, tableName, values) => {
		const parsed = insertRecordSchema.safeParse([
			filePath,
			tableName,
			values
		]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS$1);
			return insertRecord(parsed.data[0], parsed.data[1], parsed.data[2]);
		});
	});
	electron.ipcMain.handle("launch:deleteRecord", async (_e, filePath, tableName, rowid) => {
		const parsed = deleteRecordSchema.safeParse([
			filePath,
			tableName,
			rowid
		]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS$1);
			deleteRecord(parsed.data[0], parsed.data[1], parsed.data[2]);
			return null;
		});
	});
	electron.ipcMain.handle("launch:searchPlayer", async (_e, projectPath, query) => {
		const parsed = searchPlayerSchema.safeParse([projectPath, query]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => searchPlayer(parsed.data[0], parsed.data[1]));
	});
	electron.ipcMain.handle("launch:listPlayers", async (_e, projectPath) => {
		const parsed = listPlayersSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => listPlayers(parsed.data[0]));
	});
	/**
	* launch:mergePlayers —— 把 `fromUid` 这个玩家**并入** `toUid`（存档 + 身份映射一起）。
	*
	* 用在"同一个人被当成两个玩家"时（平台在群事件里只给 member_openid 的极端情况）。
	* 两条安全约束：
	*   1. **机器人运行时拒绝**：翻译器把映射缓存在内存，会在下一次保存时覆盖文件改动；
	*   2. 合并前**整库备份**（见 dataService.mergePlayers）。
	*/
	electron.ipcMain.handle("launch:mergePlayers", async (_e, projectPath, fromUid, toUid) => {
		const parsed = mergePlayersSchema.safeParse([
			projectPath,
			fromUid,
			toUid
		]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		const [proj, from, to] = parsed.data;
		if (from === to) return {
			ok: false,
			error: "不能合并到自己"
		};
		const st = botManager.getBotStatus(proj);
		if (st && (st.status === "running" || st.status === "starting")) return {
			ok: false,
			error: "请先停止机器人再合并（运行中的映射会覆盖本次改动）"
		};
		return tryIpcAsync(async () => {
			const db = await mergePlayers(proj, from, to);
			const map = mergeUidMapping(proj, from, to);
			return {
				...db,
				mappingMoved: map.moved
			};
		});
	});
	/**
	* launch:checkIdentity —— **只读**检查身份一致性（不修任何数据）。
	*
	* 为什么需要：存档按 **uid** 存，而 uid 由 `openid → uid` 映射分配（见 identityService 顶部）。
	* 两者漂了不会报错，只是"数据认不出是谁"：实测一个真实项目映射 2 条、数据 11 个玩家 → 9 个孤儿。
	*/
	electron.ipcMain.handle("launch:checkIdentity", async (_e, projectPath) => {
		const parsed = checkIdentitySchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => checkIdentity(parsed.data[0]));
	});
	/**
	* launch:getPlayerSchema —— 玩家存档的**字段契约**。
	*
	* fields = 流程声明（variable_persist）∪ 存档实际存在的 key，项目可在
	* data/players/player.schema.json 里覆盖 label/type/category。
	* 面板据此显示字段，不再靠"猜列名 + 别名表"。
	*/
	electron.ipcMain.handle("launch:getPlayerSchema", async (_e, projectPath) => {
		const parsed = getPlayerSchemaSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => getPlayerSchema(parsed.data[0]));
	});
	/**
	* launch:saveSchema —— 保存**数据表结构声明**（数据浏览器「建表向导」用）。
	*
	* 2026-10-18 修（计划 5.4）：这个能力原先只有 `plugin:saveSchema` 一个频道，
	* 而 preload 把它挂在 `launchData.saveSchema` 名下 —— 域与方法对不上：
	* 同域的兄弟方法是 `launch:savePlayerSchema`，唯独它跳到 `plugin:`。
	* 现在补一个同实现的 `launch:` 频道，preload 改指这里；
	* `plugin:saveSchema` **保留**（外部脚本/既有调用点可能还在用）。
	*/
	electron.ipcMain.handle("launch:saveSchema", async (_e, projectPath, tableName, fields) => {
		const parsed = saveSchemaSchema.safeParse([
			projectPath,
			tableName,
			fields
		]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => saveSchema(parsed.data[0], parsed.data[1], parsed.data[2]));
	});
	/** launch:savePlayerSchema —— 把当前契约落成文件（让项目拥有它、可手改中文名/类型/分类） */
	electron.ipcMain.handle("launch:savePlayerSchema", async (_e, projectPath, schema) => {
		const parsed = savePlayerSchemaSchema.safeParse([projectPath, schema]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			savePlayerSchema(parsed.data[0], parsed.data[1]);
			return null;
		});
	});
	/**
	* launch:deletePlayer —— 删掉某个玩家的**全部存档数据**（数据浏览器里"删除玩家"）。
	* 不可逆，服务层会先备份该玩家的 db 文件（db.backup，WAL 安全）。
	*/
	electron.ipcMain.handle("launch:deletePlayer", async (_e, projectPath, qq) => {
		const parsed = deletePlayerSchema.safeParse([projectPath, qq]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpcAsync(() => deletePlayer(parsed.data[0], parsed.data[1]));
	});
	electron.ipcMain.handle("launch:queryPlayerTables", async (_e, filePath, qq) => {
		const parsed = queryPlayerTablesSchema.safeParse([filePath, qq]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			assertPathWithinBase(process.cwd(), parsed.data[0], DATA_FILE_EXTS$1);
			return queryPlayerTables(parsed.data[0], parsed.data[1]);
		});
	});
	electron.ipcMain.handle("launch:getUidMapping", async (_e, projectPath) => {
		const parsed = uidMappingSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => getUidMapping(parsed.data[0]));
	});
	electron.ipcMain.handle("launch:getPlayersWithUid", async (_e, projectPath) => {
		const parsed = uidMappingSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => getPlayersWithUid(parsed.data[0]));
	});
	electron.ipcMain.handle("launch:updatePlayerUid", async (_e, projectPath, openid, newUid) => {
		const parsed = updatePlayerUidSchema.safeParse([
			projectPath,
			openid,
			newUid
		]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpcAsync(() => updatePlayerUid(parsed.data[0], parsed.data[1], parsed.data[2]));
	});
	electron.ipcMain.handle("launch:getDataTemplate", async (_e, projectPath) => {
		const parsed = uidMappingSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => getDataTemplate(parsed.data[0]));
	});
	/**
	* `launch:deriveDataTemplate` —— 从**项目自身**推导一份数据模板（不读已保存的模板文件）。
	*
	* 给模板编辑器的「恢复默认」用：默认内容不再是硬编码的示例字段，
	* 而是"你项目里 `variable_persist` 声明过的 + 存档里真实存在的"那些 key。
	*/
	electron.ipcMain.handle("launch:deriveDataTemplate", async (_e, projectPath) => {
		const parsed = uidMappingSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => deriveTemplateFromProject(parsed.data[0]));
	});
	electron.ipcMain.handle("launch:saveDataTemplate", async (_e, projectPath, template) => {
		const parsed = dataTemplateSchema.safeParse([projectPath, template]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => {
			saveDataTemplate(parsed.data[0], parsed.data[1]);
			return null;
		});
	});
	/**
	* `launch:countPlayersMissingBaseData` —— 还有几个玩家没有基础数据。
	*
	* 引擎基础数据是"从功能上线那一刻起"才记的，老玩家档案里没有 →
	* 卡片上"基础数据"是空的。面板据此提示"可以初始化"。
	*/
	electron.ipcMain.handle("launch:countPlayersMissingBaseData", async (_e, projectPath) => {
		const parsed = uidMappingSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => countPlayersMissingBaseData(parsed.data[0]));
	});
	/**
	* `launch:backfillPlayerBaseData` —— 给历史玩家回填基础数据。
	*
	* 幂等：已有值的 key 一律不动（`registered_at` 尤其不能被改写）。
	* 数据来源只有 `_persistent.updated_at`（推断，天级精度），详见
	* `services/project/playerBaseDataService.ts` 的说明。
	*/
	electron.ipcMain.handle("launch:backfillPlayerBaseData", async (_e, projectPath) => {
		const parsed = uidMappingSchema.safeParse([projectPath]);
		if (!parsed.success) return {
			ok: false,
			error: `参数校验失败: ${parsed.error.message}`
		};
		return tryIpc(() => backfillPlayerBaseData(parsed.data[0]));
	});
}

export { DATA_FILE_EXTS$1, registerLaunchDataIpc };
