// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import * as util from "util";
import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import { init_logger, logger } from "../infra/logger";

var execFileAsync = (0, util.promisify)(child_process.execFile);
/**
* 应用自身产生、不该进版本历史的文件。
*
* `.qqbat/flow.json.bak-*` —— 每次保存前的自动备份，真实项目里能躺几十个；
* `.qqbat/history/` —— 同上；
* `.git.cleared-<时间戳>` 目录 —— `clearHistory` 改名留存下来的旧仓库。
* 不忽略它们的话，"有未提交变更"这个信号会一直亮着，用户就不再看它了。
*/
var APP_GITIGNORE_RULES = [
	".qqbat/flow.json.bak-*",
	".qqbat/history/",
	".git.cleared-*/",
	".qqbat/ai-history.jsonl",
	".qqbat/ai-spill/"
];
/** 改写历史前的备份 ref 前缀：旧 tip 挂在这个命名空间下，不进 `git branch` 列表，但可据此回滚 */
var REWRITE_BACKUP_PREFIX = "refs/qqbat/backup/";
/** 自动版本号的形状：v<大版本>.<小版本>（SemVer 的简化形态，够用且一眼看懂） */
var VERSION_TAG_RE = /^v(\d+)\.(\d+)$/;
/**
* 按已有版本号算出下一个建议名：取最大大版本，小版本 +1；一个都没有就从 v1.0 开始。
*
* 为什么不做"自动大版本"：大版本是**语义决定**（不兼容的改动），机器猜不出来 ——
* 所以自动只推进小版本，大版本由用户改名成 v2.0 来表达。
*/
function nextVersionName(existing) {
	let major = 1;
	let minor = -1;
	for (const name of existing) {
		const m = VERSION_TAG_RE.exec(name);
		if (!m) continue;
		const ma = Number(m[1]);
		const mi = Number(m[2]);
		if (ma > major || ma === major && mi > minor) {
			major = ma;
			minor = mi;
		}
	}
	return `v${major}.${minor + 1}`;
}
/** 标签名必须能被 git 接受，且不含空白/特殊字符（否则报错也看不懂） */
function assertValidTagName(name) {
	if (!name.trim()) throw new Error("版本名不能为空");
	if (/[\s~^:?*[\\]/.test(name) || name.startsWith("-") || name.includes("..")) throw new Error(`版本名 ${name} 含非法字符（不能有空格 ~ ^ : ? * [ \\ 、不能以 - 开头）`);
}
/**
* 「工作提交」的 trailer。
*
* ## 它解决什么
* 自动保存是 1.5 秒防抖触发的，**编辑十分钟能产生几十条提交**。实测一个真实项目：
* 45 条提交里 45 条都是 `auto: save flow.json`，没有一条有意义的 —— 于是"提交"这个
* 路标彻底失去作用，用户只能靠时间戳翻历史（2026-10-02 用户提出"架构是不是不对劲"）。
*
* ## 规则
* · **编辑期间**（reason=auto/manual）的所有保存都 **amend 到同一条"工作提交"** 上，
*   它随编辑不断更新，而不是每次保存造一条；
* · **里程碑**（生成代码 / 导出 / 运行前 / 恢复）产生**独立提交**，不带这个 trailer，
*   于是下一次编辑会另起一条工作提交；
* · **打版本（tag）之前必须先定型**（去掉 trailer）—— 否则工作提交被后续 amend 之后，
*   tag 会指向一个被丢弃的旧对象，"回到这个版本"就会还原成错的代码。
*/
var WORKING_TRAILER = "Qqbat-Working: true";
var WORKING_TRAILER_RE = /\n*Qqbat-Working: true\s*$/;
/** 编辑中的说明。不带增删统计 —— 它会被反复 amend，统计没有意义且会闪。 */
function buildWorkingMessage(nextRaw) {
	const next = parseFlowSummary(nextRaw);
	if (!next) return null;
	return `编辑中${next.name && next.name !== "untitled" ? `「${next.name}」` : ""}：${next.nodeIds.size} 节点 · ${next.edgeIds.size} 连线`;
}
/** 去掉工作 trailer（定型 / 拼最终说明时用） */
function stripWorkingTrailer(message) {
	return message.replace(WORKING_TRAILER_RE, "").trimEnd();
}
/** 字段分隔符（NUL）与记录分隔符（0x1e）；提交正文里不会出现这两个 */
var REC_SEP = "";
var FIELD_SEP = "\0";
/** git log 格式：hash/tree/作者/提交者/时间/正文 */
var HISTORY_FORMAT = "--format=%H%x00%T%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B%x1e";
/** `git log` 在「仓库还没有任何提交」时会非零退出 —— 这是**合法空态**，不是故障。 */
function isEmptyRepoError(e) {
	const err = e;
	const text = `${err?.stderr ?? ""} ${err?.message ?? ""}`;
	return /does not have any commits yet|unknown revision|bad default revision|ambiguous argument 'HEAD'/i.test(text);
}
function parseFlowSummary(raw) {
	try {
		const g = JSON.parse(raw);
		const ids = (arr) => new Set((arr ?? []).map((x) => String(x?.id ?? "")).filter(Boolean));
		return {
			name: typeof g.metadata?.name === "string" ? g.metadata.name : "",
			nodeIds: ids(g.nodes),
			edgeIds: ids(g.edges)
		};
	} catch {
		return null;
	}
}
/** 两个 id 集合的增删数量 */
function setIdDelta(prev, next) {
	let added = 0;
	let removed = 0;
	for (const id of next) if (!prev.has(id)) added++;
	for (const id of prev) if (!next.has(id)) removed++;
	return {
		added,
		removed
	};
}
/**
* 触发这次保存的动作 → 说明的前缀。
*
* 为什么必须记：这些提交**机制上**都是"保存流程"，但触发动作完全不同 ——
* 而历史上**只有点「生成代码」才会落盘**（persistenceSlice 的 generateCode 先 saveNow
* 再 codegen；main.tsx 的注释亲口写着"以前只有点生成代码才落盘"），
* 所以用户记忆里那些记录是"生成代码的版本"。加了自动保存之后，两者在历史里长得一模一样。
*/
var REASON_LABEL = {
	auto: "自动保存",
	manual: "保存",
	generate: "生成代码",
	run: "运行前保存",
	other: "保存"
};
function buildAutoMessage(prevRaw, nextRaw, reason) {
	const head = REASON_LABEL[reason] ?? REASON_LABEL.other;
	const next = parseFlowSummary(nextRaw);
	if (!next) return null;
	const label = next.name && next.name !== "untitled" ? `「${next.name}」` : "";
	const size = `${next.nodeIds.size} 节点 · ${next.edgeIds.size} 连线`;
	const prev = prevRaw === null ? null : parseFlowSummary(prevRaw);
	if (!prev) return `${head}${label}：初始版本（${size}）`;
	const n = setIdDelta(prev.nodeIds, next.nodeIds);
	const e = setIdDelta(prev.edgeIds, next.edgeIds);
	if (n.added === 0 && n.removed === 0 && e.added === 0 && e.removed === 0) return `${head}${label}：${size}（参数或文案改动）`;
	const parts = [];
	if (n.added || n.removed) parts.push(`节点 +${n.added}/−${n.removed}`);
	if (e.added || e.removed) parts.push(`连线 +${e.added}/−${e.removed}`);
	return `${head}${label}：${size}（${parts.join("，")}）`;
}
/**
* 把 git 的失败分类。
*
* 抽成**纯函数**是为了能单测：这几类的处理方式完全不同（一类静默降级、
* 一类必须给出可执行的提示、其余记日志），而分支原本藏在 catch 里、
* 只有真去跑 git 才能触发。
*/
function classifyGitFailure(e) {
	const err = e;
	const detail = [err?.stderr, err?.message].map((v) => typeof v === "string" ? v : v == null ? "" : String(v)).filter(Boolean).join(" ").trim();
	if (err?.code === "ENOENT" || /ENOENT|not recognized as an internal|command not found/i.test(detail)) return {
		kind: "git-missing",
		detail
	};
	if (/ignored by one of your \.gitignore/i.test(detail) || /被.{0,20}\.gitignore.{0,10}忽略|已在.{0,20}gitignore/i.test(detail)) return {
		kind: "path-ignored",
		detail
	};
	return {
		kind: "other",
		detail
	};
}
/**
* 同一个项目、同一类失败只告警一次。
*
* 为什么需要：`autoCommit` 挂在**每次保存**后面，而保存很频繁。
* 一个持续存在的故障（比如 flow.json 一直被忽略）会以"每次保存一条"的频率刷爆日志 ——
* 那样"让失败可见"就变成了"让日志不可读"。
*/
var warnedKeys = /* @__PURE__ */ new Set();
function warnOnce(projectPath, kind, message) {
	const key = `${projectPath}::${kind}`;
	if (warnedKeys.has(key)) return;
	warnedKeys.add(key);
	logger.warn(message);
}
/**
* 把 git 故障变成一句**能给人看**的错误。
*
* 历史行为：`log` 的 catch 是 `return []`，注释写着「无提交记录或 git 失败时返回空数组」——
* 把两件完全不同的事折叠成同一个结果。于是「PATH 上没有 git」「仓库损坏」「路径不对」
* 在界面上统统表现为"列表是空的"，用户无从判断。
* 真机反馈（2026-09-21）："git 列表那边不能读" —— 看不到任何原因，只能说不知道怎么回事。
*
* 现在故障一律抛出，经 IPC 的 tryIpcAsync 转成 `{ok:false, error}` 送到前端显示；
* 而「空仓库」仍然安静地返回空数组（那是正常的）。
*
* 这里只给**诊断细节**（git 自己的 stderr + 路径），不带"读取失败"这类动作词 ——
* 动作词由界面按 i18n 补，否则会拼成「无法读取提交历史：读取提交历史失败（…）」这样的叠字。
*/
function gitFailure(e, projectPath) {
	const err = e;
	if (err?.code === "ENOENT") return /* @__PURE__ */ new Error("找不到 git 可执行文件（PATH 上没有 git）");
	const detail = (typeof err?.stderr === "string" ? err.stderr.trim() : "") || err?.message || String(e);
	return /* @__PURE__ */ new Error(`${detail}（项目：${projectPath}）`);
}
var GitService = class {
	/**
	* 在项目目录初始化 git 仓库（如果还没有 .git 目录）
	*/
	async gitInit(projectPath) {
		try {
			const gitDir = (0, path.join)(projectPath, ".git");
			if ((0, fs.existsSync)(gitDir)) return true;
			await execFileAsync("git", ["init"], { cwd: projectPath });
			return true;
		} catch {
			return false;
		}
	}
	/**
	* 自动提交：只 add flow.json 和 src/plugins/ 目录
	*
	* ## 契约：**永不抛异常**，但**也不许静默**
	*
	* 它由 `flow.ts:336` 在保存流程之后调用，而保存用户数据绝不能被 git 拖垮 ——
	* 所以这里不能抛（调用方那圈 try/catch 只是历史遗留）。但原实现是
	* `catch { /* 静默忽略所有 git 错误 *\/ }`，于是：
	*
	*   - git 没装 / 不是仓库 → 合理降级（由返回值表达，不刷日志）
	*   - **`git add` 因为 `.qqbat/flow.json` 被 .gitignore 忽略而失败** →
	*     每一次保存都无声失败，版本历史永远为空，而界面看不出任何异常
	*   - commit 真的失败（权限、hooks、lock 文件残留）→ 同样无声
	*
	* 项目自己在同文件里已经修过同类问题（见 `log` 的注释：
	* 「其余故障一律抛出，让前端看得见」），`HANDOFF.md` 也记过一次"git 静默失败"修复 ——
	* 这里是漏网的第二处。修法保持一致：**分类 + 让失败可见**，
	* 只是可见的载体换成"返回值 + 限流日志"（因为这条路径不能抛）。
	*/
	async autoCommit(projectPath, message, reason = "other") {
		try {
			const gitDir = (0, path.join)(projectPath, ".git");
			if (!(0, fs.existsSync)(gitDir)) await execFileAsync("git", ["init"], { cwd: projectPath });
			try {
				await this.ensureGitignore(projectPath);
			} catch (e) {
				logger.warn(`[git] 写入 .gitignore 失败（不影响本次提交）: ${e instanceof Error ? e.message : String(e)}`);
			}
			const working = reason === "auto" || reason === "manual";
			const amending = working && await this.isWorkingHead(projectPath);
			let msg = message;
			if (!msg) {
				let nextRaw = null;
				try {
					nextRaw = await (0, fs_promises.readFile)((0, path.join)(projectPath, ".qqbat", "flow.json"), "utf-8");
				} catch {
					nextRaw = null;
				}
				if (working) msg = (nextRaw === null ? null : buildWorkingMessage(nextRaw)) ?? `编辑中 @ ${(/* @__PURE__ */ new Date()).toISOString()}`;
				else {
					let prevRaw = null;
					try {
						const { stdout } = await execFileAsync("git", ["show", "HEAD:.qqbat/flow.json"], {
							cwd: projectPath,
							maxBuffer: 33554432
						});
						prevRaw = stdout;
					} catch {
						prevRaw = null;
					}
					msg = (nextRaw === null ? null : buildAutoMessage(prevRaw, nextRaw, reason)) ?? `auto: save flow.json @ ${(/* @__PURE__ */ new Date()).toISOString()}`;
				}
			}
			const finalMsg = working ? `${stripWorkingTrailer(msg)}\n\n${WORKING_TRAILER}` : stripWorkingTrailer(msg);
			const addPaths = [];
			if ((0, fs.existsSync)((0, path.join)(projectPath, ".qqbat", "flow.json"))) addPaths.push(".qqbat/flow.json");
			if ((0, fs.existsSync)((0, path.join)(projectPath, "src", "plugins"))) addPaths.push("src/plugins/");
			if (addPaths.length === 0) return {
				committed: false,
				skipped: "项目里还没有可提交的内容（flow.json 尚未生成）"
			};
			if ((0, fs.existsSync)((0, path.join)(projectPath, ".gitignore"))) addPaths.push(".gitignore");
			await execFileAsync("git", ["add", ...addPaths], { cwd: projectPath });
			const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: projectPath });
			if (!stdout.trim()) return {
				committed: false,
				skipped: "没有需要提交的变更"
			};
			await execFileAsync("git", [
				"commit",
				...amending ? ["--amend"] : [],
				"-m",
				finalMsg
			], {
				cwd: projectPath,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: "qqbat",
					GIT_AUTHOR_EMAIL: "qqbat@local",
					GIT_COMMITTER_NAME: "qqbat",
					GIT_COMMITTER_EMAIL: "qqbat@local"
				}
			});
			return { committed: true };
		} catch (e) {
			const { kind, detail } = classifyGitFailure(e);
			if (kind === "git-missing") return {
				committed: false,
				skipped: "未检测到 git（自动版本历史不可用）"
			};
			warnOnce(projectPath, kind, `[git] 自动提交失败，流程保存不受影响${kind === "path-ignored" ? "（flow.json 被项目 .gitignore 忽略 ⇒ 自动提交永远不会产生提交，版本历史会一直是空的）" : ""}: ${projectPath} — ${detail}`);
			return {
				committed: false,
				error: detail,
				...kind === "path-ignored" ? { skipped: "path-ignored" } : {}
			};
		}
	}
	/**
	* 让项目的 `.gitignore` 覆盖"应用自己产生的文件"。
	*
	* 为什么需要：真实项目里躺着几十个 `flow.json.bak-*` 自动备份，不忽略的话
	* git 状态永远显示"有未提交变更"——于是那个黄点失去意义，用户也就不再看它。
	*
	* 行为约定（由 `tests/main/services/git.test.ts` 锁定）：
	*   - 文件不存在 → 创建；
	*   - **幂等**：已在文件里的规则不重复追加；
	*   - **不覆盖用户已有规则**：只在末尾补缺失项。
	*/
	async ensureGitignore(projectPath) {
		const ignorePath = (0, path.join)(projectPath, ".gitignore");
		let existing = "";
		try {
			existing = await (0, fs_promises.readFile)(ignorePath, "utf-8");
		} catch {
			existing = "";
		}
		const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
		const missing = APP_GITIGNORE_RULES.filter((rule) => !present.has(rule));
		if (missing.length === 0) return;
		const header = existing.trim() ? "" : "# qqbat：应用自身产生的文件（不忽略的话「有未提交变更」会一直亮着）\n";
		const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
		await (0, fs_promises.writeFile)(ignorePath, `${existing}${prefix}${header}${missing.join("\n")}\n`, "utf-8");
	}
	/**
	* 读档：把某个历史版本的 flow.json 取回来。
	*
	* 行为约定（由测试锁定）：**任何校验不过就中止、且不碰任何文件** ——
	* 读档本身是"用旧内容覆盖当前内容"，所以宁可拒绝也不能写坏。
	*   - 不是 git 仓库 → 抛错（不做任何事）
	*   - 该版本内容不是合法 JSON → 抛错，不写盘、不备份
	*   - 缺少 `nodes` 数组 → 抛错（避免把坏快照写进项目）
	*   - 成功：先备份当前文件，再写回，最后**追加一条 restore 提交**
	*     （恢复本身也要进历史，否则"恢复错了"不可逆）
	*/
	async restoreFlow(projectPath, hash) {
		const gitDir = (0, path.join)(projectPath, ".git");
		if (!(0, fs.existsSync)(gitDir)) throw new Error("还没有 Git 仓库，请先初始化后再读档");
		const { stdout } = await execFileAsync("git", ["show", `${hash}:.qqbat/flow.json`], { cwd: projectPath });
		let parsed;
		try {
			parsed = JSON.parse(stdout);
		} catch {
			throw new Error("该版本内容不是合法 JSON，已中止（未改动任何文件）");
		}
		const nodes = parsed?.nodes;
		if (!Array.isArray(nodes)) throw new Error("该版本缺少节点数组，已中止（避免把坏快照写进项目）");
		const target = (0, path.join)(projectPath, ".qqbat", "flow.json");
		const backupPath = `${target}.bak-restore-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
		try {
			await (0, fs_promises.copyFile)(target, backupPath);
		} catch {}
		await (0, fs_promises.writeFile)(target, stdout, "utf-8");
		const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], { cwd: projectPath });
		if (statusOut.trim()) {
			await execFileAsync("git", ["add", ".qqbat/flow.json"], { cwd: projectPath });
			await execFileAsync("git", [
				"commit",
				"-m",
				`restore: flow.json @ ${hash.slice(0, 7)}`
			], {
				cwd: projectPath,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: "qqbat",
					GIT_AUTHOR_EMAIL: "qqbat@local",
					GIT_COMMITTER_NAME: "qqbat",
					GIT_COMMITTER_EMAIL: "qqbat@local"
				}
			});
		}
		return {
			nodes: nodes.length,
			backupPath
		};
	}
	/**
	* 清空历史：把 `.git` **改名留存**再重新 init。
	*
	* 为什么是改名而不是 `rm -rf`：列表立刻干净（用户要的效果），
	* 但历史还捞得回来 —— 删历史这种不可逆操作不该一步到位。
	* 流程文件本身不动。
	*/
	async clearHistory(projectPath) {
		const gitDir = (0, path.join)(projectPath, ".git");
		if (!(0, fs.existsSync)(gitDir)) throw new Error("还没有 Git 仓库，无需清空");
		const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
		const archivedPath = (0, path.join)(projectPath, `.git.cleared-${stamp}`);
		await (0, fs_promises.rename)(gitDir, archivedPath);
		await execFileAsync("git", ["init"], { cwd: projectPath });
		return { archivedPath };
	}
	/**
	* 获取最近提交日志
	*/
	async log(projectPath, maxCount = 20) {
		try {
			const { stdout } = await execFileAsync("git", [
				"log",
				`--max-count=${maxCount}`,
				"--format=%H||%ct||%s"
			], { cwd: projectPath });
			if (!stdout.trim()) return [];
			return stdout.trim().split("\n").map((line) => {
				const [hash, unixTs, ...rest] = line.split("||");
				return {
					hash,
					message: rest.join("||"),
					timestamp: (/* @__PURE__ */ new Date(Number(unixTs) * 1e3)).toISOString()
				};
			});
		} catch (e) {
			if (isEmptyRepoError(e)) return [];
			throw gitFailure(e, projectPath);
		}
	}
	/**
	* 获取指定提交的 diff（变更文件列表 + 完整 diff 文本）
	*/
	async diff(projectPath, hash) {
		try {
			const { stdout: filesOut } = await execFileAsync("git", [
				"show",
				"--no-color",
				"--name-only",
				"--format=",
				hash
			], {
				cwd: projectPath,
				maxBuffer: 10485760
			});
			const files = filesOut.trim().split("\n").filter(Boolean);
			const { stdout: patchOut } = await execFileAsync("git", [
				"show",
				"--no-color",
				"--format=commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n    %s%n",
				hash
			], {
				cwd: projectPath,
				maxBuffer: 10485760
			});
			let patch = patchOut;
			const MAX_PATCH = 262144;
			if (patch.length > MAX_PATCH) patch = patch.slice(0, MAX_PATCH) + "\n\n... (diff 过长已截断，完整内容请用 git 命令查看)";
			return {
				files,
				patch
			};
		} catch (e) {
			throw gitFailure(e, projectPath);
		}
	}
	/**
	* 获取仓库状态：分支名、提交数、是否干净
	*/
	async status(projectPath) {
		try {
			const gitDir = (0, path.join)(projectPath, ".git");
			if (!(0, fs.existsSync)(gitDir)) return null;
			const [branchResult, countResult, porcelainResult] = await Promise.all([
				execFileAsync("git", [
					"rev-parse",
					"--abbrev-ref",
					"HEAD"
				], { cwd: projectPath }).catch(() => ({ stdout: "unknown" })),
				execFileAsync("git", [
					"rev-list",
					"--count",
					"HEAD"
				], { cwd: projectPath }).catch(() => ({ stdout: "0" })),
				execFileAsync("git", ["status", "--porcelain"], { cwd: projectPath }).catch(() => ({ stdout: "" }))
			]);
			const branch = branchResult.stdout.trim();
			const commitCount = parseInt(countResult.stdout.trim(), 10) || 0;
			const changes = porcelainResult.stdout.trim().split("\n").filter(Boolean).map((l) => l.trim());
			return {
				branch,
				commitCount,
				clean: changes.length === 0,
				changes
			};
		} catch {
			return null;
		}
	}
	/**
	* 取当前分支的完整提交链（**最旧 → 最新**），带重建所需的全部元数据。
	*
	* 用 NUL / 0x1e 分隔而非 `||`：提交正文是用户可改的多行文本，
	* 任何“看起来不会出现”的字符（含 `||`、换行）都可能出现在里面。
	*/
	async readHistory(projectPath, ref) {
		const { stdout } = await execFileAsync("git", [
			"log",
			"--reverse",
			HISTORY_FORMAT,
			ref
		], {
			cwd: projectPath,
			maxBuffer: 16777216
		});
		return stdout.split(REC_SEP).filter((rec) => rec.trim()).map((rec) => {
			const f = rec.split(FIELD_SEP);
			f[0] = f[0].trimStart();
			const [hash, tree, an, ae, ad, cn, ce, cd] = f;
			return {
				hash,
				tree,
				authorName: an,
				authorEmail: ae,
				authorDate: ad,
				committerName: cn,
				committerEmail: ce,
				committerDate: cd,
				message: f.slice(8).join(FIELD_SEP).trimEnd()
			};
		});
	}
	/**
	* 用 plumbing 重建提交链：**逐条复用原提交的 tree**，只跳过要删的、只改要改的消息。
	*
	* ## 为什么不用 `git rebase` / `git checkout`
	*
	* 那两条都会**改动工作区**。而这个面板是在应用**打开着项目的状态下**用的 ——
	* 工作区里的 `.qqbat/flow.json` 被中途换成历史版本，可能触发渲染层重新加载，
	* 甚至被自动保存再提交一条新记录（等于白删）。
	*
	* `commit-tree` 是纯对象操作：不 checkout、不动 index、不动工作区，**也不可能冲突**
	* （每条提交的 tree 原样复用，根本不存在“应用补丁”这一步）。
	*
	* @returns 新 tip；一条都没保留时返回 null（调用方负责拒绝这种情况）
	*/
	async rebuildChain(projectPath, commits, drop, reword) {
		let newParent = null;
		for (const c of commits) {
			if (drop.has(c.hash)) continue;
			const message = reword && reword.hash === c.hash ? reword.message : c.message;
			const args = [
				"-c",
				"commit.gpgsign=false",
				"commit-tree",
				c.tree
			];
			if (newParent) args.push("-p", newParent);
			args.push("-m", message);
			const { stdout } = await execFileAsync("git", args, {
				cwd: projectPath,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: c.authorName,
					GIT_AUTHOR_EMAIL: c.authorEmail,
					GIT_AUTHOR_DATE: c.authorDate,
					GIT_COMMITTER_NAME: c.committerName,
					GIT_COMMITTER_EMAIL: c.committerEmail,
					GIT_COMMITTER_DATE: c.committerDate
				}
			});
			newParent = stdout.trim();
		}
		return newParent;
	}
	/** 改写前的公共前置：**必须在任何写操作之前**跑完；返回分支名、旧 tip 与完整提交链 */
	async prepareRewrite(projectPath, hashes) {
		if (hashes.length === 0) throw new Error("没有选中任何提交");
		const branch = (await execFileAsync("git", [
			"rev-parse",
			"--abbrev-ref",
			"HEAD"
		], { cwd: projectPath })).stdout.trim();
		if (branch === "HEAD") throw new Error("当前处于游离 HEAD 状态，暂不支持改写历史");
		const tip = (await execFileAsync("git", ["rev-parse", branch], { cwd: projectPath })).stdout.trim();
		const commits = await this.readHistory(projectPath, branch);
		const known = new Set(commits.map((c) => c.hash));
		for (const h of hashes) if (!known.has(h)) throw new Error(`提交 ${h.slice(0, 7)} 不在当前分支的历史里（可能已刷新，请重试）`);
		if (commits.length - new Set(hashes).size <= 0) throw new Error("不能删除全部提交：至少保留一条");
		return {
			branch,
			tip,
			commits
		};
	}
	/** 备份旧 tip，返回 ref 名（改写历史必须留后路 —— 与 clearHistory 改名留存同一纪律） */
	async backupTip(projectPath, tip) {
		const ref = `${REWRITE_BACKUP_PREFIX}${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
		await execFileAsync("git", [
			"update-ref",
			ref,
			tip
		], { cwd: projectPath });
		return ref;
	}
	/** 更新分支引用：带 CAS（旧值 = 改写前的 tip），期间有人提交就整体失败而不是悄悄覆盖 */
	async moveBranch(projectPath, branch, newTip, oldTip) {
		await execFileAsync("git", [
			"update-ref",
			`refs/heads/${branch}`,
			newTip,
			oldTip
		], { cwd: projectPath });
	}
	/** HEAD 是不是"工作提交"（编辑中、可以被后续保存 amend 的那一条） */
	async isWorkingHead(projectPath) {
		try {
			const { stdout } = await execFileAsync("git", [
				"log",
				"-1",
				"--format=%B"
			], { cwd: projectPath });
			return stdout.includes(WORKING_TRAILER);
		} catch {
			return false;
		}
	}
	/**
	* 把当前的工作提交**定型**：去掉 trailer，从此不再被 amend。
	*
	* ⚠️ **打版本之前必须定型**。工作提交会被后续保存 amend（hash 改变），
	* 若它上面已经挂了 tag，amend 之后 tag 仍指向那个被丢弃的旧对象 ——
	* 于是"回到这个版本"还原出的是**错的代码**，而且完全没有报错。
	*/
	async sealWorkingCommit(projectPath) {
		if (!await this.isWorkingHead(projectPath)) return false;
		const { stdout } = await execFileAsync("git", [
			"log",
			"-1",
			"--format=%B"
		], { cwd: projectPath });
		await execFileAsync("git", [
			"commit",
			"--amend",
			"-m",
			stripWorkingTrailer(stdout) || "（无说明）"
		], {
			cwd: projectPath,
			env: {
				...process.env,
				GIT_COMMITTER_NAME: "qqbat",
				GIT_COMMITTER_EMAIL: "qqbat@local"
			}
		});
		return true;
	}
	/** 改写后工作区是否与新 tip 不一致（删掉最新一条时会出现） */
	async isWorktreeDirty(projectPath) {
		const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: projectPath });
		return stdout.trim().length > 0;
	}
	/**
	* 删除若干条提交（**可单条、可多条**）。
	*
	* 被删提交的改动不会“消失”：后继提交的 tree 原样保留，所以删掉一条之后，
	* 它的内容差异会体现在**下一条**提交的 diff 里 —— 这正是“删除一条记录”的语义。
	*/
	async deleteCommits(projectPath, hashes) {
		const { branch, tip, commits } = await this.prepareRewrite(projectPath, hashes);
		const backupRef = await this.backupTip(projectPath, tip);
		const newTip = await this.rebuildChain(projectPath, commits, new Set(hashes), null);
		if (!newTip) throw new Error("不能删除全部提交：至少保留一条");
		await this.moveBranch(projectPath, branch, newTip, tip);
		return {
			rewritten: new Set(hashes).size,
			branch,
			backupRef,
			worktreeDirty: await this.isWorktreeDirty(projectPath)
		};
	}
	/** 重命名一条提交的说明（reword）：只改正文，作者、时间、内容都不动 */
	async rewordCommit(projectPath, hash, message) {
		const trimmed = message.trim();
		if (!trimmed) throw new Error("提交说明不能为空");
		const { branch, tip, commits } = await this.prepareRewrite(projectPath, [hash]);
		const backupRef = await this.backupTip(projectPath, tip);
		const newTip = await this.rebuildChain(projectPath, commits, /* @__PURE__ */ new Set(), {
			hash,
			message: trimmed
		});
		if (!newTip) throw new Error("改写失败：没有生成新的提交链");
		await this.moveBranch(projectPath, branch, newTip, tip);
		return {
			rewritten: 1,
			branch,
			backupRef,
			worktreeDirty: await this.isWorktreeDirty(projectPath)
		};
	}
	/** 列出版本标签（按创建时间从新到旧），并给出下一个建议版本号 */
	async listVersionTags(projectPath) {
		try {
			const { stdout } = await execFileAsync("git", [
				"for-each-ref",
				"refs/tags",
				"--sort=-creatordate",
				"--format=%(refname:short)%00%(*objectname)%00%(objectname)%00%(contents:subject)%00%(creatordate:iso-strict)"
			], {
				cwd: projectPath,
				maxBuffer: 8388608
			});
			const tags = [];
			for (const line of stdout.split("\n")) {
				if (!line.trim()) continue;
				const [name, peeled, objectName, message, timestamp] = line.split("\0");
				if (!name) continue;
				tags.push({
					name,
					hash: peeled || objectName || "",
					message: message ?? "",
					timestamp: timestamp ?? ""
				});
			}
			let headHash = null;
			try {
				headHash = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectPath })).stdout.trim();
			} catch {
				headHash = null;
			}
			return {
				tags,
				next: nextVersionName(tags.map((t) => t.name)),
				headHash
			};
		} catch (e) {
			if (isEmptyRepoError(e)) return {
				tags: [],
				next: nextVersionName([]),
				headHash: null
			};
			throw gitFailure(e, projectPath);
		}
	}
	/**
	* 在 HEAD 上打一个版本标签（生成代码成功时自动调用）。
	*
	* @param name 指定名字；省略则按已有标签自动取下一个（v1.0 → v1.1 → …）
	* @param message 标签说明；省略则用一句默认的
	* @returns 该提交上的版本标签（HEAD 已有版本标签时**直接返回它**，不重复打）
	*/
	async tagVersion(projectPath, name, message) {
		try {
			await this.sealWorkingCommit(projectPath);
			const tip = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectPath })).stdout.trim();
			const { tags } = await this.listVersionTags(projectPath);
			const existing = tags.find((t) => t.hash === tip);
			if (existing) {
				if (name === void 0 || name === existing.name) return existing;
				throw new Error(`当前提交已经是 ${existing.name}，而且没有新的代码改动 —— 同一个提交上不允许起第二个版本名（否则"回到哪个版本"就没有意义了）。请先修改流程并重新生成，或直接「重命名」${existing.name}。`);
			}
			const tagName = name ?? nextVersionName(tags.map((t) => t.name));
			assertValidTagName(tagName);
			if (tags.some((t) => t.name === tagName)) throw new Error(`版本 ${tagName} 已经存在（换一个名字，或删掉旧的那个）`);
			const subject = message ?? `生成代码 · ${(/* @__PURE__ */ new Date()).toISOString()}`;
			await execFileAsync("git", [
				"tag",
				"-a",
				tagName,
				"-m",
				subject,
				tip
			], {
				cwd: projectPath,
				env: {
					...process.env,
					GIT_COMMITTER_NAME: "qqbat",
					GIT_COMMITTER_EMAIL: "qqbat@local"
				}
			});
			return {
				name: tagName,
				hash: tip,
				message: subject,
				timestamp: (/* @__PURE__ */ new Date()).toISOString()
			};
		} catch (e) {
			if (e instanceof Error && !/^fatal:|^error:/i.test(e.message)) throw e;
			throw gitFailure(e, projectPath);
		}
	}
	/** 给一个版本改名（保留它指向的提交与说明） */
	async renameVersionTag(projectPath, oldName, newName) {
		assertValidTagName(newName);
		if (oldName === newName) return;
		const { tags } = await this.listVersionTags(projectPath);
		const target = tags.find((t) => t.name === oldName);
		if (!target) throw new Error(`版本 ${oldName} 不存在（可能已改名或删除，请刷新）`);
		if (tags.some((t) => t.name === newName)) throw new Error(`版本 ${newName} 已经存在`);
		await execFileAsync("git", [
			"tag",
			"-a",
			newName,
			"-m",
			target.message || newName,
			target.hash
		], {
			cwd: projectPath,
			env: {
				...process.env,
				GIT_COMMITTER_NAME: "qqbat",
				GIT_COMMITTER_EMAIL: "qqbat@local"
			}
		});
		await execFileAsync("git", [
			"tag",
			"-d",
			oldName
		], { cwd: projectPath });
	}
	/** 删除一个版本标签（只删标签，提交本身不动） */
	async deleteVersionTag(projectPath, name) {
		const { tags } = await this.listVersionTags(projectPath);
		if (!tags.some((t) => t.name === name)) throw new Error(`版本 ${name} 不存在（可能已被删除，请刷新）`);
		await execFileAsync("git", [
			"tag",
			"-d",
			name
		], { cwd: projectPath });
	}
};
var gitService = new GitService();

export { execFileAsync, APP_GITIGNORE_RULES, REWRITE_BACKUP_PREFIX, VERSION_TAG_RE, nextVersionName, assertValidTagName, WORKING_TRAILER, WORKING_TRAILER_RE, buildWorkingMessage, stripWorkingTrailer, REC_SEP, FIELD_SEP, HISTORY_FORMAT, isEmptyRepoError, parseFlowSummary, setIdDelta, REASON_LABEL, buildAutoMessage, classifyGitFailure, warnedKeys, warnOnce, gitFailure, GitService, gitService };
