// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import { encryptSecret, isEncryptionAvailable, tryDecryptSecret } from "../infra/safeStorage";
import { logger } from "../infra/logger";

/**
* 加密 `ProjectConfig` 里的敏感字段，返回可安全落盘的副本。
*
* ## 两条不能省的规则
*
* 1. **已带 `_encrypted` 标记的段必须原样保留**。`migratePlaintextSecrets` 会把盘上
*    **原始 JSON** 再交回这里保存；那时若把密文当明文又加密一次，用户下次读到的
*    就是乱码 —— 凭证**静默损坏**，且没有任何报错。所以先看标记再决定加不加密。
* 2. 系统不支持 safeStorage 时只能明文落盘（否则用户根本存不进配置），
*    但**必须留一条 warn**：静默降级是最难查的形态（用户以为它是加密的）。
*
* 覆盖 4 处凭据：official.appSecret / ai.apiKey / lark.appSecret / dingtalk.clientSecret。
*
* ## 为什么从 ProjectService 私有方法提成模块级导出（2026-10-01 §9 A1）
*
* 官方适配器 `services/official/`（原 official.ts）过去**自带第二套** isEncryptionAvailable /
* encryptSecret / `_encrypted` 逻辑，于是"怎么加密"有了两份实现：改一处，另一处
* 不会跟着变。规则收到这里之后，ProjectService 与 official 凭据共用同一份 ——
* 这是"一份真相"里**规则唯一**的那一半；另一半是存储位置唯一
* （见 `saveOfficialConfigToProject`）。
*/
/** 解密失败时暂存"原始密文"的字段名（见 `markUndecryptable`） */
var CIPHERTEXT_BACKUP_KEY = "_ciphertext";
/**
* 解密失败时的处置：把**原始密文**挪到 `_ciphertext`，只清空"可用凭据"，并保留 `_encrypted`。
*
* ## 为什么不能"置空了事"（2026-10-02 逐行审查发现的数据丢失缺陷）
*
* 原实现是 `appSecret = ''` + `delete _encrypted`。后果不是"这次读不到"，而是**永久丢失**：
* 之后**任何一次** `saveProjectConfig` —— 启动机器人时的端口回写、AI 配置保存、
* 旧 botType 迁移 —— 都会把这份内存 config 写回盘，而空串不参与加密，
* 于是**盘上的密文被覆盖成空串**。
*
* 而"解密失败"在换机器、用户配置目录变更、DPAPI/safeStorage 暂时不可用时
* **完全可能只是暂时的**，原机上本来还能恢复。清空把它变成了不可逆。
*
* 现在密文留在 `_ciphertext`，由 `restoreBackedUpCiphertext` 在保存时写回 ——
* 盘上密文逐字节不变，而调用方看到的仍是"未配置"（`appSecret === ''`），错误提示照旧清楚。
*/
function markUndecryptable(seg, field) {
	if (!seg || typeof seg !== "object") return;
	const rec = seg;
	rec[CIPHERTEXT_BACKUP_KEY] = rec[field];
	rec[field] = "";
	rec._encrypted = true;
}
/**
* 保存前把 `_ciphertext` 还原回目标字段（并保持 `_encrypted`）。
*
* @returns true = 该段已还原，调用方**不要**再走加密分支
*/
function restoreBackedUpCiphertext(seg, field) {
	if (!seg || typeof seg !== "object") return false;
	const rec = seg;
	const backup = rec[CIPHERTEXT_BACKUP_KEY];
	if (typeof backup !== "string") return false;
	rec[field] = backup;
	rec._encrypted = true;
	delete rec[CIPHERTEXT_BACKUP_KEY];
	return true;
}
function encryptConfigSecret(config) {
	const persisted = { ...config };
	const available = isEncryptionAvailable();
	/** safeStorage 不可用、又确实有明文凭据的段（用于汇总一条 warn） */
	const plaintextSections = [];
	if (restoreBackedUpCiphertext(persisted.official, "appSecret")) {} else if (persisted.official?.appSecret) {
		if (persisted.official._encrypted) {} else if (available) persisted.official = {
			...persisted.official,
			appSecret: encryptSecret(persisted.official.appSecret),
			_encrypted: true
		};
		else plaintextSections.push("official.appSecret");
	}
	if (restoreBackedUpCiphertext(persisted.ai, "apiKey")) {} else if (persisted.ai?.apiKey) {
		if (persisted.ai._encrypted) {} else if (available) persisted.ai = {
			...persisted.ai,
			apiKey: encryptSecret(persisted.ai.apiKey),
			_encrypted: true
		};
		else plaintextSections.push("ai.apiKey");
	}
	if (restoreBackedUpCiphertext(persisted.lark, "appSecret")) {} else if (persisted.lark?.appSecret) {
		if (persisted.lark._encrypted) {} else if (available) persisted.lark = {
			...persisted.lark,
			appSecret: encryptSecret(persisted.lark.appSecret),
			_encrypted: true
		};
		else plaintextSections.push("lark.appSecret");
	}
	if (restoreBackedUpCiphertext(persisted.dingtalk, "clientSecret")) {} else if (persisted.dingtalk?.clientSecret) {
		if (persisted.dingtalk._encrypted) {} else if (available) persisted.dingtalk = {
			...persisted.dingtalk,
			clientSecret: encryptSecret(persisted.dingtalk.clientSecret),
			_encrypted: true
		};
		else plaintextSections.push("dingtalk.clientSecret");
	}
	if (plaintextSections.length > 0) logger.warn(`[project] safeStorage 不可用，以下凭据将以明文写入 project.json（未加密）: ${plaintextSections.join(", ")}`);
	return persisted;
}
/**
* 解密 `ProjectConfig` 里的敏感字段，兼容历史明文（无 `_encrypted` 标记则原样返回）。
* 与 `encryptConfigSecret` 同一套规则、同一处维护（见那里的"为什么导出"）。
*/
function decryptConfigSecret(parsed) {
	if (parsed.official?._encrypted && typeof parsed.official.appSecret === "string") {
		const decrypted = tryDecryptSecret(parsed.official.appSecret);
		if (decrypted) {
			parsed.official = {
				...parsed.official,
				appSecret: decrypted
			};
			delete parsed.official._encrypted;
		} else {
			logger.error(`[project] AppSecret 解密失败: ${parsed.name}（凭证可能已损坏或在其他机器上加密）`);
			markUndecryptable(parsed.official, "appSecret");
		}
	}
	if (parsed.ai?._encrypted && typeof parsed.ai.apiKey === "string") {
		const decrypted = tryDecryptSecret(parsed.ai.apiKey);
		if (decrypted) {
			parsed.ai = {
				...parsed.ai,
				apiKey: decrypted
			};
			delete parsed.ai._encrypted;
		} else {
			logger.error(`[project] AI apiKey 解密失败: ${parsed.name}（凭证可能已损坏或在其他机器上加密）`);
			markUndecryptable(parsed.ai, "apiKey");
		}
	}
	if (parsed.lark?._encrypted && typeof parsed.lark.appSecret === "string") {
		const decrypted = tryDecryptSecret(parsed.lark.appSecret);
		if (decrypted) {
			parsed.lark = {
				...parsed.lark,
				appSecret: decrypted
			};
			delete parsed.lark._encrypted;
		} else {
			logger.error(`[project] 飞书 AppSecret 解密失败: ${parsed.name}（凭证可能已损坏或在其他机器上加密）`);
			markUndecryptable(parsed.lark, "appSecret");
		}
	}
	if (parsed.dingtalk?._encrypted && typeof parsed.dingtalk.clientSecret === "string") {
		const decrypted = tryDecryptSecret(parsed.dingtalk.clientSecret);
		if (decrypted) {
			parsed.dingtalk = {
				...parsed.dingtalk,
				clientSecret: decrypted
			};
			delete parsed.dingtalk._encrypted;
		} else {
			logger.error(`[project] 钉钉 AppSecret 解密失败: ${parsed.name}（凭证可能已损坏或在其他机器上加密）`);
			markUndecryptable(parsed.dingtalk, "clientSecret");
		}
	}
	return parsed;
}

export { CIPHERTEXT_BACKUP_KEY, markUndecryptable, restoreBackedUpCiphertext, encryptConfigSecret, decryptConfigSecret };
