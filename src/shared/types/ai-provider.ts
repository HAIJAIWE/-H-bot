// @ts-nocheck
// 由 H Bot 10/18 编译产物 region 还原（src/shared/types/ai-provider.ts），只保证语法/行为，类型待补。

import type { AiToolCall, AiToolDefinition, ChatMessage, LlmUsage } from './ai'
import { DOMESTIC_LLM_PRESETS, defaultBaseUrlOf } from './llm-presets'
import { assembleStream } from '../ai/streamAssembler'
import { retryDelayMs, withLlmRetry } from '../ai/retryRunner'

/**
 * Provider 实例配置（`providerRegistry.getOrCreate()` 的入参）。
 * 字段与 `AiConfig` 对齐，但这里不引用它 —— 运行时配置可能来自项目/机器人两套来源。
 */
export interface AIProviderConfig {
  provider?: string
  apiKey?: string
  model?: string
  baseUrl?: string
  enableThinking?: boolean
  [key: string]: unknown
}

/** 流式增量：`content` 是本段文本；`reasoning` 类增量单独标 type，界面折叠显示。 */
export interface ProviderChunk {
  type: 'text' | 'reasoning'
  content: string
}

/** 流式回调（三家 provider 共用同一形状） */
export interface ProviderCallbacks {
  onChunk: (chunk: ProviderChunk) => void
  onComplete: (text: string) => void
  onToolCalls?: (calls: AiToolCall[]) => void | Promise<void>
  onUsage?: (usage: LlmUsage) => void
}

/** Provider 统一接口：`chat()` 流式地把结果推给 callbacks */
export interface AIProviderInterface {
  chat(
    messages: ChatMessage[],
    tools: AiToolDefinition[] | undefined,
    callbacks: ProviderCallbacks,
    signal?: AbortSignal,
  ): Promise<void>
  /** 嵌入（可选能力；不是所有 provider 都实现）。单条文本 → 一个向量（产物里三家都按这个形态实现） */
  embed?: (text: string) => Promise<number[]>
}

/** 默认 HTTP 请求超时（30 秒） */
var DEFAULT_TIMEOUT_MS = 3e4
/** AI 聊天请求超时（60 秒，LLM 生成可能较慢） */
var CHAT_TIMEOUT_MS = 6e4
/** 带超时控制的 fetch，默认 30 秒超时 */
/**
 * 带**空闲超时**的 fetch。
 *
 * ## 为什么不是"总时长超时"
 *
 * LLM 的流式回答可能持续很久（几十秒到几分钟），但**任何一刻都可能在吐字**。
 * 按总时长杀会在"模型思考了 30 秒然后开始回答"时误杀一个完全正常的请求。
 * 判据应该是**"还活着吗"**，而不是"跑了多久" —— 所以每次读到数据就重置计时器。
 *
 * ## 原实现的漏洞（实测）
 *
 * 它 `await fetch(...)` 之后立刻 `clearTimeout(timer)` —— 也就是只护住了**连接阶段**。
 * 一旦拿到响应头，流再卡住就没人管了：连接成功、响应头已到、然后永远不吐字，
 * `reader.read()` 会**永久挂起**。用户看到的是"AI 卡住了，转圈不动"。
 *
 * ## 外部取消
 *
 * 调用方传进来的 `signal` 原来被**完全忽略**（`{...options, signal: controller.signal}`
 * 把 options.signal 覆盖掉了）—— 也就是"取消"按钮点了没用。现在两条信号合并。
 */
async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS, externalSignal) {
  const controller = new AbortController()
  let abortReason = null
  const onExternalAbort = () => {
    abortReason = 'external'
    controller.abort()
  }
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  let timer = null
  const bumpIdle = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      abortReason = 'idle'
      controller.abort()
    }, timeoutMs)
  }
  const clearIdle = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  bumpIdle()
  let response
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (e) {
    clearIdle()
    externalSignal?.removeEventListener('abort', onExternalAbort)
    throw e
  }
  if (!response.body) {
    clearIdle()
    externalSignal?.removeEventListener('abort', onExternalAbort)
    return response
  }
  const reader = response.body.getReader()
  const stream = new ReadableStream({
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          clearIdle()
          externalSignal?.removeEventListener('abort', onExternalAbort)
          ctrl.close()
          return
        }
        bumpIdle()
        ctrl.enqueue(value)
      } catch (e) {
        clearIdle()
        externalSignal?.removeEventListener('abort', onExternalAbort)
        if (abortReason === 'idle')
          ctrl.error(/* @__PURE__ */ new Error(`读取响应超时（空闲 ${timeoutMs}ms 没有数据）`))
        else ctrl.error(e instanceof Error ? e : new Error(String(e)))
      }
    },
    cancel(reason) {
      clearIdle()
      externalSignal?.removeEventListener('abort', onExternalAbort)
      reader.cancel(reason)
    },
  })
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
/**
 * Provider 返回了非 2xx。
 *
 * ## 为什么要一个专门的类（而不是 `new Error('... (429): ...')`）
 *
 * 原来这三处抛出点把状态码**只写在消息字符串里**。而调用方要判断"这次失败该不该重试"
 * 时，就只能去正则匹配那句中文 —— 换个 provider、改一下措辞，重试逻辑就静默失效了
 * （而且失效方式最难查：不报错，只是"偶尔不重试"）。
 *
 * 有了 `status` 字段，重试判据就是一条明确的规则：
 * **429 与 5xx 可重试，其余 4xx 不可**（400/401/403/404 重试多少次都是一样的结果）。
 */
var ProviderHttpError = class extends Error {
  status
  /** 厂商在 `Retry-After` 里要求的等待毫秒数；没有就是 undefined（重试器会退回本地退避） */
  retryAfterMs
  constructor(status, message, retryAfterMs) {
    super(message)
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.name = 'ProviderHttpError'
  }
}
/**
 * 从 `Retry-After` 头算等待毫秒数。两种格式都认：秒数（"3"）与 HTTP 日期。
 * 认不出来返回 undefined —— 不臆造一个等待时间。
 */
function retryAfterMsOf(response) {
  const raw = response?.headers?.get?.('retry-after')
  if (!raw) return void 0
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1e3)
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return void 0
  return Math.max(0, at - Date.now())
}
/** 统一的 4xx/5xx 抛出点：状态码 + 厂商要求等待多久，一次都带上 */
function providerHttpError(response, message) {
  return new ProviderHttpError(response.status, message, retryAfterMsOf(response))
}
/**
 * 把各家五花八门的用量字段归一成 `LlmUsage`；认不出来就返回 null（**不臆造数字**）。
 *
 * 认不出来时不回调 —— 让"没有用量"保持为"没有"，而不是报一个 0 出去被当成真实成本。
 */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const r = raw
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : void 0)
  const prompt = num(r.prompt_tokens) ?? num(r.prompt_eval_count)
  const completion = num(r.completion_tokens) ?? num(r.eval_count)
  const total =
    num(r.total_tokens) ??
    (prompt !== void 0 || completion !== void 0 ? (prompt ?? 0) + (completion ?? 0) : void 0)
  if (prompt === void 0 && completion === void 0 && total === void 0) return null
  const details = r.prompt_tokens_details
  const cached =
    num(r.prompt_cache_hit_tokens) ??
    num(r.cache_read_input_tokens) ??
    (details && typeof details === 'object' ? num(details.cached_tokens) : void 0)
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total ?? 0,
    ...(cached !== void 0 ? { cachedTokens: cached } : {}),
  }
}
/**
 * 把 ChatMessage[] 映射为 OpenAI 兼容的消息格式。
 * 保留 assistant 的 tool_calls（OpenAI function calling 格式）和 tool 结果（role=tool）。
 */
/**
 * 一条消息给厂商的 `content`。
 *
 * 带图时用 OpenAI 兼容的**多段格式**（text + image_url）；不带图时仍是**纯字符串** ——
 * 保持老行为：多段数组不是所有端点都吃，没图就没有理由冒这个险。
 */
function apiContentOf(m) {
  if (!m.images || m.images.length === 0) return m.content
  return [
    {
      type: 'text',
      text: m.content || '[image]',
    },
    ...m.images.map(url => ({
      type: 'image_url',
      image_url: { url },
    })),
  ]
}
function mapChatMessages(messages) {
  return messages.map((m, i) => {
    const msg = {
      role: m.role,
      content: apiContentOf(m),
    }
    if (m.toolCalls && m.toolCalls.length > 0)
      msg.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }))
    if (m.toolResult !== void 0) {
      msg.role = 'tool'
      msg.tool_call_id = m.toolCalls?.[0]?.id ?? messages[i - 1]?.toolCalls?.[0]?.id ?? ''
      msg.content = m.toolResult
    }
    return msg
  })
}
/**
 * 把配置压成一个可比较的字符串（用于判断"实例是不是该重建"）。
 *
 * 只取**会影响实例行为**的字段；对象键顺序固定，避免同一份配置因为键序不同被判成"变了"。
 */
function fingerprintConfig(config) {
  const c = config
  return JSON.stringify(
    ['provider', 'apiKey', 'model', 'baseUrl', 'enableThinking'].map(k => [k, c[k] ?? null]),
  )
}
var ProviderRegistry = class {
  providers = /* @__PURE__ */ new Map()
  instances = /* @__PURE__ */ new Map()
  /**
   * 每个实例**当初是用哪份配置建的**。
   *
   * 为什么必须记：`getOrCreate` 原来只看名字 —— 实例存在就原样返回，**新配置被丢掉**。
   * 后果是"在智能体面板改了模型/密钥，保存后不重启不生效"（面板看起来能用、实际没换）。
   * 这是 docs/ai/agent-panel-design.md 第五节记的那个 bug。
   *
   * 现在带上配置一起比对：**配置没变就复用**（避免无谓重建），**变了就重建**。
   */
  instanceConfigs = /* @__PURE__ */ new Map()
  currentProvider = null
  register(name, factory) {
    this.providers.set(name, factory)
  }
  getFactory(name) {
    return this.providers.get(name)
  }
  list() {
    return Array.from(this.providers.keys())
  }
  has(name) {
    return this.providers.has(name)
  }
  /** 创建 Provider 实例 */
  create(name, config) {
    const Factory = this.providers.get(name)
    if (!Factory) throw new Error(`未知的 AI Provider: ${name}`)
    const instance = new Factory(config)
    this.instances.set(name, instance)
    this.instanceConfigs.set(name, fingerprintConfig(config))
    return instance
  }
  /** 获取或创建 Provider 实例 */
  /**
   * 获取或创建 Provider 实例。
   *
   * 复用时**必须把新配置推下去**：这是"面板保存后立刻生效"的关键。
   * 原实现是 `if (existing) return existing;` —— 新配置被丢掉，
   * 于是用户改完模型/密钥"看起来没生效"，要重启才好（设计稿第五节记的 bug）。
   */
  getOrCreate(name, config) {
    const existing = this.instances.get(name)
    if (existing) {
      const next = fingerprintConfig(config)
      if (this.instanceConfigs.get(name) !== next && 'updateConfig' in existing)
        existing.updateConfig(config)
      this.instanceConfigs.set(name, next)
      return existing
    }
    return this.create(name, config)
  }
  /**
   * 当前 provider 的**完整配置**（界面回显用）。
   *
   * 读不回来就会"再保存一次把设置抹掉"：对话框只从内存回显，冷启动显示默认值，
   * 用户点保存就把磁盘上那份好配置覆盖了。
   */
  getCurrentConfig() {
    if (!this.currentProvider) return null
    return this.instances.get(this.currentProvider)?.getConfig?.() ?? null
  }
  /** 清掉某个 provider 的缓存实例（下一位调用者会用新配置重建） */
  invalidate(name) {
    this.instances.delete(name)
    this.instanceConfigs.delete(name)
  }
  /** 设置当前使用的 Provider */
  setCurrent(name) {
    if (!this.providers.has(name)) throw new Error(`未知的 AI Provider: ${name}`)
    this.currentProvider = name
  }
  /** 获取当前 Provider 名称 */
  getCurrent() {
    return this.currentProvider
  }
  /** 获取当前 Provider 实例 */
  getCurrentInstance() {
    if (!this.currentProvider) return null
    return this.instances.get(this.currentProvider) ?? null
  }
}
/** 全局 Provider 注册表单例 */
var providerRegistry = new ProviderRegistry()
var GLM_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
var GLMProvider = class {
  name = 'glm'
  config
  constructor(config) {
    this.config = config
  }
  /**
   * 当前生效的配置。
   *
   * 为什么要有：注册表复用实例时要把**新配置推下去**（`updateConfig`），
   * 而"面板保存后不重启不生效"的根因就是实例里那份配置再也没被更新过。
   * 读回来也是必要的 —— 界面回显拿不到完整配置时，用户"再保存一次"会把设置抹掉。
   */
  getConfig() {
    return this.config
  }
  /** 推新配置（实例仍在用，只是换了模型/密钥/开关） */
  updateConfig(config) {
    this.config = config
  }
  async chat(
    messages: ChatMessage[],
    tools: AiToolDefinition[] | undefined,
    callbacks: ProviderCallbacks,
    signal?: AbortSignal,
  ) {
    const baseUrl = this.config.baseUrl || GLM_DEFAULT_BASE_URL
    const body = {
      model: this.config.model,
      messages: mapChatMessages(messages),
      stream: true,
    }
    if (typeof this.config.enableThinking === 'boolean')
      body.enable_thinking = this.config.enableThinking
    if (tools.length > 0)
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      CHAT_TIMEOUT_MS,
      signal,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `GLM API 请求失败 (${response.status}): ${text}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    await assembleStream(reader, 'openai', { callbacks, mapUsage: normalizeUsage })
  }
  async *stream(messages) {
    const response = await fetchWithTimeout(
      `${this.config.baseUrl || GLM_DEFAULT_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: apiContentOf(m),
          })),
          stream: true,
        }),
      },
      CHAT_TIMEOUT_MS,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `GLM API 请求失败 (${response.status}): ${text}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const jsonStr = trimmed.slice(6)
        if (jsonStr === '[DONE]') continue
        try {
          const text = JSON.parse(jsonStr).choices?.[0]?.delta?.content
          if (text) yield text
        } catch {}
      }
    }
  }
  async embed(text) {
    const baseUrl = this.config.baseUrl || GLM_DEFAULT_BASE_URL
    const embedModel = this.config.embedModel || 'embedding-2'
    const response = await fetchWithTimeout(
      `${baseUrl}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: embedModel,
          input: text,
        }),
      },
      CHAT_TIMEOUT_MS,
    )
    if (!response.ok) {
      const errText = await response.text()
      throw providerHttpError(response, `GLM Embedding 请求失败 (${response.status}): ${errText}`)
    }
    return (await response.json()).data[0]?.embedding ?? []
  }
}
var OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
/**
 * 取该 provider 实际要用的 base URL。
 *
 * 两个回落：
 *   1. 用户没填 → 查 `llm-presets` 的默认地址（国内各家路径不同，见预设表）；
 *      查不到再退 OpenAI 默认。
 *   2. 用户把 **完整端点** 粘进来了（`https://api.deepseek.com/chat/completions`）
 *      → 去掉 `/chat/completions` 后缀。各家文档给的"base_url"写法不一致，
 *      直接粘官方示例是最常见的用法，必须容忍。
 */
function resolveCompatBaseUrl(config) {
  return (
    String(config.baseUrl ?? '').trim() ||
    defaultBaseUrlOf(String(config.provider ?? '')) ||
    OPENAI_DEFAULT_BASE_URL
  )
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/+$/, '')
}
/**
 * **任意 OpenAI 兼容服务商**的 provider。
 *
 * ## 为什么一个类顶十家
 *
 * DeepSeek / 智谱 / 通义 / Kimi / 豆包 / MiniMax / 百川 / 阶跃 / 硅基流动 …
 * **都提供 OpenAI 兼容的 `/chat/completions`**，请求体与 SSE 解析完全一致。
 * 差异只有三处，且都是数据：
 *   · `baseUrl`（各家路径不同：智谱是 /api/paas/v4、百炼要带 /compatible-mode/v1）
 *   · `model` 名
 *   · 是否需要 API Key（本地 Ollama 不需要）
 *
 * 所以按 `config.provider` 从预设表取默认地址，一个类覆盖全部。
 * 加一家新服务商 = 在 `llm-presets.ts` 加一条，**不写新类**。
 */
var OpenAICompatibleProvider = class {
  /** 与 config.provider 一致（注册表按它取实例） */
  name
  config
  constructor(config) {
    this.config = config
    this.name = config.provider
  }
  /** 当前生效的配置（见 GLMProvider 同名方法的说明） */
  getConfig() {
    return this.config
  }
  /** 推新配置（实例仍在用，只是换了模型/密钥/开关） */
  updateConfig(config) {
    this.config = config
  }
  async chat(
    messages: ChatMessage[],
    tools: AiToolDefinition[] | undefined,
    callbacks: ProviderCallbacks,
    signal?: AbortSignal,
  ) {
    const baseUrl = resolveCompatBaseUrl(this.config)
    const body = {
      model: this.config.model,
      messages: mapChatMessages(messages),
      stream: true,
      /**
       * **主动要用量**（2026-10-08）。
       *
       * OpenAI 兼容端点在流式下**默认不回** `usage` —— 不加这个字段，界面上就永远没有
       * 「这一轮吃了多少 token」，只能拿本地估算充数（而那正是「看起来像账、其实不是」的东西）。
       * 它是 OpenAI 的标准字段，不是自造参数。
       *
       * ⚠️ GLM 那一份请求体**刻意不加**：它本来就在最后一帧带 usage（见 aiProviderUsage 的用例），
       * 而各家兼容端对未知字段的容忍度不一样 —— 能拿到的就别冒 400 的风险。
       */
      stream_options: { include_usage: true },
    }
    if (typeof this.config.enableThinking === 'boolean')
      body.enable_thinking = this.config.enableThinking
    if (tools.length > 0)
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      CHAT_TIMEOUT_MS,
      signal,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `OpenAI API 请求失败 (${response.status}): ${text}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    await assembleStream(reader, 'openai', { callbacks, mapUsage: normalizeUsage })
  }
  async *stream(messages) {
    const response = await fetchWithTimeout(
      `${resolveCompatBaseUrl(this.config)}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: apiContentOf(m),
          })),
          stream: true,
        }),
      },
      CHAT_TIMEOUT_MS,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `OpenAI API 请求失败 (${response.status}): ${text}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const jsonStr = trimmed.slice(6)
        if (jsonStr === '[DONE]') continue
        try {
          const text = JSON.parse(jsonStr).choices?.[0]?.delta?.content
          if (text) yield text
        } catch {}
      }
    }
  }
  async embed(text) {
    const response = await fetchWithTimeout(
      `${resolveCompatBaseUrl(this.config)}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: text,
        }),
      },
      CHAT_TIMEOUT_MS,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `Embedding 请求失败 (${response.status}): ${text}`)
    }
    return (await response.json()).data[0]?.embedding ?? []
  }
}
var OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434'
var OllamaProvider = class {
  name = 'ollama'
  config
  constructor(config) {
    this.config = config
  }
  async chat(
    messages: ChatMessage[],
    _tools: AiToolDefinition[] | undefined,
    callbacks: ProviderCallbacks,
    signal?: AbortSignal,
  ) {
    const response = await fetchWithTimeout(
      `${this.config.baseUrl || OLLAMA_DEFAULT_BASE_URL}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: apiContentOf(m),
          })),
          stream: true,
        }),
      },
      CHAT_TIMEOUT_MS,
      signal,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `Ollama API 请求失败 (${response.status}): ${text}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    await assembleStream(reader, 'ollama', { callbacks, mapUsage: normalizeUsage })
  }
  async *stream(messages) {
    const response = await fetchWithTimeout(
      `${this.config.baseUrl || OLLAMA_DEFAULT_BASE_URL}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: apiContentOf(m),
          })),
          stream: true,
        }),
      },
      CHAT_TIMEOUT_MS,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `Ollama API 请求失败 (${response.status}): ${text}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          const content = parsed.message?.content ?? parsed.response ?? ''
          if (content) yield content
        } catch {}
      }
    }
  }
  async embed(text) {
    const response = await fetchWithTimeout(
      `${this.config.baseUrl || OLLAMA_DEFAULT_BASE_URL}/api/embeddings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: text,
        }),
      },
      CHAT_TIMEOUT_MS,
    )
    if (!response.ok) {
      const text = await response.text()
      throw providerHttpError(response, `Ollama Embedding 请求失败 (${response.status}): ${text}`)
    }
    return (await response.json()).embedding ?? []
  }
}
for (const preset of DOMESTIC_LLM_PRESETS) {
  if (preset.id === 'glm' || preset.id === 'ollama') continue
  providerRegistry.register(preset.id, OpenAICompatibleProvider)
}
providerRegistry.register('glm', GLMProvider)
providerRegistry.register('ollama', OllamaProvider)
// 重试/退避的实现在 `src/shared/ai/retryRunner.ts`（策略与退避公式来自 vendor/dsh/llm-retry），
// 这里只保留 re-export，历史导入路径不变。

export {
  fetchWithTimeout,
  normalizeUsage,
  apiContentOf,
  mapChatMessages,
  fingerprintConfig,
  resolveCompatBaseUrl,
  retryDelayMs,
  withLlmRetry,
  DEFAULT_TIMEOUT_MS,
  CHAT_TIMEOUT_MS,
  ProviderHttpError,
  ProviderRegistry,
  providerRegistry,
  GLM_DEFAULT_BASE_URL,
  GLMProvider,
  OPENAI_DEFAULT_BASE_URL,
  OpenAICompatibleProvider,
  OLLAMA_DEFAULT_BASE_URL,
  OllamaProvider,
}
