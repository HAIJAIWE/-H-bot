// src/main/services/bot/tools.ts
//
// **工具层** —— 把节点目录暴露成 LLM 的 tool schema。
//
// ## 这是这个项目最独特的杠杆
//
// 别的 agent 框架要你手写 function schema；这边**画出来就有了**：
// 你在画布上用过的每一个节点，都能直接变成机器人的可调用工具。
//
// ## 但"能调"不等于"该让它调" —— 默认必须是白名单
//
// 作者助手（A）面对的是你，工具给多了顶多是它乱试；
// 机器人（B）面对的是**群里的人**，一个能发消息、能踢人、能写数据库的工具集
// 配上"被群友绕进去"的模型，后果不是"重跑一次"。
//
// 所以默认集合由**代码**决定，且刻意保守：
//   · 只要 `type === 'action'` 的节点（触发器/控制流/纯数据节点当工具没有意义）；
//   · 且 `sideEffects` 为空的（不对外发消息、不写库、不发网络请求）。
// 想要更强的能力，**显式列出 kind** —— 那是一个有意识的决定，不是一个默认值。
//
// ## 与沙箱的关系
//
// 工具执行走的是**同一套 handler registry**，也就是流程执行用的那条路。
// 好处是"机器人的智能体能做的事 = 你画过的所有节点"，边界天然一致；
// 代价是节点能力就是能力上限 —— 所以真正的边界仍然是**白名单**，不是沙箱。

import type { AiToolDefinition } from '@shared/types/ai';
import { getNodeRegistry } from '@main/nodes/registry';
import { registerAllBuiltinNodes } from '@main/nodes/builtin';
import { getHandler } from '@main/runtime/handlerRegistry';
import { ExecContext } from '@main/runtime/ExecContext';
import type { BotInterface, OneBotEvent } from '../builtinNodes/builtinNodes';
import { logger } from '../infra/logger';

export interface BotToolSpec {
  /** 对应的节点 kind（执行时用它找回 handler） */
  kind: string;
  /** 给模型看的 function 定义 */
  definition: AiToolDefinition;
  /** 该节点声明的副作用（用于日志与"这个工具会对外做事"的提示） */
  sideEffects: string[];
}

/** function name 只允许 [a-zA-Z0-9_-]，且长度有限 */
function toFunctionName(kind: string): string {
  return kind.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * **默认工具集：显式白名单**。
 *
 * ## 为什么不再按元数据推导（2026-10-18 P0）
 *
 * 旧实现是"`type === 'action'` 且 `sideEffects` 为空"—— 看起来保守，实际是**信任节点的自我声明**。
 * 而 `http_request` 在目录里就写着 `sideEffects: []`，却能向任意 URL 发请求：
 * 一行元数据笔误，等于把"机器人可以对着群友外呼任意地址"当默认值发出去。
 *
 * 元数据只适合**描述**，不适合**授权**。所以默认集改成这张手写清单：
 * 加一条 = 一次有意识的决定，而不是某个节点作者顺手留空了一个数组。
 *
 * 想要更强能力就**显式列出 kind**（节点配置里的"工具清单"）—— 那是用户的选择，不是默认值。
 */
export const EXPOSED_BY_DEFAULT: readonly string[] = [
  // 构造消息段：纯数据拼装，不发送、不落盘（要发送得显式加 message_send / message_op）
  'message_compose',
  // 等用户输入：只影响流程走向，不产生对外 I/O
  'wait_input',
];

/**
 * 有能力**越过本机边界**的 kind（网络 / 第三方 API / 向量化 / 模型调用）。
 *
 * 它们不写本机文件、也不发 QQ 消息，所以按 `sideEffects` 看是"干净"的 ——
 * 但它们能**把数据带出去**，这正是最该要用户点头的一类。名单在这里集中维护：
 * 新增外呼类节点必须加进来，否则它会以"无副作用"的身份混进白名单。
 */
export const NETWORK_CAPABLE_KINDS: readonly string[] = [
  'http_request',
  // get_profile 的 sideEffects 是空数组（目录作者没替它声明），但它 8 个模式全都在调
  // QQ 开放接口查成员/群资料 —— 典型"元数据不可信"，只能按 kind 硬编码补判。
  'get_profile',
  'agent_chat',
  'intent_classify',
  'embedding',
];

/**
 * **声明了 `sideEffects: []` 却真的会对外做事**的 kind。
 *
 * 这就是"元数据不可信"的具体例子：`message_op` 的目录元数据是空数组，但它能发消息、能撤回。
 * 这些只能按 kind 硬编码补判 —— 与 {@link NETWORK_CAPABLE_KINDS} 同一套理由。
 */
export const MESSAGE_CAPABLE_KINDS: readonly string[] = ['message_op'];

/** 工具的风险类别（判据只看 kind 与 sideEffects，纯粹、可测） */
export type ToolRiskClass = 'none' | 'net' | 'msg' | 'write';

const NETWORK_EFFECT_RE = /^(call_api|api_call)(:|$)|net|http/i;
const MESSAGE_EFFECT_RE = /^message_|send|recall|kick|mute|ban/i;
const WRITE_EFFECT_RE = /^(write_)|write_db|write_file|db_write/i;

/**
 * 这个工具属于哪一类风险。
 *
 * 顺序有意义：**网络优先**（外呼最不可撤回），其次消息（发出去就撤不回），最后写库/写文件
 * （可回滚/可恢复）。只读节点（不产生对外 I/O）返回 `none` —— 闸门按**能力类别**判，
 * 不搞"一律要确认"，否则用户会条件反射地点同意，闸门等于没有。
 */
export function riskClassOf(spec: Pick<BotToolSpec, 'kind' | 'sideEffects'>): ToolRiskClass {
  if (NETWORK_CAPABLE_KINDS.includes(spec.kind)) return 'net';
  if (MESSAGE_CAPABLE_KINDS.includes(spec.kind)) return 'msg';
  const effects = spec.sideEffects ?? [];
  if (effects.some((e) => NETWORK_EFFECT_RE.test(e))) return 'net';
  if (effects.some((e) => MESSAGE_EFFECT_RE.test(e))) return 'msg';
  if (effects.some((e) => WRITE_EFFECT_RE.test(e))) return 'write';
  return 'none';
}

/** 风险类别的中文标签（给"高风险确认"的提示与日志用） */
export function riskClassLabel(risk: ToolRiskClass): string {
  switch (risk) {
    case 'net':
      return '网络外呼';
    case 'msg':
      return '对外发消息';
    case 'write':
      return '写数据/文件';
    default:
      return '只读';
  }
}

/** 要不要用户点头才执行（`confirmHighRisk` 打开时用它判，而不是看 sideEffects 是否为空） */
export function requiresConfirmation(spec: Pick<BotToolSpec, 'kind' | 'sideEffects'>): boolean {
  return riskClassOf(spec) !== 'none';
}

/**
 * 列出**默认可用**的工具 kind。
 *
 * 返回 {@link EXPOSED_BY_DEFAULT} 的副本：调用方改数组不该影响默认集。
 */
export function defaultToolKinds(): string[] {
  return [...EXPOSED_BY_DEFAULT];
}

/**
 * 把节点目录编译成 tool schema。
 *
 * @param kinds 允许的节点 kind；传空数组表示用 `defaultToolKinds()` 的保守默认
 * @param log 可选的告警回调（列了不存在的 kind 时要**说出来**，不能静默少给工具）
 */
export function buildBotToolSpecs(
  kinds: readonly string[],
  log?: (message: string) => void,
): BotToolSpec[] {
  const registry = getNodeRegistry();
  registerAllBuiltinNodes(registry);
  const all = registry.listAll();
  const byKind = new Map(all.map((n) => [n.kind, n]));

  const wanted = kinds.length > 0 ? [...kinds] : defaultToolKinds();
  const specs: BotToolSpec[] = [];
  const unknown: string[] = [];

  for (const kind of wanted) {
    const node = byKind.get(kind);
    if (!node) {
      unknown.push(kind);
      continue;
    }

    // 参数取自**节点的数据入口**：模型要填的就是这些。
    // 控制端口（in/out）不是参数 —— 交给模型只会让它困惑。
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const port of node.inputs) {
      if (port.kind !== 'data') continue;
      properties[port.id] = {
        type:
          port.dataType === 'number'
            ? 'number'
            : port.dataType === 'boolean'
              ? 'boolean'
              : 'string',
        description: port.description || port.name,
        ...(port.options ? { enum: port.options.map((o) => o.value) } : {}),
      };
      if (port.required) required.push(port.id);
    }

    specs.push({
      kind,
      sideEffects: node.sideEffects ?? [],
      definition: {
        name: toFunctionName(kind),
        description: `${node.label}：${node.summary}`.slice(0, 500),
        parameters: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        category: 'query',
      },
    });
  }

  if (unknown.length > 0) {
    log?.(
      `工具白名单里有 ${unknown.length} 个不存在的节点 kind：${unknown.join(', ')}` +
        '（它们被忽略了 —— 检查一下是不是拼错了）',
    );
  }
  return specs;
}

/** 工具执行结果：一律归一成 `{ ok, result }`，绝不抛给循环 */
export interface ToolRunOutcome {
  ok: boolean;
  /** 回传给模型的内容（已是可序列化的普通对象） */
  result: unknown;
}

/**
 * 执行一次工具调用 —— 就是**跑一次那个节点**。
 *
 * 刻意复用 `getHandler`：这样"节点能做的事"与"机器人智能体能做的事"永远是同一套实现，
 * 不会出现"画布上能用、agent 里行为不一致"的分裂。
 */
export async function runBotTool(
  spec: BotToolSpec,
  args: Record<string, unknown>,
  bot: BotInterface,
  event: OneBotEvent,
  projectPath: string,
): Promise<ToolRunOutcome> {
  const handler = getHandler(spec.kind);
  if (!handler) {
    return { ok: false, result: `工具 ${spec.kind} 没有可用的 handler` };
  }

  try {
    // 工具是**独立调用**，没有上游节点、没有变量表 ——
    // 所以给一个最小的 ExecContext。依赖上游数据的节点不适合当工具，
    // 那正是白名单要挡的事（默认集合只收无副作用的 action 节点）。
    // 类型上用 never 兜过 ExecContext 自己那份 FlowGraph 别名（与 shared 的那份不等价）。
    const ctx = new ExecContext(
      { nodes: [], edges: [] } as never,
      new Map(),
      [],
      {},
      `bot-tool-${spec.kind}-${Date.now()}`,
    );
    const out = await handler(bot as never, event, args ?? {}, {
      projectPath,
      ctx,
    } as never);

    // handler 的约定：业务失败写在 error 字段里。把它如实带回去 ——
    // 模型看到失败原因才可能改对，看到空结果只会瞎猜。
    const record = (out ?? {}) as Record<string, unknown>;
    const error = typeof record.error === 'string' ? record.error : '';
    return { ok: error === '', result: out ?? {} };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`[bot-tool] ${spec.kind} 执行失败: ${msg}`);
    return { ok: false, result: `工具执行抛出异常：${msg}` };
  }
}
