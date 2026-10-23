// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";

/** 能力自检：只需要项目路径（凭据与历史 id 都从项目里取） */
var probeCapabilitiesSchema = z.object({ projectPath: z.string().min(1) });

export { probeCapabilitiesSchema };
