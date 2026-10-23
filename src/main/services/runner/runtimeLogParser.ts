// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { debuggerService } from "../ops/debugger";
import { emitBotLog, emitMetricData, emitNodeEvent } from "./runtimeEvents";

/**
* 运行时日志行协议解析。
*
* 迁移说明：这些标记原本由 Python 子进程打印到 stdout，再由 `botProcess.ts`
* 的 stdout 解析器消费。Python 运行时移除后，日志来源改为 TS 运行时
* （`FlowRuntime.onLog` → `botManager`），标记格式作为协议本身保持不变，
* 因此解析逻辑原样移到本模块，使生成代码 / 运行时打印的标记仍能驱动
* 节点事件（指标面板）、`METRIC:` 行（指标收集）与 `[DEBUG:PAUSE:...]`
* （源码级调试暂停）。
*
* 支持的标记：
*   - `[TRACE:<traceId>]`                                   链路追踪 ID
*   - `[NODE:enter|exit|error:<nodeId>]`                    节点执行事件
*   - `[METRIC:msg_count={n},latency={ms}]`                 指标原始行
*   - `[DEBUG:PAUSE:<nodeId>:<label>:<k=v|k=v>]`            调试暂停（含变量快照）
*
* @param projectPath - 项目根路径（日志与事件按项目隔离）
* @param line - 运行时输出的一行日志
*/
function parseRuntimeLogLine(projectPath, line) {
	const traceMatch = line.match(/\[TRACE:([^\]]+)\]/);
	const traceId = traceMatch ? traceMatch[1] : void 0;
	const nodeMatch = line.match(/\[NODE:(enter|exit|error):([^\]]+)\]/);
	if (nodeMatch) {
		emitNodeEvent(projectPath, {
			nodeId: nodeMatch[2],
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			status: nodeMatch[1],
			traceId
		});
		if (nodeMatch[1] === "exit" || nodeMatch[1] === "error") debuggerService.onNodeExit(nodeMatch[2]);
	}
	if (line.includes("[METRIC:")) emitMetricData(projectPath, line);
	const debugPauseMatch = line.match(/\[DEBUG:PAUSE:([^:]+):([^:]*):?(.*)\]/);
	if (debugPauseMatch) {
		const [, nodeId, nodeLabel, varsStr] = debugPauseMatch;
		debuggerService.onNodeHit(nodeId, nodeLabel, parseDebugVars(varsStr));
	}
	emitBotLog(projectPath, line, "info", traceId);
}
/** 解析 `k=v|k=v` 形式的变量快照（无 `=` 时按布尔真值处理） */
function parseDebugVars(varsStr) {
	if (!varsStr) return [];
	return varsStr.split("|").filter(Boolean).map((pair) => {
		const eqIdx = pair.indexOf("=");
		if (eqIdx < 0) return {
			name: pair,
			value: "true",
			type: "bool"
		};
		const name = pair.slice(0, eqIdx);
		const rawValue = pair.slice(eqIdx + 1);
		return {
			name,
			value: rawValue,
			type: typeof rawValue
		};
	});
}

export { parseRuntimeLogLine, parseDebugVars };
