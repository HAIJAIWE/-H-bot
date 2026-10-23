// src/main/services/ai/flowIndex.ts
//
// 流程图索引（供助手/工具读图）：节点/边/分组/命令词的紧凑索引 + 控制链排序。
// 本文件从 10/18 编译产物还原（原始 TS 快照缺失），逻辑与线上 10/18 版本一致。
// @ts-nocheck
/** 节点的 kind：目录里叫 nodeKind（`type` 只是粗分类 trigger/action/logic/data） */
export function nodeKindOf(node) {
	return String(node?.data?.nodeKind ?? node?.type ?? "未知");
}
/** `id(kind)` —— 索引与控制链里统一用这个形态（测试按 `/^\S+\(.+\)$/` 校验） */
export function labelOf(flow, id) {
	return `${id}(${nodeKindOf(nodeById(flow).get(id))})`;
}
export function nodeById(flow) {
	const m =  new Map();
	for (const n of flow.nodes ?? []) if (n?.id) m.set(n.id, n);
	return m;
}
/**
* 控制边邻接表：`sourceId → [targetId]`（只收**控制流**边）。
*
* 判定依据是**源端口在源节点上的 kind**：`data` 的边是数据流（接的是参数，不是"下一步"）。
* 实测真实项目 422 条边里：196 条 control、212 条 data、**14 条源节点没有端口信息**。
* 那 14 条没有依据可判，按控制边处理（宁可链长一点，也不要漏掉执行顺序）。
*/
export function buildControlAdjacency(flow) {
	const byId = nodeById(flow);
	const adj =  new Map();
	for (const e of flow.edges ?? []) {
		if (!e?.source || !e?.target) continue;
		const outs = byId.get(e.source)?.data?.outputs;
		if (Array.isArray(outs) && outs.length > 0) {
			const port = outs.find((p) => p?.id === e.sourcePort);
			if (port && port.kind !== "control") continue;
		}
		const list = adj.get(e.source);
		if (list) list.push(e.target);
		else adj.set(e.source, [e.target]);
	}
	return adj;
}
/**
* 把一组节点 id 按**控制流顺序**排好。
*
* ⚠️ 必须走图，不能靠 `nodeIds` 的顺序：真实项目里 `nodeGroups[].nodeIds` 是
* **按 id 字母序**存的（`rpg_t` 后面跟 `rpg_bag`、`rpg_bagadd`…），与执行顺序无关。
*/
export function orderChain(flow, ids, adjIn) {
	const adj = adjIn ?? buildControlAdjacency(flow);
	const inSet = new Set(ids);
	const indegree =  new Map();
	for (const id of ids) indegree.set(id, 0);
	for (const id of ids) for (const next of adj.get(id) ?? []) if (inSet.has(next)) indegree.set(next, (indegree.get(next) ?? 0) + 1);
	const heads = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
	const start = heads.length > 0 ? heads : ids;
	const out = [];
	const seen =  new Set();
	const visit = (id) => {
		if (seen.has(id)) return;
		seen.add(id);
		out.push(id);
		for (const next of adj.get(id) ?? []) if (inSet.has(next)) visit(next);
	};
	for (const id of start) visit(id);
	for (const id of ids) visit(id);
	return out;
}
export function buildProjectVocabulary(flow) {
	const vars = (flow.variables ?? []).filter((v) => v && typeof v.id === "string");
	const systems = (flow.systems ?? []).filter((s) => s && typeof s.id === "string");
	const lines = [];
	if (vars.length === 0) lines.push("变量：（还没有声明任何变量）");
	else {
		const shown = vars.slice(0, 60).map((v) => {
			return `${v.name && v.name !== v.id ? `${v.id}(${v.name})` : v.id}${v.dataType ? `:${v.dataType}` : ""}${v.scope ? `[${v.scope === "session" ? "会话" : "全局"}]` : ""}`;
		});
		const more = vars.length > shown.length ? ` …还有 ${vars.length - shown.length} 个` : "";
		lines.push(`变量（${vars.length} 个）：${shown.join("、")}${more}`);
		lines.push("（写变量读写节点时**优先复用上面已有的名字**，别为同一件事新造一个变量）");
	}
	if (systems.length === 0) lines.push("系统：（未分组）");
	else {
		const shown = systems.slice(0, 20).map((s) => {
			const name = s.name ? `${s.name}(${s.id})` : s.id;
			return s.description ? `${name}—${s.description}` : name;
		});
		const more = systems.length > shown.length ? ` …还有 ${systems.length - shown.length} 个` : "";
		lines.push(`系统（${systems.length} 个）：${shown.join("；")}${more}`);
	}
	return lines.join("\n");
}
/**
* 生成结构索引：规模 + 每条指令一行控制链。
*
* **不含任何配置值** —— 那是 `read_flow` 指定 nodeId 时才取的东西。
*/
export function buildFlowIndex(flow, opts = {}) {
	const maxChars = opts.maxChars ?? 7e3;
	const nodes = flow.nodes ?? [];
	const edges = flow.edges ?? [];
	const groups = (flow.nodeGroups ?? []).filter((g) => (g?.nodeIds ?? []).length > 0);
	const adj = buildControlAdjacency(flow);
	const grouped =  new Set();
	for (const g of groups) for (const id of g.nodeIds ?? []) grouped.add(id);
	const ungrouped = nodes.map((n) => n.id).filter((id) => id && !grouped.has(id));
	const commandCount = groups.filter((g) => String(g.title ?? "").startsWith("/")).length;
	const header = `共 ${nodes.length} 个节点 / ${edges.length} 条连线 / ${commandCount} 条指令\n（每条指令一行，\`id(节点类型)\` 按控制流顺序；要配置值请用 read_flow 指定 nodeId）
`;
	const full = [];
	for (const g of groups) {
		const chain = orderChain(flow, (g.nodeIds ?? []).filter((id) => typeof id === "string"), adj).map((id) => labelOf(flow, id)).join("→");
		full.push(`「${g.title ?? g.id ?? "未命名"}」${chain}`);
	}
	if (ungrouped.length > 0) {
		const chain = orderChain(flow, ungrouped, adj).map((id) => labelOf(flow, id)).join("→");
		full.push(`「（未分组）」${chain}`);
	}
	const joined = full.join("\n");
	if (header.length + joined.length <= maxChars) return {
		nodeCount: nodes.length,
		edgeCount: edges.length,
		groupCount: groups.length,
		commandCount,
		index: header + joined
	};
	const lines = [];
	let used = header.length;
	const omittedGroups = [];
	for (let gi = 0; gi < groups.length; gi++) {
		const g = groups[gi];
		const ids = (g.nodeIds ?? []).filter((id) => typeof id === "string");
		for (const keep of [
			ids.length,
			6,
			3
		]) {
			const chain = orderChain(flow, ids, adj).map((id) => labelOf(flow, id));
			const head = chain.slice(0, keep).join("→");
			const rest = keep < chain.length ? `…（共 ${chain.length} 个节点）` : "";
			const line = `「${g.title ?? g.id ?? "未命名"}」${head}${rest}`;
			if (used + line.length + 1 <= maxChars) {
				lines.push(line);
				used += line.length + 1;
				break;
			}
			if (keep === 3) omittedGroups.push(String(g.title ?? g.id ?? ""));
		}
	}
	if (omittedGroups.length > 0) lines.push(`…（另有 ${omittedGroups.length} 条指令未列出：${omittedGroups.join("、")}）`);
	return {
		nodeCount: nodes.length,
		edgeCount: edges.length,
		groupCount: groups.length,
		commandCount,
		index: header + lines.join("\n")
	};
}
/** 解析 flow.json；坏数据不该让工具抛出去 —— 返回 null 由调用方给出可读结果 */
export function parseFlow(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		return parsed;
	} catch {
		return null;
	}
}
