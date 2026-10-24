// src/main/services/agent-core/modelAdapter.ts
//
// **模型适配器**：把现有 provider（callLlm）接进 agent-core 的 ModelFn。
//
// 只做翻译，不做策略：
//   ChatTurn[] → ChatMessage[]（工具结果按 user 消息回灌，带工具名前缀）
//   CORE_TOOLS → AiToolDefinition[]
//   onToolCalls → ModelReply.calls（args 已是对象，不再二次解析）
//
// 依赖注入而不是直接 import：测试传假 call，不必 mock 模块。
import type { AiToolCall, AiToolDefinition, ChatMessage } from '@shared/types/ai';
import { callLlm, type LlmConfig } from '../ai/llm';
import { normalizeToolCalls } from '../ai/toolMessages';
import { CORE_TOOLS, type ChatTurn, type ModelFn, type ModelReply } from './core';

type CallLlm = typeof callLlm;

/**
 * 工具定义 → 模型的 tools 列表。
 *
 * `parameters` **必须**用具工具自己的那份：第一版写死成
 * `{properties:{}, additionalProperties:true}`，等于告诉模型"参数随便猜"。
 */
function toDef(name: string, description: string, parameters?: Record<string, unknown>): AiToolDefinition {
  return {
    name,
    description,
    parameters: parameters ?? { type: 'object', properties: {}, additionalProperties: true },
    category: 'query',
  };
}

export function createModelFn(
  config: LlmConfig,
  opts: {
    call?: CallLlm;
    signal?: AbortSignal;
    /** 文本增量：流式界面靠它把模型的话**边出边显示**（不是等整轮跑完） */
    onChunk?: (text: string) => void;
    /** 思考过程增量（厂商给了才有；不传 = 丢弃，不影响正文） */
    onReasoning?: (text: string) => void;
  } = {},
): ModelFn {
  const call = opts.call ?? callLlm;
  const tools = CORE_TOOLS.map((t) => toDef(t.name, t.description, t.parameters));
  return async (turns: ChatTurn[]): Promise<ModelReply> => {
    const messages: ChatMessage[] = turns.map((t) =>
      t.role === 'tool'
        ? { role: 'user', content: '[工具 ' + String(t.name ?? '') + ']\n' + t.content }
        : {
            role: t.role,
            content: t.content,
            /**
             * 图只可能出现在 user 回合（循环不产图）。交出去之后由 provider 层的
             * apiContentOf 改成多段 content —— 那张 map 早就在，只是循环以前没把图递过去。
             */
            ...(t.images && t.images.length > 0 ? { images: [...t.images] } : {}),
          },
    );
    let text = '';
    let calls: AiToolCall[] = [];
    await call(
      config,
      messages,
      tools,
      {
        onChunk: (chunk) => {
          if (!chunk.content) return;
          if (chunk.type === 'reasoning') opts.onReasoning?.(chunk.content);
          else opts.onChunk?.(chunk.content);
        },
        onToolCalls: (c) => {
          /**
           * ⚠️ provider 回调的是**原始 OpenAI 形状**（`{id, function:{name, arguments}}`，
           * 参数还是没解析的 JSON 字符串），类型上却声明成 `AiToolCall`。
           * 不归一就接的后果（2026-10-18 真机）：每个调用都变成
           * `{name: undefined, args: {}}` → 循环跑满 12 轮"未知工具"。
           * 归一逻辑复用助手那边那份，见 toolMessages.ts 的注释。
           */
          calls = normalizeToolCalls(c);
        },
        onComplete: (full) => {
          text = full;
        },
      },
      opts.signal,
    );
    return { text, calls };
  };
}
