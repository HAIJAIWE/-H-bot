// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as node_path from "node:path";
import * as node_fs from "node:fs";
import { loadOfficialConfig } from "../official/config";
import { apiBase, fetchAccessToken } from "../official/client";

/** 我们自己建的面板都带这个前缀的 remark —— 用来在远端认出"这是 qqbat 建的" */
var PANEL_REMARK_PREFIX = "qqbat";
var REQUEST_TIMEOUT_MS = 15e3;
/** 一次官方 API 调用；非 2xx 时把响应体带进错误里（官方 400 只说"必填字段缺失"，不说缺哪个） */
async function officialRequest(token, base, method, path, body) {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			Authorization: `QQBot ${token}`,
			...body === void 0 ? {} : { "Content-Type": "application/json" }
		},
		body: body === void 0 ? void 0 : JSON.stringify(body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	const text = await res.text().catch(() => "");
	if (!res.ok) throw new Error(`官方接口失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return { raw: text };
	}
}
/** 取凭据与 token（与能力自检同一套链路；凭据**绝不出现在返回值里**） */
async function auth(projectPath) {
	const config = await loadOfficialConfig(projectPath);
	if (!config) throw new Error("该项目尚未配置 AppID / AppSecret，无法同步指令面板");
	const { token } = await fetchAccessToken(config.appId, config.appSecret);
	return {
		token,
		base: apiBase(config.sandbox ?? false)
	};
}
/** 列出某个场景下的所有面板 */
async function listPanels(projectPath, scope) {
	const { token, base } = await auth(projectPath);
	const raw = await officialRequest(token, base, "GET", `/v2/panels?scope=${encodeURIComponent(scope)}`);
	const boxed = Array.isArray(raw) ? void 0 : raw?.data;
	const list = Array.isArray(raw) ? raw : Array.isArray(boxed) ? boxed : boxed?.records ?? raw?.records ?? [];
	return (Array.isArray(list) ? list : []).filter((p) => p && typeof p.panel_id === "string");
}
/**
* 读当前的**自定义菜单**（`GET /v2/menu`，只读）。
*
* 与面板同一个理由：菜单是**远端状态**，图里的 `menu_config` 节点只是"想让它长什么样"，
* 应用不问一次就不知道线上实际是什么。出厂配置清单要显示它，就得有这条只读入口。
*/
async function getMenu(projectPath) {
	const { token, base } = await auth(projectPath);
	const data = await officialRequest(token, base, "GET", "/v2/menu");
	return {
		version: Number(data?.version ?? 0),
		menu: data?.menu ?? null
	};
}
/**
* 条目是否一致（顺序也算 —— 面板里的顺序是用户排的）。
*
* ⚠️ 比较前要**去掉前导斜杠**：真机实测（2026-09-29）平台会把 `name` 的 `/` 去掉
* （我们发 `/骰子`，`list_panels` 查回来是 `骰子`）。不归一化的话，
* "内容已一致就不写"这条永远不成立 —— 每次同步都会白发一个 PUT。
*/
function sameItems(a, b) {
	if (a.length !== b.length) return false;
	const norm = (n) => String(n ?? "").replace(/^\//, "");
	return a.every((x, i) => norm(x.name) === norm(b[i].name) && (x.desc ?? "") === (b[i].desc ?? ""));
}
/** 把一次写操作记进项目的同步日志（追加一行 JSON，便于事后追责） */
function writeLog(projectPath, entry) {
	try {
		const dir = (0, node_path.join)(projectPath, ".qqbat");
		(0, node_fs.mkdirSync)(dir, { recursive: true });
		(0, node_fs.appendFileSync)((0, node_path.join)(dir, "panel_sync.log"), JSON.stringify({
			at: (/* @__PURE__ */ new Date()).toISOString(),
			...entry
		}) + "\n", "utf-8");
	} catch {}
}
/**
* 把面板内容同步到 QQ（**一个场景只保留一个面板**）。
*
* 决策顺序：
*   1. `GET /v2/panels?scope=` 拿该场景现有面板；
*   2. 认领一个（优先 remark 以 `qqbat` 开头的那批里的第一个，否则第一个）；
*   3. 没有 → `POST` 新建；有但内容不同 → `PUT` 覆盖；内容相同 → **什么都不写**；
*   4. 其余同场景面板 → `DELETE`（客户端本来就只显示一个，留着只会让人搞不清哪个在生效）。
*/
async function applyPanel(projectPath, opts) {
	const { token, base } = await auth(projectPath);
	const remark = opts.remark.startsWith("qqbat") ? opts.remark : `${PANEL_REMARK_PREFIX}：${opts.remark}`;
	const existing = await listPanels(projectPath, opts.scope);
	const mine = existing.filter((p) => String(p.panel?.remark ?? "").startsWith(PANEL_REMARK_PREFIX));
	const keeper = (mine.length ? mine : existing)[0];
	const extras = existing.filter((p) => p.panel_id !== keeper?.panel_id);
	const body = {
		scope: opts.scope,
		target_type: "all",
		panel: {
			items: opts.items,
			remark
		}
	};
	const keptItems = keeper?.panel?.items ?? [];
	const changed = !keeper || !sameItems(keptItems, opts.items);
	const deleted = extras.map((p) => p.panel_id);
	const parts = [];
	parts.push(keeper ? changed ? "覆盖" : "内容已一致，不用改" : "新建");
	if (deleted.length) parts.push(`删掉多余的 ${deleted.length} 个`);
	const summary = `${opts.scope}：${parts.join("，")}（${opts.items.length} 条）`;
	if (opts.dryRun) return {
		created: "",
		updated: "",
		deleted,
		changed,
		summary: `[预览] ${summary}`
	};
	let created = "";
	let updated = "";
	if (!keeper) {
		const r = await officialRequest(token, base, "POST", "/v2/panels", body);
		created = String(r?.panel_id ?? "");
	} else if (changed) {
		await officialRequest(token, base, "PUT", `/v2/panels/${keeper.panel_id}`, {
			items: opts.items,
			remark
		});
		updated = keeper.panel_id;
	}
	for (const id of deleted) await officialRequest(token, base, "DELETE", `/v2/panels/${id}`);
	writeLog(projectPath, {
		scope: opts.scope,
		created,
		updated,
		deleted,
		itemCount: opts.items.length,
		summary
	});
	return {
		created,
		updated,
		deleted,
		changed,
		summary
	};
}

export { PANEL_REMARK_PREFIX, REQUEST_TIMEOUT_MS, officialRequest, auth, listPanels, getMenu, sameItems, writeLog, applyPanel };
