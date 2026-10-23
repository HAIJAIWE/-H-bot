import { t } from '../i18n';
/** 片段节点定义（精简版，插入时用 createNode 重建） */
export interface TemplateNodeDef {
  kind: string; // 节点类型，如 'variable_persist'
  config?: Record<string, unknown>; // 配置覆盖（合并到 defaultConfig）
  label?: string; // 可选自定义标签
}

/** 片段边定义（用索引引用节点，避免硬编码 ID） */
export interface TemplateEdgeDef {
  from: number; // 源节点在 nodes 数组中的索引
  fromPort: string; // 源端口 ID
  to: number; // 目标节点索引
  toPort: string; // 目标端口 ID
}

/** 片段定义 */
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

/** 预置片段库 */
export const SUBFLOW_TEMPLATES: SubflowTemplate[] = [
  // ===== 数据读写类 =====
  {
    id: 'read-player-data',
    get name() { return t('template.readPlayerData.name'); },
    get description() { return t('template.readPlayerData.description'); },
    category: '数据读写',
    nodes: [{ kind: 'variable_persist', config: { mode: 'load', key: 'player_data', scope: 'user' } }],
    edges: [],
    get usageHint() { return t('template.readPlayerData.usageHint'); },
  },
  {
    id: 'save-player-data',
    get name() { return t('template.savePlayerData.name'); },
    get description() { return t('template.savePlayerData.description'); },
    category: '数据读写',
    nodes: [{ kind: 'variable_persist', config: { mode: 'save', key: 'player_data', scope: 'user' } }],
    edges: [],
    get usageHint() { return t('template.savePlayerData.usageHint'); },
  },
  {
    id: 'check-exists',
    get name() { return t('template.checkExists.name'); },
    get description() { return t('template.checkExists.description'); },
    category: '数据读写',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'exists', key: 'signed_today', scope: 'user' } },
      { kind: 'branch_if', config: { expression: 'value' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'exists', to: 1, toPort: 'value' },
    ],
    get usageHint() { return t('template.checkExists.usageHint'); },
  },
  {
    id: 'increment-counter',
    get name() { return t('template.incrementCounter.name'); },
    get description() { return t('template.incrementCounter.description'); },
    category: '数据读写',
    nodes: [
      {
        kind: 'variable_persist',
        config: { mode: 'increment', key: 'login_count', scope: 'user', amount: 1 },
      },
    ],
    edges: [],
    get usageHint() { return t('template.incrementCounter.usageHint'); },
  },

  // ===== 消息回复类 =====
  {
    id: 'format-and-reply',
    get name() { return t('template.formatAndReply.name'); },
    get description() { return t('template.formatAndReply.description'); },
    category: '消息回复',
    nodes: [
      { kind: 'format_text', config: { template: '你好，{name}！', variables_json: '{"name":"朋友"}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'text' },
    ],
    get usageHint() { return t('template.formatAndReply.usageHint'); },
  },
  {
    id: 'context-reply',
    get name() { return t('template.contextReply.name'); },
    get description() { return t('template.contextReply.description'); },
    category: '消息回复',
    nodes: [
      { kind: 'get_context', config: { mode: 'user_id' } },
      { kind: 'format_text', config: { template: '你的QQ是{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'var1' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'text' },
    ],
    get usageHint() { return t('template.contextReply.usageHint'); },
  },
  {
    id: 'random-reply',
    get name() { return t('template.randomReply.name'); },
    get description() { return t('template.randomReply.description'); },
    category: '消息回复',
    nodes: [
      { kind: 'random', config: { mode: 'choice', items: '["在的","你好呀","怎么啦"]' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'text' },
    ],
    get usageHint() { return t('template.randomReply.usageHint'); },
  },

  // ===== 流程控制类 =====
  {
    id: 'cooldown-check',
    get name() { return t('template.cooldownCheck.name'); },
    get description() { return t('template.cooldownCheck.description'); },
    category: '流程控制',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load', key: 'cooldown', scope: 'user' } },
      { kind: 'branch_if', config: { expression: '!value' } },
      { kind: 'message_send', config: { mode: 'text', text: '✅ 操作成功！' } },
      { kind: 'message_send', config: { mode: 'text', text: '⏳ 冷却中，请稍后再试！' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'value' },
      { from: 1, fromPort: 'true', to: 2, toPort: 'in' },
      { from: 1, fromPort: 'false', to: 3, toPort: 'in' },
    ],
    get usageHint() { return t('template.cooldownCheck.usageHint'); },
  },
  {
    id: 'try-catch-block',
    get name() { return t('template.tryCatchBlock.name'); },
    get description() { return t('template.tryCatchBlock.description'); },
    category: '流程控制',
    nodes: [{ kind: 'try_catch' }],
    edges: [],
    get usageHint() { return t('template.tryCatchBlock.usageHint'); },
  },
  {
    id: 'delay-execution',
    get name() { return t('template.delayExecution.name'); },
    get description() { return t('template.delayExecution.description'); },
    category: '流程控制',
    nodes: [{ kind: 'delay', config: { seconds: 3 } }],
    edges: [],
    get usageHint() { return t('template.delayExecution.usageHint'); },
  },

  // ===== AI对话类：目前没有片段（原来两条审计后删除） =====
  //
  // 删掉的原因（`tests/renderer/lib/subflowTemplates.test.ts` 抓到的）：
  //   1. 「带记忆的 AI 对话」引用了 `memory_op` —— 这个节点在节点目录里**根本不存在**
  //      （memory_* 早按 Python 时代残留整体删除），插进画布就是一条跑不通的流程；
  //   2. 两条的核心节点 `agent_chat` 目前是**占位实现**（不会真的调用模型），
  //      插进去属于"能连上但不干活" —— 按原则 9（占位内容不如没有）不该发布。
  //
  // 等 AI 节点真正实现（或改成"用 HTTP 请求调你自己的模型"，保持零成本红线）之后，
  // 再用**内置节点**重建这两条片段；审计测试会保证它们不引用不存在的节点/端口。

  // ===== 游戏逻辑类 =====
  {
    id: 'signin-flow',
    get name() { return t('template.signinFlow.name'); },
    get description() { return t('template.signinFlow.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load', key: 'signed_today', scope: 'user' } },
      { kind: 'branch_if', config: { expression: '!value' } },
      { kind: 'variable_persist', config: { mode: 'load_or_default', key: 'exp', scope: 'user', default: 0 } },
      { kind: 'expression_eval', config: { expression: 'v1 + 10' } },
      { kind: 'variable_persist', config: { mode: 'save', key: 'exp', scope: 'user' } },
      { kind: 'format_text', config: { template: '签到成功！当前经验：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'value' },
      { from: 1, fromPort: 'true', to: 2, toPort: 'in' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 2, fromPort: 'result', to: 3, toPort: 'v1' },
      { from: 3, fromPort: 'out', to: 4, toPort: 'in' },
      { from: 3, fromPort: 'result', to: 4, toPort: 'value' },
      { from: 4, fromPort: 'out', to: 5, toPort: 'in' },
      { from: 3, fromPort: 'result', to: 5, toPort: 'var1' },
      { from: 5, fromPort: 'out', to: 6, toPort: 'in' },
      { from: 5, fromPort: 'result', to: 6, toPort: 'text' },
    ],
    get usageHint() { return t('template.signinFlow.usageHint'); },
  },
  {
    id: 'combat-round',
    get name() { return t('template.combatRound.name'); },
    get description() { return t('template.combatRound.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load_or_default', key: 'player_hp', scope: 'user', default: 100 } },
      { kind: 'expression_eval', config: { expression: 'v1 - 8' } },
      { kind: 'variable_persist', config: { mode: 'save', key: 'player_hp', scope: 'user' } },
      { kind: 'format_text', config: { template: '剩余血量：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'v1' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'value' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 3, toPort: 'var1' },
      { from: 3, fromPort: 'out', to: 4, toPort: 'in' },
      { from: 3, fromPort: 'result', to: 4, toPort: 'text' },
    ],
    get usageHint() { return t('template.combatRound.usageHint'); },
  },

  // ===== 时间工具类 =====
  {
    id: 'time-format',
    get name() { return t('template.timeFormat.name'); },
    get description() { return t('template.timeFormat.description'); },
    category: '时间工具',
    nodes: [{ kind: 'time_op', config: { mode: 'now', fmt: '%Y-%m-%d %H:%M' } }],
    edges: [],
    get usageHint() { return t('template.timeFormat.usageHint'); },
  },

  // ===== 游戏逻辑类（扩充） =====
  {
    id: 'inventory-view',
    get name() { return t('template.inventoryView.name'); },
    get description() { return t('template.inventoryView.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load', key: 'inventory', scope: 'user' } },
      { kind: 'format_text', config: { template: '🎒 你的背包：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'var1' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'text' },
    ],
    get usageHint() { return t('template.inventoryView.usageHint'); },
  },
  {
    id: 'inventory-add',
    get name() { return t('template.inventoryAdd.name'); },
    get description() { return t('template.inventoryAdd.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load_or_default', key: 'inventory', scope: 'user', default: '[]' } },
      { kind: 'list_op', config: { mode: 'append', item: '新手剑' } },
      { kind: 'variable_persist', config: { mode: 'save', key: 'inventory', scope: 'user' } },
      { kind: 'format_text', config: { template: '✅ 已获得新物品！当前背包：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'source_list' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'value' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 3, toPort: 'var1' },
      { from: 3, fromPort: 'out', to: 4, toPort: 'in' },
      { from: 3, fromPort: 'result', to: 4, toPort: 'text' },
    ],
    get usageHint() { return t('template.inventoryAdd.usageHint'); },
  },
  {
    id: 'shop-buy',
    get name() { return t('template.shopBuy.name'); },
    get description() { return t('template.shopBuy.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load', key: 'gold', scope: 'user' } },
      { kind: 'branch_if', config: { expression: 'value >= 100' } },
      { kind: 'expression_eval', config: { expression: 'v1 - 100' } },
      { kind: 'variable_persist', config: { mode: 'save', key: 'gold', scope: 'user' } },
      { kind: 'format_text', config: { template: '✅ 购买成功！剩余金币：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
      { kind: 'message_send', config: { mode: 'text', text: '❌ 金币不足，需要 100 金币！' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'value' },
      { from: 1, fromPort: 'true', to: 2, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 2, toPort: 'v1' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 2, fromPort: 'result', to: 3, toPort: 'value' },
      { from: 3, fromPort: 'out', to: 4, toPort: 'in' },
      { from: 2, fromPort: 'result', to: 4, toPort: 'var1' },
      { from: 4, fromPort: 'out', to: 5, toPort: 'in' },
      { from: 4, fromPort: 'result', to: 5, toPort: 'text' },
      { from: 1, fromPort: 'false', to: 6, toPort: 'in' },
    ],
    get usageHint() { return t('template.shopBuy.usageHint'); },
  },
  {
    id: 'quest-accept',
    get name() { return t('template.questAccept.name'); },
    get description() { return t('template.questAccept.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load', key: 'player_level', scope: 'user' } },
      { kind: 'branch_if', config: { expression: 'value >= 5' } },
      { kind: 'variable_persist', config: { mode: 'save', key: 'active_quest', scope: 'user' } },
      { kind: 'message_send', config: { mode: 'text', text: '✅ 任务已接取！' } },
      { kind: 'message_send', config: { mode: 'text', text: '❌ 等级不足，需达到 5 级！' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'value' },
      { from: 1, fromPort: 'true', to: 2, toPort: 'in' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 1, fromPort: 'false', to: 4, toPort: 'in' },
    ],
    get usageHint() { return t('template.questAccept.usageHint'); },
  },
  {
    id: 'pk-attack',
    get name() { return t('template.pkAttack.name'); },
    get description() { return t('template.pkAttack.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load_or_default', key: 'player_atk', scope: 'user', default: 50 } },
      { kind: 'expression_eval', config: { expression: 'v1 * 1.5' } },
      { kind: 'variable_persist', config: { mode: 'save', key: 'last_damage', scope: 'user' } },
      { kind: 'format_text', config: { template: '⚔️ 造成伤害：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'v1' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'value' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 3, toPort: 'var1' },
      { from: 3, fromPort: 'out', to: 4, toPort: 'in' },
      { from: 3, fromPort: 'result', to: 4, toPort: 'text' },
    ],
    get usageHint() { return t('template.pkAttack.usageHint'); },
  },
  {
    id: 'cultivate',
    get name() { return t('template.cultivate.name'); },
    get description() { return t('template.cultivate.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load_or_default', key: 'exp', scope: 'user', default: 0 } },
      { kind: 'expression_eval', config: { expression: 'v1 + 10' } },
      { kind: 'variable_persist', config: { mode: 'save', key: 'exp', scope: 'user' } },
      { kind: 'format_text', config: { template: '🌟 修炼成功！当前经验：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'v1' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'value' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 1, fromPort: 'result', to: 3, toPort: 'var1' },
      { from: 3, fromPort: 'out', to: 4, toPort: 'in' },
      { from: 3, fromPort: 'result', to: 4, toPort: 'text' },
    ],
    get usageHint() { return t('template.cultivate.usageHint'); },
  },
  {
    id: 'gacha-pull',
    get name() { return t('template.gachaPull.name'); },
    get description() { return t('template.gachaPull.description'); },
    category: '游戏逻辑',
    nodes: [
      {
        kind: 'random',
        config: {
          mode: 'weighted',
          items: '[{"value":"ssr","weight":1},{"value":"sr","weight":9},{"value":"r","weight":90}]',
        },
      },
      { kind: 'variable_persist', config: { mode: 'save', key: 'last_pull', scope: 'user' } },
      { kind: 'format_text', config: { template: '🎉 抽到：{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'value' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 2, toPort: 'var1' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 2, fromPort: 'result', to: 3, toPort: 'text' },
    ],
    get usageHint() { return t('template.gachaPull.usageHint'); },
  },
  {
    id: 'leaderboard',
    get name() { return t('template.leaderboard.name'); },
    get description() { return t('template.leaderboard.description'); },
    category: '游戏逻辑',
    nodes: [
      { kind: 'variable_persist', config: { mode: 'load', key: 'scores', scope: 'global' } },
      { kind: 'list_op', config: { mode: 'sort' } },
      { kind: 'format_text', config: { template: '🏆 排行榜：\n{var1}' } },
      { kind: 'message_send', config: { mode: 'text' } },
    ],
    edges: [
      { from: 0, fromPort: 'out', to: 1, toPort: 'in' },
      { from: 1, fromPort: 'out', to: 2, toPort: 'in' },
      { from: 2, fromPort: 'out', to: 3, toPort: 'in' },
      { from: 0, fromPort: 'result', to: 1, toPort: 'source_list' },
      { from: 1, fromPort: 'result', to: 2, toPort: 'var1' },
      { from: 2, fromPort: 'result', to: 3, toPort: 'text' },
    ],
    get usageHint() { return t('template.leaderboard.usageHint'); },
  },
];
