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

export { safeRelativePath, readFileSchema, writeFileSchema, listFilesSchema };
