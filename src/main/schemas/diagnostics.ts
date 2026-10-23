// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

var exportSchema = z.object({ projectPath: z.string().min(1) });

/**
 * diagnostics:rendererLog 参数：渲染层带来的一行运行日志。
 * 限长是防「整篇控制台塞进 IPC」—— 诊断包要的是线索，不是全文。
 */
const rendererLogSchema = z.object({ line: z.string().min(1).max(4000) });

export { exportSchema, rendererLogSchema };
