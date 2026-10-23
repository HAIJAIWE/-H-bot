// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

var crashGetReportsSchema = z.object({ count: z.number().int().positive().optional() });
var crashReadReportSchema = z.object({ id: z.string().min(1) });
var safeOutputPath = z.string().min(1).refine((p) => !p.includes("..") && !p.includes("\0") && !/[<>|*&;`$]/.test(p), "输出路径不允许包含 ..、空字符或 shell 特殊字符");
z.object({ outputPath: safeOutputPath });
var crashCaptureSchema = z.object({
	message: z.string(),
	stack: z.string().optional(),
	extra: z.record(z.string(), z.unknown()).optional()
});

export { crashGetReportsSchema, crashReadReportSchema, safeOutputPath, crashCaptureSchema };
