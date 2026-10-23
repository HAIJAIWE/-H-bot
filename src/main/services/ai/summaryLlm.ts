// src/main/services/ai/summaryLlm.ts
//
// 语义摘要用的模型适配（见 contextDigest.summarizeDroppedHistory）：
// 用**作者助手自己的配置**（同一个 provider/model），不另配一套 key；
// 拿不到配置就返回 undefined —— 调用方据此走确定性摘要。
import { callLlm } from './llm';
import { resolveAuthorAiConfig } from './appAiConfig';
import { MODEL_SUMMARY_ENV, type DigestLlm } from './contextDigest';

export async function resolveSummaryLlm(projectPath: string): Promise<DigestLlm | undefined> {
  if (process.env[MODEL_SUMMARY_ENV] !== 'model') return undefined;
  const config = await resolveAuthorAiConfig(projectPath).catch(() => null);
  if (!config?.apiKey) return undefined;
  return {
    async summarize(prompt: string): Promise<string> {
      let text = '';
      await callLlm(
        config,
        [{ role: 'user', content: prompt }],
        [],
        {
          onChunk: (chunk) => {
            if (chunk.type === 'text') text += chunk.content;
          },
          onToolCalls: () => {
            // 摘要请求不带工具；万一厂商回了 tool_calls，忽略即可
          },
          onComplete: (full) => {
            if (!text && full) text = full;
          },
        },
      );
      return text;
    },
  };
}
