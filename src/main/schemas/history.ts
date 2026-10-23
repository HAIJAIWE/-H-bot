// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

var historyListSchema = z.object({ projectPath: z.string().min(1) });
var historyRestoreSchema = z.object({
	projectPath: z.string().min(1),
	fileName: z.string().min(1)
});
var historyEntrySchema = z.object({
	projectPath: z.string().min(1),
	fileName: z.string().min(1)
});

export { historyListSchema, historyRestoreSchema, historyEntrySchema };
