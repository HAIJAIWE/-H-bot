// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as path from "path";
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import { historyService } from "./history";
import { flowGraphSchema } from "../../schemas/flow";
import { init_logger, logger } from "../infra/logger";
import { migrateLegacyKinds } from "../../codegen/graphPreprocess";
import { normalizeFlow, validateFlow } from "../../../shared/nodes/flowNormalize";
import { NODE_CATALOG_V2 } from "../../../shared/nodes/builtinCatalog";
import { getSendMessageOutputs } from "../../../shared/types/keyboard";
import { toPlainPorts } from "../../../shared/nodes/portUtils";
import { getKnownFlowDiskRevision, noteFlowDiskRevisionFromDisk, readFlowDiskRevision } from "./flowDiskRevision";
import { assertWithinProject } from "../infra/pathGuard";
import { activeProjectRegistry } from "../project/activeProject";
import { atomicWrite } from "../infra/fileOps";
import { gitService } from "../ops/git";
import { FLOW_SCHEMA_VERSION } from "../../../shared/types/flow";

/**
* 加载判定用的「当前版本」。
*
* 以前这里写死字符串 "1.1"，而 shared/types/flow 的写入方常量另写一份 —— 改一处漏一处的经典坑。
* 现在以 shared 的 `FLOW_SCHEMA_VERSION` 为唯一真相，本文件只做别名导出（测试与迁移共用同一个值）。
*/
const CURRENT_SCHEMA_VERSION = FLOW_SCHEMA_VERSION;

/**
* 校验 flow 中的 edges 是否引用了有效的端口。
* 当 builtinCatalog 中节点的 inputs/outputs 定义变化时，旧 flow.json 中可能引用不存在的端口。
* 清理无效 edges，避免运行时错误和 UI 显示异常。
*/
/** 收集"被现有连线引用到的端口"：迁移清空端口后，靠它把用户接过的线救回来 */
function collectReferencedPorts(flow) {
	const out = /* @__PURE__ */ new Map();
	const get = (id) => {
		if (!out.has(id)) out.set(id, {
			inputs: /* @__PURE__ */ new Set(),
			outputs: /* @__PURE__ */ new Set()
		});
		return out.get(id);
	};
	for (const e of flow.edges) {
		if (e.sourcePort) get(e.source).outputs.add(e.sourcePort);
		if (e.targetPort) get(e.target).inputs.add(e.targetPort);
	}
	return out;
}
/**
* 把"新 spec 里没有、但连线仍然引用"的端口补回节点声明，**从而保住这些连线**。
*
* 为什么不干脆让它们被删掉：那是**用户接好的线** ✗。真实事故（2026-10-03）：
* `variable_persist` 拆分后，新 kind 没有 `result`/`failed` 端口，7 条边被"正确地"删掉，
* 其中 2 个节点变成孤儿、从触发器不可达 —— 用户什么都没做，只是打开了一次项目。
*
* 保留 ≠ 假装它能用：保留的端口会**记进日志**（旧端口名 + 条数），由用户决定改接还是删线。
* 语义映射（`result` 该对应新节点的哪个端口）是**节点拆分的架构决策**，不该由这里猜。
*/
function preserveReferencedPorts(flow, referenced, kindBefore, portsBefore) {
	const keptPorts = [];
	for (const node of flow.nodes) {
		const ref = referenced.get(node.id);
		if (!ref) continue;
		if (kindBefore.get(node.id) === node.data.nodeKind) continue;
		const old = portsBefore.get(node.id);
		const fill = (declared, want, kind) => {
			const ports = [...declared ?? []];
			const have = new Set(ports.map((p) => p.id));
			const prev = kind === "out" ? old?.outputs ?? [] : old?.inputs ?? [];
			for (const id of want) {
				if (!id || have.has(id)) continue;
				ports.push(prev.find((p) => p.id === id) ?? {
					id,
					name: id,
					kind: "data"
				});
				have.add(id);
				keptPorts.push(`${node.data.nodeKind}.${node.id}.${kind}:${id}`);
			}
			return ports;
		};
		const outputs = fill(node.data.outputs, ref.outputs, "out");
		const inputs = fill(node.data.inputs, ref.inputs, "in");
		node.data.outputs = outputs;
		node.data.inputs = inputs;
	}
	return { keptPorts };
}
function sanitizeFlowEdges(flow) {
	const referenced = collectReferencedPorts(flow);
	const kindBefore = new Map(flow.nodes.map((n) => [n.id, n.data.nodeKind]));
	const portsBefore = new Map(flow.nodes.map((n) => [n.id, {
		inputs: [...n.data.inputs ?? []],
		outputs: [...n.data.outputs ?? []]
	}]));
	migrateLegacyKinds(flow);
	flow = normalizeFlow(flow).graph;
	const { keptPorts } = preserveReferencedPorts(flow, referenced, kindBefore, portsBefore);
	if (keptPorts.length > 0) logger.warn(`[sanitizeFlowEdges] 迁移后有 ${keptPorts.length} 个旧端口在新节点上已不存在，连线已**保留**（没有静默断开）。请确认这些线要改接到新端口还是删掉：` + keptPorts.slice(0, 10).join(", ") + (keptPorts.length > 10 ? ` …（共 ${keptPorts.length} 个）` : ""));
	const nodeMap = /* @__PURE__ */ new Map();
	for (const node of flow.nodes) nodeMap.set(node.id, node);
	const getValidPorts = (node) => {
		const spec = NODE_CATALOG_V2.find((n) => n.kind === node.data.nodeKind);
		const inputs = spec?.inputs ?? node.data.inputs;
		const specOutputs = spec?.outputs ?? [];
		const nodeOutputs = node.data.outputs ?? [];
		const outputIds = /* @__PURE__ */ new Set();
		for (const p of specOutputs) outputIds.add(p.id);
		for (const p of nodeOutputs) outputIds.add(p.id);
		if (node.data.nodeKind === "message_send") for (const p of getSendMessageOutputs(node.data.config ?? {})) outputIds.add(p.id);
		return {
			inputIds: new Set(inputs.map((p) => p.id)),
			outputIds
		};
	};
	const portCache = /* @__PURE__ */ new Map();
	for (const node of flow.nodes) portCache.set(node.id, getValidPorts(node));
	const validEdges = flow.edges.filter((edge) => {
		if (edge.source === "__config_api__" && edge.configApi != null) {
			if (!nodeMap.get(edge.target)) return false;
			const targetPorts = portCache.get(edge.target);
			if (!targetPorts) return false;
			if (!targetPorts.inputIds.has(edge.targetPort)) return false;
			return true;
		}
		const sourceNode = nodeMap.get(edge.source);
		const targetNode = nodeMap.get(edge.target);
		if (!sourceNode || !targetNode) return false;
		const sourcePorts = portCache.get(edge.source);
		const targetPorts = portCache.get(edge.target);
		if (!sourcePorts || !targetPorts) return false;
		if (!sourcePorts.outputIds.has(edge.sourcePort)) return false;
		if (!targetPorts.inputIds.has(edge.targetPort)) return false;
		return true;
	});
	const removedCount = flow.edges.length - validEdges.length;
	if (removedCount > 0) logger.warn(`[sanitizeFlowEdges] 清理了 ${removedCount} 条无效 edge（端口 ID 不匹配）`);
	return {
		...flow,
		edges: validEdges
	};
}
var MIGRATIONS = { "1.1": migrateTo1_1 };
/**
* 语义化版本比较（按数字而非字符串比较）。
* 字符串比较在两位版本号时会出错（如 '1.10' < '1.2' 为 true，但语义上 1.10 > 1.2）。
* 返回值：<0 表示 a<b，0 表示相等，>0 表示 a>b。
*/
function compareVersions(a, b) {
	const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const va = pa[i] ?? 0;
		const vb = pb[i] ?? 0;
		if (va < vb) return -1;
		if (va > vb) return 1;
	}
	return 0;
}
/**
* v1.0 → v1.1 迁移：合并 send_keyboard_message 到 send_message（双模式节点）。
*
* 变更：
*  - 将 nodeKind === 'send_keyboard_message' 的节点改为 nodeKind === 'send_message'
*  - 添加 config.mode = 'keyboard'
*  - 用最新 send_message 节点目录的 inputs/outputs 覆盖节点上的旧 inputs/outputs
*    （旧节点没有 mode 数据端口，codegen 只传递 inputs 中 kind==='data' 的端口，
*     不更新会导致 mode 参数缺失，handler 始终走默认 text 模式）
*/
function migrateTo1_1(flow) {
	const sendMsgSpec = NODE_CATALOG_V2.find((n) => n.kind === "message_send");
	if (!sendMsgSpec) return flow;
	const nodes = flow.nodes || [];
	for (const node of nodes) {
		const data = node.data || {};
		if (data.nodeKind !== "send_keyboard_message") continue;
		data.nodeKind = "message_send";
		const config = data.config || {};
		if (config.mode === void 0) config.mode = "keyboard";
		data.config = config;
		data.inputs = toPlainPorts(sendMsgSpec.inputs);
		data.outputs = getSendMessageOutputs(config);
	}
	return flow;
}
/** 运行迁移链直到目标版本 */
function runMigrations(flow, targetVersion = CURRENT_SCHEMA_VERSION) {
	let current = flow.schemaVersion || "0.9";
	if (compareVersions(current, targetVersion) >= 0) return flow;
	const versions = Object.keys(MIGRATIONS).sort();
	let migrated = { ...flow };
	for (const v of versions) {
		if (compareVersions(v, current) <= 0) continue;
		const fn = MIGRATIONS[v];
		if (fn) {
			migrated = fn(migrated);
			migrated.schemaVersion = v;
		}
	}
	migrated.schemaVersion = targetVersion;
	return migrated;
}
var FlowService = class {
	baseDir;
	constructor(baseDir = "") {
		this.baseDir = baseDir;
	}
	async loadFlow(projectPath) {
		const filePath = (0, path.join)(projectPath, ".qqbat", "flow.json");
		if (!(0, fs.existsSync)(filePath)) return null;
		const raw = await (0, fs_promises.readFile)(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		const schemaVersion = parsed.schemaVersion || "0.9";
		if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
			try {
				await historyService.backup(projectPath, schemaVersion);
			} catch {}
			const migrated = runMigrations(parsed, CURRENT_SCHEMA_VERSION);
			await (0, fs_promises.mkdir)((0, path.join)(projectPath, ".qqbat"), { recursive: true });
			await (0, fs_promises.writeFile)(filePath, JSON.stringify(migrated, null, 2), "utf-8");
			await noteFlowDiskRevisionFromDisk(projectPath, filePath);
			const result = flowGraphSchema.safeParse(migrated);
			if (!result.success) throw new Error(`迁移后 flow.json 校验失败: ${result.error.message}`);
			return this._finalizeFlow(result.data, projectPath);
		}
		const result = flowGraphSchema.safeParse(parsed);
		if (!result.success) throw new Error(`flow.json 校验失败: ${result.error.message}`);
		await noteFlowDiskRevisionFromDisk(projectPath, filePath);
		return this._finalizeFlow(result.data, projectPath);
	}
	/**
	* 加载收尾：**先规范化再清理**，并把发生的变化/问题记进日志。
	*
	* 顺序很关键：`sanitizeFlowEdges` 校验端口时看不到 `keyboard` 推导出的 `btn_*`，
	* 若先清理就会把按钮连线当无效边删掉（实测删过 4 条）。规范化补齐端口后，
	* 按钮连线才是合法的。
	*
	* 这里不再有"静默清洗"：补了多少端口、有多少问题、丢了哪些边，都写日志。
	* 统一真相层见 `src/shared/nodes/flowNormalize.ts`。
	*/
	_finalizeFlow(graph, projectPath) {
		const { graph: normalized, changes, unknownKinds } = normalizeFlow(graph);
		if (changes.length > 0) {
			const portCount = changes.reduce((n, c) => n + c.addedInputs.length + c.addedOutputs.length, 0);
			logger.info(`[flow] 已为 ${changes.length} 个节点补全 ${portCount} 个端口定义（flow.json 未保存端口，通常是模板创建的流程）`);
		}
		if (unknownKinds.length > 0) logger.debug(`[flow] ${unknownKinds.length} 个节点不在内置目录中（按插件节点处理）: ` + unknownKinds.map((u) => u.nodeKind).join(", "));
		const sanitized = sanitizeFlowEdges(normalized);
		const errors = validateFlow(sanitized).filter((i) => i.severity === "error");
		if (errors.length > 0) logger.warn(`[flow] ${projectPath} 存在 ${errors.length} 个问题: ` + errors.slice(0, 5).map((i) => i.message).join("；") + (errors.length > 5 ? ` 等 ${errors.length} 项` : ""));
		return sanitized;
	}
	async saveFlow(projectPath, flow, reason = "other") {
		if (this.baseDir) assertWithinProject(this.baseDir, projectPath);
		const dir = (0, path.join)(projectPath, ".qqbat");
		await (0, fs_promises.mkdir)(dir, { recursive: true });
		const filePath = (0, path.join)(dir, "flow.json");
		if (reason === "auto" || reason === "manual") {
			const activePath = activeProjectRegistry.getActivePath();
			if (activePath && !activeProjectRegistry.isActive(projectPath)) {
				logger.error(`[flow] 已阻止自动保存：目标项目 ${projectPath} 不是当前打开的项目 ${activePath}。画布可能仍停在早先打开的项目上（切项目时画布页没挂载就不会重新加载），整份写入会覆盖那个项目的 flow.json。`);
				throw new Error(`已拒绝保存：当前打开的项目是「${(0, path.basename)(activePath) || activePath}」，而这次保存要整份写入「${(0, path.basename)(projectPath) || projectPath}」。为避免覆盖未打开项目的流程，本次保存已取消 —— 切回该项目会重新加载画布，那时再保存即可。`);
			}
			const knownRevision = getKnownFlowDiskRevision(projectPath);
			const diskRevision = await readFlowDiskRevision(filePath);
			if (knownRevision !== void 0 && diskRevision !== null && knownRevision !== diskRevision) {
				logger.error(`[flow] 已阻止自动保存：${filePath} 在画布加载之后被其他操作改写过（磁盘版本 ${diskRevision} ≠ 已知版本 ${knownRevision}）。需重新加载画布后再保存。`);
				throw new Error("已拒绝保存：磁盘上的 flow.json 已被其他操作改写（历史读档 / 时光机 / 外部编辑），当前画布已经不是最新的。请重新加载画布后再保存，以免覆盖那份更新的版本。");
			}
		}
		if (Array.isArray(flow?.nodes) && flow.nodes.length === 0 && (0, fs.existsSync)(filePath)) {
			const existing = await this.readExistingCounts(filePath);
			if (existing.nodes > 0) {
				logger.error(`[flow] 已阻止保存：即将用空图覆盖 ${filePath}（磁盘上原有 ${existing.nodes} 个节点 / ${existing.edges} 条边）。如果是想清空项目，请新建项目而不是覆盖。`);
				throw new Error(`拒绝用空流程覆盖已有流程（磁盘上原有 ${existing.nodes} 个节点）。如需清空请新建项目。`);
			}
		}
		const { graph: normalized, changes } = normalizeFlow(flow);
		if (changes.length > 0) logger.info(`[flow] 保存前补全 ${changes.length} 个节点的端口定义（写入后即自愈）`);
		const updated = {
			...normalized,
			metadata: {
				...normalized.metadata,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			}
		};
		try {
			if ((0, fs.existsSync)(filePath)) await historyService.backup(projectPath);
		} catch {}
		await atomicWrite(filePath, JSON.stringify(updated, null, 2));
		await noteFlowDiskRevisionFromDisk(projectPath, filePath);
		const autoCommitResult = await gitService.autoCommit(projectPath, void 0, reason);
		if (autoCommitResult.error) logger.warn(`[flow] 自动提交失败（流程已保存）: ${autoCommitResult.error}`);
	}
	/**
	* 读磁盘上 flow.json 的节点/边数量（**不抛异常**）。
	*
	* 用于"空图覆盖"守卫：文件损坏或不存在时返回 0（= 无法证明磁盘上有内容，
	* 那就不要拦 —— 守卫只拦**能确证**会造成数据丢失的写）。
	*/
	async readExistingCounts(filePath) {
		try {
			const raw = await (0, fs_promises.readFile)(filePath, "utf-8");
			const parsed = JSON.parse(raw);
			return {
				nodes: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
				edges: Array.isArray(parsed.edges) ? parsed.edges.length : 0
			};
		} catch {
			return {
				nodes: 0,
				edges: 0
			};
		}
	}
};

export { collectReferencedPorts, preserveReferencedPorts, sanitizeFlowEdges, MIGRATIONS, compareVersions, migrateTo1_1, runMigrations, CURRENT_SCHEMA_VERSION, FlowService };
