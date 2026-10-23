// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as electron from "electron";
import { readOfficialConfigFromProject, saveOfficialConfigToProject } from "../bot/officialConfigIo";
import { emitSystemLog } from "../runner/runtimeEvents";
import * as path from "path";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import { decryptConfigSecret } from "../project/configSecrets";
import { init_paths, legacyUserDataPath, userDataPathOrThrow } from "../infra/paths";

function appDataDir() {
	return userDataPathOrThrow("officialConfig", electron.app);
}
/**
* 保存官方适配器配置。
*
* ## 落盘位置只有一处（2026-10-01 §9 A1）
*
* 旧实现在 `appDataDir()` 下另写一份 `<base64url(项目路径)>.json`，并**自带一套**
* isEncryptionAvailable/encryptSecret/`_encrypted` 逻辑。于是凭据有两个来源：
* 项目配置界面读的是 `project.json`，而运行期读的是这里 —— 界面显示的和实际用的对不上；
* 更糟的是纯 Node（Docker / SSH 无头）里根本没有 `app.getPath('userData')`，
* 部署路径**写不进也读不到**桌面写下的那份。
*
* 现在唯一权威源 = `<项目>/.qqbat/project.json`，加密规则与其它平台凭据共用同一份
* （project.ts 的 `saveOfficialConfigToProject`）。旧位置由
* `loadOfficialConfig` 一次性迁移，这里不再写任何第二份。
*/
async function saveOfficialConfig(projectPath, config) {
	await saveOfficialConfigToProject(projectPath, {
		appId: config.appId,
		appSecret: config.appSecret,
		sandbox: config.sandbox,
		wsUrl: config.wsUrl
	});
}
/**
* 解析 `QQ_SANDBOX` 这类布尔开关。
*
* 非法值（`QQ_SANDBOX=maybe`）返回 `undefined` 而不是猜一个 —— 猜错会把机器人接到
* 生产网关上（沙箱/正式是两个完全不同的域名），这种错误代价太高。
*/
function parseSandboxFlag(raw) {
	if (raw === void 0) return void 0;
	const v = raw.trim().toLowerCase();
	if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
	if (v === "0" || v === "false" || v === "no" || v === "off" || v === "") return false;
}
/**
* 从环境变量读官方适配器配置（远程 / 无头部署的唯一凭据来源）。
*
* ## 为什么需要它（2026-10-01 架构评估 P0-1）
*
* 原来的 `loadOfficialConfig` 只读 `app.getPath('userData')` 下的加密 JSON。而 Docker /
* SSH 部署跑在纯 Node 里：既没有 Electron 的 userData，也没有 safeStorage（Linux 上
* `appSecret` 根本解不开）。于是 `.env.example` 让用户填的 `QQ_APP_ID` / `QQ_APP_SECRET`
* **全仓无人读取** —— 容器永远报"未配置 AppID 和 AppSecret"，而用户明明填了。
*
* ## 语义
*
* · 只有 appId 与 appSecret **都**非空时才认 env；只填一个时明确告警并回退本地文件，
*   避免"半配置"被当成有效配置去连官方网关。
* · `QQ_SANDBOX` 合法时才覆盖，非法值忽略（见 `parseSandboxFlag`）。
*/
function officialConfigFromEnv(env = process.env) {
	const appId = (env.QQ_APP_ID ?? "").trim();
	const appSecret = (env.QQ_APP_SECRET ?? "").trim();
	if (appId && appSecret) {
		const sandbox = parseSandboxFlag(env.QQ_SANDBOX);
		return sandbox === void 0 ? {
			appId,
			appSecret
		} : {
			appId,
			appSecret,
			sandbox
		};
	}
	if (appId || appSecret) emitSystemLog("", "官方适配器只配置了 QQ_APP_ID / QQ_APP_SECRET 中的一个，已忽略环境变量并回退本地配置文件", "warn");
	return null;
}
/**
* 旧位置（appDataDir）里该项目的配置文件路径；`app` 不可用时抛错，调用方必须 try/catch。
*
* 双读（P4.3）：凭据目录从 `qqbat-data/official` 搬到了 `config/official`，迁移是
* "只复制不删除"的。这里优先新位置，**回落旧位置** —— 迁移失败（磁盘/权限）时
* 用户不会因为"新目录是空的"就被判定为未配置，凭据仍能从老地方读回来。
*/
function legacyOfficialConfigFile(projectPath) {
	const name = `${Buffer.from(projectPath).toString("base64url")}.json`;
	const current = (0, path.join)(appDataDir(), name);
	if ((0, fs.existsSync)(current)) return current;
	const legacyDir = legacyUserDataPath("officialConfig", electron.app);
	if (legacyDir) {
		const legacy = (0, path.join)(legacyDir, name);
		if ((0, fs.existsSync)(legacy)) return legacy;
	}
	return current;
}
/**
* 文件里的 sandbox 允许被 env 覆盖：容器/远程不方便改加密配置，
* 但沙箱与正式是两个完全不同的官方域名，切换必须能只靠环境变量完成。
*/
function withEnvSandbox(config) {
	const envSandbox = parseSandboxFlag(process.env.QQ_SANDBOX);
	if (envSandbox === void 0) return config;
	return {
		...config,
		sandbox: envSandbox
	};
}
/**
* 读旧位置（appDataDir）里的官方配置。2026-10-01 §9 A1 之后它只是**迁移来源**。
*
* 解密不在这里另写一份：包成 `official` 段后交给 project.ts 的 `decryptConfigSecret`，
* 与 `project.json` 走的是同一套 `_encrypted` 规则（含"解不开就置空并报错"）。
*/
async function readLegacyOfficialConfig(projectPath) {
	let file;
	try {
		file = legacyOfficialConfigFile(projectPath);
	} catch {
		return null;
	}
	if (!(0, fs.existsSync)(file)) return null;
	let raw;
	try {
		raw = JSON.parse(await (0, fs_promises.readFile)(file, "utf-8"));
	} catch {
		emitSystemLog(projectPath, "官方适配器旧配置文件不是合法 JSON，已忽略", "warn");
		return null;
	}
	const storedSecret = typeof raw.appSecret === "string" ? raw.appSecret : "";
	const decrypted = decryptConfigSecret({
		name: (0, path.basename)(projectPath),
		official: {
			appId: raw.appId ?? "",
			appSecret: storedSecret,
			sandbox: raw.sandbox,
			wsUrl: raw.wsUrl,
			_encrypted: raw._encrypted
		}
	}).official;
	const config = {
		appId: decrypted?.appId ?? "",
		appSecret: decrypted?.appSecret ?? "",
		sandbox: decrypted?.sandbox,
		wsUrl: decrypted?.wsUrl
	};
	return {
		config,
		file,
		decryptFailed: raw._encrypted === true && storedSecret !== "" && config.appSecret === ""
	};
}
/**
* 把旧位置的配置**一次性**搬进 `<项目>/.qqbat/project.json`。
*
* ## 幂等怎么保证
*
* 搬完立刻删旧文件：第二次调用连旧文件都找不到，自然一个字节都不写。
*
* ## 失败为什么不能连累读取
*
* 调用方已经拿到了旧配置的值，写盘失败只是"这次没搬成"；旧文件必须留着（下次启动再试），
* 否则就成了"迁移失败 + 数据丢失"。
*/
async function migrateLegacyOfficialConfig(projectPath, legacy) {
	if (legacy.decryptFailed) {
		emitSystemLog(projectPath, "官方适配器旧凭据解密失败（换机器或系统不支持安全存储），保留旧文件不迁移", "error");
		return;
	}
	if (!(0, fs.existsSync)(projectPath)) return;
	try {
		await saveOfficialConfigToProject(projectPath, legacy.config);
		await (0, fs_promises.rm)(legacy.file, { force: true });
		emitSystemLog(projectPath, "官方适配器凭据已从旧位置迁移到 .qqbat/project.json", "info");
	} catch (e) {
		emitSystemLog(projectPath, `官方适配器凭据迁移失败（已回退读取旧文件）: ${e instanceof Error ? e.message : String(e)}`, "warn");
	}
}
async function loadOfficialConfig(projectPath) {
	const fromEnv = officialConfigFromEnv();
	if (fromEnv) return fromEnv;
	const fromProject = await readOfficialConfigFromProject(projectPath);
	if (fromProject?.appId && fromProject.appSecret) return withEnvSandbox(fromProject);
	const legacy = await readLegacyOfficialConfig(projectPath);
	if (legacy) {
		await migrateLegacyOfficialConfig(projectPath, legacy);
		return withEnvSandbox(legacy.config);
	}
	return null;
}

export { appDataDir, saveOfficialConfig, parseSandboxFlag, officialConfigFromEnv, legacyOfficialConfigFile, withEnvSandbox, readLegacyOfficialConfig, migrateLegacyOfficialConfig, loadOfficialConfig };
