// src/main/services/ai/tools/capabilityInvoke.ts
//
// `invoke_capability` 的**第一步**：只开放"确实无副作用"的一小撮能力。
//
// ## 为什么只开这么少（这是刻意的，不是没做完）
//
// 上一版归位表把"Q 层"当成"可以让模型直接调"，**那是错的**：层与副作用是两个正交维度 ——
// 同为 Q 层，\`flow.validate\` 是纯函数，\`dataTransfer.exportJson\` 却**会写文件**，
// \`official.testConnection\` 会**带凭据联网**，\`diagnostics.export\` 还依赖 UI 窗口推进度。
// 所以放行判据是三条**同时**成立（见 docs 附录 B）：
//   ① 层 = Q；② 不写文件；③ 不联网。
//
// ## 直接调用怎么跑起来（2026-10-08 改）
//
// 上一版是**每个能力手写一条绑定**（复制 service 调用 + 复刻守卫）。问题不是麻烦，
// 而是**同一个动作会有第二套实现** —— 守卫迟早与 IPC 那条漂移。
// 现在改成：启动时**捕获已注册的 handler 直接调它**（见 ipcBridge.ts 文件头），
// 于是参数校验、路径守卫、业务逻辑**全都还是那一份**。
//
// ⚠️ 通用桥不等于放开一切：模型能碰到什么，仍然由**附录 B 白名单**逐条决定
// （开放一个能力 = 在文档里加一行，不是加代码）。这才是它比手写绑定更该用的原因。
import type { AiToolDefinition } from '@shared/types/ai';
import type { RegisteredHandler } from './registry';
import { CAPABILITY_ACCESS, CAPABILITY_CATALOG } from '../capabilityCatalog.generated';
// 白名单落在 shared：渲染层执行期复检要读**同一份**（见 capabilityGuard.ts 文件头）
import { DIRECT_CALL_SAFE } from '@shared/ai/capabilityPolicy.generated';
import { safeStringify } from '../toolResultBudget';
import { guardCapabilityAttempt, resolveCapabilityArgs } from '@shared/ai/capabilityGuard';
import { invokeRegisteredChannel } from '../ipcBridge';

/** 已有专用工具的能力：不要从这里再走一遍（否则同一个动作两条路） */
const ALREADY_COVERED: Record<string, string> = {
  'flow.validate': 'validate_flow',
  'flow.preview': 'preview_flow',
};

const INVOKE_DEFS: AiToolDefinition[] = [
  {
    name: 'invoke_capability',
    description:
      '调用一条**只读且无副作用**的已开放能力（能力目录里被标为可直接调用的那些）。' +
      'id 必须先用 search_capabilities / describe_capability 拿到真实值。' +
      '⚠️ 只有极少数能力在这里开放：会写文件、会联网、或需要用户界面的能力**一律拒绝**，' +
      '并会告诉你该走哪条路（有副作用的能力只能提出提案，等用户确认）。' +
      '被拒绝是**预期行为**，不是故障 —— 别换个写法重试同一条。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '能力 id，形如 launchData.listPlayers（必须先用 search_capabilities 查）。',
        },
        args: {
          type: 'object',
          description: '传给该能力的参数对象；不同能力参数不同，先用 describe_capability 看说明。',
        },
      },
      required: ['id'],
    },
    category: 'query',
  },
  {
    name: 'propose_capability',
    description:
      '对一条**有副作用**的应用能力提出提案（等用户在界面上确认后才执行）。' +
      'id 必须先用 search_capabilities 拿到，并且只有白名单里的少数几条可以被提议。' +
      '⚠️ 这是**提案**，不是执行：本工具永远不会直接改动任何东西，' +
      '被拒绝（能力不在白名单 / 层不对 / id 不存在）是**预期行为**，别换个写法重试。' +
      '当前可提议的代表是「新建项目」——那是"从零做一个机器人"的入口。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '能力 id，形如 project.create（必须先用 search_capabilities 查）。',
        },
        args: {
          type: 'object',
          description:
            '传给该能力的参数对象（按附录 C 的调用约定翻成位置参数）。' +
            '不同能力参数不同，先用 describe_capability 看清楚。',
        },
      },
      required: ['id'],
    },
    category: 'mutation',
  },
];

/** 执行工具的声明 */
export function capabilityInvokeDefinitions(): AiToolDefinition[] {
  return INVOKE_DEFS;
}

/** 给一条能力一句"为什么不能直接调"。层不同，理由不同 —— 都要能指导下一步。 */
function refusalReason(id: string, layer: string): string {
  if (ALREADY_COVERED[id]) {
    return `这条能力已有专用工具：请直接用 ${ALREADY_COVERED[id]}。`;
  }
  switch (layer) {
    case 'M':
      return '它有副作用：只能提出提案，等用户在界面上确认后才生效。不要试图绕过确认。';
    case 'F':
      return '它被明确禁止模型调用（任意命令执行等价于交出主机）。这条路走不通，别再试。';
    case 'R':
      return '它是应用**自动注入上下文**的数据，不需要主动调用；需要时让用户在看板上查看。';
    case 'P':
      return '它必须由用户在界面上亲自操作（例如选目录），模型不能代劳。';
    case 'X':
      return '它属于助手自身或内部管道，不对外开放。';
    default:
      return '它虽然是只读语义，但会写文件或联网，因此未开放直接调用（原因见文档附录 B）。';
  }
}

export const CAPABILITY_INVOKE_HANDLERS: Record<string, RegisteredHandler> = {
  /**
   * mutation 类工具在**应用内从不执行** —— 只被 toolCallToOperations 转成提案操作。
   *
   * 但 **MCP 路径是直接 executeTool 的**（见 src/main/mcp/server.ts 文件头：
   * 第一版直接执行工具、不经过 Proposal 机制）。
   * 那里没有提案、没有用户确认，所以这里必须**显式拒绝** ——
   * 否则就多出一条「从外部客户端直接建项目 / 改数据」的后门。
   */
  propose_capability: ({ args }) => {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    return {
      result:
        `「${id || '(空 id)'}」是有副作用的能力，**必须由用户在应用界面里确认**。` +
        '\n应用内这一步会走「待确认计划」；直连（MCP）路径**不提供**该通道 —— 没有确认就不执行。',
    };
  },

  invoke_capability: async ({ args, projectPath }) => {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    const entry = CAPABILITY_CATALOG.find((e) => e.id === id);

    if (!entry) {
      const method = id.includes('.') ? id.split('.').pop()! : id;
      const near = CAPABILITY_CATALOG.filter((e) => e.method === method).slice(0, 5);
      return {
        result:
          `没有「${id}」这条能力。` +
          (near.length
            ? `\n同名的其它能力：\n${near.map((e) => `  ${e.id}`).join('\n')}`
            : '\n用 search_capabilities 搜关键词拿到真实 id。'),
      };
    }

    // ── 闸门 ①：必须在附录 B 的"无副作用"白名单里（默认拒绝） ──
    if (!DIRECT_CALL_SAFE.includes(entry.id)) {
      return {
        result:
          `不能直接调用 ${entry.id}（属 ${entry.layer} 层）。\n` +
          `${CAPABILITY_ACCESS[entry.layer]}\n` +
          `原因：${refusalReason(entry.id, entry.layer)}`,
      };
    }

    const callArgs =
      args.args && typeof args.args === 'object' && !Array.isArray(args.args)
        ? (args.args as Record<string, unknown>)
        : {};

    // 已有专用工具的能力：**先**指路（否则会先撞上"缺参数"，提示就跑偏了）
    const redirect = ALREADY_COVERED[entry.id];
    if (redirect) {
      return { result: `这条能力已有专用工具：请直接用 ${redirect}。` };
    }

    // ── 闸门 ②：参数体检（路径 / 跨项目）+ 按附录 B 的调用约定翻位置参数 ──
    const verdict = guardCapabilityAttempt(entry.id, callArgs, 'direct');
    if (!verdict.ok) return { result: `不能直接调用 ${entry.id}：${verdict.reason}` };
    const resolved = resolveCapabilityArgs(entry.id, callArgs, projectPath, 'direct');
    if (!resolved.ok) return { result: `${entry.id} 参数有问题：${resolved.reason}` };

    // ── 闸门 ③：必须有一条可 invoke 的 IPC 通道 ──
    // （事件订阅类 \`on*\` 没有可调通道；没有通道说明这条能力不该走这里）
    if (!entry.channel || entry.channelKind !== 'invoke') {
      return {
        result:
          `${entry.id} 没有可直接调用的 IPC 通道（channelKind=${String(entry.channelKind)}）。\n` +
          `提示：${refusalReason(entry.id, entry.layer)}`,
      };
    }

    // ── 真正执行：调**同一条**已注册的 IPC handler（校验与守卫都是那一份） ──
    const res = await invokeRegisteredChannel(entry.channel, resolved.positional);
    if (!res.ok) {
      // 失败是**信息**：把原文回给模型，别吞成「出错了」
      return { result: `${entry.id} 执行失败：${res.error}` };
    }
    return { result: `${entry.id} 返回：\n${safeStringify(res.value)}` };
  },
};
