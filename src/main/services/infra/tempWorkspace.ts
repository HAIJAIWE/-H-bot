// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import * as fs_promises from "fs/promises";
import * as path from "path";
import * as os from "os";
import { init_logger, logger } from "./logger";

/**
* 临时工作目录的统一入口（P3-3.8）。
*
* ## 为什么需要它
*
* 2026-10-18 隔离审计 RT-17：预览与 SSH 部署各写了一套临时目录逻辑 ——
* 一个用 `mkdtemp`，一个用 `Date.now()` 拼；清理也是两处各自的 `rm`。
* 后果不是功能错误，是**清理容易漏**：部署那份临时目录里装着含 `.env` 凭证的
* 项目快照，漏一次就在系统临时目录里留一份敏感数据。
*
* ## 约定
*
* - 前缀统一 `qqbat-<用途>-`：在系统临时目录里一眼认得出归属；
* - 用 `mkdtemp` 而不是时间戳：并发时时间戳会撞，mkdtemp 不会；
* - 清理集中到 `disposeTempWorkspace`：失败只 warn、不抛（调用点在 finally 里，
*   抛出会盖掉真正的业务错误），但**必须**留日志 —— 凭证残留不能静默。
*/
/**
* 建一个本次运行专属的临时目录。
*
* @param scope 用途（preview / deploy / …），会出现在目录名里
*/
async function createTempWorkspace(scope) {
	const safeScope = scope.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "work";
	return (0, fs_promises.mkdtemp)((0, path.join)((0, os.tmpdir)(), "qqbat-" + safeScope + "-"));
}
/**
* 删除临时目录（best-effort）。
*
* 清理失败**不抛**：调用点都在 finally 里，抛出会盖掉真正的业务错误。
* 但会留一条 warn —— 临时目录里可能有含凭证的项目快照，静默失败不可接受。
*/
async function disposeTempWorkspace(dir) {
	try {
		await (0, fs_promises.rm)(dir, {
			recursive: true,
			force: true
		});
	} catch (e) {
		logger.warn("[temp] 临时目录清理失败（可能残留含凭证的快照）: " + dir, e);
	}
}

export { createTempWorkspace, disposeTempWorkspace };
