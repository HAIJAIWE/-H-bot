// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

var createTerminalSchema = z.object({ projectPath: z.string().min(1) });
var writeTerminalSchema = z.object({
	id: z.string().min(1),
	data: z.string()
});
var killTerminalSchema = z.object({ id: z.string().min(1) });

export { createTerminalSchema, writeTerminalSchema, killTerminalSchema };
