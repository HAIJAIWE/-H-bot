import { t } from '../../i18n';
import { SUBFLOW_TEMPLATE_DEFS } from '@shared/nodes/subflowTemplateDefs';
import type {
  SubflowTemplateDef,
  TemplateEdgeDef,
  TemplateNodeDef,
} from '@shared/nodes/subflowTemplateTypes';

// 类型从这里**再导出**：原来从本文件 import 的地方（configQueryChain / commandWizard 等）不受影响
export type { TemplateNodeDef, TemplateEdgeDef };

/** 片段定义（数据在 @shared/nodes/subflowTemplateDefs，这里只贴文案） */
export interface SubflowTemplate {
  id: string;
  name: string;
  description: string;
  category: '数据读写' | '消息回复' | '流程控制' | '游戏逻辑' | '时间工具';
  nodes: TemplateNodeDef[];
  edges: TemplateEdgeDef[];
  /** 插入说明：告诉用户这个片段如何接入流程 */
  usageHint: string;
}

/**
 * 片段库（21 条）。
 *
 * ⚠️ 2026-10-03 拆分：**结构数据**移到了 `@shared/nodes/subflowTemplateDefs` —— 因为运行时回归
 * `tests/main/runtime/subflowFragmentsE2E.test.ts` 要把每条片段**真跑一遍**（主进程侧），
 * 而 `tsconfig.node` 不含 `src/renderer` ✗。本文件只负责按 id 取 i18n 文案。
 *
 * ⚠️ 文案键必须**以字面量形式**写在这张表里（不能拼 `template.${id}.name`）——
 * `tests/renderer/i18n/orphanKeys.test.ts` 靠静态扫描找使用点，拼出来的键会被判成"孤儿键"。
 */
const COPY_KEYS: Record<string, [name: string, description: string, usageHint: string]> = {
  'read-player-data': [
    'template.readPlayerData.name',
    'template.readPlayerData.description',
    'template.readPlayerData.usageHint',
  ],
  'save-player-data': [
    'template.savePlayerData.name',
    'template.savePlayerData.description',
    'template.savePlayerData.usageHint',
  ],
  'check-exists': [
    'template.checkExists.name',
    'template.checkExists.description',
    'template.checkExists.usageHint',
  ],
  'increment-counter': [
    'template.incrementCounter.name',
    'template.incrementCounter.description',
    'template.incrementCounter.usageHint',
  ],
  'format-and-reply': [
    'template.formatAndReply.name',
    'template.formatAndReply.description',
    'template.formatAndReply.usageHint',
  ],
  'context-reply': [
    'template.contextReply.name',
    'template.contextReply.description',
    'template.contextReply.usageHint',
  ],
  'random-reply': [
    'template.randomReply.name',
    'template.randomReply.description',
    'template.randomReply.usageHint',
  ],
  'cooldown-check': [
    'template.cooldownCheck.name',
    'template.cooldownCheck.description',
    'template.cooldownCheck.usageHint',
  ],
  'try-catch-block': [
    'template.tryCatchBlock.name',
    'template.tryCatchBlock.description',
    'template.tryCatchBlock.usageHint',
  ],
  'delay-execution': [
    'template.delayExecution.name',
    'template.delayExecution.description',
    'template.delayExecution.usageHint',
  ],
  'signin-flow': [
    'template.signinFlow.name',
    'template.signinFlow.description',
    'template.signinFlow.usageHint',
  ],
  'combat-round': [
    'template.combatRound.name',
    'template.combatRound.description',
    'template.combatRound.usageHint',
  ],
  'time-format': [
    'template.timeFormat.name',
    'template.timeFormat.description',
    'template.timeFormat.usageHint',
  ],
  'inventory-view': [
    'template.inventoryView.name',
    'template.inventoryView.description',
    'template.inventoryView.usageHint',
  ],
  'inventory-add': [
    'template.inventoryAdd.name',
    'template.inventoryAdd.description',
    'template.inventoryAdd.usageHint',
  ],
  'shop-buy': [
    'template.shopBuy.name',
    'template.shopBuy.description',
    'template.shopBuy.usageHint',
  ],
  'quest-accept': [
    'template.questAccept.name',
    'template.questAccept.description',
    'template.questAccept.usageHint',
  ],
  'pk-attack': [
    'template.pkAttack.name',
    'template.pkAttack.description',
    'template.pkAttack.usageHint',
  ],
  cultivate: [
    'template.cultivate.name',
    'template.cultivate.description',
    'template.cultivate.usageHint',
  ],
  'gacha-pull': [
    'template.gachaPull.name',
    'template.gachaPull.description',
    'template.gachaPull.usageHint',
  ],
  leaderboard: [
    'template.leaderboard.name',
    'template.leaderboard.description',
    'template.leaderboard.usageHint',
  ],
};

// 结构数据来自 10/18 产物（@ts-nocheck，category 被推断成 string）——这里收窄回联合类型
export const SUBFLOW_TEMPLATES: SubflowTemplate[] = (
  SUBFLOW_TEMPLATE_DEFS as SubflowTemplateDef[]
).map((def) => {
  const keys = COPY_KEYS[def.id];
  return {
    ...def,
    get name() {
      return t(keys[0]);
    },
    get description() {
      return t(keys[1]);
    },
    get usageHint() {
      return t(keys[2]);
    },
  };
});

// ===== 历史记录（保留）：AI 对话类片段为什么被删 =====
//
// 删掉的原因（`tests/renderer/lib/command/subflowTemplates.test.ts` 抓到的）：
//   1. 「带记忆的 AI 对话」引用了 `memory_op` —— 这个节点在节点目录里**根本不存在**
//      （memory_* 早按 Python 时代残留整体删除），插进画布就是一条跑不通的流程；
//   2. 两条的核心节点 `agent_chat` 目前是**占位实现**（不会真的调用模型），
//      插进去属于"能连上但不干活" —— 按原则 9（占位内容不如没有）不该发布。
//
// 等 AI 节点真正实现（或改成"用 HTTP 请求调你自己的模型"，保持零成本红线）之后，
// 再用**内置节点**重建这两条片段；审计测试会保证它们不引用不存在的节点/端口。
