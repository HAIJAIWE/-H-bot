// @ts-nocheck
// 由 10/18 打包产物还原（chunk: codegen-DXUm0n0M.js）；见 _recovery/README-recovery.md
import { nextNode } from "./topo";
import { generateBlock } from "./controlFlowEmitter";
import { indentStr, tsLiteral } from "./typescriptUtils";
import { emitDebugPausePrint } from "./expressionSafety";

/**
* 为 send_message 按钮UI模式节点的 btn_xxx 端口生成独立 on_command handler。
*
* 每个按钮端口连接的下游节点链会被编译为一个 on_command matcher，
* 命令名是按钮的 action.data（去掉前缀 /）。
*
* 这样用户在流程中从按钮端口连接到下游步骤，即可实现"点击按钮 → 执行对应事件"，
* 无需手动创建 on_command 触发器。
*/
function generateButtonEventHandlers(graph, dataflow, imports, customCalls, errors, debugMode) {
	const sections = [];
	for (const node of graph.nodes) {
		if (node.data.nodeKind !== "message_send") continue;
		if (node.data.config?.mode !== "keyboard") continue;
		const keyboard = node.data.config?.keyboard;
		if (!keyboard?.rows) continue;
		for (const row of keyboard.rows) {
			if (!row?.buttons) continue;
			for (const btn of row.buttons) {
				if (!btn?.id) continue;
				const next = nextNode(node, `btn_${btn.id}`, graph);
				if (!next) continue;
				const rawData = btn.action?.data ?? "";
				if (!rawData) {
					errors.push(`按钮 "${btn.render_data?.label}" (节点 ${node.id}) 缺少 action.data（命令名），无法生成按钮事件处理器`);
					continue;
				}
				const command = rawData.replace(/^\/+/, "");
				const ctx = {
					dataflow,
					imports,
					customCalls,
					matcherVar: "",
					traceVar: "trace_id",
					errors,
					graph
				};
				sections.push(generateButtonHandler(node, btn, command, next, graph, ctx, debugMode));
			}
		}
	}
	return sections;
}
/**
* 生成单个按钮事件的 on_command matcher + handler。
*
* 生成结构：
*   matcher_btn_<id> = on_command("<command>", priority=10)
*   @matcher_btn_<id>.handle()
*   async def _handle_btn_<id>(bot, event):
*       trace_id = str(uuid.uuid4())
*       _vars = {}
*       <下游节点链代码>
*/
function generateButtonHandler(sendNode, btn, command, firstNode, graph, ctx, debugMode) {
	const triggerId = `${sendNode.id}_${btn.id}`.replace(/[^a-zA-Z0-9_]/g, "_");
	const matcherVar = `matcher_btn_${triggerId}`;
	ctx.matcherVar = matcherVar;
	const matcherDef = `const ${matcherVar} = onCommand(${tsLiteral(command)});\n`;
	const handlerSig = `async function ${`_handle_btn_${triggerId}`}(ctx: FlowContext, event: TriggerEvent): Promise<void>`;
	const bodyLines = [];
	const traceVar = "trace_id";
	ctx.traceVar = traceVar;
	bodyLines.push(`${indentStr(1)}const ${traceVar} = randomUUID();`);
	bodyLines.push(`${indentStr(1)}const _vars: Record<string, unknown> = {};  // 节点变量上下文`);
	if (debugMode) bodyLines.push(emitDebugPausePrint(indentStr(1), sendNode.id, sendNode.data.label, traceVar));
	bodyLines.push(generateBlock(firstNode, graph, ctx, 1, debugMode));
	return `${matcherDef}${handlerSig} {\n${bodyLines.join("\n")}\n}\n`;
}

export { generateButtonEventHandlers, generateButtonHandler };
