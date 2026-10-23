// @ts-nocheck
// 由 10/18 打包产物还原（chunk: registration-B3DiGKnT.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../infra/logger";

/** ../bot/llm：**延迟加载** —— 静态导入会形成 builtinNodes↔bot 的运行时环（见文件头） */
var loadLlm = () => import("../bot/llm.js");
/** ../bot/tools：**延迟加载** —— 静态导入会形成 builtinNodes↔bot 的运行时环（见文件头） */
var loadTools = () => import("../bot/tools.js");
/** ../bot/memory：**延迟加载** —— 静态导入会形成 builtinNodes↔bot 的运行时环（见文件头） */
var loadMemory = () => import("../bot/memory.js");
/** ../bot/policy：**延迟加载** —— 静态导入会形成 builtinNodes↔bot 的运行时环（见文件头） */
var loadPolicy = () => import("../bot/policy.js");
/** ../bot/pending：**延迟加载** —— 静态导入会形成 builtinNodes↔bot 的运行时环（见文件头） */
var loadPending = () => import("../bot/pending.js");
async function agentChat(bot, event, prompt = "", systemPrompt = "", _model = "", temperature = .7, _maxTokens = 2e3, tools = [], mode = "chat", history = [], maxRounds = 3, confirmHighRisk = true) {
	const { callBotAgent, callBotLlm } = await loadLlm();
	const { buildBotToolSpecs, runBotTool, requiresConfirmation, riskClassOf, riskClassLabel } = await loadTools();
	const { loadConversation } = await loadMemory();
	const { checkBotPolicy, logBotCall, addDailyUsage } = await loadPolicy();
	const { classifyConfirmation, clearPendingAction, getPendingAction, setPendingAction } = await loadPending();
	const projectPath = String(bot?.projectPath ?? "");
	if (!projectPath) return {
		response: "",
		tool_calls: [],
		error: "缺少项目路径：运行时没有把 projectPath 注入给这个节点。这是**接线问题，不是你的流程写错了** —— 模型配置改多少遍都没用。"
	};
	if (!String(prompt ?? "").trim()) return {
		response: "",
		tool_calls: [],
		error: "prompt 不能为空"
	};
	const isAgent = String(mode || "chat") === "agent";
	const unknownKinds = [];
	const specs = buildBotToolSpecs(parseKindList(tools), (m) => unknownKinds.push(m));
	if (isAgent && specs.length === 0) return {
		response: "",
		tool_calls: [],
		error: "没有可用的工具：工具清单里没有一个真实存在的节点类型。" + (unknownKinds.length > 0 ? `认不出来的：${unknownKinds.join("、")}。` : "") + "请用 list_nodes 查真实 kind，或留空使用默认的安全工具集。"
	};
	const subject = subjectOf(event);
	const decision = await checkBotPolicy(projectPath, subject);
	if (!decision.allowed) return {
		response: "",
		tool_calls: [],
		error: decision.reason
	};
	const convId = conversationIdOf(subject);
	if (confirmHighRisk && convId) {
		const pending = await getPendingAction(projectPath, convId).catch(() => null);
		if (pending) {
			const verdict = classifyConfirmation(prompt);
			if (verdict === "yes") {
				await clearPendingAction(projectPath, convId);
				const spec = specs.find((s) => s.definition.name === pending.toolName);
				if (!spec) return {
					response: "",
					tool_calls: [],
					error: `待确认的工具 ${pending.toolName} 已不在本次工具清单里，无法执行`
				};
				const out = await runBotTool(spec, pending.args, bot, event, projectPath);
				const detail = out.ok ? `结果：${summarizeToolResult(out.result)}` : `但它失败了：${summarizeToolResult(out.result)}`;
				return {
					response: `已执行：${pending.summary}。${detail}`,
					tool_calls: [],
					error: ""
				};
			}
			if (verdict === "no") {
				await clearPendingAction(projectPath, convId);
				return {
					response: `已取消：${pending.summary}。`,
					tool_calls: [],
					error: ""
				};
			}
		}
	}
	let historyEntries = parseHistory(history);
	if (historyEntries.length === 0 && convId) try {
		historyEntries = await loadConversation(projectPath, convId);
	} catch (e) {
		logger.warn(`[agent_chat] 读取会话记忆失败（当次无记忆继续）: ${String(e)}`);
	}
	/** 被"高风险确认"拦下的那次工具调用（要在模型返回后记成待确认动作） */
	let haltedCall = null;
	const result = isAgent ? await callBotAgent({
		projectPath,
		prompt,
		...systemPrompt.trim() ? { systemPrompt } : {},
		...historyEntries.length > 0 ? { history: historyEntries } : {},
		temperature,
		tools: specs.map((s) => s.definition),
		maxRounds: Number.isFinite(maxRounds) && maxRounds > 0 ? maxRounds : 3,
		executeTool: async (name, args) => {
			const spec = specs.find((s) => s.definition.name === name);
			if (!spec) return {
				ok: false,
				result: `工具 ${name} 不在本次白名单里`
			};
			if (confirmHighRisk && requiresConfirmation(spec)) {
				haltedCall = {
					name,
					args,
					summary: describeToolCall(spec, args)
				};
				return {
					ok: true,
					result: `工具 ${spec.kind} 属于「${riskClassLabel(riskClassOf(spec))}」，已按「高风险确认」暂停，等待用户确认后再执行。`,
					halt: true
				};
			}
			const out = await runBotTool(spec, args, bot, event, projectPath);
			return {
				ok: out.ok,
				result: out.result
			};
		}
	}) : await callBotLlm({
		projectPath,
		prompt,
		...systemPrompt.trim() ? { systemPrompt } : {},
		...historyEntries.length > 0 ? { history: historyEntries } : {},
		temperature
	});
	const toolCalls = isAgent ? result.toolCalls ?? [] : [];
	const log = async (ok, error) => {
		try {
			await logBotCall(projectPath, {
				ts: (/* @__PURE__ */ new Date()).toISOString(),
				...subject,
				mode: isAgent ? "agent" : "chat",
				toolCalls: toolCalls.length,
				...result.usage ? {
					promptTokens: result.usage.promptTokens,
					completionTokens: result.usage.completionTokens
				} : {},
				ok,
				...error ? { error: error.slice(0, 200) } : {}
			});
		} catch (e) {
			logger.warn(`[agent_chat] 写调用日志失败（不影响回复）: ${String(e)}`);
		}
	};
	if (result.error) {
		await log(false, result.error);
		return {
			response: "",
			tool_calls: [],
			error: result.error
		};
	}
	await log(true);
	// P1-5 的写侧：读侧在 checkBotPolicy（readDailyUsage），这里把本轮的用量累加。
	// 改造前 addDailyUsage 只有测试引用 —— 日额度读到的已用量恒 0，"5 万 token/天"从没生效。
	if (result.usage) {
		const tokens = (Number(result.usage.promptTokens) || 0) + (Number(result.usage.completionTokens) || 0);
		try {
			await addDailyUsage(projectPath, subject, tokens);
		} catch (e) {
			logger.warn(`[agent_chat] 记额度失败（不影响回复）: ${String(e)}`);
		}
	}
	if (isAgent && haltedCall && convId) {
		const call = haltedCall;
		try {
			await setPendingAction(projectPath, convId, {
				toolName: call.name,
				args: call.args,
				summary: call.summary,
				askedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
		} catch (e) {
			logger.warn(`[agent_chat] 记录待确认动作失败: ${String(e)}`);
		}
		const response = `这个操作需要你确认：${call.summary}。\n回「确认」我就执行，回「取消」就放弃（5 分钟内有效）。`;
		await recordTurn(projectPath, convId, prompt, response);
		return {
			response,
			tool_calls: toolCalls,
			error: ""
		};
	}
	const response = Boolean(result.roundLimitHit) ? `${result.response}\n\n（已达到工具调用轮数上限，回答可能不完整）` : result.response;
	await recordTurn(projectPath, convId, prompt, response);
	return {
		response,
		tool_calls: toolCalls,
		error: ""
	};
}
/** 把一轮对话写进会话记忆（失败只告警，绝不因此让回复发不出去） */
async function recordTurn(projectPath, convId, userText, assistantText) {
	const { appendConversation } = await loadMemory();
	if (!convId) return;
	try {
		await appendConversation(projectPath, convId, [{
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			role: "user",
			content: userText
		}, {
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			role: "assistant",
			content: assistantText
		}]);
	} catch (e) {
		logger.warn(`[agent_chat] 写入会话记忆失败（不影响本次回复）: ${String(e)}`);
	}
}
/** 给待确认动作写一句人话（用户要凭它决定同不同意） */
function describeToolCall(spec, args) {
	const label = spec.definition.description || spec.kind;
	const argText = summarizeToolResult(args);
	return argText && argText !== "{}" ? `${label}（参数 ${argText}）` : label;
}
/** 工具结果压成一行可读文本（给用户看，不喂模型） */
function summarizeToolResult(result) {
	try {
		const text = typeof result === "string" ? result : JSON.stringify(result);
		return text.length > 200 ? `${text.slice(0, 200)}…` : text;
	} catch {
		return String(result);
	}
}
/** 把 `tools` 端口（可能是 JSON 字符串，也可能是数组）解析成 kind 列表 */
function parseKindList(raw) {
	if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed) return [];
		try {
			const parsed = JSON.parse(trimmed);
			return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
		} catch {
			return [];
		}
	}
	return [];
}
/** 解析 `history` 端口（JSON 字符串或数组）—— 认得出来才用，认不出就当没给 */
function parseHistory(raw) {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === "string" && raw.trim()) try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
	return [];
}
/**
* 这条事件属于**谁**（限流与额度是按人算的，见 bot/policy.ts）。
* 群号与用户号都取翻译器分配的顺序 UID —— 与会话记忆、白名单用的是同一套标识。
*/
function subjectOf(event) {
	const gid = event?.group_id;
	const uid = event?.user_id;
	const groupId = gid === void 0 || gid === null ? "" : String(gid);
	const userId = uid === void 0 || uid === null ? "" : String(uid);
	return {
		...groupId ? { groupId } : {},
		...userId ? { userId } : {}
	};
}
/**
* 这段会话该分到哪一段记忆。
*
* 沿用 `bot/memory.ts` 的三种 scope：群内每人一份最常用（同一个人在同一个群里连续对话）；
* 拿不到任何身份时**不记**（没有 key 就没法分会话，硬记会把不同人的话混在一起）。
*/
function conversationIdOf(subject) {
	if (subject.groupId && subject.userId) return {
		scope: "group-user",
		groupId: subject.groupId,
		userId: subject.userId
	};
	if (subject.groupId) return {
		scope: "group",
		groupId: subject.groupId
	};
	if (subject.userId) return {
		scope: "user",
		userId: subject.userId
	};
	return null;
}
/**
* 意图识别 —— **2026-09-27 真正接上**（此前是占位实现，恒返回"未接入"错误）。
*
* ## 为什么这次能接
*
* 它要的能力就是"调一次模型"，而 `callBotLlm` 早就在了（配置链路：项目 `botAi` →
* `ai` → 全局 → 内存会话）。之前没接，于是 `outputPortGate` 把 `all_scores` 登记成例外、
* `paramOrderGate` 把 `text` 登记成例外 —— **那条例外的理由正是"它是占位节点，
* 改它不改变可观测行为"**。现在实现了，这个理由消失，两条例外都已删除。
*
* ## 顺带修掉的位置参数漂移
*
* 目录里的输入端口叫 `user_message`，而 `PARAM_ORDER` 里写的是 `text` ——
* 也就是说这个节点**拿不到用户填的消息**（`text` 不是任何端口名）。
* 因为节点恒报错，这个漂移一直不可观测。现在改成 `userMessage`（与
* `portToParam('user_message')` 一致），并补上 `systemPrompt` / `temperature`
* 两个此前根本没接线、用户填了也没用的端口。
*
* ## 失败与"半成功"的边界
*
* 模型给出的标签**必须**是候选意图之一：拿回一个没声明过的标签会让下游的
* 分支匹配全部落空，而用户完全看不出原因 —— 所以那种情况**报错**而不是照原样透出。
*/
async function intentClassify(bot, event, userMessage = "", intentsRaw = [], systemPrompt = "", temperature = .3) {
	const { callBotLlm } = await loadLlm();
	const failed = (error) => ({
		intent: "",
		confidence: 0,
		all_scores: [],
		error
	});
	const projectPath = String(bot?.projectPath ?? "");
	if (!projectPath) return failed("缺少项目路径：运行时没有把 projectPath 注入给这个节点。这是**接线问题，不是你的流程写错了** —— 模型配置改多少遍都没用。");
	const text = String(userMessage ?? "").trim();
	if (!text) return failed("user_message 不能为空");
	const parsed = parseIntents(intentsRaw);
	if (parsed.error) return failed(parsed.error);
	if (parsed.list.length === 0) return failed("意图列表不能为空：至少给一个候选意图，如 [{\"label\":\"闲聊\",\"desc\":\"日常对话\"}]");
	const labels = parsed.list.map((i) => i.label);
	const sys = String(systemPrompt ?? "").trim() || "你是一个意图分类器。只能从给定的候选意图里选一个，不要发明新标签，不要解释。";
	const prompt = `候选意图：\n${parsed.list.map((i, n) => `${n + 1}. ${i.label}${i.desc ? ` —— ${i.desc}` : ""}`).join("\n")}\n\n用户消息：\n${text}\n\n只输出一个 JSON 对象，不要任何多余文字，格式：
{"intent":"<候选意图的 label>","confidence":<0-1 的小数>,"scores":[{"label":"<label>","score":<0-1 的小数>}]}
scores 要覆盖**全部**候选意图（按分数从高到低）。`;
	const t = Number(temperature);
	const r = await callBotLlm({
		projectPath,
		prompt,
		systemPrompt: sys,
		temperature: Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : .3
	});
	if (r.error) return failed(r.error);
	const obj = extractJsonObject(r.response);
	if (!obj) return failed(`模型回复不是可解析的 JSON，无法得到意图：${r.response.slice(0, 120)}`);
	const intent = String(obj.intent ?? "").trim();
	if (!intent) return failed("模型回复里没有 intent 字段");
	if (!labels.includes(intent)) return failed(`模型返回了候选之外的意图「${intent}」，已拒绝透出（会让下游分支全部落空）。候选：${labels.join(" / ")}`);
	const rawConf = Number(obj.confidence);
	const confidence = Number.isFinite(rawConf) ? Math.min(1, Math.max(0, rawConf)) : 0;
	let allScores = [];
	if (Array.isArray(obj.scores)) for (const s of obj.scores) {
		if (!s || typeof s !== "object") continue;
		const label = String(s.label ?? "").trim();
		if (!labels.includes(label)) continue;
		const score = Number(s.score);
		if (!Number.isFinite(score)) continue;
		allScores.push({
			label,
			score: Math.min(1, Math.max(0, score))
		});
	}
	if (allScores.length === 0) allScores = [{
		label: intent,
		score: confidence
	}];
	return {
		intent,
		confidence,
		all_scores: allScores,
		error: ""
	};
}
/**
* 解析「意图列表」输入（`intents` 端口 / `defaultConfig.intents`）。
*
* 接受三种写法（目录里给的例子是第一种）：
*   `[{"label":"闲聊","desc":"日常对话"}, ...]` · `["闲聊","查询"]` · 上面两种的 JSON 字符串
* 空串/空数组 = **没配**（返回空 list，由调用方报"至少给一个候选意图"）。
*/
function parseIntents(raw) {
	let value = raw;
	if (typeof value === "string") {
		const t = value.trim();
		if (!t) return {
			list: [],
			error: ""
		};
		try {
			value = JSON.parse(t);
		} catch {
			return {
				list: [],
				error: `意图列表不是合法 JSON：${t.slice(0, 60)}`
			};
		}
	}
	if (value === void 0 || value === null) return {
		list: [],
		error: ""
	};
	if (!Array.isArray(value)) return {
		list: [],
		error: "意图列表必须是数组，如 [{\"label\":\"闲聊\",\"desc\":\"日常对话\"}]"
	};
	const list = [];
	for (const item of value) {
		if (typeof item === "string") {
			const label = item.trim();
			if (label) list.push({ label });
			continue;
		}
		if (item && typeof item === "object") {
			const label = String(item.label ?? "").trim();
			if (!label) return {
				list: [],
				error: "意图列表里有一项没有 label"
			};
			const desc = item.desc;
			list.push({
				label,
				...typeof desc === "string" && desc.trim() ? { desc } : {}
			});
			continue;
		}
		return {
			list: [],
			error: "意图列表的每一项必须是字符串或 {label, desc}"
		};
	}
	return {
		list,
		error: ""
	};
}
/** 从模型回复里抠出第一个 JSON 对象（容忍 ```json 代码块与前后废话） */
function extractJsonObject(text) {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	const body = (fenced ? fenced[1] : text).trim();
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		return JSON.parse(body.slice(start, end + 1));
	} catch {
		return null;
	}
}
async function llmChat(bot, event, prompt = "", _systemPrompt = "", _model = "", _temperature = .7, _maxTokens = 2e3) {
	console.info(`[llm_chat] prompt=${prompt?.slice(0, 50)}...`);
	return {
		response: "",
		error: "AI 能力未接入：llm_chat 需要配置模型与密钥，当前版本不含真实 AI 调用"
	};
}
/**
* 文本向量化 —— **2026-09-27 真正接上**（此前是占位实现，恒返回"未接入"错误）。
*
* ## 改了什么，为什么
*
* 目录里这个节点声明了 `vector`（向量）与 `dimensions`（维度）两个输出端口，
* 而实现返回的键叫 `embedding` —— 两个端口**从来没有被写过**。
* `outputPortGate` 当时把它们登记为例外，理由写得很清楚：
* 「`embedding` 恒返回「未接入」错误，端口写不写都不改变任何可观测行为。
* **接上真实嵌入模型时必须顺手改成 `vector`**」。
*
* 而仓库里**本来就有**真实的嵌入能力（`AIProviderInterface.embed`，
* GLM 那条固定 `embedding-2`、别的 provider 各有端点，见 `ai-provider.ts`），
* 配置解析那一套 `bot/llm.ts` 也已经有了 —— 所以这里不是"没能力"，是没接。
* 现在接上：`embedText()` 复用与 `callBotLlm` 完全相同的配置链路
* （项目 `botAi` → `ai` → 全局 → 内存会话），失败按节点层约定返回 error 而不抛。
*
* 移除了原来的第 4 个形参 `_model`：provider 的嵌入模型来自配置
* （`config.embedModel` / 各 provider 的默认值），这个形参**从来传不到任何地方**，
* 留在签名里只会让 `PARAM_ORDER` 多一条"位置占位"例外（已随本次一并删除）。
*/
async function embedding(bot, event, text = "") {
	const { embedText } = await loadLlm();
	const projectPath = String(bot?.projectPath ?? "");
	if (!projectPath) return {
		vector: [],
		dimensions: 0,
		error: "缺少项目路径：运行时没有把 projectPath 注入给这个节点。这是**接线问题，不是你的流程写错了** —— 模型配置改多少遍都没用。"
	};
	const input = String(text ?? "");
	if (!input.trim()) return {
		vector: [],
		dimensions: 0,
		error: "text 不能为空"
	};
	const r = await embedText({
		projectPath,
		text: input
	});
	return {
		vector: r.vector,
		dimensions: r.vector.length,
		error: r.error
	};
}

export { loadLlm, loadTools, loadMemory, loadPolicy, loadPending, agentChat, recordTurn, describeToolCall, summarizeToolResult, parseKindList, parseHistory, subjectOf, conversationIdOf, intentClassify, parseIntents, extractJsonObject, llmChat, embedding };
