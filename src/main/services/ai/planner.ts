// src/main/services/ai/planner.ts
//
// **规划者（Planner）** —— 多智能体的第一阶段（2026-10-18）。
//
// 它与执行者（authorRuntime 的主循环）是**两个上下文**：
//   · 规划者只看见用户需求 + 一份要求产出 JSON 的说明，**没有写工具**；
//   · 它产出一份结构化 Plan（目标 / 步骤 / 风险），执行者把它当成一轮用户消息读进去。
// 这才是"多智能体"的本质：不是两个模型聊天，而是**两个上下文通过结构化产物交接**。
//
// ## 失败语义：一律放行（fail-open）
//
// 规划是**增益，不是关卡**：模型没按格式回、网络断了、被取消 —— 都返回 null，
// 主循环照常跑（等于退回单 agent）。绝不能让"规划者挂了"变成"用户什么也做不了"。
//
// ## 开关
//
// 默认**开**（用户 2026-10-18 要求），可用 QQBAT_MULTI_AGENT=0 关掉。
// 测试环境在 tests/setup.ts 里关掉：脚本化模型会把规划调用当成第一轮脚本，
// 让 12 条任务级 eval 全部错位。
import type { ChatMessage } from '@shared/types/ai';
import type { Plan } from '@shared/types/agent';
import { callLlm, type LlmConfig } from './llm';
import { logger } from '../infra/logger';

export const MULTI_AGENT_ENV = 'QQBAT_MULTI_AGENT';

/** 规划者开关（每次读 env：诊断开关要能当场生效，也便于测试） */
export function isPlanningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MULTI_AGENT_ENV] !== '0';
}

/**
 * 这条需求值不值得先规划。
 *
 * 太短的需求（"加个签到"）规划是浪费一轮；纯提问（"这个节点是干嘛的"）也不该规划。
 * 判据故意保守：漏判只是少一次增益，误判会多花一次模型调用。
 */
export function shouldPlan(requirement: string): boolean {
  const text = String(requirement ?? '').trim();
  if (text.length < 20) return false;
  const isQuestion = /[?？]\s*$/.test(text) || /^(怎么|如何|为什么|为啥|能不能|是否|有没有)/.test(text);
  const isAction = /(加|做|改|建|新增|删除|删掉|接上|写|生成|替换)/.test(text);
  return isAction || !isQuestion;
}

/**
 * 这句话里有没有"要动手"的动作词。
 *
 * 供 `src/main/services/ai/readOnlyRoute.ts:23` 判断能否只走只读循环。
 * **判据必须宽松**：漏掉一个动作词 = 把"要改流程"的需求送进只读循环（用户看到的
 * 是"它只会说不动手"）；多判一个动作词只是回落旧链路（今天的行为），代价小得多。
 * 所以动词表宁长勿短，未知一律按"可能有动作"处理（false 只留给纯名词/问句）。
 */
const ACTION_WORD_RE =
  /(加|做|改|建|删|写|生成|替换|接上|连上|运行|执行|启动|停止|重启|部署|安装|创建|新建|新增|修改|编辑|删除|删掉|移除|重命名|移动|复制|保存|提交|清理|修复|配置|接入|导入|导出|打包|发布|上传|下载|设置|切换|启用|禁用|撤销|回滚|优化|重构|调整|更新|补上|补全|弄|搞|画|增加|减少)/;

const ACTION_WORD_EN_RE =
  /\b(add|create|modify|edit|write|run|execute|delete|remove|install|deploy|fix|update|refactor|implement|build|generate|replace|rename|move|copy|save|commit|clean|configure|import|export|publish|upload|download|enable|disable|revert|rollback|optimize)\b/i;

export function looksLikeAction(text: string): boolean {
  const t = String(text ?? '').trim();
  if (t.length === 0) return false;
  return ACTION_WORD_RE.test(t) || ACTION_WORD_EN_RE.test(t);
}

export function buildPlannerSystemPrompt(): string {
  return [
    '你是一个**规划者**（Planner）。你的唯一任务：把用户需求拆成可执行的步骤。',
    '你**不能动手**（没有写工具），只输出计划。',
    '',
    '只输出一个 JSON 对象，不要 Markdown 代码块、不要解释：',
    '{',
    '  "goal": "一句话复述用户要什么",',
    '  "steps": [{ "intent": "动词开头的一步", "tools": ["可能要用的工具名"] }],',
    '  "risks": ["执行时要注意的坑"]',
    '}',
    '',
    '要求：',
    '· steps 控制在 3-8 步；每步是一件事，不要写"确认需求"这类废话；',
    '· 如果需求已经足够简单（一步就能做完），steps 就写一步；',
    '· risks 只写**这个项目里真实存在的风险**（重复命令词、已有变量名、需要重启才生效等），没有就空数组。',
  ].join('\n');
}

/** 从模型回复里抠出 Plan（容忍代码块包裹；格式不对返回 null） */
export function parsePlanJson(text: string): Plan | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      goal?: unknown;
      steps?: unknown;
      risks?: unknown;
    };
    const goal = String(obj.goal ?? '').trim();
    const stepsRaw = Array.isArray(obj.steps) ? obj.steps : [];
    const steps = stepsRaw
      .map((s) => {
        if (typeof s === 'string') return { intent: s.trim() };
        const o = (s ?? {}) as { intent?: unknown; tools?: unknown };
        return {
          intent: String(o.intent ?? '').trim(),
          ...(Array.isArray(o.tools)
            ? { tools: o.tools.map((t) => String(t)).filter(Boolean) }
            : {}),
        };
      })
      .filter((s) => s.intent.length > 0)
      .slice(0, 8);
    if (!goal || steps.length === 0) return null;
    const risks = Array.isArray(obj.risks)
      ? obj.risks.map((r) => String(r).trim()).filter(Boolean).slice(0, 5)
      : [];
    return { goal, steps, risks, by: 'llm' };
  } catch {
    return null;
  }
}

/** 把计划渲染成执行者能读的一段话（它是**上下文**，不是 UI 文案） */
export function renderPlan(plan: Plan): string {
  const lines = [
    '【规划者产出的计划】（不是用户原话；按它执行，需要调整可以偏离但要说明理由）',
    '目标：' + plan.goal,
    ...plan.steps.map((s, i) => `${i + 1}. ${s.intent}${s.tools?.length ? '（可用 ' + s.tools.join(' / ') + '）' : ''}`),
    ...(plan.risks.length ? ['风险：', ...plan.risks.map((r) => '· ' + r)] : []),
  ];
  return lines.join('\n');
}

/**
 * **仲裁（多智能体第三阶段）**：执行者有权否决规划者的步骤。
 *
 * 判据是**能力**而不是"像不像好计划"：
 *   · 某一步声明的工具**一个都不在当前角色可用集里** ⇒ 这一步执行者做不了，丢掉并记账；
 *   · 全被丢掉 ⇒ 返回 null（等于"这份计划不可执行"，退回无计划执行）。
 *
 * 为什么不让模型自己仲裁：两个模型互相说服是最贵的死循环。**能力是确定的**，
 * 用确定的东西仲裁不确定的东西，才叫闸门。
 */
export interface PlanArbitration {
  plan: Plan;
  /** 被丢掉的步骤（进日志/UI，让用户知道计划被裁剪过） */
  dropped: Array<{ intent: string; reason: string }>;
}

export function arbitratePlan(
  plan: Plan,
  opts: { allowedTools: ReadonlySet<string> },
): PlanArbitration | null {
  const kept: Plan['steps'] = [];
  const dropped: PlanArbitration['dropped'] = [];
  for (const step of plan.steps) {
    const tools = step.tools ?? [];
    // 没声明工具的步骤无法判能力 —— 保留（规划者没绑定实现）
    if (tools.length === 0) {
      kept.push(step);
      continue;
    }
    const usable = tools.filter((t) => opts.allowedTools.has(t));
    if (usable.length === 0) {
      dropped.push({
        intent: step.intent,
        reason: '这一步只需要 ' + tools.join(' / ') + '，当前角色一个都不可用',
      });
      continue;
    }
    kept.push({ ...step, tools: usable });
  }
  if (kept.length === 0) return null;
  return { plan: { ...plan, steps: kept }, dropped };
}

/**
 * 调一次模型产出计划。**失败一律 null**（调用方退回单 agent）。
 */
export async function planWithModel(input: {
  requirement: string;
  config: LlmConfig;
  signal: AbortSignal;
  /** 侦察者的发现（第二阶段）：有就拼进规划输入 —— 规划必须建立在读到的事实上 */
  brief?: string;
}): Promise<Plan | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildPlannerSystemPrompt() },
    {
      role: 'user',
      content: (input.brief ? input.brief + '\n\n' : '') + '用户需求：' + input.requirement,
    },
  ];
  let text = '';
  try {
    await callLlm(
      input.config,
      messages,
      [],
      {
        // 规划过程**不流式进聊天面板**：它是内部交接，不是给用户看的回答
        onChunk: () => {},
        onToolCalls: () => {},
        onComplete: (full) => {
          text = full;
        },
      },
      input.signal,
    );
  } catch (e) {
    logger.warn('[ai] 规划者调用失败（退回单 agent）:', e);
    return null;
  }
  const plan = parsePlanJson(text);
  if (!plan) logger.warn('[ai] 规划者没给出可解析的 JSON（退回单 agent）');
  return plan;
}
