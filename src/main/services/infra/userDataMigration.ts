// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import { init_logger, logger } from "./logger";
import { init_paths, userDataPath, userDataRoot } from "./paths";

/**
* userData 目录布局迁移（P4.3）。
*
* ## 迁什么
*
* 把散在 userData **根目录**的 3 个配置文件与一个品牌命名目录，收进 `config/`：
*
* | 旧位置 | 新位置 |
* | --- | --- |
* | `<userData>/ai-config.json` | `<userData>/config/ai-config.json` |
* | `<userData>/ai-tool-budget.json` | `<userData>/config/ai-tool-budget.json` |
* | `<userData>/framework-dev-mode.json` | `<userData>/config/dev-mode.json` |
* | `<userData>/qqbat-data/official/` | `<userData>/config/official/` |
*
* ## 三条硬规则
*
* 1. **只复制，不删除**。迁移失败或用户回退旧版本时，数据仍在原地。
* 2. **幂等**：新位置一旦存在就跳过，不覆盖（用户可能已经在新位置改过配置）。
* 3. **留墓碑**：在旧路径旁边写一个 `<旧路径>.migrated-to-<entry>` 标记，
*    记录时间与目标 —— 这是"可以删旧目录了"的唯一证据，也是排障时的线索。
*
* ## 为什么必须在 bootstrap 最前面调用
*
* 迁移要早于任何配置读取：否则 `loadAndApplyToolBudget()` 会先在新位置找不到、
* 回落到默认值，用户改了半天的预算设置看起来"没了"。
*/
var MOVES = [
	{
		from: ["ai-config.json"],
		to: "aiConfig"
	},
	{
		from: ["ai-tool-budget.json"],
		to: "aiToolBudget"
	},
	{
		from: ["framework-dev-mode.json"],
		to: "devModeSetting"
	},
	{
		from: ["qqbat-data", "official"],
		to: "officialConfig"
	}
];
/**
* 执行一次布局迁移。
*
* 返回明细而不是布尔值：调用方要把它打进日志（"这次启动迁了哪几项"），
* 测试也要能断言"第二次跑是全部 skipped"。
*/
function migrateUserDataLayout(app) {
	const result = {
		migrated: [],
		skipped: [],
		failed: []
	};
	const root = userDataRoot(app);
	if (!root) return result;
	for (const move of MOVES) {
		const from = (0, path.join)(root, ...move.from);
		const to = userDataPath(move.to, app);
		if (!to || from === to) {
			result.skipped.push(move.from.join("/"));
			continue;
		}
		if ((0, fs.existsSync)(to)) {
			result.skipped.push(move.from.join("/"));
			continue;
		}
		if (!(0, fs.existsSync)(from)) {
			result.skipped.push(move.from.join("/"));
			continue;
		}
		try {
			(0, fs.mkdirSync)((0, path.dirname)(to), { recursive: true });
			(0, fs.cpSync)(from, to, {
				recursive: true,
				force: false,
				errorOnExist: false
			});
			(0, fs.writeFileSync)(from + ".migrated-to-" + move.to, JSON.stringify({
				from,
				to,
				at: (/* @__PURE__ */ new Date()).toISOString(),
				pid: process.pid
			}, null, 2), "utf-8");
			result.migrated.push(move.from.join("/") + " → " + move.to);
			logger.info("[userData] 已迁移 " + from + " → " + to + "（旧路径保留）");
		} catch (e) {
			result.failed.push(move.from.join("/"));
			logger.error("[userData] 迁移失败，旧数据仍保留在原位置，下次启动会重试:", e);
		}
	}
	return result;
}
/**
* 把**旧版本写在安装目录里**的项目搬到 userData（P3-3.9，P6-6.5 的前置）。
*
* ## 为什么必须做
*
* 打包后的项目根曾经是 process.cwd()/projects —— 而 cwd 在快捷方式 / portable 启动时
* 是**安装目录**。于是用户项目住在 D:\H Bot Made\projects 里：卸载/覆盖安装就可能带走它们，
* 而 P6 要改 productName（= 换安装目录）时，项目会直接「消失」。
*
* ## 三条规则（与 userData 布局迁移一致）
*
* 1. **只复制，不删除**：安装目录里的原项目保留，用户回退旧版本照样能打开；
* 2. **同名跳过**：目标已存在同名项目 → 不覆盖（用户可能已经在新位置继续开发）；
* 3. **留墓碑**：<旧目录>.migrated-to-userdata，记录时间与目标。
*
* ## 只在打包环境调用
*
* 开发态 cwd 就是仓库根，projects/ 是**仓库自己的测试项目**（测试、RPG测试项目…），
* 把它们复制进 userData 只会污染真机数据。调用方用 app.isPackaged 判断。
*/
function migrateLegacyProjectRoot(legacyDir, app) {
	const result = {
		migrated: [],
		skipped: [],
		failed: []
	};
	const target = userDataPath("projects", app);
	if (!target || !(0, fs.existsSync)(legacyDir)) return result;
	if ((0, path.resolve)(legacyDir) === (0, path.resolve)(target)) return result;
	let entries;
	try {
		entries = (0, fs.readdirSync)(legacyDir, { withFileTypes: true });
	} catch {
		return result;
	}
	(0, fs.mkdirSync)(target, { recursive: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const from = legacyDir + "/" + entry.name;
		const to = target + "/" + entry.name;
		if ((0, fs.existsSync)(to)) {
			result.skipped.push(entry.name);
			continue;
		}
		try {
			(0, fs.cpSync)(from, to, {
				recursive: true,
				force: false,
				errorOnExist: false
			});
			result.migrated.push(entry.name);
		} catch (e) {
			result.failed.push(entry.name);
			logger.error("[userData] 项目迁移失败（原目录保留）: " + entry.name, e);
		}
	}
	rewriteRecentProjects((0, path.join)(target, "qqbat", "recent.json"), legacyDir, target);
	if (result.migrated.length > 0 || result.failed.length > 0) {
		try {
			(0, fs.writeFileSync)(legacyDir + ".migrated-to-userdata", JSON.stringify({
				from: legacyDir,
				to: target,
				at: (/* @__PURE__ */ new Date()).toISOString(),
				migrated: result.migrated
			}, null, 2), "utf-8");
		} catch {}
		logger.info("[userData] 已把 " + result.migrated.length + " 个项目从安装目录迁到 userData（原目录保留）");
	}
	return result;
}
/**
* 把 `最近项目` 列表里的**绝对路径**从旧目录改写到新目录。
*
* 为什么必须做：`<项目根>/qqbat/recent.json`（应用自己的最近打开列表）里存的是
* **绝对路径**。项目整体被复制走之后，列表还指着安装目录 —— 用户点开就是
* 「项目不存在」，而项目其实好好地在新位置。2026-10-18 真机迁移时实测到：
* 迁移后 recent.json 仍然写着 `D:\H Bot Made\projects\测试`。
*
* 两个动作：
* 1. 前缀改写：`fromDir` → `toDir`（分隔符两种都认，JSON 里是转义的反斜杠）；
* 2. **丢掉目标不存在的条目**：宁可列表短一点，也不要留一条点不开的死链。
*
* 返回实际改了几条（0 = 无需改动，也就不写盘）。
*/
function rewriteRecentProjects(recentFile, fromDir, toDir) {
	if (!(0, fs.existsSync)(recentFile)) return 0;
	let list;
	try {
		list = JSON.parse((0, fs.readFileSync)(recentFile, "utf-8"));
	} catch {
		return 0;
	}
	if (!Array.isArray(list)) return 0;
	const norm = (s) => s.replace(/\\/g, "/").replace(/\/+$/, "");
	const from = norm(fromDir);
	let changed = 0;
	const next = list.flatMap((raw) => {
		if (!raw || typeof raw !== "object") return [];
		const entry = raw;
		const oldPath = typeof entry.path === "string" ? entry.path : "";
		if (!oldPath) return [raw];
		const n = norm(oldPath);
		if (!(n === from || n.startsWith(from + "/"))) return [raw];
		const rel = (0, path.relative)(fromDir, oldPath);
		if (rel.startsWith("..")) return [raw];
		const newPath = (0, path.join)(toDir, rel);
		if (!(0, fs.existsSync)(newPath)) {
			changed++;
			return [];
		}
		if (newPath !== oldPath) changed++;
		return [{
			...entry,
			path: newPath
		}];
	});
	if (changed === 0) return 0;
	try {
		(0, fs.writeFileSync)(recentFile, JSON.stringify(next, null, 2), "utf-8");
		logger.info("[userData] 最近项目列表已改写到新位置（" + changed + " 条）");
	} catch (e) {
		logger.warn("[userData] 改写 recent.json 失败（列表可能指向旧路径）", e);
		return 0;
	}
	return changed;
}

export { MOVES, migrateUserDataLayout, migrateLegacyProjectRoot, rewriteRecentProjects };
