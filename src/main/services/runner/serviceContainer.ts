// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { botManager } from "../bot/botManager";
import { FlowService } from "../flow/flow";
import { historyService } from "../flow/history";
import { init_logger, logger } from "../infra/logger";
import { ProjectService } from "../project/project";
import { CodegenService } from "../flow/codegen";

/** 创建类型安全的服务键 */
function createServiceKey(name) {
	return name;
}
/** 预定义的服务键 */
var SERVICE_KEYS = {
	PROJECT_SERVICE: createServiceKey("ProjectService"),
	FLOW_SERVICE: createServiceKey("FlowService"),
	CODEGEN_SERVICE: createServiceKey("CodegenService"),
	HISTORY_SERVICE: createServiceKey("HistoryService"),
	BOT_MANAGER: createServiceKey("BotManager")
};
var ServiceContainer = class {
	services = /* @__PURE__ */ new Map();
	resolving = /* @__PURE__ */ new Set();
	/** 注册单例服务 */
	registerSingleton(key, factory) {
		this.services.set(key, {
			factory,
			lifetime: "singleton"
		});
	}
	/** 注册瞬态服务（每次获取新实例） */
	registerTransient(key, factory) {
		this.services.set(key, {
			factory,
			lifetime: "transient"
		});
	}
	/** 注册已有实例 */
	registerInstance(key, instance) {
		this.services.set(key, {
			factory: () => instance,
			lifetime: "singleton",
			instance
		});
	}
	/** 获取服务实例（类型安全） */
	get(key) {
		const registration = this.services.get(key);
		if (!registration) throw new Error(`Service not registered: ${key}`);
		if (registration.lifetime === "singleton" && registration.instance) return registration.instance;
		if (this.resolving.has(key)) throw new Error(`Circular dependency detected: ${key}`);
		this.resolving.add(key);
		try {
			const instance = registration.factory(this);
			if (registration.lifetime === "singleton") registration.instance = instance;
			return instance;
		} finally {
			this.resolving.delete(key);
		}
	}
	/** 检查服务是否已注册 */
	has(key) {
		return this.services.has(key);
	}
	/** 清理所有单例实例 */
	dispose() {
		for (const [, registration] of this.services) if (registration.instance && typeof registration.instance === "object" && "dispose" in registration.instance) try {
			registration.instance.dispose();
		} catch (e) {
			logger.warn(`[ServiceContainer] 释放服务失败:`, e);
		}
		this.services.clear();
	}
};
/** 创建并配置默认容器 */
function createDefaultContainer(baseDir) {
	const container = new ServiceContainer();
	container.registerInstance(SERVICE_KEYS.BOT_MANAGER, botManager);
	container.registerSingleton(SERVICE_KEYS.PROJECT_SERVICE, (_c) => {
		const service = new ProjectService(baseDir);
		botManager.setBaseDir(baseDir);
		botManager.setProjectService(service);
		return service;
	});
	container.registerSingleton(SERVICE_KEYS.FLOW_SERVICE, (_c) => {
		return new FlowService(baseDir);
	});
	container.registerSingleton(SERVICE_KEYS.CODEGEN_SERVICE, (_c) => {
		return new CodegenService(baseDir);
	});
	container.registerSingleton(SERVICE_KEYS.HISTORY_SERVICE, (_c) => {
		historyService.setBaseDir(baseDir);
		return historyService;
	});
	return container;
}
/** 全局容器实例（懒初始化） */
var globalContainer = null;
// baseDir 可选：只在懒初始化时需要；容器已初始化后调用方不必再传（main/index.ts:120 即这种用法）。
function getGlobalContainer(baseDir?: string) {
	if (!globalContainer) {
		if (!baseDir) throw new Error("Global container not initialized. Call initializeGlobalContainer first.");
		globalContainer = createDefaultContainer(baseDir);
	}
	return globalContainer;
}
function initializeGlobalContainer(baseDir) {
	globalContainer = createDefaultContainer(baseDir);
	return globalContainer;
}
function disposeGlobalContainer() {
	if (globalContainer) {
		globalContainer.dispose();
		globalContainer = null;
	}
}

export { createServiceKey, SERVICE_KEYS, ServiceContainer, createDefaultContainer, globalContainer, getGlobalContainer, initializeGlobalContainer, disposeGlobalContainer };
