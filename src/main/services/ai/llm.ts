// src/main/services/ai/llm.ts
import type { ChatMessage, AiToolDefinition, AiToolCall } from '@shared/types/ai';
import { providerRegistry, type AIProviderConfig } from '@shared/types/ai-provider';
import { withLlmRetry } from './llmRetry';
import { logger } from '../infra/logger';

export interface LlmConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /**
   * 「关思考」开关。**三态**：undefined = 不发该字段（默认）、true/false = 显式发送。
   *
   * 为什么不是 boolean：真 OpenAI 端点收到未知字段可能直接 400，
   * 所以"没勾"必须是"不发"，而不是"发 false"。
   */
  enableThinking?: boolean;
  /**
   * **provider 回退链**（P3）：主 provider 因额度/鉴权/限流不可用时，按顺序换这些。
   *
   * 只从配置文件来 —— 界面不编辑它，用户手写进 `%APPDATA%/qqbat/ai-config.json`
   * （每项 provider / apiKey / model 必填，baseUrl 可选）。判据与三条边界见 `llmFallback.ts`。
   */
  fallbacks?: LlmConfig[];
}

export interface LlmChunk {
  /** reasoning = 思考过程（与正文分开：它不进 fullResponse、也不回灌给模型） */
  type: 'text' | 'reasoning';
  content: string;
}

/**
 * 调用 LLM 并返回流式结果。
 * 使用 Provider 注册表进行实际调用。
 */
export async function callLlm(
  config: LlmConfig,
  messages: ChatMessage[],
  tools: AiToolDefinition[],
  callbacks: {
    onChunk: (chunk: LlmChunk) => void;
    onToolCalls: (calls: AiToolCall[]) => void;
    onComplete: (fullText: string) => void;
    /** 厂商回传的真实用量（**给了才有**；面板的 tok/s、缓存命中都靠它，没有就什么都不显示） */
    onUsage?: (usage: import('@shared/types/ai').LlmUsage) => void;
  },
  /**
   * 取消信号。一路透传到 `fetchWithTimeout` —— 没有它，「停止」按钮只是界面上的假动作
   * （渲染层把状态置一下，主进程照跑满 10 轮）。
   */
  signal?: AbortSignal,
): Promise<void> {
  const providerConfig: AIProviderConfig = {
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  };

  const provider = providerRegistry.getOrCreate(config.provider, providerConfig);

  /**
   * 已经吐过内容了吗 —— 决定"还能不能重试"。
   *
   * 流式响应里只要输出过一个字，重放就会**把内容写两遍**（用户看到答案中间接了一段重复的）。
   * 所以宁可这次失败，也不重放：判据在 `llmRetry.ts` 的文件头第 2 条。
   */
  let emitted = false;
  const wrapped = {
    onChunk: (chunk: LlmChunk): void => {
      emitted = true;
      callbacks.onChunk(chunk);
    },
    onToolCalls: (calls: AiToolCall[]): void => {
      emitted = true;
      callbacks.onToolCalls(calls);
    },
    onComplete: callbacks.onComplete,
    // 用量一样要透传：包装层吞掉它，面板上就永远没有真实 token 数
    ...(callbacks.onUsage ? { onUsage: callbacks.onUsage } : {}),
  };

  // 重试与退避：一次 429/网络抖动不该让用户把需求重说一遍（见 llmRetry.ts）
  await withLlmRetry(() => provider.chat(messages, tools, wrapped, signal), {
    signal,
    hasOutput: () => emitted,
    onRetry: ({ attempt, delayMs, error }: { attempt: number; delayMs: number; error: unknown }) => {
      logger.warn(
        `[ai] LLM 调用失败（第 ${attempt} 次），${delayMs}ms 后重试：` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });
}
