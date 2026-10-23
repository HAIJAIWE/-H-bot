// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { callLlm } from "./llm";
import { init_logger, logger } from "../infra/logger";

/** `provider · model` —— 日志/提示里统一用这个形状，免得两处各写一种 */
function describeConfig(config) {
	return `${config.provider} · ${config.model}`;
}
/**
* 这个错值不值得换一家？
*
* 判据只有两类：**HTTP 状态**（额度/鉴权/限流/服务端故障）与**错误文案里的关键词**
* （各家 provider 的措辞不同，有的把 403 塞进 message 里而不是 status）。
* 刻意**不**把网络超时算进来：那是 `llmRetry` 的活儿（同一家重试更可能成功）。
*/
function isFallbackWorthy(err) {
	const msg = err instanceof Error ? err.message : String(err);
	if (/\b(401|402|403|429)\b/.test(msg)) return true;
	if (/\b5\d{2}\b/.test(msg)) return true;
	return /quota|rate[ _-]?limit|free[ _-]?tier|insufficient|balance|unauthor|forbidden|invalid[ _-]?api[ _-]?key|额度|限流|余额/i.test(msg);
}
/**
* 按顺序排好的候选：主 provider 在前，`fallbacks` 依次在后。
*
* 两道清理，都是"配置错误别变成一次注定失败的请求"：
* · 没填 apiKey 的备用项**跳过**（本地 Ollama 那种不需要 key 的，走主位，别放备用位）；
* · `provider|model|baseUrl` 相同的重复项**去重**（同一条链上把同一家试两遍毫无意义）。
*/
function buildProviderChain(config) {
	const chain = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (c, requireKey) => {
		if (requireKey && !c.apiKey) return;
		const key = `${c.provider}|${c.model}|${c.baseUrl ?? ""}`;
		if (seen.has(key)) return;
		seen.add(key);
		chain.push(c);
	};
	push(config, false);
	for (const f of config.fallbacks ?? []) push(f, true);
	return chain;
}
/**
* 带回退链的一次 LLM 调用。
*
* @returns **真正成功的那份配置** —— 调用方要靠它记 trace（"这一轮到底是谁答的"，
*          否则回退之后面板上还写着主模型的名字，排查时会被自己骗）。
*/
async function callLlmWithFallback(config, messages, tools, callbacks, signal, deps) {
	const call = deps?.call ?? callLlm;
	const chain = buildProviderChain(config);
	let lastError;
	for (let i = 0; i < chain.length; i++) {
		const current = chain[i];
		let emitted = false;
		const wrapped = {
			onChunk: (chunk) => {
				emitted = true;
				callbacks.onChunk(chunk);
			},
			onToolCalls: (calls) => {
				emitted = true;
				return callbacks.onToolCalls(calls);
			},
			onComplete: callbacks.onComplete,
			...callbacks.onUsage ? { onUsage: callbacks.onUsage } : {}
		};
		try {
			await call(current, messages, tools, wrapped, signal);
			if (i > 0) logger.info(`[ai] 本轮由备用 provider 作答：${describeConfig(current)}`);
			return current;
		} catch (e) {
			lastError = e;
			const next = chain[i + 1];
			if (signal?.aborted || emitted || !next || !isFallbackWorthy(e)) throw e;
			const event = {
				from: describeConfig(current),
				to: describeConfig(next),
				error: e
			};
			logger.warn(`[ai] ${event.from} 不可用（${e instanceof Error ? e.message : String(e)}），回退到 ${event.to}`);
			deps?.onFallback?.(event);
		}
	}
	throw lastError;
}

export { describeConfig, isFallbackWorthy, buildProviderChain, callLlmWithFallback };
