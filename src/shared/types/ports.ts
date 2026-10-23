// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md

/**
* 把基础类型提升为数组类型。
*
* 单独成函数是为了让 TS 在递归推导（如 inferTypeFromConfig）中能收窄返回类型：
* 直接写 `` `${t}[]` `` 在 `t: PortBaseType` 时会被推断为宽泛的 `string`。
*/
function toArrayType(base) {
	if (base === "any") return "any";
	if (base.endsWith("[]")) return base;
	return `${base}[]`;
}
/** 从配置值推导类型 */
function inferTypeFromConfig(value) {
	if (value === null || value === void 0) return "null";
	if (typeof value === "string") return "string";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	if (Array.isArray(value)) {
		if (value.length === 0) return "array";
		return toArrayType(inferTypeFromConfig(value[0]));
	}
	if (typeof value === "object") return "object";
	return "any";
}
/** 标准化端口类型字符串 */
function normalizePortType(type) {
	const t = type.trim().toLowerCase();
	if (t.endsWith("[]")) return toArrayType(normalizePortType(t.slice(0, -2)));
	return {
		str: "string",
		int: "number",
		float: "number",
		bool: "boolean",
		obj: "object",
		arr: "array",
		dt: "datetime",
		evt: "event",
		err: "error",
		none: "null"
	}[t] || t;
}

export { toArrayType, inferTypeFromConfig, normalizePortType };
