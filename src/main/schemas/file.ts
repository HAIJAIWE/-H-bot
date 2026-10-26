// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

var safeRelativePath = z.string().min(1).refine((p) => !p.includes("..") && !p.includes("\0"), "相对路径不允许包含 .. 或空字符");
var readFileSchema = z.object({
	projectPath: z.string().min(1),
	relativePath: safeRelativePath
});
var writeFileSchema = z.object({
	projectPath: z.string().min(1),
	relativePath: safeRelativePath,
	content: z.string()
});
var listFilesSchema = z.object({
	projectPath: z.string().min(1),
	relativeDir: safeRelativePath.optional()
});
/**
 * `@` 引用的候选检索（第 58 批）。
 *
 * `query` 允许空串（刚打 `@` 时就是空 —— 此时给"目录在前、按名字排"的全量前 20 条），
 * 但 `projectPath` 不能空：检索永远限定在当前项目内，不接受"全盘搜"。
 * 上限 400 字符只挡明显不是路径的输入（真口径在服务层的按 `/` 分叉）。
 */
var searchReferencesSchema = z.object({
	projectPath: z.string().min(1),
	query: z.string().max(400),
	limit: z.number().int().min(1).max(50).optional()
});

export { safeRelativePath, readFileSchema, writeFileSchema, listFilesSchema, searchReferencesSchema };
