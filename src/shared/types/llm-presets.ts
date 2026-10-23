// src/shared/types/llm-presets.ts
//
// 国内大模型服务商预设 —— **唯一真相层**。
//
// ## 为什么要有这张表
//
// 之前 provider 下拉里只有 `glm` / `openai` / `ollama`，而 `claude` **在枚举里却根本没有实现**
// （选中它只会得到"未知的 AI Provider"）。国内用户想接 DeepSeek / 通义 / Kimi / 豆包
// 只能选 "OpenAI 兼容" 然后**自己手填 Base URL** —— 而那个地址（用户说的"端口"）
// 和"去哪申请 Key"（"链接"）恰恰是最容易填错的两件事：
//   · DeepSeek 的 base_url 有 `https://api.deepseek.com` 和 `.../v1` 两种写法；
//   · 智谱的路径是 `/api/paas/v4`，不是 `/v1`；
//   · 百炼的 OpenAI 兼容模式必须带 `/compatible-mode/v1`。
//
// 所以把"服务商 → 地址 / 模型 / 申请入口"做成数据，面板只读这份。
//
// ## 全部走 OpenAI 兼容协议
//
// 下面这些服务商**都提供 OpenAI 兼容的 `/chat/completions`**，
// 所以实现上共用 `OpenAICompatibleProvider`（见 ai-provider.ts），
// 差异只在 `baseUrl` + `model` + 鉴权头 —— 正好是这张表能表达的。
// 这也是为什么加一家新服务商只需要在这里加一条，不用写新类。
//
// ## ⚠️ 模型名会过期 —— 所以设计上不依赖它
//
// 大模型型号迭代以月计，**这张表里的 `models` 一定会变旧**（实测：
// `moonshot-v1-*` 系列已于 2026-08-31 全线下线、`deepseek-chat` 已被
// `deepseek-flash` 取代、通义从 `qwen-plus` 走到 `qwen3.8-max`）。
// 因此：
//   · `models` 只当**下拉候选**，面板**永远允许手填**（选「自定义…」）；
//   · 每家都带 `docsUrl`，面板给出"查最新模型列表"的链接；
//   · 因此**过期的代价是"下拉里少个新名字"，不是"用不了"**。
export interface LlmPreset {
  /** provider 标识（存进配置、也是注册表里的 key） */
  id: string;
  /** 面板显示名 */
  label: string;
  /**
   * API 接入地址（用户说的"端口"）。
   *
   * 一律**不带** `/chat/completions` 后缀 —— 由 provider 拼接（它会容忍两种写法，
   * 见 `resolveCompatBaseUrl`）。
   */
  baseUrl: string;
  /** 去哪申请 API Key（用户说的"链接"）—— 面板上给可点的入口 */
  keyPage: string;
  /** 官方模型列表页（模型名会过期，用户需要能自己查最新） */
  docsUrl: string;
  /** 常见模型（下拉候选；面板同时允许手填） */
  models: readonly string[];
  /** 默认模型 */
  defaultModel: string;
  /** 是否需要 API Key（本地模型不需要） */
  needsKey: boolean;
  /** 该服务商容易踩的坑（面板上显示一行提示） */
  note?: string;
}

/**
 * 国内服务商。**按用户常见程度排序**（面板下拉的顺序就是它）。
 *
 * 模型名核对时间：2026-09-22（来源为各家官方文档，见各条 `docsUrl`）。
 */
// ⚠️ `as const` 不能省。原先这里标的是 `: readonly LlmPreset[]`，而 `LlmPreset.id` 是
// `string` —— 于是 `LLM_PRESET_IDS` 退化成 `string[]`，`AiProvider = (typeof LLM_PRESET_IDS)[number]`
// 也就退化成 **`string`**：所谓"AI 服务商类型"实际上什么也没约束。
// `as const` 保住 id 的字面量，`satisfies` 保住"每条都必须符合 LlmPreset"这条约束
// —— 两者缺一：少了 as const 就丢字面量，少了 satisfies 就丢结构校验。
export const DOMESTIC_LLM_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek（深度求索）',
    baseUrl: 'https://api.deepseek.com/v1',
    keyPage: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-flash',
    needsKey: true,
    note: '旧名 deepseek-chat / deepseek-reasoner 已由 deepseek-flash 承接；也支持 Anthropic 格式（/anthropic）',
  },
  {
    id: 'glm',
    label: '智谱 GLM（BigModel）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyPage: 'https://open.bigmodel.cn/usercenter/apikeys',
    docsUrl: 'https://docs.z.ai/guides/overview/pricing',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-4.6'],
    defaultModel: 'glm-5.3',
    needsKey: true,
    note: '路径是 /api/paas/v4（不是 /v1）；海外版走 z.ai 域名',
  },
  {
    id: 'dashscope',
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyPage: 'https://bailian.console.aliyun.com/?apiKey=1',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/models',
    models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen-long'],
    defaultModel: 'qwen3.7-plus',
    needsKey: true,
    note: '必须带 /compatible-mode/v1 这段路径；百炼同时托管 deepseek / kimi / glm 等第三方模型',
  },
  {
    id: 'moonshot',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    keyPage: 'https://platform.moonshot.cn/console/api-keys',
    docsUrl: 'https://platform.kimi.ai/docs/models',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'],
    defaultModel: 'kimi-k3',
    needsKey: true,
    note: 'moonshot-v1 系列与 kimi-k2 系列均已下线，请用 kimi-k3',
  },
  {
    id: 'ark',
    label: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    keyPage: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    docsUrl: 'https://docs.volcengine.com/docs/ark/model-list',
    models: ['doubao-seed-1.6', 'doubao-seed-1.6-flash', 'doubao-pro-32k'],
    defaultModel: 'doubao-seed-1.6',
    needsKey: true,
    note: 'model 要填**推理接入点 ID**（ep- 开头）或模型名，以控制台"模型列表"为准',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow（聚合）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    keyPage: 'https://cloud.siliconflow.cn/account/ak',
    docsUrl: 'https://docs.siliconflow.cn/cn/api-reference/models/get-model-list',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen3-235B-A22B-Instruct-2507',
      'zai-org/GLM-4.6',
      'moonshotai/Kimi-K2-Instruct',
    ],
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    needsKey: true,
    note: '聚合平台：一个 Key 可用多家开源模型，模型名带 `组织/模型` 前缀',
  },
  {
    id: 'minimax',
    label: 'MiniMax（稀宇）',
    baseUrl: 'https://api.minimax.chat/v1',
    keyPage: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    docsUrl: 'https://platform.minimaxi.com/document/guides/chat-model/V2',
    models: ['MiniMax-M3', 'MiniMax-Text-01', 'abab6.5s-chat'],
    defaultModel: 'MiniMax-M3',
    needsKey: true,
    note: '型号迭代较快，以控制台文档为准',
  },
  {
    id: 'baichuan',
    label: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    keyPage: 'https://platform.baichuan-ai.com/console/apikey',
    docsUrl: 'https://platform.baichuan-ai.com/docs/api',
    models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k'],
    defaultModel: 'Baichuan4',
    needsKey: true,
  },
  {
    id: 'stepfun',
    label: '阶跃星辰 StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    keyPage: 'https://platform.stepfun.com/interface-key',
    docsUrl: 'https://platform.stepfun.com/docs/overview/concept',
    models: ['step-2-16k', 'step-1-32k', 'step-1-8k'],
    defaultModel: 'step-2-16k',
    needsKey: true,
  },
  {
    id: 'ollama',
    label: '本地模型（Ollama）',
    baseUrl: 'http://localhost:11434',
    keyPage: 'https://ollama.com/download',
    docsUrl: 'https://ollama.com/library',
    models: ['qwen3', 'qwen2.5', 'deepseek-r1', 'llama3.1', 'glm4'],
    defaultModel: 'qwen3',
    needsKey: false,
    note: '走 Ollama 原生 /api/chat 协议（不是 OpenAI 兼容）',
  },
  {
    id: 'openai',
    label: 'OpenAI 兼容（自定义）',
    baseUrl: 'https://api.openai.com/v1',
    keyPage: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs/models',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
    note: '任何 OpenAI 兼容端点都可以：把 Base URL 改成你自己的地址',
  },
] as const satisfies readonly LlmPreset[];

/** 按 id 取预设（找不到返回 undefined，调用方自己决定怎么报错） */
export function findLlmPreset(id: string): LlmPreset | undefined {
  return DOMESTIC_LLM_PRESETS.find((p) => p.id === id);
}

/**
 * 全部预设 id（给 schema 的 enum 与注册表用）。
 *
 * 类型由 `DOMESTIC_LLM_PRESETS` 推导，**不要**再标注成 `readonly string[]` ——
 * 那会把字面量联合擦成 `string`，`AiProvider` 随之失效（见上面 as const 的注释）。
 */
export const LLM_PRESET_IDS = DOMESTIC_LLM_PRESETS.map((p) => p.id);

/** 该 provider 的默认 Base URL（找不到预设时返回空串，由调用方回落） */
export function defaultBaseUrlOf(id: string): string {
  return findLlmPreset(id)?.baseUrl ?? '';
}
