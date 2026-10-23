// src/shared/nodes/commandChain.ts
//
// 「新建指令」的**纯逻辑**：把「命令词 + 一句回复 + 要不要记数据」翻译成一条**能直接插入**的节点链。
//
// ## 为什么放在 shared（2026-10-06 从 src/renderer/src/lib/commandWizard.ts 搬来）
//
// 这段逻辑原来只在渲染层（向导用）。现在智能体多了一个 `new_command` 工具 —— 它要在
// **主进程**算出**同一条链**，否则：
//   · 预览图（`pendingGraph`）看不到它提出的改动 → 模型自检"没生效" → 重复提交
//     （这正是 pendingGraph.ts 文件头记的那个实盘事故）
//   · 提案校验（`proposalValidation`）也会照着"没有这条链"的图去判断
// 而 `tsconfig.node` 不含 `src/renderer`，所以逻辑必须待在 shared。
// 渲染层的 `lib/commandWizard.ts` 现在只是**再导出**（导入方一行都不用改）。
//
// 为什么值得单独一个文件：向导/工具的价值是"一键铺好并连好线"，而"铺什么、怎么连"是
// 可测的纯数据。测试能直接断言端口名（`next`/`in`/`out`/`result`/`var1`）——
// 这些名字写错一个，生成出来的链就是断的，但界面上看不出来。
import type { TemplateEdgeDef, TemplateNodeDef } from './subflowTemplateTypes';

/** 记数据的方式：不记 / 每次 +1（签到打卡）/ 只读取（查询积分） */
export type CommandDataMode = 'none' | 'increment' | 'read';

export interface CommandWizardInput {
  /** 命令词（可带 `/`，会被归一化） */
  command: string;
  /** 回复文案，可写 {var1} 引用数值 */
  reply: string;
  dataMode?: CommandDataMode;
  /** 数据键名（只能用英文/数字/下划线；同一键名的指令共用一份数据，如 /签到 写、/积分 读） */
  dataKey?: string;
}

/** 归一化命令词：去掉用户顺手带的 `/` 和首尾空白 */
export function normalizeCommand(word: string): string {
  return word.trim().replace(/^\/+/, '').trim();
}

/** 记数据时的默认键名（英文；界面上会提示"拼音也行"） */
export const DEFAULT_DATA_KEY = 'score';

/**
 * 持久化键名的合法字符集。
 *
 * 与 `variable_persist` / `variable_set` 的校验**保持一致**
 * （`VAR_PERSIST_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/`）——真机实测：向导默认给「积分」
 * 这种中文名时，生成的链跑起来直接报「非法变量名」，所以这里必须提前拦住。
 */
export const DATA_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidDataKey(key: string): boolean {
  return DATA_KEY_RE.test(key.trim());
}

export interface CommandChain {
  nodes: TemplateNodeDef[];
  edges: TemplateEdgeDef[];
}

/** 向导至少要有的两样东西：命令词 + 回复文案（记数据时键名也得合法） */
export function isCommandWizardReady(input: CommandWizardInput): boolean {
  if (normalizeCommand(input.command).length === 0) return false;
  if (input.reply.trim().length === 0) return false;
  if ((input.dataMode ?? 'none') !== 'none' && !isValidDataKey(input.dataKey ?? '')) return false;
  return true;
}

/**
 * 生成节点链（索引引用节点，与 `SubflowTemplate` 的约定一致）。
 *
 * - 不记数据：收到消息 → 发消息（2 个节点）
 * - 记数据：收到消息 → 持久化操作 → 发消息（3 个节点，且把持久化的 `result` 接到发送节点的
 *   `var1` 端口，回复文案里的 `{var1}` 就取到数值；这也是"回复即模板"省掉文本模板节点的用法）
 */
export function buildCommandChain(input: CommandWizardInput): CommandChain {
  const command = normalizeCommand(input.command);
  const dataMode: CommandDataMode = input.dataMode ?? 'none';
  const dataKey = (input.dataKey ?? '').trim() || DEFAULT_DATA_KEY;
  const reply = input.reply;

  const nodes: TemplateNodeDef[] = [
    {
      kind: 'message_received',
      config: { match: 'command', message_type: 'any', command, prefix: '/' },
      label: `/${command}`,
    },
  ];
  const edges: TemplateEdgeDef[] = [];

  if (dataMode === 'none') {
    nodes.push({ kind: 'message_send', config: { mode: 'text', text: reply } });
    edges.push({ from: 0, fromPort: 'next', to: 1, toPort: 'in' });
    return { nodes, edges };
  }

  // ⚠️ 2026-10-03：原来生成的是 `variable_persist`（已弃用、面板上已隐藏）✗ ——
  // 用户从命令向导建出来的流程会立刻带一个"找不到的节点"。
  // 现在直接生成拆分后的节点：increment → incr_variable（单模式，无 mode 键）；
  // load_or_default → load_variable（多模式，保留 mode）。
  nodes.push({
    kind: dataMode === 'increment' ? 'incr_variable' : 'load_variable',
    // increment = 读+加+写一次完成；load_or_default = 只读（首次读到默认值并落库）
    config:
      dataMode === 'increment'
        ? { key: dataKey, scope: 'user', amount: 1, default: 0, auto_save: true }
        : { mode: 'load_or_default', key: dataKey, scope: 'user', default: 0, auto_save: true },
    label: dataMode === 'increment' ? `${dataKey} +1` : `${dataKey}（读取）`,
  });
  nodes.push({ kind: 'message_send', config: { mode: 'text', text: reply } });

  edges.push({ from: 0, fromPort: 'next', to: 1, toPort: 'in' });
  edges.push({ from: 1, fromPort: 'out', to: 2, toPort: 'in' });
  // 数值走数据线接进发送节点的 var1（文案里的 {var1}）
  edges.push({ from: 1, fromPort: 'result', to: 2, toPort: 'var1' });
  return { nodes, edges };
}
