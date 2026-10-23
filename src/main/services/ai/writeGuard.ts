// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { isAppManagedReadOnly } from "../../../shared/files/readOnlyPaths";

/** 归一化相对路径：统一分隔符、去掉前导 ./、Windows 下大小写不敏感 */
function normalizeRelPath(relPath) {
	return relPath.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").toLowerCase();
}
/** projectPath → 本会话读过的文件集合 */
var observed = /* @__PURE__ */ new Map();
/** 记下"模型读过这个文件"（由 read_code / read_file 调用） */
function noteFileRead(projectPath, relPath) {
	const key = normalizeRelPath(relPath);
	if (!key) return;
	let set = observed.get(projectPath);
	if (!set) {
		set = /* @__PURE__ */ new Set();
		observed.set(projectPath, set);
	}
	set.add(key);
}
/** 这个文件本会话读过吗 */
function hasReadFile(projectPath, relPath) {
	return observed.get(projectPath)?.has(normalizeRelPath(relPath)) ?? false;
}
/** 清掉某个项目的观察记录（关项目 / 清空对话时调用） */
function resetObservedFiles(projectPath) {
	if (projectPath) observed.delete(projectPath);
	else observed.clear();
}
/**
* 检查一批待确认操作里的写文件动作。
*
* @param existsOnDisk 判断相对路径在磁盘上是否已存在（由调用方注入，便于测试与复用）
* @returns 拒绝原因；**全部允许时返回 null**
*/
function denialForWrites(projectPath, ops, existsOnDisk) {
	for (const op of ops) {
		if (op.kind !== "write_code" && op.kind !== "write_file" || !op.filePath) continue;
		const rel = op.filePath;
		if (!existsOnDisk(rel)) continue;
		if (!hasReadFile(projectPath, rel)) return `拒绝覆盖 ${rel}：你还没读过它。这个工具是**整文件覆盖**，不看一眼就写会把里面的内容整段抹掉（包括你不认识的部分）。请先用 read_file 读一遍 ${rel}，确认要保留什么，再提出修改。`;
	}
	return null;
}
/**
* **应用自己管理的文件，通用写通道一律不许写**（P0-7）。
*
* ## 为什么单列一条（它和上面那条不是一回事）
*
* 上面那条管的是"覆盖别人的东西之前先看一眼" —— 看一眼就放行了。
* 而 `.qqbat/flow.json` 这类文件**看多少眼都不该从这个通道写**：它是画布的数据源，
* 每次保存都会被**整体重写**，从通用写通道改它 = 绕过"flow.json 只由 flowStore 写"
* 的纪律（今晚真机丢数据的同一类形态），而且下一次画布保存就把改动冲掉。
*
* ## 判据只有一处
*
* 用 `@shared/files/readOnlyPaths` 的 `isAppManagedReadOnly` —— 与**提案路径**
* （proposal.ts 的 write_code case）、**编辑器只读规则**（FileExplorer / CodePanel）
* 是同一个函数、同一份清单。这里再抄一张清单，迟早与画布那边漂移 ——
* 本仓库已经为"两份真源"付过代价。
*
* @returns 拒绝原因（**给外部客户端/模型看的、可执行的一句**）；允许写入时返回 null
*/
function denialForAppManagedWrite(relPath) {
	if (!isAppManagedReadOnly(relPath)) return null;
	return `拒绝写入 ${relPath}：这是**应用自己管理**的文件（画布数据 / 项目元信息 / 生成物），每次保存都由应用整体重写 —— 从这条通用写通道改它，改了也会被冲掉，而且绕开了画布自己的保存与校验。
要改流程请在**画布**上改（或走应用内的提案路径）；本次调用**没有写入任何内容**，别换个写法重试。`;
}

export { normalizeRelPath, observed, noteFileRead, hasReadFile, resetObservedFiles, denialForWrites, denialForAppManagedWrite };
