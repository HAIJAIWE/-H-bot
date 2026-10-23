// src/shared/nodes/groups/ai.ts
//
// # 目录分片：AI（3 个节点）
//
// 从 `builtinCatalog.ts` 按 `group` 拆出来（2026-10-03）。**条目原文搬运，未做任何改写**；
// 等价性由「按 kind 排序后的哈希」证明（见提交说明）。加新节点请加在本文件里。
import { inModes } from '../catalogHelpers';
import { AGENT_CHAT_MODE_OPTIONS } from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const aiNodes: NodeSpecV2[] = [
  {
    kind: 'embedding',
    type: 'ai',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    label: '文本向量化',
    group: 'AI',
    icon: '🧬',
    // 2026-09-27：**已接上真实嵌入能力**（此前是占位实现，运行时恒报"未接入"）。
    // 它走与 `agent_chat` 完全相同的模型配置链路：项目 `botAi` → `ai` → 全局 → 内存会话。
    description: '把文本转成向量，用于语义搜索 / 相似度计算',
    summary:
      '调用配置里的嵌入模型，把文本转成向量（`vector`）并给出维度（`dimensions`）。' +
      '需要先配好模型与密钥；拿不到配置或返回空向量时明确报错，不给假向量。',
    sideEffects: [],
    tags: ['AI', 'embedding', '向量', 'RAG', '语义'],
    handler: { source: 'builtin', module: 'embedding' },
    exposedAsTool: true,
    toolName: '文本向量化',
    toolArgs: ['text'],
    defaultConfig: {},
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'text',
        name: '文本',
        kind: 'data',
        dataType: 'string',
        required: true,
        description: '要向量化的文本',
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'vector',
        name: '向量',
        kind: 'data',
        dataType: 'list',
        description: '文本的向量表示（浮点数列表）',
      },
      { id: 'dimensions', name: '维度', kind: 'data', dataType: 'number', description: '向量维度' },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）',
      },
    ],
  },
  {
    kind: 'agent_chat',
    type: 'ai',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'ai_chat',
    label: 'AI 智能体对话',
    group: 'AI',
    icon: '🤖',
    description: '大模型对话 + 可选工具调用',
    summary:
      '统一的 AI 智能体节点。选「单次对话」只问答一次；选「智能体」会按用户消息动态挑选并调用工具节点，支持多轮对话。',
    sideEffects: [],
    tags: ['LLM', 'AI', '对话', '智能体', '工具调用'],
    handler: { source: 'builtin', module: 'agent_chat' },
    exposedAsTool: true,
    toolName: 'AI 智能体对话',
    toolArgs: ['prompt', 'system_prompt', 'mode', 'tools'],
    defaultConfig: {
      mode: 'chat',
      system_prompt: '',
      temperature: 0.7,
      max_rounds: 3,
      confirm_high_risk: true,
      tools: '[]',
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'chat',
        description: '可选：单次对话 / 多轮工具调用',
        options: AGENT_CHAT_MODE_OPTIONS,
      },
      {
        id: 'prompt',
        name: '提示词',
        kind: 'data',
        dataType: 'string',
        required: true,
        description: '用户输入或系统提示词',
      },
      {
        id: 'history',
        name: '历史记录',
        kind: 'data',
        dataType: 'list',
        description: '对话历史 JSON',
      },
      {
        id: 'system_prompt',
        name: '系统提示词',
        kind: 'data',
        dataType: 'string',
        description: 'AI 系统提示词（角色设定）',
      },
      {
        id: 'temperature',
        name: '温度',
        kind: 'data',
        dataType: 'number',
        description: 'LLM 采样温度（0-2）',
      },
      {
        id: 'max_rounds',
        name: '最大轮数',
        kind: 'data',
        dataType: 'number',
        default: 3,
        description: '「多轮工具调用」下最多调用工具多少轮',
        showWhen: inModes('agent'),
      },
      {
        id: 'confirm_high_risk',
        name: '高风险确认',
        kind: 'data',
        dataType: 'boolean',
        default: true,
        description: '高风险工具需确认',
      },
      {
        id: 'tools',
        name: '可用工具',
        kind: 'data',
        dataType: 'list',
        description: '「多轮工具调用」模式下可用的工具节点清单，留空表示全部可用',
        showWhen: inModes('agent'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'response',
        name: '回复',
        kind: 'data',
        dataType: 'string',
        description: 'AI 最终回复文本',
      },
      {
        id: 'tool_calls',
        name: '工具调用记录',
        kind: 'data',
        dataType: 'list',
        description: '「多轮工具调用」下的工具调用历史',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）',
      },
    ],
  },
  {
    kind: 'intent_classify',
    type: 'ai',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    label: '意图识别',
    group: 'AI',
    icon: '🎯',
    // 2026-09-27：**已接上真实实现**（走 `callBotLlm`，与 agent_chat 同一套配置链路）。
    description: '用 LLM 对用户消息做意图分类',
    summary:
      '给一组候选意图让模型选最匹配的，输出标签（`intent`）、置信度（`confidence`）' +
      '与各意图分数（`all_scores`）。模型返回候选外的标签会明确报错，不透出。',
    sideEffects: [],
    tags: ['AI', '意图', '分类'],
    handler: { source: 'builtin', module: 'intent_classify' },
    exposedAsTool: false,
    defaultConfig: { system_prompt: '', temperature: 0.3, intents: '[]' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'user_message',
        name: '用户消息',
        kind: 'data',
        dataType: 'string',
        required: true,
        description: '要分类的用户消息文本',
      },
      {
        id: 'intents',
        name: '意图列表',
        kind: 'data',
        dataType: 'json',
        description:
          '意图列表 JSON（覆盖 config），如 [{"label":"闲聊","desc":"日常对话"},{"label":"查询","desc":"查信息"}]',
      },
      {
        id: 'system_prompt',
        name: '系统提示词',
        kind: 'data',
        dataType: 'string',
        description: '可选自定义系统提示词（留空用内置提示词）',
      },
      {
        id: 'temperature',
        name: '温度',
        kind: 'data',
        dataType: 'number',
        description: 'LLM 采样温度（0-2，建议低温度如 0.3 保证分类稳定性）',
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'intent',
        name: '意图标签',
        kind: 'data',
        dataType: 'string',
        description: '最匹配的意图标签',
      },
      {
        id: 'confidence',
        name: '置信度',
        kind: 'data',
        dataType: 'number',
        description: '0-1 的置信度分数',
      },
      {
        id: 'all_scores',
        name: '全部分数',
        kind: 'data',
        dataType: 'json',
        description:
          '所有意图的分数列表，如 [{"label":"闲聊","score":0.9},{"label":"查询","score":0.1}]',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）',
      },
    ],
  },
];
