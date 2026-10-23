// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { getCanonicalNodeLabel } from "../../../shared/nodes/catalog/registry";
import { getControlInput, isControlPortName } from "../../../shared/nodes/controlPorts";
import { buildCommandChain } from "../../../shared/nodes/commandChain";
import { buildConfigQueryChain } from "../../../shared/nodes/configQueryChain";
import { SUBFLOW_TEMPLATE_DATA } from "../../../shared/nodes/subflowTemplateData";
import { NODE_CATALOG_V2 } from "../../../shared/nodes/builtinCatalog";
import { getNodeRegistry } from "../../nodes/registry";
import { registerAllBuiltinNodes } from "../../nodes/builtin/index";
import { normalizeFlow } from "../../../shared/nodes/flowNormalize";

/**
* ★ **和渲染层读同一份目录**（2026-10-15 探测器抓到的分歧）。
*
* 以前预览里的新节点是「自己拼的骨架」：config 空、没有 description、label 退回 kind。
* 而渲染层走 createNode()，起点是这份目录里的 defaultConfig 与规范名。
* 于是「预览看到的」和「点应用之后得到的」不是同一个东西 ——
* config 缺默认值还会让预览里的校验结论与真实应用不一致。
*
* 现在两边都从 `NODE_CATALOG_V2` 起步（它是共享的单一来源）。
*/
/**
* 把待确认操作叠加到一张图上。
*
* 纯函数：不碰磁盘、不改入参。认不出的操作**如实报出来**（skipped），不静默忽略 ——
* 否则模型会以为"我提的都生效了"。
*/
function applyPendingOperations(base, ops) {
	const graph = structuredClone({
		...base,
		nodes: base.nodes ?? [],
		edges: base.edges ?? []
	});
	const nodes = graph.nodes ?? [];
	const edges = graph.edges ?? [];
	const skipped = [];
	let applied = 0;
	/** 按引用名找节点：tempRef 与真实 id 都能命中 */
	const find = (ref) => nodes.find((n) => n.id === ref);
	/**
	* 目录里**查不到**这个 kind 时的兜底：照抄图里一个同 kind 的现成节点。
	*
	* ⚠️ 只在目录查不到时用（插件节点 / 已从目录移除的节点）。目录查得到就必须以目录为准 ——
	* 渲染层 `createNode()` 只认目录，从不"继承"图里现成节点的配置与备注。
	*
	* 2026-10-15 分歧探测器抓到的漂移：主进程以前**无差别**拿现成节点当模板（add_node 与
	* 三个模板类 op 都是），于是预览里的新节点带着旧节点的 `description`、旧节点的配置，
	* 而用户点应用之后得到的是干净的节点 —— 预览与真应用又不是一张图了。
	*
	* ⚠️ 兜底时也**不要要求它已声明端口**：磁盘上的 flow.json 通常**不写端口**（加载时才由
	* normalizeFlow 补），所以"找带端口的同 kind 节点"几乎永远找不到 —— 实测就是这么
	* 掉进兜底分支、把触发器节点的 `type` 写成了 `action`，于是 `preview_flow` 报"没匹配到"，
	* 模型据此继续重复提交。教训：模板查找的条件要按**真实数据**来定，不是按理想数据。
	*/
	const templateForUnknownKind = (kind) => NODE_CATALOG_V2.some((s) => s.kind === kind) ? void 0 : nodes.find((n) => n.data?.nodeKind === kind);
	/**
	* 造一个"刚被创建"的节点 —— 起点与渲染层 `createNode()` **完全一致**：
	*   · config = 目录 `defaultConfig` 深拷贝 + 本次给出的 config（渲染层也是这个合并顺序）
	*   · label  = 显式给的（真值才认，与渲染层的 `if (label)` 一致），否则目录**规范名**（恒 zh-CN）
	*   · type   = 目录声明的类型（运行时靠它认触发器）
	* 端口留空，交给末尾的 normalizeFlow 按目录补齐。
	*
	* 「两侧各有一份造节点的实现」正是本文件头那个事故的根因（一边认 label、一边不认），
	* 所以现在只留这一处构造：add_node 与 apply_template / new_command / new_lookup 全走它。
	*/
	const makeCatalogNode = (id, kind, seed) => {
		/** 目录里的规范定义（共享来源，与渲染层 createNode 同一份） */
		const spec = NODE_CATALOG_V2.find((s) => s.kind === kind);
		const fallback = templateForUnknownKind(kind);
		/** 起点是目录的 defaultConfig 深拷贝（嵌套对象不能共享引用）；目录查不到才退回现成节点 */
		const baseConfig = spec?.defaultConfig ? structuredClone(spec.defaultConfig) : structuredClone(fallback?.data?.config) ?? {};
		return {
			id,
			type: catalogTypeOf(kind) ?? fallback?.type ?? "action",
			position: {
				x: 0,
				y: 0
			},
			data: {
				label: (seed.label ? seed.label : void 0) ?? getCanonicalNodeLabel(kind) ?? spec?.label ?? fallback?.data?.label ?? kind,
				nodeKind: kind,
				...seed.description ? { description: seed.description } : {},
				config: {
					...baseConfig,
					...seed.config ?? {}
				},
				inputs: [],
				outputs: []
			}
		};
	};
	/**
	* 从**节点目录**取该 kind 的类型（trigger / action / logic / data / ai / custom）。
	*
	* 为什么必须问目录：运行时靠 `node.type === 'trigger'` 判定触发器
	* （FlowInterpreter.ts:176,223）。凭印象默认成 'action' 会让新加的触发器**永远不触发** ——
	* 而且不报错，正是这个仓库最怕的静默失败。
	*/
	const catalogTypeOf = (kind) => {
		try {
			const registry = getNodeRegistry();
			registerAllBuiltinNodes(registry);
			return registry.listAll().find((n) => n.kind === kind)?.type;
		} catch {
			return;
		}
	};
	for (let opIndex = 0; opIndex < ops.length; opIndex += 1) {
		const op = ops[opIndex];
		switch (op.kind) {
			case "add_node":
				nodes.push(makeCatalogNode(op.tempRef, op.nodeKind, {
					label: op.label,
					config: op.config,
					description: op.description
				}));
				applied += 1;
				break;
			case "connect": {
				const src = find(op.sourceRef);
				const dst = find(op.targetRef);
				if (!src || !dst) {
					skipped.push(`connect(${op.sourceRef}→${op.targetRef})：找不到节点`);
					break;
				}
				/**
				* ⚠️ **与渲染层 `flowStore.addEdge` 同一套规则**（2026-10-15 分歧探测器抓到）。
				*
				* 原先这里是硬编码正则 + 只处理「出口不许分叉」—— 而真应用走 addEdge，
				* 它还有第二条规则（**数据入口一个口只能一条**），判定也用共享的
				* `isControlPortName` / `getControlInput`。两份规则不一致的后果：
				* 预览里接对了、点应用之后画布上多出一条线，运行时只有一条会执行。
				* 现在两边都读 `@shared/nodes/controlPorts`。
				*/
				const targetNode = nodes.find((n) => n.id === dst.id);
				let kept = (targetNode ? getControlInput(targetNode)?.portId === op.targetPortId : isControlPortName(op.targetPortId)) ? edges : edges.filter((e) => e.target !== dst.id || e.targetPort !== op.targetPortId);
				if (isControlPortName(op.sourcePortId)) kept = kept.filter((e) => e.source !== src.id || e.sourcePort !== op.sourcePortId);
				edges.length = 0;
				edges.push(...kept);
				edges.push({
					id: `pending-${src.id}-${op.sourcePortId}-${dst.id}-${op.targetPortId}`,
					source: src.id,
					sourcePort: op.sourcePortId,
					target: dst.id,
					targetPort: op.targetPortId
				});
				applied += 1;
				break;
			}
			case "update_config": {
				const node = find(op.nodeRef);
				if (!node) {
					skipped.push(`update_config(${op.nodeRef})：找不到节点`);
					break;
				}
				node.data = {
					...node.data ?? {},
					config: {
						...node.data?.config ?? {},
						...op.config ?? {}
					},
					...op.label ? { label: op.label } : {},
					...op.description ? { description: op.description } : {}
				};
				applied += 1;
				break;
			}
			case "delete_node": {
				const idx = nodes.findIndex((n) => n.id === op.nodeRef);
				if (idx < 0) {
					skipped.push(`delete_node(${op.nodeRef})：找不到节点`);
					break;
				}
				nodes.splice(idx, 1);
				for (let i = edges.length - 1; i >= 0; i -= 1) if (edges[i].source === op.nodeRef || edges[i].target === op.nodeRef) edges.splice(i, 1);
				applied += 1;
				break;
			}
			/**
			* 套片段 / 新建指令：展开成**节点 + 边**再加进来。
			*
			* ⚠️ 不展开的后果正是这个文件头记的那个事故：模型提了改动 → preview_flow 看不到 →
			* 它以为没生效 → 把同一批操作再提一遍（真机重复 3 遍、烧满轮数）。
			* 展开用的是**渲染层同一个纯函数**（@shared/nodes/commandChain）与同一份模板数据，
			* 所以预览图和落盘后的图是同一张。
			*/
			case "new_lookup": {
				const chain = buildConfigQueryChain({
					command: op.command,
					table: op.table,
					dbPath: op.dbPath,
					field: op.field,
					matchField: op.matchField ?? "",
					reply: op.reply
				});
				const baseId = `preview_${opIndex}_lookup_${op.command}`;
				chain.nodes.forEach((def, i) => {
					nodes.push(makeCatalogNode(`${baseId}_${i}`, def.kind, {
						label: def.label,
						config: def.config
					}));
				});
				chain.edges.forEach((e, i) => {
					edges.push({
						id: `${baseId}_e${i}`,
						source: `${baseId}_${e.from}`,
						sourcePort: e.fromPort,
						target: `${baseId}_${e.to}`,
						targetPort: e.toPort
					});
				});
				chain.configApiEdges.forEach((def, i) => {
					const paramNodeId = def.paramRef ? `${baseId}_${def.paramRef.node}` : void 0;
					edges.push({
						id: `${baseId}_cfg${i}`,
						source: "__config_api__",
						sourcePort: "__api__",
						target: `${baseId}_${def.target}`,
						targetPort: def.targetPort,
						configApi: {
							table: def.table,
							field: def.field,
							dbPath: def.dbPath,
							...def.where ? { where: def.where } : {},
							...def.paramRef && paramNodeId ? { whereParamRef: {
								nodeId: paramNodeId,
								portId: def.paramRef.port
							} } : {}
						}
					});
				});
				applied += 1;
				break;
			}
			case "apply_template":
			case "new_command": {
				const chain = op.kind === "apply_template" ? (() => {
					const tpl = SUBFLOW_TEMPLATE_DATA.find((t) => t.id === op.templateId);
					return tpl ? {
						nodes: tpl.nodes,
						edges: tpl.edges
					} : null;
				})() : buildCommandChain({
					command: op.command,
					reply: op.reply,
					...op.dataMode ? { dataMode: op.dataMode } : {},
					...op.dataKey ? { dataKey: op.dataKey } : {}
				});
				if (!chain) {
					const ref = op.kind === "apply_template" ? op.templateId : "new-command";
					skipped.push(`${op.kind}(${ref})：没有这个片段`);
					break;
				}
				const baseId = `preview_${opIndex}_${op.kind === "apply_template" ? op.templateId : "new-command"}`;
				chain.nodes.forEach((def, i) => {
					nodes.push(makeCatalogNode(`${baseId}_${i}`, def.kind, {
						label: def.label,
						config: def.config
					}));
				});
				chain.edges.forEach((e, i) => {
					edges.push({
						id: `${baseId}_e${i}`,
						source: `${baseId}_${e.from}`,
						sourcePort: e.fromPort,
						target: `${baseId}_${e.to}`,
						targetPort: e.toPort
					});
				});
				applied += 1;
				break;
			}
			default: skipped.push(op.kind);
		}
	}
	graph.nodes = nodes;
	graph.edges = edges;
	try {
		const { graph: normalized } = normalizeFlow(graph);
		return {
			graph: normalized,
			applied,
			skipped
		};
	} catch {
		return {
			graph,
			applied,
			skipped
		};
	}
}
/** 给自检工具的返回里附一句说明，让模型知道自己在看什么 */
function pendingNote(overlay) {
	const parts = [`这是**预览图**：已把 ${overlay.applied} 条待用户确认的操作叠加到磁盘流程之上。`];
	if (overlay.skipped.length > 0) parts.push(`（有 ${overlay.skipped.length} 条操作动的是文件而不是图，未包含：${overlay.skipped.join(", ")}）`);
	parts.push("用户点确认后世界才会变成这样；在那之前磁盘流程不变 —— 所以**不要再重复提交同一组操作**。");
	return parts.join("");
}

export { applyPendingOperations, pendingNote };
