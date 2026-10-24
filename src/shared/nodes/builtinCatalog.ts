// src/shared/nodes/builtinCatalog.ts
//
// 内置节点目录 —— **按 `group` 拆成 11 个分片**（2026-10-03）。
//
// 为什么拆：这个文件曾是 **8468 行 / 被改 81 次**（全仓最热），改一个节点要在里面找半天。
// 现在每个分片 300~1100 行，按 group 找就行。物理上再按体量细分为 17 个文件
// （data / storage 等 group 拆成子片），见 `groups/` 目录。
//
// ⚠️ **顺序与原文件不同**：原数组里各 group 是交错的，拆成文件后按 group 聚拢。
// 已确认无人依赖该顺序（调色板用 `groupByGroup()` 自己按 group 分组；无测试断言顺序）；
// 生成的 `docs/nodes-reference.md` 顺序会随之变化 —— 重新生成即可。
//
// 等价性证明：拆分前后「按 kind 排序后的目录」sha256 完全一致。
import type { NodeSpecV2 } from '../types/nodeV2';
import { actionConfigNodes } from './groups/actionConfig';
import { actionGenericNodes } from './groups/actionGeneric';
import { actionPlatformNodes } from './groups/actionPlatform';
import { aiNodes } from './groups/ai';
import { branchNodes } from './groups/branch';
import { calcNodes } from './groups/calc';
import { contextNodes } from './groups/context';
import { controlFlowNodes } from './groups/controlFlow';
import { dataConfigNodes } from './groups/dataConfig';
import { dataFileNodes } from './groups/dataFile';
import { dataListNodes } from './groups/dataList';
import { dataVariableNodes } from './groups/dataVariable';
import { messageNodes } from './groups/message';
import { storageDbNodes } from './groups/storageDb';
import { storagePlayerNodes } from './groups/storagePlayer';
import { textNodes } from './groups/text';
import { triggerNodes } from './groups/trigger';

// 配置表默认库路径的唯一真相在 storageDb 分片里，这里保持对外导出不变
// （databaseWrite.ts / PropertyDrawer.tsx 从本模块 import DEFAULT_DB_PATH）。
export { DEFAULT_DB_PATH } from './groups/storageDb';

export const NODE_CATALOG_V2: NodeSpecV2[] = [
  ...triggerNodes,
  ...messageNodes,
  ...actionPlatformNodes,
  ...actionConfigNodes,
  ...actionGenericNodes,
  ...branchNodes,
  ...controlFlowNodes,
  ...dataVariableNodes,
  ...dataFileNodes,
  ...dataListNodes,
  ...dataConfigNodes,
  ...aiNodes,
  ...storagePlayerNodes,
  ...storageDbNodes,
  ...calcNodes,
  ...contextNodes,
  ...textNodes,
];

/**
 * **平台回填表**：给没有在自己身上声明 `platform` 的节点补一个。
 *
 * 为什么要回填：`platform` 是「多平台项目里这个节点能不能用」的粗粒度徽标，
 * 新节点很容易忘记写；这里缺省 `'all'`，至少保证画布上不会出现空徽标。
 * 新节点仍应**显式声明** `platform`（见 NodeSpecV2.platform），本表只兜底。
 */
const PLATFORM_ANNOTATIONS: Record<string, NonNullable<NodeSpecV2['platform']>> = {
  bot_info: 'qq',
  join_approval: 'qq',
  menu_config: 'qq',
  panel_config: 'qq',
  channel_op: 'qq',
  battle_panel: 'qq',
  answer_interaction: 'qq',
  message_recall: 'all',
  message_edit: 'qq',
  api_call: 'qq',
  group_op: 'qq',
  message_op: 'qq',
  button_clicked: 'qq',
};

/**
 * **能力标注**：这个节点需要绑定支持哪些能力（见 `shared/domain/common/capabilities.ts`）。
 *
 * ## 它与 `PLATFORM_ANNOTATIONS` 的关系（**不是第二套词汇**）
 *
 * `platform` 是**粗粒度、且运行时不用**的（只在编辑器画个徽标）；
 * `requires` 是**细粒度、机器可校验**的：编辑器能按绑定禁用节点、
 * 运行时能明确报"缺哪个能力" —— 而不是**静默失败**。
 *
 * 两者暂时并存（`platform` 兼容既有流程数据），但**新增判断一律用 `requires`**。
 *
 * ## 只标"经 `callApi` 出去"的能力
 *
 * `db.*` / `fs.*` 是框架自身能力，任何绑定下都可用 —— **不标**。
 */
const CAPABILITY_ANNOTATIONS: Record<string, string[]> = {
  message_send: ['im.message.send'],
  battle_panel: ['im.message.send_keyboard'],
  message_recall: ['im.message.recall'],
  message_edit: ['im.message.edit'],
  group_op: [
    'im.group.ban',
    'im.group.kick',
    'im.group.card',
    'im.group.whole_ban',
    'im.group.special_title',
    'im.group.leave',
    'im.group.info',
    'im.group.member_info',
    'im.group.member_list',
  ],
  answer_interaction: ['im.interaction.respond'],
  button_clicked: ['im.interaction.respond'],
  menu_config: ['im.interaction.menu'],
  panel_config: ['im.interaction.panel'],
  join_approval: ['im.interaction.join_approval'],
  bot_info: ['im.bot.info', 'im.bot.share_link'],
  channel_op: [
    'im.channel.manage',
    'im.channel.announce',
    'im.channel.pin',
    'im.channel.reaction',
  ],
};

for (const node of NODE_CATALOG_V2) {
  if (!node.platform) node.platform = PLATFORM_ANNOTATIONS[node.kind] ?? 'all';
  if (!node.requires) {
    const caps = CAPABILITY_ANNOTATIONS[node.kind];
    if (caps) node.requires = [...caps];
  }
}
