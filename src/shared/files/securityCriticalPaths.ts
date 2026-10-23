// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/**
* 清单（框架根相对路径）。
*
* 加条目时请自问：**改它会不会让某条安全规则变薄？** 会 → 加；只是"重要" → 不加。
*/
var SECURITY_CRITICAL_FILES = [
	{
		path: "src/shared/files/securityCriticalPaths.ts",
		why: "★ 清单自己 —— 删掉或放宽它等于关掉这份告警"
	},
	{
		path: "src/main/services/infra/pathGuard.ts",
		why: "路径与禁区守卫生体（路径穿越 / .git / node_modules / out / dist 全在这里判）"
	},
	{
		path: "src/main/services/infra/fileOps.ts",
		why: "写前强制备份与禁区检查的**接线处**（拆掉那两行 = 护栏静默失效）"
	},
	{
		path: "src/main/services/devBackup/",
		why: "框架模式开关 / 框架根判定 / 写前备份与回滚整块（改薄它 = 回退点不可信）"
	},
	{
		path: "src/main/ipc/file.ts",
		why: "文件 IPC 的边界（禁区、备份、框架工作区放行都在这条通道上接线）"
	},
	{
		path: "src/main/schemas/file.ts",
		why: "文件 IPC 的载荷校验（.. 与空字符在这里先拦一道）"
	},
	{
		path: "src/main/schemas/ai.ts",
		why: "ai:chat 的模式值域 —— 2026-10-15 漏改它导致\"某个模式发送被静默拒绝\""
	},
	{
		path: "src/shared/files/readOnlyPaths.ts",
		why: "编辑器\"应用管理的文件只读\"规则（放宽 = 会被应用整体覆盖的文件可被随手改）"
	},
	{
		path: ".gitignore",
		why: ".dev-backups/ 的忽略规则（删掉 = 回退点会被 git 收走）"
	}
];
/**
* 归一化：统一分隔符、去掉前导 `./`、折叠多余 `/`、转小写。
*
* 转小写是为了 Windows（文件系统大小写不敏感）；清单本身一律小写。
*/
function normalizeSecurityPath(relativePath) {
	return relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").toLowerCase();
}
/**
* 命中清单吗？返回**命中的那一条**（带上"为什么"），没命中返回 null。
*
* 匹配规则（与 `shared/files/readOnlyPaths.ts` 同一套约定）：
*   · 以 `/` 结尾 = **目录前缀**（`src/main/services/devBackup/` 覆盖整个模块，含将来新增的文件）；
*   · 其余 = **精确匹配**整条路径（不是前缀 —— 否则 `schemas/ai.ts.bak` 之类会被误判）。
*/
function securityCriticalEntryFor(relativePath, files = SECURITY_CRITICAL_FILES) {
	const p = normalizeSecurityPath(relativePath);
	if (!p) return null;
	for (const entry of files) {
		const target = normalizeSecurityPath(entry.path);
		if (!target) continue;
		if (target.endsWith("/")) {
			if (p === target.slice(0, -1) || p.startsWith(target)) return entry;
		} else if (p === target) return entry;
	}
	return null;
}

export { SECURITY_CRITICAL_FILES, normalizeSecurityPath, securityCriticalEntryFor };
