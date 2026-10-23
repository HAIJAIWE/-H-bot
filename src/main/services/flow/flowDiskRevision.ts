// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as fs_promises from "fs/promises";
import { normalizeProjectPath } from "../project/activeProject";

/** projectPath(规范化) → "mtimeMs:size" */
var knownRevisions = /* @__PURE__ */ new Map();
/** 读磁盘上某个文件的版本指纹；不存在 / 读不到返回 null（= 无法证明，调用方据此 fail-open） */
async function readFlowDiskRevision(filePath) {
	try {
		const st = await (0, fs_promises.stat)(filePath);
		return `${st.mtimeMs}:${st.size}`;
	} catch {
		return null;
	}
}
/** 登记"这一版是主进程自己读/写出来的"；revision 为 null 表示文件不存在 → 清掉记录 */
function noteFlowDiskRevision(projectPath, revision) {
	const key = normalizeProjectPath(projectPath);
	if (revision === null) knownRevisions.delete(key);
	else knownRevisions.set(key, revision);
}
/** 读一次磁盘并登记为已知版本（写入点用） */
async function noteFlowDiskRevisionFromDisk(projectPath, filePath) {
	noteFlowDiskRevision(projectPath, await readFlowDiskRevision(filePath));
}
/** 主进程上次登记的版本；undefined = 还没登记过（fail-open） */
function getKnownFlowDiskRevision(projectPath) {
	return knownRevisions.get(normalizeProjectPath(projectPath));
}

export { knownRevisions, readFlowDiskRevision, noteFlowDiskRevision, noteFlowDiskRevisionFromDisk, getKnownFlowDiskRevision };
