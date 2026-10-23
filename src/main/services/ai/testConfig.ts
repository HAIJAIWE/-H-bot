// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { init_logger, logger } from "../infra/logger";
import { providerRegistry } from "../../../shared/types/ai-provider";

/** 测试请求的超时：够慢模型回一个字，又不至于让用户干等 */
var CONFIG_TEST_TIMEOUT_MS = 2e4;
/** 发给模型的测试指令：要求**极短**输出，别为一次连通性检查付一整段生成的费用 */
var PING_PROMPT = "连通性测试。只回一个字：好";
/**
* 用一份配置真的调一次模型。
*
* **绝不抛错**：失败是一种结果（`{ ok: false, error }`），由界面显示给用户 ——
* 让 IPC 层去区分"调用失败"和"模型不通"只会把排查引向错误方向。
*/
async function testLlmConfig(config, timeoutMs = CONFIG_TEST_TIMEOUT_MS) {
	const Factory = providerRegistry.getFactory(config.provider);
	if (!Factory) return {
		ok: false,
		error: `未知的服务商：${config.provider}`
	};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const startedAt = Date.now();
	let text = "";
	try {
		const provider = new Factory({
			provider: config.provider,
			apiKey: config.apiKey,
			model: config.model,
			...config.baseUrl ? { baseUrl: config.baseUrl } : {},
			...typeof config.enableThinking === "boolean" ? { enableThinking: config.enableThinking } : {}
		});
		const messages = [{
			role: "user",
			content: PING_PROMPT
		}];
		await provider.chat(messages, [], {
			onChunk: (chunk) => {
				text += chunk.content;
			},
			onToolCalls: () => {},
			onComplete: (full) => {
				if (full) text = full;
			}
		}, controller.signal);
		return {
			ok: true,
			model: config.model,
			latencyMs: Date.now() - startedAt,
			sample: text.trim().slice(0, 60)
		};
	} catch (e) {
		if (controller.signal.aborted) return {
			ok: false,
			error: `超过 ${Math.round(timeoutMs / 1e3)} 秒没有响应`
		};
		logger.warn("[ai] 测试连接失败：", e);
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		};
	} finally {
		clearTimeout(timer);
	}
}

export { CONFIG_TEST_TIMEOUT_MS, PING_PROMPT, testLlmConfig };
