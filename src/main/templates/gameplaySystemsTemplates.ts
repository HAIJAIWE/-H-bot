// src/main/templates/gameplaySystemsTemplates.ts
// 玩法系统模板：交易 / 锻造 / 宠物 / 任务 4 套可视化游戏逻辑
// 使用 data_table/file_read + persistent_op + random + expression_eval
// 等节点搭出完整玩法流程，无需写 Python 代码。
import type { FlowTemplate } from '@shared/types/template'

// ════════════════════════════════════════════════════════════════
// 交易系统模板
// 4条链：/交易列表 | /购买 <物品> | /出售 <物品> | /转账 <QQ> <金额>
// ════════════════════════════════════════════════════════════════
export const TRADE_TEMPLATE: FlowTemplate = {
  id: 'gameplay-systems-trade',
  name: '交易系统',
  description: '完整交易玩法：商品列表展示、购买扣金币加物品、出售加金币删物品、转账给其他QQ。使用 persistent_op 管理背包与金币，全程可视化搭建。',
  botCategory: 'game',
  category: '其他',
  tags: ['交易', '商店', '购买', '出售', '转账', '游戏'],
  author: '内置',
  nodes: [
    // ═══ 链1 · /交易列表 ═══
    { id: 'tr1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '交易列表', nodeKind: 'on_message', config: { match: 'command', command: '交易列表', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'tr1_read', type: 'data', position: { x: 250, y: 0 }, data: { label: '读商品表', nodeKind: 'file_op', config: { mode: 'read', file_path: 'shop_items.json', encoding: 'utf-8' }, inputs: [], outputs: [] } },
    { id: 'tr1_fmt', type: 'logic', position: { x: 550, y: 0 }, data: { label: '格式化列表', nodeKind: 'format_text', config: { template: '🛒 商品列表：\n{var1}\n输入 /购买 <物品名> 购买' }, inputs: [], outputs: [] } },
    { id: 'tr1_msg', type: 'action', position: { x: 850, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链2 · /购买 <物品> ═══
    { id: 'tr2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '购买', nodeKind: 'on_message', config: { match: 'command', command: '购买', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'tr2_args', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取物品名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'tr2_uid', type: 'logic', position: { x: 500, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'tr2_lgold', type: 'data', position: { x: 750, y: 350 }, data: { label: '读金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr2_lprice', type: 'data', position: { x: 1000, y: 350 }, data: { label: '读物品价格', nodeKind: 'persistent_op', config: { mode: 'load', key: 'item_price', scope: 'global' }, inputs: [], outputs: [] } },
    { id: 'tr2_expr', type: 'logic', position: { x: 1300, y: 350 }, data: { label: '金币够不够', nodeKind: 'expression_eval', config: { expression: 'v1 >= v2' }, inputs: [], outputs: [] } },
    { id: 'tr2_if', type: 'logic', position: { x: 1600, y: 350 }, data: { label: '够金币？', nodeKind: 'if_branch', config: { expression: 'value == True' }, inputs: [], outputs: [] } },
    { id: 'tr2_nogold', type: 'action', position: { x: 1900, y: 430 }, data: { label: '金币不足', nodeKind: 'send_message', config: { text: '❌ 金币不足，无法购买' }, inputs: [], outputs: [] } },
    // 扣金币
    { id: 'tr2_subgold', type: 'logic', position: { x: 1900, y: 270 }, data: { label: '扣金币', nodeKind: 'expression_eval', config: { expression: 'v1 - v2' }, inputs: [], outputs: [] } },
    { id: 'tr2_sgold', type: 'data', position: { x: 2200, y: 270 }, data: { label: '存金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    // 加物品到背包
    { id: 'tr2_sitem', type: 'data', position: { x: 2500, y: 270 }, data: { label: '加物品到背包', nodeKind: 'persistent_op', config: { mode: 'save', key: 'bag_item', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr2_fmt', type: 'logic', position: { x: 2800, y: 270 }, data: { label: '格式化购买', nodeKind: 'format_text', config: { template: '✅ 购买成功：{var1}\n扣除金币后余额已更新' }, inputs: [], outputs: [] } },
    { id: 'tr2_msg', type: 'action', position: { x: 3100, y: 270 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链3 · /出售 <物品> ═══
    { id: 'tr3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '出售', nodeKind: 'on_message', config: { match: 'command', command: '出售', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'tr3_args', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取物品名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'tr3_uid', type: 'logic', position: { x: 500, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'tr3_lbag', type: 'data', position: { x: 750, y: 700 }, data: { label: '读背包', nodeKind: 'persistent_op', config: { mode: 'load', key: 'bag_item', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr3_ifhave', type: 'logic', position: { x: 1050, y: 700 }, data: { label: '背包有物品？', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    { id: 'tr3_nohave', type: 'action', position: { x: 1350, y: 780 }, data: { label: '无物品', nodeKind: 'send_message', config: { text: '❌ 背包中没有该物品' }, inputs: [], outputs: [] } },
    // 加金币
    { id: 'tr3_lprice', type: 'data', position: { x: 1350, y: 620 }, data: { label: '读回收价', nodeKind: 'persistent_op', config: { mode: 'load', key: 'item_sell_price', scope: 'global' }, inputs: [], outputs: [] } },
    { id: 'tr3_lgold', type: 'data', position: { x: 1600, y: 620 }, data: { label: '读金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr3_addgold', type: 'logic', position: { x: 1850, y: 620 }, data: { label: '加金币', nodeKind: 'expression_eval', config: { expression: 'v1 + v2' }, inputs: [], outputs: [] } },
    { id: 'tr3_sgold', type: 'data', position: { x: 2100, y: 620 }, data: { label: '存金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    // 删除物品
    { id: 'tr3_ditem', type: 'data', position: { x: 2400, y: 620 }, data: { label: '删除背包物品', nodeKind: 'persistent_op', config: { mode: 'save', key: 'bag_item', value: null, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr3_fmt', type: 'logic', position: { x: 2700, y: 620 }, data: { label: '格式化出售', nodeKind: 'format_text', config: { template: '✅ 出售成功：{var1}\n金币已增加' }, inputs: [], outputs: [] } },
    { id: 'tr3_msg', type: 'action', position: { x: 3000, y: 620 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链4 · /转账 <QQ> <金额> ═══
    { id: 'tr4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: '转账', nodeKind: 'on_message', config: { match: 'command', command: '转账', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'tr4_atarget', type: 'logic', position: { x: 250, y: 1050 }, data: { label: '获取目标QQ', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'tr4_aamt', type: 'logic', position: { x: 500, y: 1050 }, data: { label: '获取金额', nodeKind: 'get_context', config: { mode: 'command_args', index: 1 }, inputs: [], outputs: [] } },
    { id: 'tr4_uid', type: 'logic', position: { x: 750, y: 1050 }, data: { label: '获取自己QQ', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'tr4_lgold', type: 'data', position: { x: 1000, y: 1050 }, data: { label: '读自己金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr4_expr', type: 'logic', position: { x: 1300, y: 1050 }, data: { label: '够转账？', nodeKind: 'expression_eval', config: { expression: 'v1 >= v2' }, inputs: [], outputs: [] } },
    { id: 'tr4_if', type: 'logic', position: { x: 1600, y: 1050 }, data: { label: '够金币？', nodeKind: 'if_branch', config: { expression: 'value == True' }, inputs: [], outputs: [] } },
    { id: 'tr4_nogold', type: 'action', position: { x: 1900, y: 1130 }, data: { label: '金币不足', nodeKind: 'send_message', config: { text: '❌ 你的金币不足，无法转账' }, inputs: [], outputs: [] } },
    // 扣自己金币
    { id: 'tr4_subgold', type: 'logic', position: { x: 1900, y: 970 }, data: { label: '扣自己金币', nodeKind: 'expression_eval', config: { expression: 'v1 - v2' }, inputs: [], outputs: [] } },
    { id: 'tr4_sself', type: 'data', position: { x: 2200, y: 970 }, data: { label: '存自己金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    // 对方加钱
    { id: 'tr4_ltarget', type: 'data', position: { x: 2500, y: 970 }, data: { label: '读对方金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr4_addtarget', type: 'logic', position: { x: 2800, y: 970 }, data: { label: '对方加钱', nodeKind: 'expression_eval', config: { expression: 'v1 + v2' }, inputs: [], outputs: [] } },
    { id: 'tr4_starget', type: 'data', position: { x: 3100, y: 970 }, data: { label: '存对方金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tr4_fmt', type: 'logic', position: { x: 3400, y: 970 }, data: { label: '格式化转账', nodeKind: 'format_text', config: { template: '💸 转账成功：已向 {var1} 转账 {var2} 金币' }, inputs: [], outputs: [] } },
    { id: 'tr4_msg', type: 'action', position: { x: 3700, y: 970 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    // 链1
    { id: 'tr1_e1', source: 'tr1_cmd', target: 'tr1_read', sourcePort: 'next', targetPort: 'in' },
    { id: 'tr1_e2', source: 'tr1_read', target: 'tr1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr1_e3', source: 'tr1_read', target: 'tr1_fmt', sourcePort: 'data', targetPort: 'var1' },
    { id: 'tr1_e4', source: 'tr1_fmt', target: 'tr1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr1_e5', source: 'tr1_fmt', target: 'tr1_msg', sourcePort: 'result', targetPort: 'text' },
    // 链2
    { id: 'tr2_e1', source: 'tr2_cmd', target: 'tr2_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'tr2_e2', source: 'tr2_args', target: 'tr2_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e3', source: 'tr2_uid', target: 'tr2_lgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e4', source: 'tr2_lgold', target: 'tr2_lprice', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e5', source: 'tr2_lprice', target: 'tr2_expr', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e6', source: 'tr2_lgold', target: 'tr2_expr', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tr2_e7', source: 'tr2_lprice', target: 'tr2_expr', sourcePort: 'result', targetPort: 'v2' },
    { id: 'tr2_e8', source: 'tr2_expr', target: 'tr2_if', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e9', source: 'tr2_expr', target: 'tr2_if', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr2_e10', source: 'tr2_if', target: 'tr2_nogold', sourcePort: 'false', targetPort: 'in' },
    { id: 'tr2_e11', source: 'tr2_if', target: 'tr2_subgold', sourcePort: 'true', targetPort: 'in' },
    { id: 'tr2_e12', source: 'tr2_lgold', target: 'tr2_subgold', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tr2_e13', source: 'tr2_lprice', target: 'tr2_subgold', sourcePort: 'result', targetPort: 'v2' },
    { id: 'tr2_e14', source: 'tr2_subgold', target: 'tr2_sgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e15', source: 'tr2_subgold', target: 'tr2_sgold', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr2_e16', source: 'tr2_sgold', target: 'tr2_sitem', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e17', source: 'tr2_args', target: 'tr2_sitem', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr2_e18', source: 'tr2_sitem', target: 'tr2_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e19', source: 'tr2_args', target: 'tr2_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'tr2_e20', source: 'tr2_fmt', target: 'tr2_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr2_e21', source: 'tr2_fmt', target: 'tr2_msg', sourcePort: 'result', targetPort: 'text' },
    // 链3
    { id: 'tr3_e1', source: 'tr3_cmd', target: 'tr3_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'tr3_e2', source: 'tr3_args', target: 'tr3_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e3', source: 'tr3_uid', target: 'tr3_lbag', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e4', source: 'tr3_lbag', target: 'tr3_ifhave', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e5', source: 'tr3_lbag', target: 'tr3_ifhave', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr3_e6', source: 'tr3_ifhave', target: 'tr3_nohave', sourcePort: 'false', targetPort: 'in' },
    { id: 'tr3_e7', source: 'tr3_ifhave', target: 'tr3_lprice', sourcePort: 'true', targetPort: 'in' },
    { id: 'tr3_e8', source: 'tr3_lprice', target: 'tr3_lgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e9', source: 'tr3_lgold', target: 'tr3_addgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e10', source: 'tr3_lgold', target: 'tr3_addgold', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tr3_e11', source: 'tr3_lprice', target: 'tr3_addgold', sourcePort: 'result', targetPort: 'v2' },
    { id: 'tr3_e12', source: 'tr3_addgold', target: 'tr3_sgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e13', source: 'tr3_addgold', target: 'tr3_sgold', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr3_e14', source: 'tr3_sgold', target: 'tr3_ditem', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e15', source: 'tr3_ditem', target: 'tr3_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e16', source: 'tr3_args', target: 'tr3_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'tr3_e17', source: 'tr3_fmt', target: 'tr3_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr3_e18', source: 'tr3_fmt', target: 'tr3_msg', sourcePort: 'result', targetPort: 'text' },
    // 链4
    { id: 'tr4_e1', source: 'tr4_cmd', target: 'tr4_atarget', sourcePort: 'next', targetPort: 'in' },
    { id: 'tr4_e2', source: 'tr4_atarget', target: 'tr4_aamt', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e3', source: 'tr4_aamt', target: 'tr4_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e4', source: 'tr4_uid', target: 'tr4_lgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e5', source: 'tr4_lgold', target: 'tr4_expr', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e6', source: 'tr4_lgold', target: 'tr4_expr', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tr4_e7', source: 'tr4_aamt', target: 'tr4_expr', sourcePort: 'result', targetPort: 'v2' },
    { id: 'tr4_e8', source: 'tr4_expr', target: 'tr4_if', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e9', source: 'tr4_expr', target: 'tr4_if', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr4_e10', source: 'tr4_if', target: 'tr4_nogold', sourcePort: 'false', targetPort: 'in' },
    { id: 'tr4_e11', source: 'tr4_if', target: 'tr4_subgold', sourcePort: 'true', targetPort: 'in' },
    { id: 'tr4_e12', source: 'tr4_lgold', target: 'tr4_subgold', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tr4_e13', source: 'tr4_aamt', target: 'tr4_subgold', sourcePort: 'result', targetPort: 'v2' },
    { id: 'tr4_e14', source: 'tr4_subgold', target: 'tr4_sself', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e15', source: 'tr4_subgold', target: 'tr4_sself', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr4_e16', source: 'tr4_sself', target: 'tr4_ltarget', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e17', source: 'tr4_ltarget', target: 'tr4_addtarget', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e18', source: 'tr4_ltarget', target: 'tr4_addtarget', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tr4_e19', source: 'tr4_aamt', target: 'tr4_addtarget', sourcePort: 'result', targetPort: 'v2' },
    { id: 'tr4_e20', source: 'tr4_addtarget', target: 'tr4_starget', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e21', source: 'tr4_addtarget', target: 'tr4_starget', sourcePort: 'result', targetPort: 'value' },
    { id: 'tr4_e22', source: 'tr4_starget', target: 'tr4_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e23', source: 'tr4_atarget', target: 'tr4_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'tr4_e24', source: 'tr4_aamt', target: 'tr4_fmt', sourcePort: 'result', targetPort: 'var2' },
    { id: 'tr4_e25', source: 'tr4_fmt', target: 'tr4_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'tr4_e26', source: 'tr4_fmt', target: 'tr4_msg', sourcePort: 'result', targetPort: 'text' },
  ],
  createdAt: '2026-07-02',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 锻造系统模板
// 3条链：/锻造列表 | /锻造 <装备> | /强化 <装备>
// ════════════════════════════════════════════════════════════════
export const FORGE_TEMPLATE: FlowTemplate = {
  id: 'gameplay-systems-forge',
  name: '锻造系统',
  description: '装备锻造与强化：查看可锻造装备与材料需求、消耗材料按成功率锻造、消耗金币强化装备等级。使用 random(weighted 模式) 判定成功率、random(int 模式) 判定强化结果，全程可视化搭建。',
  botCategory: 'game',
  category: '其他',
  tags: ['锻造', '强化', '装备', 'random', '游戏'],
  author: '内置',
  nodes: [
    // ═══ 链1 · /锻造列表 ═══
    { id: 'fo1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '锻造列表', nodeKind: 'on_message', config: { match: 'command', command: '锻造列表', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fo1_read', type: 'data', position: { x: 250, y: 0 }, data: { label: '读锻造配方', nodeKind: 'file_op', config: { mode: 'read', file_path: 'forge_recipes.json', encoding: 'utf-8' }, inputs: [], outputs: [] } },
    { id: 'fo1_fmt', type: 'logic', position: { x: 550, y: 0 }, data: { label: '格式化列表', nodeKind: 'format_text', config: { template: '🔨 可锻造装备：\n{var1}\n输入 /锻造 <装备名> 开始锻造' }, inputs: [], outputs: [] } },
    { id: 'fo1_msg', type: 'action', position: { x: 850, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链2 · /锻造 <装备> ═══
    { id: 'fo2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '锻造', nodeKind: 'on_message', config: { match: 'command', command: '锻造', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fo2_args', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取装备名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'fo2_uid', type: 'logic', position: { x: 500, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    // 检查3种材料
    { id: 'fo2_lm1', type: 'data', position: { x: 750, y: 350 }, data: { label: '读材料1', nodeKind: 'persistent_op', config: { mode: 'load', key: 'mat_ore', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo2_lm2', type: 'data', position: { x: 1000, y: 350 }, data: { label: '读材料2', nodeKind: 'persistent_op', config: { mode: 'load', key: 'mat_wood', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo2_lm3', type: 'data', position: { x: 1250, y: 350 }, data: { label: '读材料3', nodeKind: 'persistent_op', config: { mode: 'load', key: 'mat_gem', scope: 'user' }, inputs: [], outputs: [] } },
    // 全部满足判断
    { id: 'fo2_expr', type: 'logic', position: { x: 1550, y: 350 }, data: { label: '材料齐全？', nodeKind: 'expression_eval', config: { expression: 'v1 >= 5 and v2 >= 3 and v3 >= 1' }, inputs: [], outputs: [] } },
    { id: 'fo2_if', type: 'logic', position: { x: 1850, y: 350 }, data: { label: '够材料？', nodeKind: 'if_branch', config: { expression: 'value == True' }, inputs: [], outputs: [] } },
    { id: 'fo2_nomat', type: 'action', position: { x: 2150, y: 430 }, data: { label: '材料不足', nodeKind: 'send_message', config: { text: '❌ 材料不足，无法锻造' }, inputs: [], outputs: [] } },
    // 消耗材料
    { id: 'fo2_sm1', type: 'data', position: { x: 2150, y: 270 }, data: { label: '消耗材料1', nodeKind: 'persistent_op', config: { mode: 'save', key: 'mat_ore', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo2_sm2', type: 'data', position: { x: 2450, y: 270 }, data: { label: '消耗材料2', nodeKind: 'persistent_op', config: { mode: 'save', key: 'mat_wood', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo2_sm3', type: 'data', position: { x: 2750, y: 270 }, data: { label: '消耗材料3', nodeKind: 'persistent_op', config: { mode: 'save', key: 'mat_gem', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    // 成功率判定
    { id: 'fo2_rw', type: 'logic', position: { x: 3050, y: 270 }, data: { label: '成功率判定', nodeKind: 'random', config: { mode: 'weighted', items: [{ value: 'success', weight: 70 }, { value: 'fail', weight: 30 }] }, inputs: [], outputs: [] } },
    { id: 'fo2_ifwin', type: 'logic', position: { x: 3350, y: 270 }, data: { label: '锻造成功？', nodeKind: 'if_branch', config: { expression: 'value == "success"' }, inputs: [], outputs: [] } },
    // 失败
    { id: 'fo2_failmsg', type: 'action', position: { x: 3650, y: 350 }, data: { label: '锻造失败', nodeKind: 'send_message', config: { text: '💔 锻造失败，材料已消耗' }, inputs: [], outputs: [] } },
    // 成功：存新装备
    { id: 'fo2_sequip', type: 'data', position: { x: 3650, y: 200 }, data: { label: '存新装备', nodeKind: 'persistent_op', config: { mode: 'save', key: 'equipped', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo2_fmt', type: 'logic', position: { x: 3950, y: 200 }, data: { label: '格式化成功', nodeKind: 'format_text', config: { template: '🎉 锻造成功！获得装备：{var1}' }, inputs: [], outputs: [] } },
    { id: 'fo2_msg', type: 'action', position: { x: 4250, y: 200 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链3 · /强化 <装备> ═══
    { id: 'fo3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '强化', nodeKind: 'on_message', config: { match: 'command', command: '强化', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fo3_args', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取装备名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'fo3_uid', type: 'logic', position: { x: 500, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'fo3_llvl', type: 'data', position: { x: 750, y: 700 }, data: { label: '读装备等级', nodeKind: 'persistent_op', config: { mode: 'load', key: 'equip_level', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo3_ifmax', type: 'logic', position: { x: 1050, y: 700 }, data: { label: '到上限？', nodeKind: 'if_branch', config: { expression: 'value >= 10' }, inputs: [], outputs: [] } },
    { id: 'fo3_maxmsg', type: 'action', position: { x: 1350, y: 780 }, data: { label: '已达上限', nodeKind: 'send_message', config: { text: '⚠️ 装备等级已达上限' }, inputs: [], outputs: [] } },
    // 检查金币
    { id: 'fo3_lgold', type: 'data', position: { x: 1350, y: 620 }, data: { label: '读金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo3_ifgold', type: 'logic', position: { x: 1650, y: 620 }, data: { label: '够金币？', nodeKind: 'if_branch', config: { expression: 'value >= 100' }, inputs: [], outputs: [] } },
    { id: 'fo3_nogold', type: 'action', position: { x: 1950, y: 700 }, data: { label: '金币不足', nodeKind: 'send_message', config: { text: '❌ 金币不足，强化需要100金币' }, inputs: [], outputs: [] } },
    // 扣金币
    { id: 'fo3_subgold', type: 'logic', position: { x: 1950, y: 550 }, data: { label: '扣金币', nodeKind: 'expression_eval', config: { expression: 'v1 - 100' }, inputs: [], outputs: [] } },
    { id: 'fo3_sgold', type: 'data', position: { x: 2250, y: 550 }, data: { label: '存金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    // 成功判定
    { id: 'fo3_ri', type: 'logic', position: { x: 2550, y: 550 }, data: { label: '强化判定', nodeKind: 'random', config: { mode: 'int', min: 1, max: 100 }, inputs: [], outputs: [] } },
    { id: 'fo3_ifsucc', type: 'logic', position: { x: 2850, y: 550 }, data: { label: '成功？', nodeKind: 'if_branch', config: { expression: 'value >= 50' }, inputs: [], outputs: [] } },
    // 成功：等级+1
    { id: 'fo3_addlvl', type: 'logic', position: { x: 3150, y: 470 }, data: { label: '等级+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'fo3_slvl', type: 'data', position: { x: 3450, y: 470 }, data: { label: '存等级', nodeKind: 'persistent_op', config: { mode: 'save', key: 'equip_level', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo3_sucmsg', type: 'action', position: { x: 3750, y: 470 }, data: { label: '强化成功', nodeKind: 'send_message', config: { text: '✨ 强化成功！装备等级+1' }, inputs: [], outputs: [] } },
    // 失败：等级-1
    { id: 'fo3_sublvl', type: 'logic', position: { x: 3150, y: 630 }, data: { label: '等级-1', nodeKind: 'expression_eval', config: { expression: 'v1 - 1' }, inputs: [], outputs: [] } },
    { id: 'fo3_slvl2', type: 'data', position: { x: 3450, y: 630 }, data: { label: '存等级', nodeKind: 'persistent_op', config: { mode: 'save', key: 'equip_level', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fo3_failmsg', type: 'action', position: { x: 3750, y: 630 }, data: { label: '强化失败', nodeKind: 'send_message', config: { text: '💥 强化失败，装备等级-1' }, inputs: [], outputs: [] } },
  ],
  edges: [
    // 链1
    { id: 'fo1_e1', source: 'fo1_cmd', target: 'fo1_read', sourcePort: 'next', targetPort: 'in' },
    { id: 'fo1_e2', source: 'fo1_read', target: 'fo1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo1_e3', source: 'fo1_read', target: 'fo1_fmt', sourcePort: 'data', targetPort: 'var1' },
    { id: 'fo1_e4', source: 'fo1_fmt', target: 'fo1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo1_e5', source: 'fo1_fmt', target: 'fo1_msg', sourcePort: 'result', targetPort: 'text' },
    // 链2
    { id: 'fo2_e1', source: 'fo2_cmd', target: 'fo2_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'fo2_e2', source: 'fo2_args', target: 'fo2_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e3', source: 'fo2_uid', target: 'fo2_lm1', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e4', source: 'fo2_lm1', target: 'fo2_lm2', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e5', source: 'fo2_lm2', target: 'fo2_lm3', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e6', source: 'fo2_lm3', target: 'fo2_expr', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e7', source: 'fo2_lm1', target: 'fo2_expr', sourcePort: 'result', targetPort: 'v1' },
    { id: 'fo2_e8', source: 'fo2_lm2', target: 'fo2_expr', sourcePort: 'result', targetPort: 'v2' },
    { id: 'fo2_e9', source: 'fo2_lm3', target: 'fo2_expr', sourcePort: 'result', targetPort: 'v3' },
    { id: 'fo2_e10', source: 'fo2_expr', target: 'fo2_if', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e11', source: 'fo2_expr', target: 'fo2_if', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo2_e12', source: 'fo2_if', target: 'fo2_nomat', sourcePort: 'false', targetPort: 'in' },
    { id: 'fo2_e13', source: 'fo2_if', target: 'fo2_sm1', sourcePort: 'true', targetPort: 'in' },
    { id: 'fo2_e14', source: 'fo2_sm1', target: 'fo2_sm2', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e15', source: 'fo2_sm2', target: 'fo2_sm3', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e16', source: 'fo2_sm3', target: 'fo2_rw', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e17', source: 'fo2_rw', target: 'fo2_ifwin', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e18', source: 'fo2_rw', target: 'fo2_ifwin', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo2_e19', source: 'fo2_ifwin', target: 'fo2_failmsg', sourcePort: 'false', targetPort: 'in' },
    { id: 'fo2_e20', source: 'fo2_ifwin', target: 'fo2_sequip', sourcePort: 'true', targetPort: 'in' },
    { id: 'fo2_e21', source: 'fo2_args', target: 'fo2_sequip', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo2_e22', source: 'fo2_sequip', target: 'fo2_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e23', source: 'fo2_args', target: 'fo2_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'fo2_e24', source: 'fo2_fmt', target: 'fo2_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo2_e25', source: 'fo2_fmt', target: 'fo2_msg', sourcePort: 'result', targetPort: 'text' },
    // 链3
    { id: 'fo3_e1', source: 'fo3_cmd', target: 'fo3_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'fo3_e2', source: 'fo3_args', target: 'fo3_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e3', source: 'fo3_uid', target: 'fo3_llvl', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e4', source: 'fo3_llvl', target: 'fo3_ifmax', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e5', source: 'fo3_llvl', target: 'fo3_ifmax', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo3_e6', source: 'fo3_ifmax', target: 'fo3_maxmsg', sourcePort: 'true', targetPort: 'in' },
    { id: 'fo3_e7', source: 'fo3_ifmax', target: 'fo3_lgold', sourcePort: 'false', targetPort: 'in' },
    { id: 'fo3_e8', source: 'fo3_lgold', target: 'fo3_ifgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e9', source: 'fo3_lgold', target: 'fo3_ifgold', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo3_e10', source: 'fo3_ifgold', target: 'fo3_nogold', sourcePort: 'false', targetPort: 'in' },
    { id: 'fo3_e11', source: 'fo3_ifgold', target: 'fo3_subgold', sourcePort: 'true', targetPort: 'in' },
    { id: 'fo3_e12', source: 'fo3_lgold', target: 'fo3_subgold', sourcePort: 'result', targetPort: 'v1' },
    { id: 'fo3_e13', source: 'fo3_subgold', target: 'fo3_sgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e14', source: 'fo3_subgold', target: 'fo3_sgold', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo3_e15', source: 'fo3_sgold', target: 'fo3_ri', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e16', source: 'fo3_ri', target: 'fo3_ifsucc', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e17', source: 'fo3_ri', target: 'fo3_ifsucc', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo3_e18', source: 'fo3_ifsucc', target: 'fo3_addlvl', sourcePort: 'true', targetPort: 'in' },
    { id: 'fo3_e19', source: 'fo3_llvl', target: 'fo3_addlvl', sourcePort: 'result', targetPort: 'v1' },
    { id: 'fo3_e20', source: 'fo3_addlvl', target: 'fo3_slvl', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e21', source: 'fo3_addlvl', target: 'fo3_slvl', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo3_e22', source: 'fo3_slvl', target: 'fo3_sucmsg', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e23', source: 'fo3_ifsucc', target: 'fo3_sublvl', sourcePort: 'false', targetPort: 'in' },
    { id: 'fo3_e24', source: 'fo3_llvl', target: 'fo3_sublvl', sourcePort: 'result', targetPort: 'v1' },
    { id: 'fo3_e25', source: 'fo3_sublvl', target: 'fo3_slvl2', sourcePort: 'out', targetPort: 'in' },
    { id: 'fo3_e26', source: 'fo3_sublvl', target: 'fo3_slvl2', sourcePort: 'result', targetPort: 'value' },
    { id: 'fo3_e27', source: 'fo3_slvl2', target: 'fo3_failmsg', sourcePort: 'out', targetPort: 'in' },
  ],
  createdAt: '2026-07-02',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 宠物系统模板
// 4条链：/捕捉 | /宠物列表 | /喂养 <宠物> | /宠物对战 <宠物>
// ════════════════════════════════════════════════════════════════
export const PET_TEMPLATE: FlowTemplate = {
  id: 'gameplay-systems-pet',
  name: '宠物系统',
  description: '完整宠物玩法：按稀有度捕捉宠物、查看宠物列表、喂养宠物升级、宠物对战计算伤害。使用 random(weighted 模式) 抽稀有度、expression_eval 计算对战伤害，全程可视化搭建。',
  botCategory: 'game',
  category: '其他',
  tags: ['宠物', '捕捉', '喂养', '对战', '游戏'],
  author: '内置',
  nodes: [
    // ═══ 链1 · /捕捉 ═══
    { id: 'pe1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '捕捉', nodeKind: 'on_message', config: { match: 'command', command: '捕捉', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'pe1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'pe1_rw', type: 'logic', position: { x: 500, y: 0 }, data: { label: '按稀有度抽宠物', nodeKind: 'random', config: { mode: 'weighted', items: [{ value: '普通史莱姆', weight: 60 }, { value: '稀有野狼', weight: 30 }, { value: '史诗火龙', weight: 9 }, { value: '传说凤凰', weight: 1 }] }, inputs: [], outputs: [] } },
    { id: 'pe1_spet', type: 'data', position: { x: 800, y: 0 }, data: { label: '存宠物槽', nodeKind: 'persistent_op', config: { mode: 'save', key: 'pet_slot', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe1_fmt', type: 'logic', position: { x: 1100, y: 0 }, data: { label: '格式化结果', nodeKind: 'format_text', config: { template: '🎯 捕捉成功！获得宠物：{var1}' }, inputs: [], outputs: [] } },
    { id: 'pe1_msg', type: 'action', position: { x: 1400, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链2 · /宠物列表 ═══
    { id: 'pe2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '宠物列表', nodeKind: 'on_message', config: { match: 'command', command: '宠物列表', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'pe2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'pe2_lpet', type: 'data', position: { x: 500, y: 350 }, data: { label: '读宠物槽', nodeKind: 'persistent_op', config: { mode: 'load', key: 'pet_slot', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe2_fmt', type: 'logic', position: { x: 800, y: 350 }, data: { label: '格式化列表', nodeKind: 'format_text', config: { template: '🐾 你的宠物：\n{var1}\n输入 /喂养 <宠物名> 或 /宠物对战 <宠物名>' }, inputs: [], outputs: [] } },
    { id: 'pe2_msg', type: 'action', position: { x: 1100, y: 350 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链3 · /喂养 <宠物> ═══
    { id: 'pe3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '喂养', nodeKind: 'on_message', config: { match: 'command', command: '喂养', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'pe3_args', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取宠物名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'pe3_uid', type: 'logic', position: { x: 500, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'pe3_lfood', type: 'data', position: { x: 750, y: 700 }, data: { label: '读食物数量', nodeKind: 'persistent_op', config: { mode: 'load', key: 'food', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe3_iffod', type: 'logic', position: { x: 1050, y: 700 }, data: { label: '有食物？', nodeKind: 'if_branch', config: { expression: 'value >= 1' }, inputs: [], outputs: [] } },
    { id: 'pe3_nofood', type: 'action', position: { x: 1350, y: 780 }, data: { label: '无食物', nodeKind: 'send_message', config: { text: '❌ 没有食物，无法喂养' }, inputs: [], outputs: [] } },
    // 消耗食物
    { id: 'pe3_subfood', type: 'logic', position: { x: 1350, y: 620 }, data: { label: '消耗食物', nodeKind: 'expression_eval', config: { expression: 'v1 - 1' }, inputs: [], outputs: [] } },
    { id: 'pe3_sfood', type: 'data', position: { x: 1650, y: 620 }, data: { label: '存食物', nodeKind: 'persistent_op', config: { mode: 'save', key: 'food', scope: 'user' }, inputs: [], outputs: [] } },
    // 经验+1
    { id: 'pe3_lexp', type: 'data', position: { x: 1950, y: 620 }, data: { label: '读宠物经验', nodeKind: 'persistent_op', config: { mode: 'load', key: 'pet_exp', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe3_addexp', type: 'logic', position: { x: 2250, y: 620 }, data: { label: '经验+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'pe3_sexp', type: 'data', position: { x: 2550, y: 620 }, data: { label: '存经验', nodeKind: 'persistent_op', config: { mode: 'save', key: 'pet_exp', scope: 'user' }, inputs: [], outputs: [] } },
    // 是否升级
    { id: 'pe3_exprup', type: 'logic', position: { x: 2850, y: 620 }, data: { label: '是否升级？', nodeKind: 'expression_eval', config: { expression: 'v1 >= 100' }, inputs: [], outputs: [] } },
    { id: 'pe3_ifup', type: 'logic', position: { x: 3150, y: 620 }, data: { label: '升级？', nodeKind: 'if_branch', config: { expression: 'value == True' }, inputs: [], outputs: [] } },
    // 未升级
    { id: 'pe3_feedmsg', type: 'action', position: { x: 3450, y: 700 }, data: { label: '喂养成功', nodeKind: 'send_message', config: { text: '🥩 喂养成功，宠物经验+1' }, inputs: [], outputs: [] } },
    // 升级：属性提升
    { id: 'pe3_latk', type: 'data', position: { x: 3450, y: 540 }, data: { label: '读宠物攻击', nodeKind: 'persistent_op', config: { mode: 'load', key: 'pet_atk', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe3_addatk', type: 'logic', position: { x: 3750, y: 540 }, data: { label: '攻击+2', nodeKind: 'expression_eval', config: { expression: 'v1 + 2' }, inputs: [], outputs: [] } },
    { id: 'pe3_satk', type: 'data', position: { x: 4050, y: 540 }, data: { label: '存攻击', nodeKind: 'persistent_op', config: { mode: 'save', key: 'pet_atk', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe3_upmsg', type: 'action', position: { x: 4350, y: 540 }, data: { label: '升级消息', nodeKind: 'send_message', config: { text: '🎉 宠物升级！攻击力+2' }, inputs: [], outputs: [] } },

    // ═══ 链4 · /宠物对战 <宠物> ═══
    { id: 'pe4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: '宠物对战', nodeKind: 'on_message', config: { match: 'command', command: '宠物对战', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'pe4_args', type: 'logic', position: { x: 250, y: 1050 }, data: { label: '获取宠物名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'pe4_uid', type: 'logic', position: { x: 500, y: 1050 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'pe4_latk', type: 'data', position: { x: 750, y: 1050 }, data: { label: '读宠物攻击', nodeKind: 'persistent_op', config: { mode: 'load', key: 'pet_atk', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe4_lhp', type: 'data', position: { x: 1000, y: 1050 }, data: { label: '读宠物HP', nodeKind: 'persistent_op', config: { mode: 'load', key: 'pet_hp', scope: 'user' }, inputs: [], outputs: [] } },
    // 怪物
    { id: 'pe4_rmon', type: 'logic', position: { x: 1250, y: 1050 }, data: { label: '随机怪物', nodeKind: 'random', config: { mode: 'choice', list: ['野猪', '巨蛛', '蝙蝠'] }, inputs: [], outputs: [] } },
    // 战斗计算（伤害 = 攻击力 * 2 - 防御 10，最小 0；怪物初始 HP=100，扣减后剩余）
    { id: 'pe4_combat', type: 'logic', position: { x: 1550, y: 1050 }, data: { label: '战斗计算', nodeKind: 'expression_eval', config: { expression: 'max(0, 100 - (v1 * 2 - 10))' }, inputs: [], outputs: [] } },
    { id: 'pe4_smhp', type: 'data', position: { x: 1850, y: 1050 }, data: { label: '存怪物剩余HP', nodeKind: 'persistent_op', config: { mode: 'save', key: 'monster_hp', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pe4_expr', type: 'logic', position: { x: 2150, y: 1050 }, data: { label: '怪物HP<=0?', nodeKind: 'expression_eval', config: { expression: 'v1 <= 0' }, inputs: [], outputs: [] } },
    { id: 'pe4_ifwin', type: 'logic', position: { x: 2450, y: 1050 }, data: { label: '胜利？', nodeKind: 'if_branch', config: { expression: 'value == True' }, inputs: [], outputs: [] } },
    // 失败
    { id: 'pe4_losemsg', type: 'action', position: { x: 2750, y: 1130 }, data: { label: '对战失败', nodeKind: 'send_message', config: { text: '💔 宠物对战失败，再接再厉' }, inputs: [], outputs: [] } },
    // 胜利：给奖励
    { id: 'pe4_rw', type: 'logic', position: { x: 2750, y: 970 }, data: { label: '随机奖励', nodeKind: 'random', config: { mode: 'choice', list: ['金币+50', '金币+100', '金币+200'] }, inputs: [], outputs: [] } },
    { id: 'pe4_fmt', type: 'logic', position: { x: 3050, y: 970 }, data: { label: '格式化胜利', nodeKind: 'format_text', config: { template: '🏆 宠物对战胜利！\n奖励：{var1}' }, inputs: [], outputs: [] } },
    { id: 'pe4_msg', type: 'action', position: { x: 3350, y: 970 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    // 链1
    { id: 'pe1_e1', source: 'pe1_cmd', target: 'pe1_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'pe1_e2', source: 'pe1_uid', target: 'pe1_rw', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe1_e3', source: 'pe1_rw', target: 'pe1_spet', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe1_e4', source: 'pe1_rw', target: 'pe1_spet', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe1_e5', source: 'pe1_spet', target: 'pe1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe1_e6', source: 'pe1_rw', target: 'pe1_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'pe1_e7', source: 'pe1_fmt', target: 'pe1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe1_e8', source: 'pe1_fmt', target: 'pe1_msg', sourcePort: 'result', targetPort: 'text' },
    // 链2
    { id: 'pe2_e1', source: 'pe2_cmd', target: 'pe2_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'pe2_e2', source: 'pe2_uid', target: 'pe2_lpet', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe2_e3', source: 'pe2_lpet', target: 'pe2_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe2_e4', source: 'pe2_lpet', target: 'pe2_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'pe2_e5', source: 'pe2_fmt', target: 'pe2_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe2_e6', source: 'pe2_fmt', target: 'pe2_msg', sourcePort: 'result', targetPort: 'text' },
    // 链3
    { id: 'pe3_e1', source: 'pe3_cmd', target: 'pe3_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'pe3_e2', source: 'pe3_args', target: 'pe3_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e3', source: 'pe3_uid', target: 'pe3_lfood', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e4', source: 'pe3_lfood', target: 'pe3_iffod', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e5', source: 'pe3_lfood', target: 'pe3_iffod', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe3_e6', source: 'pe3_iffod', target: 'pe3_nofood', sourcePort: 'false', targetPort: 'in' },
    { id: 'pe3_e7', source: 'pe3_iffod', target: 'pe3_subfood', sourcePort: 'true', targetPort: 'in' },
    { id: 'pe3_e8', source: 'pe3_lfood', target: 'pe3_subfood', sourcePort: 'result', targetPort: 'v1' },
    { id: 'pe3_e9', source: 'pe3_subfood', target: 'pe3_sfood', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e10', source: 'pe3_subfood', target: 'pe3_sfood', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe3_e11', source: 'pe3_sfood', target: 'pe3_lexp', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e12', source: 'pe3_lexp', target: 'pe3_addexp', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e13', source: 'pe3_lexp', target: 'pe3_addexp', sourcePort: 'result', targetPort: 'v1' },
    { id: 'pe3_e14', source: 'pe3_addexp', target: 'pe3_sexp', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e15', source: 'pe3_addexp', target: 'pe3_sexp', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe3_e16', source: 'pe3_sexp', target: 'pe3_exprup', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e17', source: 'pe3_sexp', target: 'pe3_exprup', sourcePort: 'result', targetPort: 'v1' },
    { id: 'pe3_e18', source: 'pe3_exprup', target: 'pe3_ifup', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e19', source: 'pe3_exprup', target: 'pe3_ifup', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe3_e20', source: 'pe3_ifup', target: 'pe3_feedmsg', sourcePort: 'false', targetPort: 'in' },
    { id: 'pe3_e21', source: 'pe3_ifup', target: 'pe3_latk', sourcePort: 'true', targetPort: 'in' },
    { id: 'pe3_e22', source: 'pe3_latk', target: 'pe3_addatk', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e23', source: 'pe3_latk', target: 'pe3_addatk', sourcePort: 'result', targetPort: 'v1' },
    { id: 'pe3_e24', source: 'pe3_addatk', target: 'pe3_satk', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe3_e25', source: 'pe3_addatk', target: 'pe3_satk', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe3_e26', source: 'pe3_satk', target: 'pe3_upmsg', sourcePort: 'out', targetPort: 'in' },
    // 链4
    { id: 'pe4_e1', source: 'pe4_cmd', target: 'pe4_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'pe4_e2', source: 'pe4_args', target: 'pe4_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e3', source: 'pe4_uid', target: 'pe4_latk', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e4', source: 'pe4_latk', target: 'pe4_lhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e5', source: 'pe4_lhp', target: 'pe4_rmon', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e6', source: 'pe4_rmon', target: 'pe4_combat', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e7', source: 'pe4_latk', target: 'pe4_combat', sourcePort: 'result', targetPort: 'v1' },
    { id: 'pe4_e8', source: 'pe4_lhp', target: 'pe4_combat', sourcePort: 'result', targetPort: 'v2' },
    { id: 'pe4_e9', source: 'pe4_combat', target: 'pe4_smhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e10', source: 'pe4_combat', target: 'pe4_smhp', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe4_e11', source: 'pe4_smhp', target: 'pe4_expr', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e12', source: 'pe4_smhp', target: 'pe4_expr', sourcePort: 'result', targetPort: 'v1' },
    { id: 'pe4_e13', source: 'pe4_expr', target: 'pe4_ifwin', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e14', source: 'pe4_expr', target: 'pe4_ifwin', sourcePort: 'result', targetPort: 'value' },
    { id: 'pe4_e15', source: 'pe4_ifwin', target: 'pe4_losemsg', sourcePort: 'false', targetPort: 'in' },
    { id: 'pe4_e16', source: 'pe4_ifwin', target: 'pe4_rw', sourcePort: 'true', targetPort: 'in' },
    { id: 'pe4_e17', source: 'pe4_rw', target: 'pe4_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e18', source: 'pe4_rw', target: 'pe4_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'pe4_e19', source: 'pe4_fmt', target: 'pe4_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'pe4_e20', source: 'pe4_fmt', target: 'pe4_msg', sourcePort: 'result', targetPort: 'text' },
  ],
  createdAt: '2026-07-02',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 任务系统模板
// 4条链：/任务列表 | /接取 <任务> | /提交 <任务> | /日常签到
// ════════════════════════════════════════════════════════════════
export const QUEST_TEMPLATE: FlowTemplate = {
  id: 'gameplay-systems-quest',
  name: '任务系统',
  description: '完整任务玩法：查看任务列表、接取任务、提交任务领奖励、每日签到连签奖励。使用 file_read 读任务表、is_today 判断签到、persistent_op 管理任务状态，全程可视化搭建。',
  botCategory: 'game',
  category: '其他',
  tags: ['任务', '签到', '日常', '奖励', '游戏'],
  author: '内置',
  nodes: [
    // ═══ 链1 · /任务列表 ═══
    { id: 'qu1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '任务列表', nodeKind: 'on_message', config: { match: 'command', command: '任务列表', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'qu1_read', type: 'data', position: { x: 250, y: 0 }, data: { label: '读任务表', nodeKind: 'file_op', config: { mode: 'read', file_path: 'quests.json', encoding: 'utf-8' }, inputs: [], outputs: [] } },
    { id: 'qu1_fmt', type: 'logic', position: { x: 550, y: 0 }, data: { label: '格式化列表', nodeKind: 'format_text', config: { template: '📜 任务列表：\n{var1}\n输入 /接取 <任务名> 接取任务' }, inputs: [], outputs: [] } },
    { id: 'qu1_msg', type: 'action', position: { x: 850, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链2 · /接取 <任务> ═══
    { id: 'qu2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '接取', nodeKind: 'on_message', config: { match: 'command', command: '接取', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'qu2_args', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取任务名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'qu2_uid', type: 'logic', position: { x: 500, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'qu2_lquest', type: 'data', position: { x: 750, y: 350 }, data: { label: '读已接取任务', nodeKind: 'persistent_op', config: { mode: 'load', key: 'quest_accepted', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu2_if', type: 'logic', position: { x: 1050, y: 350 }, data: { label: '已接取？', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    { id: 'qu2_already', type: 'action', position: { x: 1350, y: 430 }, data: { label: '已接取过', nodeKind: 'send_message', config: { text: '⚠️ 该任务已接取，请完成后提交' }, inputs: [], outputs: [] } },
    { id: 'qu2_squest', type: 'data', position: { x: 1350, y: 270 }, data: { label: '标记接取', nodeKind: 'persistent_op', config: { mode: 'save', key: 'quest_accepted', value: true, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu2_fmt', type: 'logic', position: { x: 1650, y: 270 }, data: { label: '格式化接取', nodeKind: 'format_text', config: { template: '✅ 已接取任务：{var1}\n完成后输入 /提交 <任务名>' }, inputs: [], outputs: [] } },
    { id: 'qu2_msg', type: 'action', position: { x: 1950, y: 270 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链3 · /提交 <任务> ═══
    { id: 'qu3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '提交', nodeKind: 'on_message', config: { match: 'command', command: '提交', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'qu3_args', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取任务名', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    { id: 'qu3_uid', type: 'logic', position: { x: 500, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'qu3_lprog', type: 'data', position: { x: 750, y: 700 }, data: { label: '读任务进度', nodeKind: 'persistent_op', config: { mode: 'load', key: 'quest_progress', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu3_if', type: 'logic', position: { x: 1050, y: 700 }, data: { label: '进度达标？', nodeKind: 'if_branch', config: { expression: 'value >= 100' }, inputs: [], outputs: [] } },
    { id: 'qu3_nocomplete', type: 'action', position: { x: 1350, y: 780 }, data: { label: '未完成', nodeKind: 'send_message', config: { text: '❌ 任务进度未达标，继续努力' }, inputs: [], outputs: [] } },
    // 发奖励：金币+经验
    { id: 'qu3_lgold', type: 'data', position: { x: 1350, y: 620 }, data: { label: '读金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu3_addgold', type: 'logic', position: { x: 1650, y: 620 }, data: { label: '金币+100', nodeKind: 'expression_eval', config: { expression: 'v1 + 100' }, inputs: [], outputs: [] } },
    { id: 'qu3_sgold', type: 'data', position: { x: 1950, y: 620 }, data: { label: '存金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu3_lexp', type: 'data', position: { x: 2250, y: 620 }, data: { label: '读经验', nodeKind: 'persistent_op', config: { mode: 'load', key: 'exp', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu3_addexp', type: 'logic', position: { x: 2550, y: 620 }, data: { label: '经验+50', nodeKind: 'expression_eval', config: { expression: 'v1 + 50' }, inputs: [], outputs: [] } },
    { id: 'qu3_sexp', type: 'data', position: { x: 2850, y: 620 }, data: { label: '存经验', nodeKind: 'persistent_op', config: { mode: 'save', key: 'exp', scope: 'user' }, inputs: [], outputs: [] } },
    // 标记完成
    { id: 'qu3_sdone', type: 'data', position: { x: 3150, y: 620 }, data: { label: '标记完成', nodeKind: 'persistent_op', config: { mode: 'save', key: 'quest_completed', value: true, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu3_fmt', type: 'logic', position: { x: 3450, y: 620 }, data: { label: '格式化完成', nodeKind: 'format_text', config: { template: '🎉 任务完成：{var1}\n奖励：金币+100 经验+50' }, inputs: [], outputs: [] } },
    { id: 'qu3_msg', type: 'action', position: { x: 3750, y: 620 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链4 · /日常签到 ═══
    { id: 'qu4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: '日常签到', nodeKind: 'on_message', config: { match: 'command', command: '日常签到', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'qu4_uid', type: 'logic', position: { x: 250, y: 1050 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'qu4_llast', type: 'data', position: { x: 500, y: 1050 }, data: { label: '读上次签到时间', nodeKind: 'persistent_op', config: { mode: 'load', key: 'sign_last_ts', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu4_istoday', type: 'logic', position: { x: 800, y: 1050 }, data: { label: '今天签过？', nodeKind: 'time_op', config: { mode: 'is_today', timestamp: 0 }, inputs: [], outputs: [] } },
    { id: 'qu4_if', type: 'logic', position: { x: 1100, y: 1050 }, data: { label: '已签到？', nodeKind: 'if_branch', config: { expression: 'value == True' }, inputs: [], outputs: [] } },
    { id: 'qu4_already', type: 'action', position: { x: 1400, y: 1130 }, data: { label: '今日已签', nodeKind: 'send_message', config: { text: '📅 今天已经签到过了，明天再来吧' }, inputs: [], outputs: [] } },
    // 记录签到
    { id: 'qu4_now', type: 'logic', position: { x: 1400, y: 970 }, data: { label: '当前时间', nodeKind: 'time_op', config: { mode: 'now', fmt: '%s' }, inputs: [], outputs: [] } },
    { id: 'qu4_slast', type: 'data', position: { x: 1700, y: 970 }, data: { label: '存签到时间', nodeKind: 'persistent_op', config: { mode: 'save', key: 'sign_last_ts', scope: 'user' }, inputs: [], outputs: [] } },
    // 随机奖励
    { id: 'qu4_rw', type: 'logic', position: { x: 2000, y: 970 }, data: { label: '随机奖励', nodeKind: 'random', config: { mode: 'choice', list: ['金币+50', '金币+100', '金币+200', '经验+30'] }, inputs: [], outputs: [] } },
    // 连续签到+1
    { id: 'qu4_lstreak', type: 'data', position: { x: 2300, y: 970 }, data: { label: '读连续天数', nodeKind: 'persistent_op', config: { mode: 'load', key: 'sign_streak', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu4_addstreak', type: 'logic', position: { x: 2600, y: 970 }, data: { label: '连续+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'qu4_sstreak', type: 'data', position: { x: 2900, y: 970 }, data: { label: '存连续天数', nodeKind: 'persistent_op', config: { mode: 'save', key: 'sign_streak', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'qu4_fmt', type: 'logic', position: { x: 3200, y: 970 }, data: { label: '格式化签到', nodeKind: 'format_text', config: { template: '✅ 签到成功！\n奖励：{var1}\n连续签到：{var2} 天' }, inputs: [], outputs: [] } },
    { id: 'qu4_msg', type: 'action', position: { x: 3500, y: 970 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    // 链1
    { id: 'qu1_e1', source: 'qu1_cmd', target: 'qu1_read', sourcePort: 'next', targetPort: 'in' },
    { id: 'qu1_e2', source: 'qu1_read', target: 'qu1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu1_e3', source: 'qu1_read', target: 'qu1_fmt', sourcePort: 'data', targetPort: 'var1' },
    { id: 'qu1_e4', source: 'qu1_fmt', target: 'qu1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu1_e5', source: 'qu1_fmt', target: 'qu1_msg', sourcePort: 'result', targetPort: 'text' },
    // 链2
    { id: 'qu2_e1', source: 'qu2_cmd', target: 'qu2_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'qu2_e2', source: 'qu2_args', target: 'qu2_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu2_e3', source: 'qu2_uid', target: 'qu2_lquest', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu2_e4', source: 'qu2_lquest', target: 'qu2_if', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu2_e5', source: 'qu2_lquest', target: 'qu2_if', sourcePort: 'result', targetPort: 'value' },
    { id: 'qu2_e6', source: 'qu2_if', target: 'qu2_already', sourcePort: 'true', targetPort: 'in' },
    { id: 'qu2_e7', source: 'qu2_if', target: 'qu2_squest', sourcePort: 'false', targetPort: 'in' },
    { id: 'qu2_e8', source: 'qu2_squest', target: 'qu2_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu2_e9', source: 'qu2_args', target: 'qu2_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'qu2_e10', source: 'qu2_fmt', target: 'qu2_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu2_e11', source: 'qu2_fmt', target: 'qu2_msg', sourcePort: 'result', targetPort: 'text' },
    // 链3
    { id: 'qu3_e1', source: 'qu3_cmd', target: 'qu3_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'qu3_e2', source: 'qu3_args', target: 'qu3_uid', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e3', source: 'qu3_uid', target: 'qu3_lprog', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e4', source: 'qu3_lprog', target: 'qu3_if', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e5', source: 'qu3_lprog', target: 'qu3_if', sourcePort: 'result', targetPort: 'value' },
    { id: 'qu3_e6', source: 'qu3_if', target: 'qu3_nocomplete', sourcePort: 'false', targetPort: 'in' },
    { id: 'qu3_e7', source: 'qu3_if', target: 'qu3_lgold', sourcePort: 'true', targetPort: 'in' },
    { id: 'qu3_e8', source: 'qu3_lgold', target: 'qu3_addgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e9', source: 'qu3_lgold', target: 'qu3_addgold', sourcePort: 'result', targetPort: 'v1' },
    { id: 'qu3_e10', source: 'qu3_addgold', target: 'qu3_sgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e11', source: 'qu3_addgold', target: 'qu3_sgold', sourcePort: 'result', targetPort: 'value' },
    { id: 'qu3_e12', source: 'qu3_sgold', target: 'qu3_lexp', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e13', source: 'qu3_lexp', target: 'qu3_addexp', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e14', source: 'qu3_lexp', target: 'qu3_addexp', sourcePort: 'result', targetPort: 'v1' },
    { id: 'qu3_e15', source: 'qu3_addexp', target: 'qu3_sexp', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e16', source: 'qu3_addexp', target: 'qu3_sexp', sourcePort: 'result', targetPort: 'value' },
    { id: 'qu3_e17', source: 'qu3_sexp', target: 'qu3_sdone', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e18', source: 'qu3_sdone', target: 'qu3_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e19', source: 'qu3_args', target: 'qu3_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'qu3_e20', source: 'qu3_fmt', target: 'qu3_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu3_e21', source: 'qu3_fmt', target: 'qu3_msg', sourcePort: 'result', targetPort: 'text' },
    // 链4
    { id: 'qu4_e1', source: 'qu4_cmd', target: 'qu4_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'qu4_e2', source: 'qu4_uid', target: 'qu4_llast', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e3', source: 'qu4_llast', target: 'qu4_istoday', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e4', source: 'qu4_llast', target: 'qu4_istoday', sourcePort: 'result', targetPort: 'timestamp' },
    { id: 'qu4_e5', source: 'qu4_istoday', target: 'qu4_if', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e6', source: 'qu4_istoday', target: 'qu4_if', sourcePort: 'result', targetPort: 'value' },
    { id: 'qu4_e7', source: 'qu4_if', target: 'qu4_already', sourcePort: 'true', targetPort: 'in' },
    { id: 'qu4_e8', source: 'qu4_if', target: 'qu4_now', sourcePort: 'false', targetPort: 'in' },
    { id: 'qu4_e9', source: 'qu4_now', target: 'qu4_slast', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e10', source: 'qu4_now', target: 'qu4_slast', sourcePort: 'result', targetPort: 'value' },
    { id: 'qu4_e11', source: 'qu4_slast', target: 'qu4_rw', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e12', source: 'qu4_rw', target: 'qu4_lstreak', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e13', source: 'qu4_lstreak', target: 'qu4_addstreak', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e14', source: 'qu4_lstreak', target: 'qu4_addstreak', sourcePort: 'result', targetPort: 'v1' },
    { id: 'qu4_e15', source: 'qu4_addstreak', target: 'qu4_sstreak', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e16', source: 'qu4_addstreak', target: 'qu4_sstreak', sourcePort: 'result', targetPort: 'value' },
    { id: 'qu4_e17', source: 'qu4_sstreak', target: 'qu4_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e18', source: 'qu4_rw', target: 'qu4_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'qu4_e19', source: 'qu4_addstreak', target: 'qu4_fmt', sourcePort: 'result', targetPort: 'var2' },
    { id: 'qu4_e20', source: 'qu4_fmt', target: 'qu4_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'qu4_e21', source: 'qu4_fmt', target: 'qu4_msg', sourcePort: 'result', targetPort: 'text' },
  ],
  createdAt: '2026-07-02',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 抽卡系统模板
// 3条链：/卡池 | /抽卡（单抽）| /十连
// 使用 random choice + persistent_op 管理金币与背包
// ════════════════════════════════════════════════════════════════
export const GACHA_TEMPLATE: FlowTemplate = {
  id: 'gameplay-systems-gacha',
  name: '抽卡系统',
  description: '完整抽卡玩法：查看卡池概率、单抽扣100金币、十连扣1000金币（保底SR）。使用 random choice 随机抽卡、persistent_op 管理金币和背包，全程可视化搭建。',
  botCategory: 'game',
  category: '其他',
  tags: ['抽卡', 'gacha', '十连', '单抽', '概率', '游戏'],
  author: '内置',
  nodes: [
    // ═══ 链1 · /卡池 ═══
    { id: 'gc1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '卡池', nodeKind: 'on_message', config: { match: 'command', command: '卡池', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'gc1_fmt', type: 'logic', position: { x: 300, y: 0 }, data: { label: '格式化卡池', nodeKind: 'format_text', config: { template: '🎰 当前卡池：\nSSR 龙息之剑 (1%)\nSR 玄铁盾 (9%)\nR 铁剑 (30%)\nN 木棍 (60%)\n\n单抽：100金币 / 十连：1000金币（保底SR）\n输入 /抽卡 或 /十连' }, inputs: [], outputs: [] } },
    { id: 'gc1_msg', type: 'action', position: { x: 600, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链2 · /抽卡（单抽）═══
    { id: 'gc2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '抽卡', nodeKind: 'on_message', config: { match: 'command', command: '抽卡', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'gc2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'gc2_lgold', type: 'data', position: { x: 500, y: 350 }, data: { label: '读金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'gc2_check', type: 'logic', position: { x: 800, y: 350 }, data: { label: '金币>=100?', nodeKind: 'if_branch', config: { expression: 'value >= 100' }, inputs: [], outputs: [] } },
    { id: 'gc2_nogold', type: 'action', position: { x: 1100, y: 430 }, data: { label: '金币不足', nodeKind: 'send_message', config: { text: '❌ 金币不足，单抽需要 100 金币' }, inputs: [], outputs: [] } },
    // 扣金币
    { id: 'gc2_subgold', type: 'logic', position: { x: 1100, y: 270 }, data: { label: '金币-100', nodeKind: 'expression_eval', config: { expression: 'v1 - 100' }, inputs: [], outputs: [] } },
    { id: 'gc2_sgold', type: 'data', position: { x: 1400, y: 270 }, data: { label: '存金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    // 抽卡
    { id: 'gc2_draw', type: 'logic', position: { x: 1700, y: 270 }, data: { label: '随机抽卡', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'SR 玄铁盾', 'R 铁剑', 'R 铁剑', 'R 铁剑', 'N 木棍', 'N 木棍', 'N 木棍', 'N 木棍'] }, inputs: [], outputs: [] } },
    // 保存到背包
    { id: 'gc2_sbag', type: 'data', position: { x: 2000, y: 270 }, data: { label: '存入背包', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gacha_last', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'gc2_fmt', type: 'logic', position: { x: 2300, y: 270 }, data: { label: '格式化结果', nodeKind: 'format_text', config: { template: '🎰 单抽结果：{var1}\n扣除 100 金币' }, inputs: [], outputs: [] } },
    { id: 'gc2_msg', type: 'action', position: { x: 2600, y: 270 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链3 · /十连 ═══
    { id: 'gc3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '十连', nodeKind: 'on_message', config: { match: 'command', command: '十连', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'gc3_uid', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'gc3_lgold', type: 'data', position: { x: 500, y: 700 }, data: { label: '读金币', nodeKind: 'persistent_op', config: { mode: 'load', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'gc3_check', type: 'logic', position: { x: 800, y: 700 }, data: { label: '金币>=1000?', nodeKind: 'if_branch', config: { expression: 'value >= 1000' }, inputs: [], outputs: [] } },
    { id: 'gc3_nogold', type: 'action', position: { x: 1100, y: 780 }, data: { label: '金币不足', nodeKind: 'send_message', config: { text: '❌ 金币不足，十连需要 1000 金币' }, inputs: [], outputs: [] } },
    // 扣金币
    { id: 'gc3_subgold', type: 'logic', position: { x: 1100, y: 620 }, data: { label: '金币-1000', nodeKind: 'expression_eval', config: { expression: 'v1 - 1000' }, inputs: [], outputs: [] } },
    { id: 'gc3_sgold', type: 'data', position: { x: 1400, y: 620 }, data: { label: '存金币', nodeKind: 'persistent_op', config: { mode: 'save', key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    // 十连抽卡（10次 random，简化为一次 multi-choice）
    { id: 'gc3_draw1', type: 'logic', position: { x: 1700, y: 620 }, data: { label: '抽卡1', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw2', type: 'logic', position: { x: 1700, y: 720 }, data: { label: '抽卡2', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw3', type: 'logic', position: { x: 1700, y: 820 }, data: { label: '抽卡3', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw4', type: 'logic', position: { x: 1700, y: 920 }, data: { label: '抽卡4', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw5', type: 'logic', position: { x: 1700, y: 1020 }, data: { label: '抽卡5', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw6', type: 'logic', position: { x: 2050, y: 620 }, data: { label: '抽卡6', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw7', type: 'logic', position: { x: 2050, y: 720 }, data: { label: '抽卡7', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw8', type: 'logic', position: { x: 2050, y: 820 }, data: { label: '抽卡8', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw9', type: 'logic', position: { x: 2050, y: 920 }, data: { label: '抽卡9', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'R 铁剑', 'N 木棍'] }, inputs: [], outputs: [] } },
    { id: 'gc3_draw10', type: 'logic', position: { x: 2050, y: 1020 }, data: { label: '抽卡10（保底SR+）', nodeKind: 'random', config: { mode: 'choice', list: ['SSR 龙息之剑', 'SR 玄铁盾', 'SR 玄铁盾', 'SR 玄铁盾'] }, inputs: [], outputs: [] } },
    // 汇总结果
    { id: 'gc3_fmt', type: 'logic', position: { x: 2400, y: 820 }, data: { label: '格式化十连', nodeKind: 'format_text', config: { template: '🎰 十连抽卡结果：\n1. {var1}\n2. {var2}\n3. {var3}\n4. {var4}\n5. {var5}\n6. {var6}\n7. {var7}\n8. {var8}\n9. {var9}\n10. {var10}（保底SR+）\n扣除 1000 金币' }, inputs: [], outputs: [] } },
    { id: 'gc3_msg', type: 'action', position: { x: 2750, y: 820 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    // 链1 · /卡池
    { id: 'gc1_e1', source: 'gc1_cmd', target: 'gc1_fmt', sourcePort: 'next', targetPort: 'in' },
    { id: 'gc1_e2', source: 'gc1_fmt', target: 'gc1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc1_e3', source: 'gc1_fmt', target: 'gc1_msg', sourcePort: 'result', targetPort: 'text' },
    // 链2 · /抽卡
    { id: 'gc2_e1', source: 'gc2_cmd', target: 'gc2_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'gc2_e2', source: 'gc2_uid', target: 'gc2_lgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc2_e3', source: 'gc2_lgold', target: 'gc2_check', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc2_e4', source: 'gc2_lgold', target: 'gc2_check', sourcePort: 'result', targetPort: 'value' },
    { id: 'gc2_e5', source: 'gc2_check', target: 'gc2_nogold', sourcePort: 'false', targetPort: 'in' },
    { id: 'gc2_e6', source: 'gc2_check', target: 'gc2_subgold', sourcePort: 'true', targetPort: 'in' },
    { id: 'gc2_e7', source: 'gc2_lgold', target: 'gc2_subgold', sourcePort: 'result', targetPort: 'v1' },
    { id: 'gc2_e8', source: 'gc2_subgold', target: 'gc2_sgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc2_e9', source: 'gc2_subgold', target: 'gc2_sgold', sourcePort: 'result', targetPort: 'value' },
    { id: 'gc2_e10', source: 'gc2_sgold', target: 'gc2_draw', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc2_e11', source: 'gc2_draw', target: 'gc2_sbag', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc2_e12', source: 'gc2_draw', target: 'gc2_sbag', sourcePort: 'result', targetPort: 'value' },
    { id: 'gc2_e13', source: 'gc2_sbag', target: 'gc2_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc2_e14', source: 'gc2_draw', target: 'gc2_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'gc2_e15', source: 'gc2_fmt', target: 'gc2_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc2_e16', source: 'gc2_fmt', target: 'gc2_msg', sourcePort: 'result', targetPort: 'text' },
    // 链3 · /十连
    { id: 'gc3_e1', source: 'gc3_cmd', target: 'gc3_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'gc3_e2', source: 'gc3_uid', target: 'gc3_lgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e3', source: 'gc3_lgold', target: 'gc3_check', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e4', source: 'gc3_lgold', target: 'gc3_check', sourcePort: 'result', targetPort: 'value' },
    { id: 'gc3_e5', source: 'gc3_check', target: 'gc3_nogold', sourcePort: 'false', targetPort: 'in' },
    { id: 'gc3_e6', source: 'gc3_check', target: 'gc3_subgold', sourcePort: 'true', targetPort: 'in' },
    { id: 'gc3_e7', source: 'gc3_lgold', target: 'gc3_subgold', sourcePort: 'result', targetPort: 'v1' },
    { id: 'gc3_e8', source: 'gc3_subgold', target: 'gc3_sgold', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e9', source: 'gc3_subgold', target: 'gc3_sgold', sourcePort: 'result', targetPort: 'value' },
    // 10个 random 串联（控制流）+ 数据流绑定到 format_text 的 var1~var10
    { id: 'gc3_e10', source: 'gc3_sgold', target: 'gc3_draw1', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e11', source: 'gc3_draw1', target: 'gc3_draw2', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e12', source: 'gc3_draw2', target: 'gc3_draw3', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e13', source: 'gc3_draw3', target: 'gc3_draw4', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e14', source: 'gc3_draw4', target: 'gc3_draw5', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e15', source: 'gc3_draw5', target: 'gc3_draw6', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e16', source: 'gc3_draw6', target: 'gc3_draw7', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e17', source: 'gc3_draw7', target: 'gc3_draw8', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e18', source: 'gc3_draw8', target: 'gc3_draw9', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e19', source: 'gc3_draw9', target: 'gc3_draw10', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e20', source: 'gc3_draw10', target: 'gc3_fmt', sourcePort: 'out', targetPort: 'in' },
    // 数据流：10个 random 的 result 绑定到 format_text 的 var1~var10
    { id: 'gc3_e21', source: 'gc3_draw1', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'gc3_e22', source: 'gc3_draw2', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var2' },
    { id: 'gc3_e23', source: 'gc3_draw3', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var3' },
    { id: 'gc3_e24', source: 'gc3_draw4', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var4' },
    { id: 'gc3_e25', source: 'gc3_draw5', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var5' },
    { id: 'gc3_e26', source: 'gc3_draw6', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var6' },
    { id: 'gc3_e27', source: 'gc3_draw7', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var7' },
    { id: 'gc3_e28', source: 'gc3_draw8', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var8' },
    { id: 'gc3_e29', source: 'gc3_draw9', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var9' },
    { id: 'gc3_e30', source: 'gc3_draw10', target: 'gc3_fmt', sourcePort: 'result', targetPort: 'var10' },
    { id: 'gc3_e31', source: 'gc3_fmt', target: 'gc3_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'gc3_e32', source: 'gc3_fmt', target: 'gc3_msg', sourcePort: 'result', targetPort: 'text' },
  ],
  createdAt: '2026-07-07',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 排行榜系统模板
// 2条链：/排行榜（Top10）| /我的排名
// 使用 query 查询 _persistent 表 + expression_eval 格式化/计算排名
// （原 persistent_op (leaderboard) 模式已移除，改用通用 SQL + 表达式组合）
// ════════════════════════════════════════════════════════════════
export const LEADERBOARD_TEMPLATE: FlowTemplate = {
  id: 'gameplay-systems-leaderboard',
  name: '排行榜系统',
  description: '完整排行榜玩法：查看 Top10 战力榜、查询自己的排名和分数。使用 query 查询持久化库 + expression_eval 格式化和计算排名，全程可视化搭建。',
  botCategory: 'game',
  category: '其他',
  tags: ['排行榜', '排名', '战力', 'Top10', '游戏'],
  author: '内置',
  nodes: [
    // ═══ 链1 · /排行榜（Top10）═══
    // SQL 查询所有用户 power 值并按降序取前 10
    { id: 'lb1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '排行榜', nodeKind: 'on_message', config: { match: 'command', command: '排行榜', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'lb1_query', type: 'data', position: { x: 300, y: 0 }, data: { label: '查Top10', nodeKind: 'query', config: { mode: 'sort', key_pattern: 'user_*:power', scope: 'user', sort_by: 'value', order: 'desc', limit: 10 }, inputs: [], outputs: [] } },
    { id: 'lb1_fmt', type: 'logic', position: { x: 650, y: 0 }, data: { label: '格式化排行', nodeKind: 'expression_eval', config: { expression: "'🏆 战力排行榜 Top10:\\n' + '\\n'.join([f'{i+1}. QQ{r[0]} - 战力{r[1]}' for i, r in enumerate(v1)])" }, inputs: [], outputs: [] } },
    { id: 'lb1_msg', type: 'action', position: { x: 1000, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链2 · /我的排名 ═══
    // 读个人战力 → 查全量排行 → 用表达式计算排名（比我分高的人数 + 1）
    { id: 'lb2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '我的排名', nodeKind: 'on_message', config: { match: 'command', command: '我的排名', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'lb2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'lb2_lpower', type: 'data', position: { x: 500, y: 350 }, data: { label: '读战力', nodeKind: 'persistent_op', config: { mode: 'load', key: 'power', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'lb2_query', type: 'data', position: { x: 800, y: 350 }, data: { label: '查全量排行', nodeKind: 'query', config: { mode: 'sort', key_pattern: 'user_*:power', scope: 'user', sort_by: 'value', order: 'desc', limit: 1000 }, inputs: [], outputs: [] } },
    { id: 'lb2_calc', type: 'logic', position: { x: 1150, y: 350 }, data: { label: '算我的排名', nodeKind: 'expression_eval', config: { expression: 'len([r for r in (v2 or []) if float(r[1] or 0) > float(v3 or 0)]) + 1' }, inputs: [], outputs: [] } },
    { id: 'lb2_fmt', type: 'logic', position: { x: 1450, y: 350 }, data: { label: '格式化我的排名', nodeKind: 'format_text', config: { template: '🏆 你的战力：{var1}\n你的排名：第 {var2} 名\n继续努力提升战力吧！' }, inputs: [], outputs: [] } },
    { id: 'lb2_msg', type: 'action', position: { x: 1750, y: 350 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    // 链1 控制流
    { id: 'lb1_e1', source: 'lb1_cmd', target: 'lb1_query', sourcePort: 'next', targetPort: 'in' },
    { id: 'lb1_e2', source: 'lb1_query', target: 'lb1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'lb1_e4', source: 'lb1_fmt', target: 'lb1_msg', sourcePort: 'out', targetPort: 'in' },
    // 链1 数据流
    { id: 'lb1_e3', source: 'lb1_query', target: 'lb1_fmt', sourcePort: 'results', targetPort: 'v1' },
    { id: 'lb1_e5', source: 'lb1_fmt', target: 'lb1_msg', sourcePort: 'result', targetPort: 'text' },
    // 链2 控制流
    { id: 'lb2_e1', source: 'lb2_cmd', target: 'lb2_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'lb2_e2', source: 'lb2_uid', target: 'lb2_lpower', sourcePort: 'out', targetPort: 'in' },
    { id: 'lb2_e3', source: 'lb2_lpower', target: 'lb2_query', sourcePort: 'out', targetPort: 'in' },
    { id: 'lb2_e4', source: 'lb2_query', target: 'lb2_calc', sourcePort: 'out', targetPort: 'in' },
    { id: 'lb2_e5', source: 'lb2_calc', target: 'lb2_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'lb2_e6', source: 'lb2_fmt', target: 'lb2_msg', sourcePort: 'out', targetPort: 'in' },
    // 链2 数据流
    { id: 'lb2_d1', source: 'lb2_lpower', target: 'lb2_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'lb2_d2', source: 'lb2_calc', target: 'lb2_fmt', sourcePort: 'result', targetPort: 'var2' },
    { id: 'lb2_d3', source: 'lb2_query', target: 'lb2_calc', sourcePort: 'results', targetPort: 'v2' },
    { id: 'lb2_d4', source: 'lb2_lpower', target: 'lb2_calc', sourcePort: 'result', targetPort: 'v3' },
  ],
  createdAt: '2026-07-08',
  version: '2.0'
}

// 导出所有玩法系统模板
export const GAMEPLAY_SYSTEMS_TEMPLATES: FlowTemplate[] = [
  TRADE_TEMPLATE,
  FORGE_TEMPLATE,
  PET_TEMPLATE,
  QUEST_TEMPLATE,
  GACHA_TEMPLATE,
  LEADERBOARD_TEMPLATE,
]
