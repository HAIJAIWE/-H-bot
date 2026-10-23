// src/main/services/ai/llmRetry.ts
//
// LLM 重试/退避的**向后兼容入口**。
//
// 实现已经在 `@shared/types/ai-provider`：那里有 ProviderHttpError（带 status）与
// 三家 provider 的实现，判"值不值得重试"必须看得到状态码，所以重试逻辑跟着一起搬了过去
// （见 ai-provider.ts 的 isRetryableLlmError / retryDelayMs / abortableSleep / withLlmRetry）。
// 本文件只保留原来的导入路径，行为一行不改。
export {
  isRetryableLlmError,
  retryDelayMs,
  abortableSleep,
  withLlmRetry,
} from '@shared/types/ai-provider';
