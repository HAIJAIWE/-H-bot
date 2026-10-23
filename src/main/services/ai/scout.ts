// src/main/services/ai/scout.ts
//
// **侦察者（Scout）** —— 多智能体第二阶段（2026-10-18）。
//
// 它与规划者、执行者都不共享上下文：只拿**只读工具**（读流程 / 节点目录 / 代码 / 日志），
// 产出几条**语义级**发现（"这个项目里 /签到 已经存在"、"冷却检查用的是 30 秒不是 30 分钟"），
// 交给规划者当输入。静态 Brief 能算出命令词/变量名，算不出这类"读出来的事实"。
//
// ## 三条纪律
// 1. **只读**：allowedTools 里没有任何写工具 —— 侦察者动手就不是侦察者了；
// 2. **有界**：默认 2 轮、最多 6 条发现，防止它把上下文读爆；
// 3. **fail-open**：读不到/乱回/超时一律 null，调用方退回静态简报。
import type { ChatMessage } from '@shared/types/ai';
import type { ChatRunState } from './chatRun';
import { runOneRound } from './chatRun';
import { ALL_TOOL_DEFINITIONS } from './tools';
import type { LlmConfig } from './llm';
import { logger } from '../infra/logger';

/** 侦察者可用的只读工具（白名单，不是"能读就都给"） */
export const SCOUT_TOOL_NAMES: readonly string[] = [
  'read_flow',
  'list_nodes',
  'list_templates',
  'read_code',
  'read_file',
  'read_logs',
  'list_node_examples',
];

export interface ScoutFindings {
  /** 几条**读出来的事实**（不是猜测；每条一句话） */
  findings: string[];
  by: 'llm';
}

export function buildScoutSystemPrompt(): string {
  return [
    '你是一个**侦察者**（Scout）。你只能**读**（只读工具），不能改任何东西。',
    '任务：在动手之前，把这个项目里与用户需求**直接相关的事实**读出来。',
    '',
    '只输出一个 JSON 对象（不要 Markdown 代码块）：',
    '{ "findings": ["一句话的事实", "..."] }',
    '',
    '要求：',
    '· 最多 6 条；只写**你从工具结果里看到的**，不要写推测；',
    '· 写"会改变做法"的事实，例如：已有同名命令词、已有同类节点、配置字段的真实取值、',
    '  日志里出现过的报错、相关的现成片段；',
    '· 如果什么都没读到，输出 { "findings": [] }。',
  ].join('\n');
}

/** 从模型回复里抠 findings（容忍代码块；格式不对返回 null） */
export function parseScoutJson(text: string): ScoutFindings | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { findings?: unknown };
    const findings = Array.isArray(obj.findings)
      ? obj.findings.map((f) => String(f).trim()).filter(Boolean).slice(0, 6)
      : [];
    return { findings, by: 'llm' };
  } catch {
    return null;
  }
}

/** 不把侦察过程流式进聊天面板：它是内部交接 */
function silentWin(): ChatRunState['win'] {
  return { webContents: { send: () => {} } } as unknown as ChatRunState['win'];
}

export function scoutTools() {
  const allowed = new Set(SCOUT_TOOL_NAMES);
  return ALL_TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
}

/**
 * 跑一次侦察（只读、有界）。**失败一律 null**（调用方退回静态简报）。
 */
export async function scoutWithModel(input: {
  projectPath: string;
  requirement: string;
  config: LlmConfig;
  signal: AbortSignal;
  maxRounds?: number;
}): Promise<ScoutFindings | null> {
  const maxRounds = Math.min(Math.max(input.maxRounds ?? 2, 1), 3);
  const messages: ChatMessage[] = [
    { role: 'system', content: buildScoutSystemPrompt() },
    { role: 'user', content: '用户需求：' + input.requirement },
  ];
  const state: ChatRunState = {
    projectPath: input.projectPath,
    win: silentWin(),
    signal: input.signal,
    messages,
    pendingOperations: [],
    fullResponse: '',
    hadToolCalls: false,
    toolCallCounts: new Map<string, number>(),
    isBatchMode: () => false,
    onBatchToolFailure: () => {},
    allowedTools: new Set<string>(SCOUT_TOOL_NAMES),
  };
  try {
    const tools = scoutTools();
    for (let round = 0; round < maxRounds; round += 1) {
      await runOneRound(state, input.config, tools);
      if (!state.hadToolCalls) break;
    }
    const parsed = parseScoutJson(state.fullResponse);
    if (!parsed) {
      logger.warn('[ai] 侦察者没给出可解析的 JSON（退回静态简报）');
      return null;
    }
    logger.info(`[ai] 侦察者产出 ${parsed.findings.length} 条发现`);
    return parsed;
  } catch (e) {
    logger.warn('[ai] 侦察失败（退回静态简报）:', e);
    return null;
  }
}

/** 渲染成给规划者的输入 */
export function renderFindings(findings: ScoutFindings): string {
  if (findings.findings.length === 0) return '侦察结果：没有发现与本需求直接相关的事实。';
  return ['侦察结果（只读工具读出来的事实，规划时必须考虑）：', ...findings.findings.map((f) => '· ' + f)].join(
    '\n',
  );
}
