// src/main/services/ai/llmRetry.ts
//
// LLM 重试/退避的**向后兼容入口**。
//
// 实现在 `@shared/ai/retryRunner`：策略与退避公式来自 `src/shared/vendor/dsh/llm-retry/`
// （搬自 DSH），错误分类（429/5xx → 故障码、Retry-After）由 `@shared/types/ai-provider`
// 的 ProviderHttpError 提供。本文件只保留原来的导入路径。
export { retryDelayMs, withLlmRetry } from '@shared/types/ai-provider'
