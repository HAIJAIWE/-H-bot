// src/main/services/bot/llm.ts
//
// **机器人侧**的模型层 —— 让群里的机器人真的能调 LLM。
//
// 与作者助手的三个硬差别：
// 1. 不共用 Provider 单例：机器人常要用另一个（更便宜更快的）模型，共用会互相顶掉配置。
// 2. 不碰作者助手那份配置：只读，不 setAiConfig。
// 3. 有硬上限，且默认更保守：超时、历史 token 预算、输出长度都收得更紧。
//
// 沙箱边界：本模块只做「把文本发给模型、把回复拿回来」，不执行代码、不读任意文件。
import type { AiToolCall, AiToolDefinition, ChatMessage, LlmUsage } from '@shared/types/ai';
import {
  providerRegistry,
  type AIProviderInterface,
  type ProviderCallbacks,
} from '@shared/types/ai-provider';
import { getAiConfig } from '../ai';
import { readAppAiConfig } from '../ai/appAiConfig';
import { readProjectBotAiConfig } from '../ai/projectAiConfig';
import { historyToMessages, type HistoryEntry } from '../ai/historyStore';
import { buildToolResultMessagesWithSpill, normalizeToolCalls } from '../ai/toolMessages';
import { logger } from '../infra/logger';
import type { LlmConfig } from '../ai/llm';

/** 机器人一次调用最多带多少历史（比作者助手更紧：面对陌生人，成本和刷屏都要防） */
export const BOT_HISTORY_TOKEN_BUDGET = 2000;

/** 默认超时（毫秒）—— 群聊里等太久体感极差，宁可失败也不要挂着 */
export const BOT_LLM_TIMEOUT_MS = 20_000;

export type BotConfigSource = 'botAi' | 'ai' | 'global' | 'session' | 'none';

export interface BotAgentToolRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface BotLlmRequest {
  projectPath: string;
  prompt: string;
  systemPrompt?: string;
  history?: readonly HistoryEntry[];
  temperature?: number;
  timeoutMs?: number;
}

export interface BotLlmResult {
  response: string;
  error: string;
  usage?: LlmUsage;
  configSource?: BotConfigSource;
}

export interface BotAgentRequest extends BotLlmRequest {
  /** 可用工具（由 bot/tools.ts 从节点目录编译而来 —— 这就是「画出来就有了」） */
  tools: AiToolDefinition[];
  /**
   * 最多几轮工具调用。
   *
   * ⚠️ **必须有上界**。作者助手那边可以放到 20 轮（面对的是你，最多浪费点时间）；
   * 机器人面对的是群里的人，一个没有上界的循环 = 有人能让你持续烧钱、持续刷屏。
   */
  maxRounds: number;
  /** 执行一次工具调用（节点层注入 —— 只有它拿得到 bot/event） */
  executeTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ ok: boolean; result: unknown; halt?: boolean }>;
  /** 每执行一个工具回调一次（观测用） */
  onToolCall?: (record: BotAgentToolRecord) => void;
}

export interface BotAgentResult extends BotLlmResult {
  toolCalls: BotAgentToolRecord[];
  /** 是否**因为轮数上限而中断** —— 要如实回传，不能假装正常结束 */
  roundLimitHit?: boolean;
  /**
   * 是否被工具**主动暂停**（当前只有一种情形：有副作用的工具需要用户确认）。
   * 暂停不是失败 —— 调用方要据此给出「请确认」的提示，而不是报错。
   */
  halted?: boolean;
}

export interface BotEmbedRequest {
  projectPath: string;
  text: string;
}

export interface BotEmbedResult {
  vector: number[];
  error: string;
  configSource?: BotConfigSource;
}

export type BotProviderResult =
  | { ok: true; provider: AIProviderInterface; source: BotConfigSource }
  | { ok: false; error: string; source: BotConfigSource };

function toLlmConfig(config: LlmConfig | null, source: BotConfigSource): BotProviderResult {
  if (!config) return { ok: false, error: '没有可用的模型配置（先在设置里配好）', source };
  try {
    const provider = providerRegistry.getOrCreate(config.provider, {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
    return { ok: true, provider, source };
  } catch (e) {
    return { ok: false, error: '创建模型实例失败：' + String(e), source };
  }
}

/**
 * 造一个机器人专用的 provider 实例（不共用作者助手的单例，见文件头）。
 * 优先级：botAi → 应用级 ai-config → 进程内 session/global → none。
 */
export async function createBotProvider(projectPath: string): Promise<BotProviderResult> {
  const botAi = await readProjectBotAiConfig(projectPath).catch(() => null);
  if (botAi) {
    const created = toLlmConfig(
      {
        provider: botAi.provider,
        apiKey: botAi.apiKey,
        model: botAi.model,
        ...(botAi.baseUrl ? { baseUrl: botAi.baseUrl } : {}),
      },
      'botAi',
    );
    if (created.ok || created.source === 'botAi') return created;
  }
  const app = await readAppAiConfig().catch(() => null);
  if (app) return toLlmConfig(app, 'ai');
  const session = getAiConfig();
  if (session) return toLlmConfig(session, 'session');
  return { ok: false, error: '没有可用的模型配置（先在设置里配好）', source: 'none' };
}

/** 纯聊天（无工具）：一轮请求，带超时 */
export async function callBotLlm(request: BotLlmRequest): Promise<BotLlmResult> {
  const created = await createBotProvider(request.projectPath);
  if (!created.ok) {
    return { response: '', error: created.error, configSource: created.source };
  }
  const { provider, source } = created;
  const messages: ChatMessage[] = [];
  if (request.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }
  const { messages: historyMessages } = historyToMessages(request.history ?? []);
  messages.push(...historyMessages);
  messages.push({ role: 'user', content: request.prompt });

  let text = '';
  let usage: LlmUsage | undefined;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('机器人调用模型超时')),
    request.timeoutMs ?? BOT_LLM_TIMEOUT_MS,
  );
  const callbacks: ProviderCallbacks = {
    onChunk: (chunk) => {
      text += chunk.content;
    },
    onComplete: () => {},
    onUsage: (u) => {
      usage = u;
    },
    onToolCalls: () => {
      // 纯聊天不带工具：厂商回了 tool_calls 也忽略
    },
  };
  try {
    await provider.chat(messages, [], callbacks, controller.signal);
    return { response: text.trim(), error: '', usage, configSource: source };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { response: '', error: '调用模型失败：' + msg, configSource: source };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 跑一轮「模型 → 调工具 → 结果回传 → 再问模型」的循环。
 *
 * 工具结果复用作者助手那套**唯一构造入口**（buildToolResultMessagesWithSpill）：
 * 于是机器人侧也自动拿到「结果归一化 + 预算漏斗」这两件事，不必再写一遍。
 */
export async function callBotAgent(request: BotAgentRequest): Promise<BotAgentResult> {
  const created = await createBotProvider(request.projectPath);
  if (!created.ok) {
    return { response: '', error: created.error, toolCalls: [], configSource: created.source };
  }
  const { provider, source } = created;
  const messages: ChatMessage[] = [];
  if (request.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }
  const { messages: historyMessages } = historyToMessages(request.history ?? []);
  messages.push(...historyMessages);
  messages.push({ role: 'user', content: request.prompt });

  /** 每轮一个超时（见文件头第 3 条）：整段最多 rounds × 单轮，而不是共用 20s */
  const roundTimeoutMs = request.timeoutMs ?? BOT_LLM_TIMEOUT_MS;
  const toolCalls: BotAgentToolRecord[] = [];
  let text = '';
  let usage: LlmUsage | undefined;
  let roundLimitHit = false;
  let halted = false;
  const rounds = Math.max(1, request.maxRounds);

  for (let round = 0; round < rounds; round += 1) {
    let roundText = '';
    let calls: AiToolCall[] = [];
    const callbacks: ProviderCallbacks = {
      onChunk: (chunk) => {
        roundText += chunk.content;
      },
      onComplete: () => {},
      onUsage: (u) => {
        usage = u;
      },
      onToolCalls: async (raw) => {
        calls = normalizeToolCalls(raw as readonly unknown[]);
      },
    };
    const roundController = new AbortController();
    const roundTimer = setTimeout(
      () => roundController.abort(new Error('机器人调用模型超时（第 ' + (round + 1) + ' 轮）')),
      roundTimeoutMs,
    );
    try {
      await provider.chat(messages, request.tools, callbacks, roundController.signal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { response: '', error: '调用模型失败：' + msg, toolCalls, configSource: source };
    } finally {
      clearTimeout(roundTimer);
    }
    if (roundText.trim()) text = roundText.trim();

    // 没有工具调用 = 模型认为可以收尾了
    if (calls.length === 0) break;

    for (const call of calls) {
      const out = await request.executeTool(call.name, call.args);
      const record: BotAgentToolRecord = {
        name: call.name,
        args: call.args,
        ok: out.ok,
        result: out.result,
      };
      toolCalls.push(record);
      request.onToolCall?.(record);
      // 工具要求暂停（比如「要用户确认」）：立刻停手，不要再问模型 ——
      // 继续问下去它只会换个说法再提一次同样的操作。
      if (out.halt) {
        halted = true;
        break;
      }
      // 复用唯一构造入口：助手侧那套「结果归一化 + 预算漏斗」在这里同样生效。
      // 走**异步版**才有溢出落盘（超预算时先把完整结果存到 .qqbat/ai-spill/）——
      // 否则两侧行为会分裂：助手侧裁了能找回，机器人侧裁了就没了。
      messages.push(
        ...(await buildToolResultMessagesWithSpill(call, out.result, request.projectPath)).messages,
      );
    }
    if (halted) break;
    if (round === rounds - 1) roundLimitHit = true;
  }

  // 暂停：把当前文本（可能为空）交回调用方，由它给出「请确认」的提示。
  // 这里**不报 error** —— 暂停是正常流程的一部分，不是失败。
  if (halted) {
    return { response: text, error: '', toolCalls, usage, configSource: source, halted: true };
  }
  // 兜底：模型可能一个字都没说（只调了工具）。这时候**不能当成功** ——
  // 那会让机器人「忙了半天什么都不回」，而且日志里看不出问题。
  if (!text) {
    return {
      response: '',
      error: roundLimitHit
        ? '达到工具调用轮数上限，但模型没有给出最终回复'
        : '模型没有给出任何回复文本',
      toolCalls,
      usage,
      configSource: source,
      roundLimitHit,
    };
  }
  return { response: text, error: '', toolCalls, usage, configSource: source, roundLimitHit };
}

/**
 * 向量化（机器人侧 RAG 用）。
 *
 * 空向量必须当**失败**报出来：embedding 的下游通常拿它算相似度，
 * 空数组在多数实现里会得到 NaN 或恒 0 —— 用户看到的是「算出来了但结果永远一样」，
 * 那正是这个仓库最反对的那类「假成功」。
 */
export async function embedText(request: BotEmbedRequest): Promise<BotEmbedResult> {
  const created = await createBotProvider(request.projectPath);
  if (!created.ok) {
    return { vector: [], error: created.error, configSource: created.source };
  }
  const embed = created.provider.embed;
  if (!embed) {
    // 显式失败：接口里 embed 是可选能力，静默返回空向量会被下游当成"算出来了"。
    return {
      vector: [],
      error: '当前 AI 服务商没有实现向量化（embedding）接口，机器人侧 RAG 无法使用。',
      configSource: created.source,
    };
  }
  try {
    const vector = await embed.call(created.provider, request.text);
    if (!Array.isArray(vector) || vector.length === 0) {
      return {
        vector: [],
        error:
          '向量化返回了空向量。多半是该 provider 的嵌入模型没配好（聊天模型能用 ≠ 嵌入模型能用）' +
          '，或这段文本超过了模型的输入长度上限。',
        configSource: created.source,
      };
    }
    return { vector, error: '', configSource: created.source };
  } catch (e) {
    logger.warn('[bot] 向量化失败: ' + String(e));
    return { vector: [], error: String(e), configSource: created.source };
  }
}
