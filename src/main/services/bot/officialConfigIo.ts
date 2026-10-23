// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs_promises from "fs/promises";
import { decryptConfigSecret, encryptConfigSecret } from "../project/configSecrets";
import { atomicWrite } from "../infra/fileOps";
import { init_logger, logger } from "../infra/logger";

/** project.json 相对项目根的路径 —— 所有项目配置（含 official 凭据）的**唯一**位置 */
function projectConfigPath(projectPath) {
	return (0, path.join)(projectPath, ".qqbat", "project.json");
}
/**
* 读取 `<项目>/.qqbat/project.json` 的 `official` 段（密文已解密）。
*
* "没配置"与"配置坏了"都返回 null，而不是抛错：调用方（官方适配器）本来就要
* 区分"没配 AppID/AppSecret"，一句 `Cannot read ...` 对它没有任何帮助。
*/
async function readOfficialConfigFromProject(projectPath) {
	let raw;
	try {
		raw = await (0, fs_promises.readFile)(projectConfigPath(projectPath), "utf-8");
	} catch {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		logger.error(`[project] project.json 不是合法 JSON，无法读取 official 配置: ${projectPath}`);
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		logger.error(`[project] project.json 顶层不是对象，无法读取 official 配置: ${projectPath}`);
		return null;
	}
	return decryptConfigSecret(parsed).official ?? null;
}
/**
* 把 `official` 段写进 `<项目>/.qqbat/project.json`（**合并式**，加密规则同上）。
*
* ## 为什么是合并式而不是整份 saveProjectConfig
*
* `project.json` 是**多处共写**的文件（翻译器端口、ai 段、adapter、其它平台凭据…）。
* 整文件覆盖是历史事故源，所以这里只替换 `official` 一段；已带 `_encrypted`
* 标记的其它段由 `encryptConfigSecret` 原样保留（规则 1），不会被二次加密。
*/
async function saveOfficialConfigToProject(projectPath, official) {
	const filePath = projectConfigPath(projectPath);
	let base;
	try {
		base = JSON.parse(await (0, fs_promises.readFile)(filePath, "utf-8"));
	} catch (e) {
		throw new Error(`项目缺少 .qqbat/project.json，拒绝写入官方配置（避免造出畸形项目）: ${projectPath}` + (e instanceof Error ? ` —— ${e.message}` : ""));
	}
	const persisted = encryptConfigSecret({
		...base,
		official
	});
	await atomicWrite(filePath, JSON.stringify(persisted, null, 2));
}

export { projectConfigPath, readOfficialConfigFromProject, saveOfficialConfigToProject };
