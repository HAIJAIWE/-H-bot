// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { z } from "zod";
import { init_paths } from "../services/infra/paths";

/** ConfigApiBinding.whereParamRef 的字面量联合类型 */
var whereParamRefSchema = z.object({
	nodeId: z.string(),
	portId: z.string(),
	literalValue: z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null()
	]).optional()
});
/**
* 配置 API 绑定（与 `src/shared/types/flow.ts` 的 `ConfigApiBinding` 同步）。
*
* ⚠️ 这里的枚举/字段**少一个就会出大事**（踩过两次）：
* 加载项目时用的是 `flowGraphSchema.safeParse(...)` 的**结果**（`services/flow/flow.ts` 的
* `_finalizeFlow(result.data)`），所以
*   1. 枚举里没有的值 → 直接**校验失败、整个画布加载不出来**
*      （实测：`mode: 'query_row'` 加进类型却没加进这里 → 画布报
*      "流程加载失败，画布没有载入内容"）；
*   2. schema 里没有的字段 → 被 Zod 默认 strip 掉、**静默丢失**
*      （实测风险：`order: 'RANDOM()'` 不在 schema 里 → 存一次就没了，
*      "随机遇怪"会退化成"永远第一只怪"，而且不报错）。
* 新增字段时请同时改 `tests/main/schemas/flow.test.ts` 的样本，那里的往返断言会兜住。
*/
var configApiBindingSchema = z.object({
	table: z.string(),
	field: z.string(),
	dbPath: z.string(),
	where: z.string().optional(),
	whereParamRef: whereParamRefSchema.optional(),
	/** query=单字段标量 / query_row=整行对象 / query_all=多行数组 */
	mode: z.enum([
		"query",
		"query_row",
		"query_all"
	]).optional(),
	/** ORDER BY 子句（不含关键字）；`RANDOM()` = 随机取一行 */
	order: z.string().optional()
});
var portSchema = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(["control", "data"]),
	dataType: z.string().optional(),
	required: z.boolean().optional(),
	description: z.string().optional(),
	default: z.unknown().optional()
});
var flowNodeDataSchema = z.object({
	label: z.string(),
	nodeKind: z.string(),
	systemId: z.string().optional(),
	description: z.string().optional(),
	config: z.record(z.string(), z.unknown()),
	inputs: z.array(portSchema),
	outputs: z.array(portSchema)
});
var flowNodeSchema = z.object({
	id: z.string(),
	type: z.enum([
		"trigger",
		"action",
		"logic",
		"data",
		"ai",
		"plugin",
		"custom"
	]),
	position: z.object({
		x: z.number(),
		y: z.number()
	}),
	data: flowNodeDataSchema
});
var flowEdgeSchema = z.object({
	id: z.string(),
	source: z.string(),
	sourcePort: z.string(),
	target: z.string(),
	targetPort: z.string(),
	sourceHandle: z.string().optional(),
	targetHandle: z.string().optional(),
	configApi: configApiBindingSchema.optional()
});
var systemGroupSchema = z.object({
	id: z.string(),
	name: z.string(),
	icon: z.string(),
	description: z.string(),
	chainTriggerIds: z.array(z.string())
});
/** 节点分组（与 NodeGroup 类型同步） */
var nodeGroupSchema = z.object({
	id: z.string(),
	title: z.string(),
	nodeIds: z.array(z.string()),
	collapsed: z.boolean()
});
var flowGraphSchema = z.object({
	schemaVersion: z.string(),
	systems: z.array(systemGroupSchema).default([]),
	nodes: z.array(flowNodeSchema),
	edges: z.array(flowEdgeSchema),
	variables: z.array(z.object({
		id: z.string(),
		name: z.string(),
		dataType: z.string(),
		defaultValue: z.unknown().optional(),
		scope: z.enum(["global", "session"])
	})),
	nodeGroups: z.array(nodeGroupSchema).optional(),
	metadata: z.object({
		name: z.string(),
		version: z.string(),
		// 运行时只有 TS 一种；旧流程文件里的其它字符串在这里静默归一，
		// 不为了"读得动老文件"把历史标识留在类型里。
		runtime: z.literal("typescript").catch("typescript"),
		createdAt: z.string(),
		updatedAt: z.string()
	})
});

export { whereParamRefSchema, configApiBindingSchema, portSchema, flowNodeDataSchema, flowNodeSchema, flowEdgeSchema, systemGroupSchema, nodeGroupSchema, flowGraphSchema };
