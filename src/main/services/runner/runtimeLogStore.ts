// src/main/services/runner/runtimeLogStore.ts
//
// 运行日志环形缓冲（供 read_logs 工具与界面日志面板读）。
// 10/18 时它内联在 previewRunner.ts 里，10/19 拆成独立模块；此处按拆分后的形状还原。
// @ts-nocheck
var buffers =  new Map();
/** 记一条运行日志（由 `ipc/runtime` 的 `onBotLog` 回调调用） */
export function pushRuntimeLog(projectPath, entry) {
	if (!projectPath) return;
	let bucket = buffers.get(projectPath);
	if (!bucket) {
		bucket = {
			entries: [],
			total: 0
		};
		buffers.set(projectPath, bucket);
	}
	bucket.entries.push(entry);
	bucket.total += 1;
	if (bucket.entries.length > 300) bucket.entries.splice(0, bucket.entries.length - 300);
}
/**
* 当前累计条数（绝对序号）。**注入测试消息前**取一次，之后用 `runtimeLogsSince` 只取新增的 ——
* 否则测试结果里会混进一堆历史日志，模型分不清哪条是这次跑出来的。
*/
export function runtimeLogSeq(projectPath) {
	return buffers.get(projectPath)?.total ?? 0;
}
/** 取绝对序号 `seq` **之后**产生的日志（缓冲区被裁剪过也能算对） */
export function runtimeLogsSince(projectPath, seq) {
	const bucket = buffers.get(projectPath);
	if (!bucket) return [];
	const firstSeq = bucket.total - bucket.entries.length;
	const skip = Math.max(0, seq - firstSeq);
	return bucket.entries.slice(skip);
}
/** 取最近 N 条（时间升序）。没有日志时返回空数组 —— 由调用方给一句可读的解释 */
export function recentRuntimeLogs(projectPath, lines = 50) {
	const entries = buffers.get(projectPath)?.entries ?? [];
	const n = Math.max(1, Math.min(lines, 300));
	return entries.slice(-n);
}
//#endregion
