// src/main/services/ai/lanes.ts
//
// **并行子代理（Phase 4）** —— 2026-10-18。
//
// ## 为什么这里可以安全并行
//
// 本仓库的 mutation **不落盘**：它们只被累积成 ProposalOperation，等用户确认后才由渲染层落地。
// 所以两个 lane 同时"改流程"并不会真的改到同一份数据 —— 各自产各自的操作集，父代理合并。
// 真正需要仲裁的只有**合并**这一步（同一节点被两个 lane 改、临时引用撞名）。
//
// ## 形态
//
// 父代理（执行者）把计划里的步骤切成 ≤2 条 lane，每条 lane 是一个**独立上下文**：
// 自己的消息、自己的 pendingOperations、只看得见自己那几步。跑完把"报告 + 操作"
// 交回父代理 —— 父代理看得到子代理干了什么（这就是主流做法），再决定采纳哪些。
//
// ## 失败语义
//
// 任何 lane 失败都只丢那条 lane（fail-open）；全部失败 = null，父代理按无并行继续。
import type { ChatMessage } from '@shared/types/ai';
import type { ProposalOperation } from '@shared/types/proposal';
import type { Plan, PlanStep } from '@shared/types/agent';
import type { ChatRunState } from './chatRun';
import { runOneRound } from './chatRun';
import { ALL_TOOL_DEFINITIONS } from './tools';
import type { LlmConfig } from './llm';
import { logger } from '../infra/logger';

/** 子代理可用的工具：查询 + 可撤回写 + 改图（**不含**不可撤回的起停/跑测试/调能力） */
const LANE_TOOL_NAMES: readonly string[] = [
  'read_flow',
  'list_nodes',
  'list_templates',
  'list_node_examples',
  'read_code',
  'read_file',
  'read_logs',
  'validate_flow',
  'preview_flow',
  'add_node',
  'connect_nodes',
  'update_node',
  'delete_node',
  'apply_template',
  'new_command',
  'new_lookup',
  // 源码写入（Phase 4b）：也是"累积成提案"，不落盘；合并时按**文件**判冲突
  'write_code',
  'write_file',
  'create_ai_node',
];

export const SUBAGENT_LANES_ENV = 'QQBAT_SUBAGENT_LANES';

/** 并行子代理开关（默认跟随多智能体；显式 =0 关） */
export function isSubagentLanesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SUBAGENT_LANES_ENV] !== '0';
}

export interface LaneResult {
  laneId: string;
  /** 子代理自己的话（父代理看得到） */
  report: string;
  /** 它提议的操作（已按 lane 命名空间化临时引用） */
  operations: ProposalOperation[];
  ok: boolean;
}

export interface LaneMerge {
  operations: ProposalOperation[];
  /** 合并时的冲突（同节点被多 lane 改等）—— 保留先到者并记账 */
  conflicts: string[];
  lanes: LaneResult[];
}

/** 一个 lane 的临时引用前缀（避免两条 lane 造出同名 tempRef） */
export function laneRefPrefix(laneId: string): string {
  return laneId + '_';
}

/**
 * 把一条 lane 的操作里的**自己造出来的**临时引用加上 lane 前缀。
 *
 * 只改 tempRef 与它自己 connect 的引用；指向既存节点的 id 原样保留 ——
 * 否则会把"接已有节点"改成"接一个不存在的 id"。
 */
export function namespaceLaneOps(
  ops: readonly ProposalOperation[],
  laneId: string,
): ProposalOperation[] {
  const prefix = laneRefPrefix(laneId);
  const ownRefs = new Set(
    ops.filter((o) => o.kind === 'add_node').map((o) => (o as { tempRef: string }).tempRef),
  );
  const rename = (ref: string): string => (ownRefs.has(ref) ? prefix + ref : ref);
  return ops.map((op) => {
    // lane 归属随操作一起走：提案卡据此分组/筛选（谁产出的）
    if (op.kind === 'add_node') {
      return { ...op, lane: laneId, tempRef: prefix + (op as { tempRef: string }).tempRef };
    }
    if (op.kind === 'connect') {
      const c = op as { sourceRef: string; targetRef: string };
      return {
        ...op,
        lane: laneId,
        sourceRef: rename(c.sourceRef),
        targetRef: rename(c.targetRef),
      };
    }
    return { ...op, lane: laneId };
  });
}

/**
 * 合并多条 lane 的操作。
 *
 * 冲突判据（保守）：**同一个节点被两个 lane 改/删** → 保留先到的，记账。
 * 不做"智能合并"：两个 lane 对同一节点的意图可能相反，猜错比拒绝更糟。
 */
export function mergeLaneOps(lanes: readonly LaneResult[]): LaneMerge {
  const operations: ProposalOperation[] = [];
  const conflicts: string[] = [];
  const touched = new Set<string>();
  for (const lane of lanes) {
    for (const op of namespaceLaneOps(lane.operations, lane.laneId)) {
      /**
       * 冲突键：改图按**节点**、写文件按**文件**（Phase 4b）。
       * 两条 lane 改同一个节点 / 写同一个文件 ⇒ 后者丢弃并记账。
       * 不同节点/不同文件互不影响 —— 这正是不落盘带来的并行空间。
       */
      const target =
        op.kind === 'update_config' || op.kind === 'delete_node'
          ? 'node:' + (op as { nodeRef: string }).nodeRef
          : op.kind === 'write_code'
            ? 'file:' + (op as { filePath: string }).filePath
            : null;
      if (target) {
        if (touched.has(target)) {
          conflicts.push(`节点 ${target} 被多条 lane 同时修改（lane ${lane.laneId} 的改动被丢弃）`);
          continue;
        }
        touched.add(target);
      }
      operations.push(op);
    }
  }
  return { operations, conflicts, lanes: [...lanes] };
}

/** 把计划步骤切成 ≤maxLanes 组（相邻步骤一组：相邻的通常相关） */
export function splitPlanIntoLanes(steps: readonly PlanStep[], maxLanes = 2): PlanStep[][] {
  const n = Math.min(Math.max(maxLanes, 1), 3, steps.length);
  if (n <= 1) return [steps.slice()];
  const groups: PlanStep[][] = Array.from({ length: n }, () => []);
  steps.forEach((step, i) => groups[i % n].push(step));
  return groups.filter((g) => g.length > 0);
}

function silentWin(): ChatRunState['win'] {
  return { webContents: { send: () => {} } } as unknown as ChatRunState['win'];
}

function laneMessages(input: { laneId: string; steps: PlanStep[]; goal: string; requirement: string }): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是**子代理 ' + input.laneId + '**，只负责父代理计划里分给你的这几步。',
        '父代理的目标：' + input.goal,
        '你的步骤：',
        ...input.steps.map((s, i) => `${i + 1}. ${s.intent}${s.tools?.length ? '（可用 ' + s.tools.join(' / ') + '）' : ''}`),
        '',
        '要求：',
        '· 只做这些步骤；超出范围的发现写进报告，别自己扩大范围；',
        '· 要改流程就**直接调用工具**（改动会进待确认计划，不会直接落盘）；',
        '· 最后用 2-3 句话报告"你做了什么 / 发现了什么"，父代理会读它。',
      ].join('\n'),
    },
    { role: 'user', content: input.requirement },
  ];
}

/**
 * 跑 2 条（或 1 条）lane。**全部失败返回 null**（父代理按无并行继续）。
 */
export async function runPlanLanes(input: {
  projectPath: string;
  requirement: string;
  plan: Plan;
  config: LlmConfig;
  signal: AbortSignal;
  maxLanes?: number;
  maxRoundsPerLane?: number;
}): Promise<LaneMerge | null> {
  const groups = splitPlanIntoLanes(input.plan.steps, input.maxLanes ?? 2);
  if (groups.length <= 1) return null;

  const allowed = new Set(LANE_TOOL_NAMES);
  const tools = ALL_TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
  const maxRounds = Math.min(Math.max(input.maxRoundsPerLane ?? 2, 1), 3);

  const results = await Promise.all(
    groups.map(async (steps, index): Promise<LaneResult> => {
      const laneId = 'L' + (index + 1);
      const state: ChatRunState = {
        projectPath: input.projectPath,
        win: silentWin(),
        signal: input.signal,
        messages: laneMessages({ laneId, steps, goal: input.plan.goal, requirement: input.requirement }),
        pendingOperations: [],
        fullResponse: '',
        hadToolCalls: false,
        toolCallCounts: new Map<string, number>(),
        isBatchMode: () => false,
        onBatchToolFailure: () => {},
        allowedTools: new Set(LANE_TOOL_NAMES),
        role: 'builder',
      };
      try {
        for (let round = 0; round < maxRounds; round += 1) {
          await runOneRound(state, input.config, tools);
          if (!state.hadToolCalls) break;
          // 子代理有产出了就停：再跑下去容易越界
          if (state.pendingOperations.length > 0) break;
        }
        return {
          laneId,
          report: state.fullResponse.trim(),
          operations: state.pendingOperations,
          ok: true,
        };
      } catch (e) {
        logger.warn(`[ai] 子代理 ${laneId} 失败（丢弃该 lane）:`, e);
        return { laneId, report: '', operations: [], ok: false };
      }
    }),
  );

  const usable = results.filter((r) => r.ok);
  if (usable.length === 0) return null;
  const merged = mergeLaneOps(usable);
  logger.info(
    `[ai] 并行子代理：${usable.length} 条 lane 产出 ${merged.operations.length} 个操作` +
      (merged.conflicts.length ? `（冲突 ${merged.conflicts.length} 条）` : ''),
  );
  return merged;
}

/** 渲染成父代理的上下文（父代理看得到每个子代理做了什么） */
export function renderLaneReports(merge: LaneMerge): string {
  const lines = ['【并行子代理的报告】（它们已经跑完，改动都已进待确认计划）'];
  for (const lane of merge.lanes) {
    lines.push(`— ${lane.laneId}：${lane.report || '（没有文字报告）'}`);
    if (lane.operations.length > 0) lines.push(`  产出 ${lane.operations.length} 个操作`);
  }
  if (merge.conflicts.length > 0) {
    lines.push('冲突（已按先到者保留）：', ...merge.conflicts.map((c) => '· ' + c));
  }
  return lines.join('\n');
}
