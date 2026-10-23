// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import { registerBuiltinEmitters } from "./register";

/** 内置节点发射器注册表 */
var NodeEmitterRegistry = class {
	specs = /* @__PURE__ */ new Map();
	/** 注册发射器 */
	register(spec) {
		if (this.specs.has(spec.kind)) console.warn(`[NodeEmitterRegistry] 发射器 "${spec.kind}" 重复注册，覆盖旧定义`);
		this.specs.set(spec.kind, spec);
	}
	/** 查找发射器 */
	find(kind) {
		return this.specs.get(kind);
	}
	/** 获取所有注册的类型 */
	listAll() {
		return [...this.specs.values()];
	}
	/** 检查是否已注册 */
	has(kind) {
		return this.specs.has(kind);
	}
};
/** 全局单例 */
var _emitterRegistry = null;
function getNodeEmitterRegistry() {
	if (!_emitterRegistry) {
		_emitterRegistry = new NodeEmitterRegistry();
		registerBuiltinEmitters(_emitterRegistry);
	}
	return _emitterRegistry;
}

export { NodeEmitterRegistry, getNodeEmitterRegistry };
