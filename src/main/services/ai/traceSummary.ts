// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

/** 纯函数：绝不抛错（trace 可能有坏数据） */
function summarizeTrace(entries, slowestCount = 5) {
	const llmCalls = entries.filter((e) => e.kind === "llm").length;
	const toolCalls = entries.filter((e) => e.kind === "tool").length;
	const failures = entries.filter((e) => e.ok === false).map((e) => ({
		name: e.name,
		kind: e.kind,
		...e.note ? { note: e.note } : {}
	}));
	const msOf = (entry) => Number.isFinite(entry.ms) ? entry.ms : 0;
	const slowest = [...entries].sort((a, b) => msOf(b) - msOf(a)).slice(0, slowestCount);
	const buckets = /* @__PURE__ */ new Map();
	for (const e of entries) {
		const key = e.kind + ":" + e.name;
		const b = buckets.get(key) ?? {
			name: e.name,
			kind: e.kind,
			count: 0,
			totalMs: 0,
			maxMs: 0
		};
		b.count += 1;
		b.totalMs += Number.isFinite(e.ms) ? e.ms : 0;
		b.maxMs = Math.max(b.maxMs, Number.isFinite(e.ms) ? e.ms : 0);
		buckets.set(key, b);
	}
	const byName = [...buckets.values()].map((b) => ({
		name: b.name,
		kind: b.kind,
		count: b.count,
		avgMs: Math.round(b.totalMs / Math.max(1, b.count)),
		maxMs: b.maxMs
	})).sort((a, b) => b.avgMs - a.avgMs);
	return {
		total: entries.length,
		llmCalls,
		toolCalls,
		failures,
		slowest,
		byName
	};
}
/** 汇总 → 可直接打印的多行文本（表格形式，便于贴进 issue / 复盘） */
function formatTraceSummary(summary, title = "AI trace 汇总") {
	if (summary.total === 0) return title + "：没有记录（这个项目还没跑过对话，或 trace 被清掉了）";
	const lines = [];
	lines.push(title + "：共 " + summary.total + " 步（模型 " + summary.llmCalls + " / 工具 " + summary.toolCalls + "）");
	lines.push("");
	lines.push("按平均耗时排序：");
	for (const row of summary.byName.slice(0, 12)) lines.push("  " + row.kind.padEnd(4) + " " + row.name.padEnd(22) + " ×" + String(row.count).padStart(3) + "  平均 " + String(row.avgMs).padStart(6) + "ms  最慢 " + String(row.maxMs).padStart(6) + "ms");
	if (summary.slowest.length > 0) {
		lines.push("");
		lines.push("最慢的几步：");
		for (const e of summary.slowest) lines.push("  " + String(e.ms).padStart(6) + "ms  " + e.kind + " " + e.name + (e.note ? "  —— " + e.note : ""));
	}
	if (summary.failures.length > 0) {
		lines.push("");
		lines.push("失败 " + summary.failures.length + " 次：");
		for (const f of summary.failures.slice(0, 10)) lines.push("  " + f.kind + " " + f.name + (f.note ? "  —— " + f.note : ""));
	}
	return lines.join("\n");
}

export { summarizeTrace, formatTraceSummary };
