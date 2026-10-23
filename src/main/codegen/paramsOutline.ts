// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import { getNodeRegistry } from "../nodes/registry";
import { hasCustomValue, isPortApplicable } from "../../shared/nodes/fieldVisibility";
import { indentStr, tsLiteral } from "./typescriptUtils";

/**
* 渲染「当前模式适用、且用户**动过**」的参数清单（一行注释）。
*
* 返回带尾随换行的字符串，方便直接拼在发射器输出**之前**；没有可列的参数时返回空串
* （绝不产出一条空注释 —— 那只会让导出变长而不多给任何信息）。
*/
function renderParamsOutline(node, indent) {
	const kind = node.data?.nodeKind;
	if (!kind) return "";
	let spec;
	try {
		spec = getNodeRegistry().find(kind);
	} catch {
		return "";
	}
	if (!spec) return "";
	const config = node.data?.config ?? {};
	const defaults = spec.defaultConfig ?? {};
	const pairs = [];
	for (const port of spec.inputs ?? []) {
		if (port.kind !== "data") continue;
		if (!isPortApplicable(port, config, defaults)) continue;
		if (!hasCustomValue(config[port.id], defaults[port.id])) continue;
		pairs.push(`${port.id}=${tsLiteral(config[port.id])}`);
	}
	if (pairs.length === 0) return "";
	return `${indentStr(indent)}// 配置参数（当前模式适用）: ${pairs.join(", ")}\n`;
}

export { renderParamsOutline };
