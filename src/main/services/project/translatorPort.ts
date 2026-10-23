// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { SERVICE_KEYS, getGlobalContainer } from "../runner/serviceContainer";
import { init_logger, logger } from "../infra/logger";

async function persistTranslatorPort(projectPath, port) {
	try {
		await getGlobalContainer().get(SERVICE_KEYS.PROJECT_SERVICE).updateTranslatorPort(projectPath, port);
	} catch (e) {
		logger.debug("[translator] 端口回写失败（本次运行不受影响）:", e);
	}
}

export { persistTranslatorPort };
