// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/main/services/ai/proposal.ts），只保证语法/行为，类型待补。
import { isAppManagedReadOnly } from '@shared/files/readOnlyPaths';
import type { ProposalOperation } from '@shared/types/proposal';
import * as require_dynamicHandlers from '../../runtime/dynamicHandlers';

import { validateHandlerSource } from '../../runtime/dynamicHandlers';
import { CAPABILITY_CATALOG } from './capabilityCatalog.generated';
import { mayRoleWrite, roleBoundaryMessage } from '@shared/ai/roleDomains';
import { guardCapabilityAttempt, resolveCapabilityArgs } from '@shared/ai/capabilityGuard';
import { readGuardOptions } from './guardSettings';
import { PROPOSABLE_SIGNATURES, DESTRUCTIVE_SIGNATURES, DESTRUCTIVE_CAPABILITIES } from '@shared/ai/capabilityPolicy.generated';
import { estimateImpact } from './capabilityImpact';
import { assessScriptRisk } from './codeSafety';
import { buildPluginManifestJson } from '../plugins/pluginManifest';
import { SUBFLOW_TEMPLATE_DATA } from '@shared/nodes/subflowTemplateData';
import { isConfigQueryReady } from '@shared/nodes/configQueryChain';
import { isCommandWizardReady } from '@shared/nodes/commandChain';
/**
* 合法 JS 标识符正则：字母/下划线/$ 开头，后跟字母/数字/下划线/$。
* 用于校验 LLM 提供的 funcName / nodeKind 等会拼接到代码或文件路径的字段，
* 防止路径穿越（如 `../../malicious`）或代码注入（如 `; import('fs')`）。
*/
var JS_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
/**
* JS 保留字：不能作为标识符（与 forkNode.ts 的 JS_RESERVED 保持一致）。
* 这里镜像一份而不是从 forkNode 导入，避免 proposal 依赖插件包生成模块。
*/
var JS_RESERVED = /* @__PURE__ */ new Set([
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"package",
	"private",
	"protected",
	"public",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield"
]);
/** 校验字符串可安全用作 JS 标识符/路径片段，否则抛错（调用方 catch 后回传 LLM） */
function assertJsIdentifier(value, field) {
	if (typeof value !== "string" || !JS_IDENTIFIER_RE.test(value)) throw new Error(`非法 ${field}: ${String(value)}（仅允许字母/数字/下划线/$，且不能以数字开头）`);
	if (JS_RESERVED.has(value)) throw new Error(`非法 ${field}: ${value}（JS 保留字不能作为标识符）`);
	return value;
}
/**
* 校验文件路径合法且不含路径穿越。
* 仅允许相对路径（由 Proposal 执行层在项目根目录内解析），禁止 `..`、绝对路径、盘符。
*/
function assertSafeRelativePath(value, field) {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${field} 不能为空`);
	if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("~")) throw new Error(`${field} 不能是绝对路径: ${value}`);
	if (value.split(/[\\/]/).some((seg) => seg === "..")) throw new Error(`${field} 含有 .. 路径穿越: ${value}`);
	return value;
}
/** AI 生成插件的目录名前缀 */
var AI_PLUGIN_PREFIX = "ai-";
/** 与 aiNodeScaffold 一致的蛇形命名规则（插件目录名 + 节点 kind 的一部分） */
var SNAKE_NAME_RE = /^[a-z][a-z0-9_]*$/;
/** 默认端口：单个控制输入 + 单个控制输出 */
var DEFAULT_INPUTS = [{
	id: "in",
	name: "in",
	kind: "control"
}];
var DEFAULT_OUTPUTS = [{
	id: "out",
	name: "out",
	kind: "control"
}];
/** 解析工具参数里的端口 JSON 字符串（工具参数只支持基础类型），失败则用默认端口 */
function parsePorts(raw, fallback) {
	if (typeof raw !== "string" || !raw.trim()) return fallback;
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
	} catch {
		return fallback;
	}
}
/**
* 生成插件包 index.js 内容（handler 以字符串形式内嵌，与 plugin-sdk 约定一致）。
* 注意：这里只生成内容，实际写盘由渲染层在用户确认 Proposal 后执行。
*/
function buildPluginIndexJs(opts) {
	const pkg = {
		name: opts.pluginName,
		version: "1.0.0",
		description: opts.summary,
		nodes: [{
			kind: opts.funcName,
			type: "action",
			label: opts.label || opts.funcName,
			icon: opts.icon,
			group: "AI 生成",
			description: opts.summary,
			inputs: opts.inputs,
			outputs: opts.outputs,
			handler: opts.handler
		}]
	};
	return `// AI 生成节点：${JSON.stringify(opts.label || opts.funcName)}
// 由 qqbat AI（create_ai_node）生成；运行在 vm 沙箱中（无 require / process / Buffer）。
// 可编辑本文件调整节点行为；handler 必须是函数表达式。

module.exports = ${JSON.stringify(pkg, null, 2)};
`;
}
/**
* 把 LLM 的 tool_call 转换为 ProposalOperation 数组。
* 累积到 Proposal 里，让用户确认后执行（mutation 类工具）。
* 未知工具返回空数组（由调用方决定如何处理）。
*
* 安全说明：
*   - 会拼接到 JS 代码或文件路径的字段（funcName、nodeKind、filePath）必须经过校验，
*     防止路径穿越和代码注入。校验失败时抛错，由 ai/index.ts 的 catch 捕获后回传 LLM。
*/
function toolCallToOperations(toolName, args, projectPath?, role?): ProposalOperation[] {
	switch (toolName) {
		case "add_node": return [{
			kind: "add_node",
			tempRef: args.tempRef || `new_${Date.now()}`,
			nodeKind: args.nodeKind,
			label: args.label,
			config: args.config || {}
		}];
		case "connect_nodes": return [{
			kind: "connect",
			sourceRef: args.sourceRef,
			sourcePortId: args.sourcePortId,
			targetRef: args.targetRef,
			targetPortId: args.targetPortId
		}];
		case "update_node": return [{
			kind: "update_config",
			nodeRef: args.nodeRef,
			...args.config ? { config: args.config } : {},
			...typeof args.label === "string" && args.label ? { label: args.label } : {},
			...typeof args.description === "string" && args.description ? { description: args.description } : {}
		}];
		case "delete_node": return [{
			kind: "delete_node",
			nodeRef: args.nodeRef
		}];
		/**
		* 调用一条**有副作用**的前端能力（M 层）—— 只产出提案，**绝不在这里执行**。
		*
		* 三层校验（全部 fail-closed，任何一条不满足都抛错并回给模型）：
		*   ① 能力必须真实存在于目录；
		*   ② 层必须是 M（R/P/F/X 一律不给，Q 层走 invoke_capability，不走这里）；
		*   ③ 必须在**附录 C** 的"可提议"白名单里 —— 不在的连提议都提不出来。
		*/
		case "propose_capability": {
			const id = typeof args.id === "string" ? args.id.trim() : "";
			const entry = CAPABILITY_CATALOG.find((e) => e.id === id);
			if (!entry) throw new Error(`没有「${id}」这条能力。先用 search_capabilities 搜到真实 id，不要凭印象拼。`);
			if (entry.layer !== "M") throw new Error(`「${entry.id}」在 ${entry.layer} 层，不能作为提案项：Q 层只读能力请用 invoke_capability；R/P/F/X 一律不开放给模型。`);
			if (role && !mayRoleWrite(role, entry.id)) throw new Error(roleBoundaryMessage(role, entry.id));
			const verdict = guardCapabilityAttempt(entry.id, args.args, "proposal", readGuardOptions());
			if (!verdict.ok) throw new Error(`「${entry.id}」不能作为提案项：${verdict.reason}`);
			const capabilityArgs = args.args && typeof args.args === "object" && !Array.isArray(args.args) ? args.args : {};
			const shape = resolveCapabilityArgs(entry.id, capabilityArgs, null);
			if (!shape.ok) throw new Error(`「${entry.id}」参数不完整：${shape.reason}`);
			if (!projectPath) {
				if ((PROPOSABLE_SIGNATURES[entry.id] ?? DESTRUCTIVE_SIGNATURES[entry.id] ?? []).includes("projectPath")) throw new Error(`「${entry.id}」需要一个已经打开的项目，而现在还没有项目。先用 project.create 把项目建出来，再谈这件事。`);
			}
			let impact;
			if (DESTRUCTIVE_CAPABILITIES.includes(entry.id)) {
				if (!projectPath) throw new Error(`「${entry.id}」是高危能力，需要项目路径才能预估影响面；本次调用没拿到项目路径，已拒绝。`);
				const estimated = estimateImpact(entry.id, capabilityArgs, projectPath);
				if (!estimated) throw new Error(`「${entry.id}」是高危能力，但**影响面预估失败**（没有登记估算器，或数据读不出来）。算不出影响就不许提案 —— 请让用户自己在界面上完成这一步。`);
				impact = estimated;
			}
			return [{
				kind: "capability",
				capabilityId: entry.id,
				capabilityArgs,
				riskLevel: "medium",
				...impact ? { impact } : {}
			}];
		}
		case "write_code":
		// write_file 与 write_code 在提案层同义（P1-2）：同一个能力两个工具名，
		// 只认一个会让另一条路径静默返回空数组 —— 模型收到"已加入待确认计划"，实际什么也没发生。
		case "write_file": {
			const filePath = assertSafeRelativePath(args.filePath ?? args.filename ?? args.path, "filePath");
			/**
			* 应用管理的文件（流程数据 / 生成物）：**界面锁成只读，工具也不许写**（2026-10-06 补）。
			*
			* 不堵的话，助手可以 `write_file('.qqbat/flow.json', ...)` 直接改流程 ——
			* 既绕开"提案 + 用户确认"，也绕开画布的撤销/校验。它不是"多一种写法"，
			* 而是一条**后门**。（界面的口径在 @shared/files/readOnlyPaths，两边同一份。）
			*/
			if (isAppManagedReadOnly(filePath)) throw new Error(`拒绝写入 ${filePath}：这是应用自己管理的文件（画布数据/生成物，会被整体覆盖）。要改流程请用 add_node / connect_nodes / update_node / delete_node —— 它们会进"待确认计划"。`);
			const content = typeof args.content === "string" ? args.content : "";
			return [{
				kind: "write_code",
				filePath,
				content,
				riskLevel: assessScriptRisk(content)
			}];
		}
		case "create_ai_node": {
			const funcName = assertJsIdentifier(args.funcName, "funcName");
			if (!SNAKE_NAME_RE.test(funcName)) throw new Error(`非法 funcName: ${funcName}（插件目录/节点标识要求蛇形命名：小写字母开头，仅含小写字母/数字/下划线）`);
			const handler = typeof args.handler === "string" ? args.handler : "";
			const handlerCheck = validateHandlerSource(handler);
			if (!handlerCheck.ok) throw new Error(handlerCheck.error ?? "handler 校验失败");
			const summary = typeof args.summary === "string" ? args.summary : "";
			const label = typeof args.label === "string" ? args.label : "";
			const icon = typeof args.icon === "string" && args.icon ? args.icon : "🤖";
			const pluginName = `${AI_PLUGIN_PREFIX}${funcName}`;
			const indexJs = buildPluginIndexJs({
				pluginName,
				funcName,
				label,
				summary,
				icon,
				inputs: parsePorts(args.inputs, DEFAULT_INPUTS),
				outputs: parsePorts(args.outputs, DEFAULT_OUTPUTS),
				handler
			});
			const manifestJson = buildPluginManifestJson({
				name: pluginName,
				description: summary
			});
			return [{
				kind: "write_code",
				filePath: `plugins/${pluginName}/manifest.json`,
				content: manifestJson,
				riskLevel: assessScriptRisk(manifestJson)
			}, {
				kind: "write_code",
				filePath: `plugins/${pluginName}/index.js`,
				content: indexJs,
				riskLevel: assessScriptRisk(indexJs)
			}];
		}
		case "generate_code": return [{ kind: "generate_code" }];
		/**
		* 套用预置片段（2026-10-06）。
		*
		* 校验放在这里而不是渲染层：**模型能拿到这条错误**。它编了一个不存在的 id 时，
		* 回给它一句"未知片段 + 几个真实 id 的例子"，它下一轮就会去 list_templates 查；
		* 而在渲染层抛错的话，用户只会看到"提案执行失败"，模型什么也学不到。
		*/
		case "apply_template": {
			const templateId = String(args.templateId ?? "").trim();
			if (!SUBFLOW_TEMPLATE_DATA.some((t) => t.id === templateId)) {
				const sample = SUBFLOW_TEMPLATE_DATA.slice(0, 8).map((t) => t.id).join("、");
				throw new Error(`未知的片段 id: ${templateId || "(空)"}。请先用 list_templates 查（例如 ${sample}…），不要凭记忆编 id。`);
			}
			return [{
				kind: "apply_template",
				templateId
			}];
		}
		/** 新建一条"查表回复"指令。参数不全/路径不合法时报错给模型，让它补齐后重试。 */
		case "new_lookup": {
			const input = {
				command: String(args.command ?? ""),
				table: String(args.table ?? ""),
				dbPath: assertSafeRelativePath(args.dbPath, "dbPath"),
				field: String(args.field ?? ""),
				matchField: typeof args.matchField === "string" ? args.matchField : "",
				reply: String(args.reply ?? "")
			};
			if (!isConfigQueryReady(input)) throw new Error("new_lookup 参数不完整：需要 command（命令词）、table（配置表名）、dbPath（配置库路径）、field（要回的字段）、reply（回复文案）。");
			return [{
				kind: "new_lookup",
				...input
			}];
		}
		/** 新建一条指令（等价于界面向导）。参数不全时报错给模型，让它补齐后重试。 */
		case "new_command": {
			const rawMode = String(args.dataMode ?? "none");
			const dataMode = rawMode === "increment" || rawMode === "read" ? rawMode : "none";
			const input = {
				command: String(args.command ?? ""),
				reply: String(args.reply ?? ""),
				dataMode,
				...typeof args.dataKey === "string" ? { dataKey: args.dataKey } : {}
			};
			if (!isCommandWizardReady(input)) throw new Error("new_command 参数不完整或非法：需要 command（命令词）、reply（回复文案）；dataMode 记数据时 dataKey 必须是英文/数字/下划线（如 score）。");
			return [{
				kind: "new_command",
				...input
			}];
		}
		default: return [];
	}
}


export { assertJsIdentifier, assertSafeRelativePath, parsePorts, buildPluginIndexJs, toolCallToOperations, JS_IDENTIFIER_RE, JS_RESERVED, AI_PLUGIN_PREFIX, SNAKE_NAME_RE, DEFAULT_INPUTS, DEFAULT_OUTPUTS };
