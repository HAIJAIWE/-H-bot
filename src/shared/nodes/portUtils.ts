// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/** 去掉端口上的函数字段，返回可直接进 store / JSON 的普通对象 */
function toPlainPort(port) {
	const { showWhen: _drop, ...rest } = port;
	return rest;
}
/** 批量版本 */
function toPlainPorts(ports) {
	return ports.map((p) => toPlainPort(p));
}

export { toPlainPort, toPlainPorts };
