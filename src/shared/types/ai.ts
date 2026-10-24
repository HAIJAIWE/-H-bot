// src/shared/types/ai.ts
import { LLM_PRESET_IDS } from './llm-presets';

/**
 * 可用的 AI 服务商。
 *
 * **从 `llm-presets` 派生**，不手写联合类型 —— 手写会出现"枚举里有、注册表里没有"的
 * 死选项（`claude` 历史上就是这样：枚举里有它，但没有实现，选中只报"未知的 AI Provider"）。
 */
export type AiProvider = (typeof LLM_PRESET_IDS)[number];

/**
 * batch（AI 的"事务性改动"）的**自动提交超时**。
 *
 * 主进程用它在死锁时自动 commit；渲染层用**同一个值**给界面横幅收尾 ——
 * 两边各写一份 30 秒的话，横幅会在主进程已经提交之后继续挂着
 * （2026-10-06 真机截图里就是一直显示"事务操作中…30 秒后自动提交"）。
 */
export const AI_BATCH_TIMEOUT_MS = 30_000;

/**
 * 「计划处置回执」的**协议串**（主进程写进记忆、渲染层触发时引用）。
 *
 * 放 shared 而不是各自写一份：
 *   · 它是**给模型看的**（不是界面文案），两边必须完全一致；
 *   · 渲染层不许硬编码中文文案（`noHardcodedCopy` 闸门），引用常量正好合规矩。
 */
export const AI_TURN_NOTE_PREFIX = '[系统回执] ';
export const AI_NOTE_APPLIED = '用户已确认并应用了你上一份计划。';
/**
 * 用户**撤回了**上一轮的全部改动（2026-10-15 补）。
 *
 * 为什么必须有它：撤回会把 AI 这一轮写的文件与流程**真还原**，但对话记忆是追加式的
 * （不删任何东西）。在这之前撤回**不发任何回执**，于是记忆里还留着上一条
 * 「用户已确认并应用了你上一份计划」—— 模型下一轮会**以为那些东西还在**，
 * 表现为「我已经帮你建好了」这类错话，而磁盘上其实已经没了。
 */
/**
 * 用户点了「↻ 重新生成」（2026-10-15 补）。
 *
 * 为什么必须有它：我们的对话记忆是**追加式**的（只加不删），所以“重新生成”只能把同一个问题
 * **再问一遍** —— 模型会在记忆里**看到自己上一次的答案**。不告诉它「上次作废」，
 * 它很可能回一句「我上面已经答过了」，而不是重做。
 * （另一种做法是 ChatGPT 的截断式：删掉那条之后的记忆再重跑 —— 那会动记忆，本仓库不做。）
 */
export const AI_NOTE_REGENERATE =
  '用户要求**重新生成**你上一条回答：上一次的答案作废，请重新作答（可以换个思路），' +
  '不要回复「我上面已经答过」之类的话。';

export const AI_NOTE_ROLLED_BACK =
  '用户撤回了上一轮的全部改动：那些节点/文件/流程现在已经不存在了，' +
  '不要再把它们当作已存在（要重做就重新提计划）。';
export const AI_NOTE_REJECTED =
  '用户**拒绝**了你上一份计划（没有落盘）。不要原样再提一遍；要改就先说清改哪里。';

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** 「关思考」开关；undefined = 不发该字段（见 aiConfigSchema 的说明） */
  enableThinking?: boolean;
  /**
   * **Key 池（回退链）**：主 provider 不可用时按顺序换。
   *
   * 扁平结构（池里的一项不允许再带 fallbacks），上限 8 —— 与主进程 schema 一致。
   */
  fallbacks?: AiConfig[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /**
   * 厂商回传的思考过程（`reasoning_content`）。只用于界面折叠展示，
   * 不进记忆、也不回灌给模型 —— 与主进程 `llm.ts` 的 `type: 'reasoning'` 对齐。
   */
  reasoning?: string;
  /**
   * 附带的图片（data URL，形如 `data:image/png;base64,...`）。
   *
   * ## 只在**这一轮**有效（2026-10-09）
   *
   * 图片**不落盘**：项目记忆是 1MB 上限的 JSONL，一张截图 base64 就几 MB，
   * 写进去等于把记忆文件撑爆。所以重开对话后图片不会回来 —— 文字会（那是记忆）。
   *
   * 只有用户消息会带它；助手回话与工具结果永远是纯文本。
   */
  images?: string[];
  /**
   * 界面提示的**类别**（2026-10-25）。目前只有 `'compaction'`：
   * 循环里的上下文被压缩时，界面要留一条"刚才丢掉了什么"的痕迹 ——
   * 否则模型忽然忘了前面的事，用户只会觉得它变笨了。
   *
   * 只是**界面标签**：不进记忆、不发模型（记忆里另有一条压缩注记，见 contextGate）。
   */
  notice?: 'compaction';
  toolCalls?: AiToolCall[];
  toolResult?: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * 一条「以后别再问」的批准规则（2026-10-18）。
 *
 * 只在主进程与渲染层之间传递，落盘在项目内的 `.qqbat/ai-approvals.json`；
 * 匹配语义与取舍见 `services/ai/allowRules.ts`。界面要能列出来并删掉 ——
 * 没有撤销口的自动放行是这一条存在的前提。
 */
export interface AiAllowRule {
  /** write = 写某个文件；command = 某条命令；tool = 助手侧某个工具+参数 */
  kind: 'write' | 'command' | 'tool';
  /** 具体动作的匹配键（项目内相对路径 / 命令行 / 工具名+参数） */
  match: string;
  /** ISO 时间戳：界面要说清"什么时候点的" */
  addedAt: string;
}

export type ToolCategory = 'query' | 'mutation';

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category: ToolCategory;
}

/**
 * 一次模型调用**真实**消耗的 token 用量（用于成本观测）。
 *
 * 「真实」是关键字：它由 provider 自己回报，**不是本地估算**。
 * 大多数端点只在流式响应的**最后一帧**才带用量（OpenAI/GLM 的 `usage`；Ollama 则是在
 * `done` 那行给 `prompt_eval_count`/`eval_count`）—— 所以**能拿到就有、拿不到就没有**。
 * 调用方（`bot/llm.ts`）的注释写的正是这个语义：「真实用量（provider 给了才有），用于成本观测」。
 */
/**
 * **一次对话运行的统计**（界面状态条显示的就是它）。
 *
 * 三条纪律（2026-10-08，与"别把估算当账"同源）：
 *  · token 数字**只来自厂商回传**（`usageReported=false` 时界面一个数都不许显示）；
 *  · **不折算金额** —— 价格/阶梯/缓存折扣/免费额度都在厂商侧，本地算出来的钱是编的；
 *  · `contextTokens` 是**本地估算**（用于"窗口还剩多少"），它是功能参数，不是用量。
 */
export interface AiRunStats {
  /** 模型轮数（一次 runOneRound = 一轮） */
  rounds: number;
  /** 工具调用次数（真正执行了的，含去重后只算一次的那些） */
  steps: number;
  /** 以下四个都来自厂商回传；没回传时保持 0 + usageReported=false */
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  usageReported: boolean;
  /** 累计的模型耗时（tok/s 的分母；只算模型那一段，不含工具执行） */
  llmMs: number;
  /** 本地估算的上下文占用（估算，非厂商口径） */
  contextTokens: number;
  /** 上下文预算（估算的上限，用来算占用百分比） */
  contextBudget: number;
  /**
   * 本轮**换过 provider** 时记一句（`主 provider · model → 备用 · model`）。
   *
   * 以前只写进 trace（给机器看），用户完全不知道 —— 于是「为什么这轮答得不一样」
   * 只能靠猜。现在状态条上给一个标记（2026-10-09）。
   */
  fallbackNote?: string;
  /**
   * **最吃上下文的那几条**（估算，按 token 降序，最多 5 条）。
   *
   * 为什么要有：只有一个百分比，用户不知道该动哪里 ——
   * 「系统提示吃了 8.8K」和「十条工具结果各吃了 600」是两种完全不同的处置。
   * 数据来自 measureConversation（同一份估算，不另算一遍）。
   */
  contextHeaviest?: Array<{ role: string; tokens: number }>;
  /** 整段对话的字符数（仅用于可读性，与 token 一起显示） */
  contextChars?: number;
  /**
   * **计划阶段跑了几轮**（P1-7；见 chatRun.ts 的 PLAN_PHASE 说明）。
   *
   * 为什么单独记一个数：轮数是这个循环里最稀缺的资源，而"计划阶段"**故意要多吃 1..3 轮**。
   * 不单独记出来，事后看日志只会觉得"这轮怎么变慢了" —— 分不清是模型啰嗦还是计划阶段在花钱。
   * 恒为 0 = 没进过计划阶段（默认关；`QQBAT_PLAN_PHASE=1` 才可能 > 0）。
   */
  planRounds?: number;
}

export interface LlmUsage {
  /** 输入（提示词）token 数 */
  promptTokens: number;
  /** 输出（生成）token 数 */
  completionTokens: number;
  /** 合计；provider 没给时由输入 + 输出相加 */
  totalTokens: number;
  /**
   * **命中缓存**的输入 token（provider 报才有）。
   *
   * 各家字段名不同（OpenAI/dashscope：`prompt_tokens_details.cached_tokens`；
   * DeepSeek：`prompt_cache_hit_tokens`；Anthropic 系：`cache_read_input_tokens`），
   * 由 `normalizeUsage` 归一。**没报就是 undefined** —— 不存在"0 = 没命中"这种编出来的结论。
   */
  cachedTokens?: number;
}
