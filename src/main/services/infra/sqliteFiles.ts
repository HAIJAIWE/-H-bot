// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import * as fs from "fs";

/**
* SQLite 主库与**旁挂文件**（`-wal` / `-shm`）的统一处理。
*
* ## 为什么需要这个文件
*
* 2026-10-18 隔离审计 RT-21：同一件事（「删库时把 -wal/-shm 也删掉」）在本仓库
* 有三套实现 —— `baseSqliteStore.clearAll`、`backupService`、`databaseWrite` 的注释提醒。
* 三套各自演进的结果是：新增一类库时必然漏掉其中一处，而漏掉的后果不是报错，
* 是「删了库文件但旧 WAL 还在，下次建库被旧 WAL 重放污染」这种极难查的现象。
*
* ## 为什么不能只删主文件
*
* WAL 模式下最近的提交可能还在 `-wal` 里。只删 `.db` 会留下孤儿 `-wal/-shm`；
* 之后同路径再建库时，SQLite 会拿旧 WAL 去重放，读到的可能是一半旧一半新的页。
*/
/** WAL 模式下与主库同源的旁挂文件后缀 */
var SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm"];
/** 列出主库 + 实际存在的旁挂文件（不存在的不返回） */
function sqliteFilesOf(dbPath) {
	const files = [dbPath];
	for (const suffix of SQLITE_SIDECAR_SUFFIXES) files.push(dbPath + suffix);
	return files.filter((f) => (0, fs.existsSync)(f));
}
/**
* 删除主库与旁挂文件（best-effort，返回实际删掉的文件）。
*
* 整个过程吞掉错误：调用点都是「清理/覆盖」路径，某个文件被占用时
* 应该继续尝试其它文件，而不是把调用方整个打断。
*
* ⚠️ 调用方必须先关闭/失效该库的连接，否则 Windows 上会 EBUSY。
*/
function removeSqliteFiles(dbPath) {
	const removed = [];
	for (const file of sqliteFilesOf(dbPath)) try {
		(0, fs.unlinkSync)(file);
		removed.push(file);
	} catch {}
	return removed;
}

export { SQLITE_SIDECAR_SUFFIXES, sqliteFilesOf, removeSqliteFiles };
