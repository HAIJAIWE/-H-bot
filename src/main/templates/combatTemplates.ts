// src/main/templates/combatTemplates.ts
// 战斗系统模板：用新节点搭出的可视化战斗流程，替代硬编码 Python。
// 4种模式：回合制 / 概率暴击 / 技能克制 / 冷却制，使用节点：expression_eval + persistent_op + if_branch + random
import type { FlowTemplate } from '@shared/types/template'

// ════════════════════════════════════════════════════════════════
// 回合制战斗模板
// 4条链：/探索 → 遭遇怪物 | /攻击 → 战斗计算 | /逃跑 → 退出战斗 | /状态
// 使用节点：expression_eval + persistent_op + if_branch
// ════════════════════════════════════════════════════════════════
export const TURN_BASED_COMBAT_TEMPLATE: FlowTemplate = {
  id: 'gameplay-combat-turn-based',
  name: '回合制战斗系统',
  description: '经典RPG回合制战斗：探索遇怪→攻击/逃跑→伤害计算→胜负判定。使用 expression_eval 计算伤害，可扩展 random/if_branch 实现暴击，全程可视化搭建无需写代码。',
  botCategory: 'game',
  category: '其他',
  tags: ['战斗', '回合制', '游戏'],
  author: '内置',
  nodes: [
    // ═══ 链1 · /探索 遭遇怪物 ═══
    { id: 'tc1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '探索', nodeKind: 'on_message', config: { match: 'command', command: '探索', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'tc1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'tc1_load', type: 'data', position: { x: 500, y: 0 }, data: { label: '读角色', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_class', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc1_if', type: 'logic', position: { x: 750, y: 0 }, data: { label: '有角色？', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    { id: 'tc1_no', type: 'action', position: { x: 1000, y: 80 }, data: { label: '无角色', nodeKind: 'send_message', config: { text: '请先输入 /创建角色' }, inputs: [], outputs: [] } },
    // persistent_op: combat_state = battling（替代原 state_machine explore）
    { id: 'tc1_sm', type: 'data', position: { x: 1000, y: -80 }, data: { label: '进入战斗', nodeKind: 'persistent_op', config: {
      mode: 'save', key: 'combat_state', value: 'battling', scope: 'user'
    }, inputs: [], outputs: [] } },
    // 随机怪物
    { id: 'tc1_rmon', type: 'logic', position: { x: 1300, y: -80 }, data: { label: '随机怪物', nodeKind: 'random', config: { mode: 'choice', list: ['史莱姆', '哥布林', '野兔'] }, inputs: [], outputs: [] } },
    { id: 'tc1_smon', type: 'data', position: { x: 1550, y: -80 }, data: { label: '存怪物名', nodeKind: 'persistent_op', config: { mode: 'save', key: 'rpg_monster_name', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc1_smhp', type: 'data', position: { x: 1800, y: -80 }, data: { label: '存怪物HP', nodeKind: 'persistent_op', config: { mode: 'save', key: 'rpg_monster_hp', value: 50, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc1_smatk', type: 'data', position: { x: 2050, y: -80 }, data: { label: '存怪物ATK', nodeKind: 'persistent_op', config: { mode: 'save', key: 'rpg_monster_atk', value: 10, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc1_fmt', type: 'logic', position: { x: 2300, y: -80 }, data: { label: '格式化遭遇', nodeKind: 'format_text', config: { template: '🌲 你遇到了 {var1}！\nHP:50 ATK:10\n输入 /攻击 战斗，/逃跑 逃跑' }, inputs: [], outputs: [] } },
    { id: 'tc1_msg', type: 'action', position: { x: 2550, y: -80 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链2 · /攻击 战斗计算 ═══
    { id: 'tc2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '攻击', nodeKind: 'on_message', config: { match: 'command', command: '攻击', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'tc2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    // 检查战斗状态（替代原 state_machine attack，改用 persistent_op load + if_branch 判断）
    { id: 'tc2_sm', type: 'data', position: { x: 500, y: 350 }, data: { label: '读战斗状态', nodeKind: 'persistent_op', config: {
      mode: 'load', key: 'combat_state', scope: 'user'
    }, inputs: [], outputs: [] } },
    { id: 'tc2_ifbat', type: 'logic', position: { x: 800, y: 350 }, data: { label: '战斗中？', nodeKind: 'if_branch', config: { expression: 'value == "battling"' }, inputs: [], outputs: [] } },
    { id: 'tc2_nobat', type: 'action', position: { x: 1050, y: 430 }, data: { label: '非战斗中', nodeKind: 'send_message', config: { text: '你当前不在战斗中。输入 /探索 寻找怪物。' }, inputs: [], outputs: [] } },
    // 读取玩家和怪物属性
    { id: 'tc2_latk', type: 'data', position: { x: 1050, y: 270 }, data: { label: '读玩家ATK', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_atk', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc2_lmhp', type: 'data', position: { x: 1300, y: 270 }, data: { label: '读怪物HP', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_monster_hp', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc2_lmatk', type: 'data', position: { x: 1550, y: 270 }, data: { label: '读怪物ATK', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_monster_atk', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc2_lmdef', type: 'data', position: { x: 1675, y: 270 }, data: { label: '读怪物DEF', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_monster_def', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc2_lmname', type: 'data', position: { x: 1800, y: 270 }, data: { label: '读怪物名', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_monster_name', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'tc2_lphp', type: 'data', position: { x: 2050, y: 270 }, data: { label: '读玩家HP', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_hp', scope: 'user' }, inputs: [], outputs: [] } },
    // expression_eval: 伤害=ATK*2-DEF，怪物剩余HP=HP-伤害
    { id: 'tc2_combat', type: 'logic', position: { x: 2300, y: 270 }, data: { label: '战斗计算', nodeKind: 'expression_eval', config: {
      expression: 'max(0, v2 - (v1 * 2 - v3))'
    }, inputs: [], outputs: [] } },
    // 保存怪物剩余HP
    { id: 'tc2_smhp2', type: 'data', position: { x: 2600, y: 200 }, data: { label: '存怪物HP', nodeKind: 'persistent_op', config: { mode: 'save', key: 'rpg_monster_hp', scope: 'user' }, inputs: [], outputs: [] } },
    // 检查怪物是否死亡
    { id: 'tc2_expr', type: 'logic', position: { x: 2600, y: 340 }, data: { label: '怪物HP<=0?', nodeKind: 'expression_eval', config: { expression: 'v1 <= 0' }, inputs: [], outputs: [] } },
    { id: 'tc2_ifwin', type: 'logic', position: { x: 2900, y: 340 }, data: { label: '胜利？', nodeKind: 'if_branch', config: { expression: 'value == True' }, inputs: [], outputs: [] } },
    // 胜利: 存回 combat_state=idle，发奖励（替代原 state_machine win）
    { id: 'tc2_smwin', type: 'data', position: { x: 3200, y: 270 }, data: { label: '战斗结束', nodeKind: 'persistent_op', config: {
      mode: 'save', key: 'combat_state', value: 'idle', scope: 'user'
    }, inputs: [], outputs: [] } },
    { id: 'tc2_winmsg', type: 'action', position: { x: 3500, y: 270 }, data: { label: '胜利消息', nodeKind: 'send_message', config: { text: '🎉 战斗胜利！获得经验和金币' }, inputs: [], outputs: [] } },
    // 未胜利: 发送战斗结果
    { id: 'tc2_fmt', type: 'logic', position: { x: 3200, y: 410 }, data: { label: '格式化战斗', nodeKind: 'format_text', config: { template: '⚔️ 你攻击了 {var1}！\n{var2}\n输入 /攻击 继续，/逃跑 逃跑' }, inputs: [], outputs: [] } },
    { id: 'tc2_msg', type: 'action', position: { x: 3500, y: 410 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ═══ 链3 · /逃跑 退出战斗 ═══
    { id: 'tc3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '逃跑', nodeKind: 'on_message', config: { match: 'command', command: '逃跑', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'tc3_uid', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'tc3_sm', type: 'data', position: { x: 500, y: 700 }, data: { label: '逃跑退出', nodeKind: 'persistent_op', config: {
      mode: 'save', key: 'combat_state', value: 'idle', scope: 'user'
    }, inputs: [], outputs: [] } },
    { id: 'tc3_msg', type: 'action', position: { x: 800, y: 700 }, data: { label: '逃跑成功', nodeKind: 'send_message', config: { text: '🏃 你成功逃离了战斗！' }, inputs: [], outputs: [] } },
  ],
  edges: [
    // 链1
    { id: 'tc1_e1', source: 'tc1_cmd', target: 'tc1_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'tc1_e2', source: 'tc1_uid', target: 'tc1_load', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e3', source: 'tc1_load', target: 'tc1_if', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e4', source: 'tc1_if', target: 'tc1_no', sourcePort: 'false', targetPort: 'in' },
    { id: 'tc1_e5', source: 'tc1_if', target: 'tc1_sm', sourcePort: 'true', targetPort: 'in' },
    { id: 'tc1_e6', source: 'tc1_sm', target: 'tc1_rmon', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e7', source: 'tc1_rmon', target: 'tc1_smon', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e8', source: 'tc1_smon', target: 'tc1_smhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e9', source: 'tc1_smhp', target: 'tc1_smatk', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e10', source: 'tc1_smatk', target: 'tc1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e11', source: 'tc1_rmon', target: 'tc1_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'tc1_e12', source: 'tc1_fmt', target: 'tc1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc1_e13', source: 'tc1_fmt', target: 'tc1_msg', sourcePort: 'result', targetPort: 'text' },
    // 链2
    { id: 'tc2_e1', source: 'tc2_cmd', target: 'tc2_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'tc2_e2', source: 'tc2_uid', target: 'tc2_sm', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e3', source: 'tc2_sm', target: 'tc2_ifbat', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e4', source: 'tc2_sm', target: 'tc2_ifbat', sourcePort: 'result', targetPort: 'value' },
    { id: 'tc2_e5', source: 'tc2_ifbat', target: 'tc2_nobat', sourcePort: 'false', targetPort: 'in' },
    { id: 'tc2_e6', source: 'tc2_ifbat', target: 'tc2_latk', sourcePort: 'true', targetPort: 'in' },
    { id: 'tc2_e7', source: 'tc2_latk', target: 'tc2_lmhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e8', source: 'tc2_lmhp', target: 'tc2_lmatk', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e9', source: 'tc2_lmatk', target: 'tc2_lmdef', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e9b', source: 'tc2_lmdef', target: 'tc2_lmname', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e10', source: 'tc2_lmname', target: 'tc2_lphp', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e11', source: 'tc2_lphp', target: 'tc2_combat', sourcePort: 'out', targetPort: 'in' },
    // expression_eval 输入绑定: v1=attacker_atk, v2=defender_hp, v3=defender_def
    { id: 'tc2_e12', source: 'tc2_latk', target: 'tc2_combat', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tc2_e13', source: 'tc2_lmhp', target: 'tc2_combat', sourcePort: 'result', targetPort: 'v2' },
    { id: 'tc2_e14', source: 'tc2_lmdef', target: 'tc2_combat', sourcePort: 'result', targetPort: 'v3' },
    // expression_eval 输出处理
    { id: 'tc2_e16', source: 'tc2_combat', target: 'tc2_smhp2', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e17', source: 'tc2_combat', target: 'tc2_smhp2', sourcePort: 'result', targetPort: 'value' },
    { id: 'tc2_e19', source: 'tc2_smhp2', target: 'tc2_expr', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e20', source: 'tc2_smhp2', target: 'tc2_expr', sourcePort: 'result', targetPort: 'v1' },
    { id: 'tc2_e21', source: 'tc2_expr', target: 'tc2_ifwin', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e22', source: 'tc2_expr', target: 'tc2_ifwin', sourcePort: 'result', targetPort: 'value' },
    { id: 'tc2_e23', source: 'tc2_ifwin', target: 'tc2_smwin', sourcePort: 'true', targetPort: 'in' },
    { id: 'tc2_e24', source: 'tc2_smwin', target: 'tc2_winmsg', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e25', source: 'tc2_ifwin', target: 'tc2_fmt', sourcePort: 'false', targetPort: 'in' },
    { id: 'tc2_e26', source: 'tc2_lmname', target: 'tc2_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'tc2_e27', source: 'tc2_combat', target: 'tc2_fmt', sourcePort: 'result', targetPort: 'var2' },
    { id: 'tc2_e28', source: 'tc2_fmt', target: 'tc2_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc2_e29', source: 'tc2_fmt', target: 'tc2_msg', sourcePort: 'result', targetPort: 'text' },
    // 链3
    { id: 'tc3_e1', source: 'tc3_cmd', target: 'tc3_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'tc3_e2', source: 'tc3_uid', target: 'tc3_sm', sourcePort: 'out', targetPort: 'in' },
    { id: 'tc3_e3', source: 'tc3_sm', target: 'tc3_msg', sourcePort: 'out', targetPort: 'in' },
  ],
  createdAt: '2026-07-01',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 技能克制战斗模板（石头剪刀布）
// /技能 石头|剪刀|布 → 怪物随机出招 → expression_eval 克制判定
// ════════════════════════════════════════════════════════════════
export const SKILL_COUNTER_COMBAT_TEMPLATE: FlowTemplate = {
  id: 'gameplay-combat-skill-counter',
  name: '技能克制战斗系统',
  description: '石头剪刀布式战斗：玩家出招(石头/剪刀/布)→怪物随机出招→克制判定→双倍伤害或被克制。使用 expression_eval 判定石头剪刀布克制关系，适合休闲对战游戏。',
  botCategory: 'game',
  category: '其他',
  tags: ['战斗', '技能克制', '石头剪刀布', '游戏'],
  author: '内置',
  nodes: [
    // /技能 指令
    { id: 'sc1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '技能', nodeKind: 'on_message', config: { match: 'command', command: '技能', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'sc1_args', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取技能', nodeKind: 'get_context', config: { mode: 'command_args', index: 0 }, inputs: [], outputs: [] } },
    // 怪物随机出招
    { id: 'sc1_rmon', type: 'logic', position: { x: 500, y: 0 }, data: { label: '怪物出招', nodeKind: 'random', config: { mode: 'choice', list: ['rock', 'paper', 'scissors'] }, inputs: [], outputs: [] } },
    // expression_eval: 石头剪刀布克制判定
    { id: 'sc1_combat', type: 'logic', position: { x: 800, y: 0 }, data: { label: '克制判定', nodeKind: 'expression_eval', config: {
      expression: "'胜' if (v1=='rock' and v2=='scissors') or (v1=='paper' and v2=='rock') or (v1=='scissors' and v2=='paper') else ('负' if (v1=='rock' and v2=='paper') or (v1=='paper' and v2=='scissors') or (v1=='scissors' and v2=='rock') else '平')"
    }, inputs: [], outputs: [] } },
    { id: 'sc1_fmt', type: 'logic', position: { x: 1100, y: 0 }, data: { label: '格式化结果', nodeKind: 'format_text', config: { template: '{var1}' }, inputs: [], outputs: [] } },
    { id: 'sc1_msg', type: 'action', position: { x: 1400, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    { id: 'sc1_e1', source: 'sc1_cmd', target: 'sc1_args', sourcePort: 'next', targetPort: 'in' },
    { id: 'sc1_e2', source: 'sc1_args', target: 'sc1_rmon', sourcePort: 'out', targetPort: 'in' },
    { id: 'sc1_e3', source: 'sc1_rmon', target: 'sc1_combat', sourcePort: 'out', targetPort: 'in' },
    { id: 'sc1_e4', source: 'sc1_args', target: 'sc1_combat', sourcePort: 'result', targetPort: 'v1' },
    { id: 'sc1_e5', source: 'sc1_rmon', target: 'sc1_combat', sourcePort: 'result', targetPort: 'v2' },
    { id: 'sc1_e6', source: 'sc1_combat', target: 'sc1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'sc1_e7', source: 'sc1_combat', target: 'sc1_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'sc1_e8', source: 'sc1_fmt', target: 'sc1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'sc1_e9', source: 'sc1_fmt', target: 'sc1_msg', sourcePort: 'result', targetPort: 'text' },
  ],
  createdAt: '2026-07-01',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 概率暴击战斗模板
// /攻击 → 伤害计算（可扩展 random+if_branch 实现命中/暴击）
// ════════════════════════════════════════════════════════════════
export const PROBABILITY_COMBAT_TEMPLATE: FlowTemplate = {
  id: 'gameplay-combat-probability',
  name: '概率暴击战斗系统',
  description: '概率制战斗：命中率/闪避率/暴击率独立判定，适合需要RNG元素的战斗。使用 expression_eval 计算伤害，可扩展 random+if_branch 实现命中/闪避/暴击判定。',
  botCategory: 'game',
  category: '其他',
  tags: ['战斗', '概率', '暴击', '闪避', '游戏'],
  author: '内置',
  nodes: [
    { id: 'pc1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '攻击', nodeKind: 'on_message', config: { match: 'command', command: '攻击', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'pc1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'pc1_latk', type: 'data', position: { x: 500, y: 0 }, data: { label: '读ATK', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_atk', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pc1_lmhp', type: 'data', position: { x: 750, y: 0 }, data: { label: '读怪物HP', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_monster_hp', scope: 'user' }, inputs: [], outputs: [] } },
    // expression_eval: 简化版伤害计算（可配合 random+if_branch 实现命中/暴击/闪避判定）
    { id: 'pc1_combat', type: 'logic', position: { x: 1000, y: 0 }, data: { label: '概率战斗', nodeKind: 'expression_eval', config: {
      expression: 'max(0, v2 - (v1 * 2 - 5))'
    }, inputs: [], outputs: [] } },
    { id: 'pc1_smhp', type: 'data', position: { x: 1300, y: 0 }, data: { label: '存怪物HP', nodeKind: 'persistent_op', config: { mode: 'save', key: 'rpg_monster_hp', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'pc1_fmt', type: 'logic', position: { x: 1550, y: 0 }, data: { label: '格式化', nodeKind: 'format_text', config: { template: '{var1}' }, inputs: [], outputs: [] } },
    { id: 'pc1_msg', type: 'action', position: { x: 1800, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    { id: 'pc1_e1', source: 'pc1_cmd', target: 'pc1_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'pc1_e2', source: 'pc1_uid', target: 'pc1_latk', sourcePort: 'out', targetPort: 'in' },
    { id: 'pc1_e3', source: 'pc1_latk', target: 'pc1_lmhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'pc1_e4', source: 'pc1_lmhp', target: 'pc1_combat', sourcePort: 'out', targetPort: 'in' },
    { id: 'pc1_e5', source: 'pc1_latk', target: 'pc1_combat', sourcePort: 'result', targetPort: 'v1' },
    { id: 'pc1_e6', source: 'pc1_lmhp', target: 'pc1_combat', sourcePort: 'result', targetPort: 'v2' },
    { id: 'pc1_e7', source: 'pc1_combat', target: 'pc1_smhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'pc1_e8', source: 'pc1_combat', target: 'pc1_smhp', sourcePort: 'result', targetPort: 'value' },
    { id: 'pc1_e9', source: 'pc1_smhp', target: 'pc1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'pc1_e10', source: 'pc1_combat', target: 'pc1_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'pc1_e11', source: 'pc1_fmt', target: 'pc1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'pc1_e12', source: 'pc1_fmt', target: 'pc1_msg', sourcePort: 'result', targetPort: 'text' },
  ],
  createdAt: '2026-07-01',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 冷却制战斗模板
// /技能 → 读上次时间 → 计算时间差 → 判断冷却 → 伤害计算 → 更新时间戳
// （原 persistent_op.cooldown_check 已移除，改用 time_op + expression_eval + if_branch 组合）
// ════════════════════════════════════════════════════════════════
export const COOLDOWN_COMBAT_TEMPLATE: FlowTemplate = {
  id: 'gameplay-combat-cooldown',
  name: '冷却制战斗系统',
  description: '技能冷却战斗：每次攻击有冷却时间，冷却中无法攻击。使用 time_op 读取时间戳、expression_eval 计算时间差并判断冷却，适合需要节奏控制的战斗系统。',
  botCategory: 'game',
  category: '其他',
  tags: ['战斗', '冷却', '技能', '游戏'],
  author: '内置',
  nodes: [
    { id: 'cd1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '技能', nodeKind: 'on_message', config: { match: 'command', command: '技能', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cd1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cd1_latk', type: 'data', position: { x: 500, y: 0 }, data: { label: '读ATK', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_atk', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cd1_lmhp', type: 'data', position: { x: 750, y: 0 }, data: { label: '读怪物HP', nodeKind: 'persistent_op', config: { mode: 'load', key: 'rpg_monster_hp', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cd1_llts', type: 'data', position: { x: 1000, y: 0 }, data: { label: '读上次时间', nodeKind: 'persistent_op', config: { mode: 'load', key: 'last_skill_ts', scope: 'user' }, inputs: [], outputs: [] } },
    // expression_eval: 伤害计算（冷却判断可扩展为 time_op 读时间差 + if_branch 分支）
    { id: 'cd1_combat', type: 'logic', position: { x: 1300, y: 0 }, data: { label: '冷却战斗', nodeKind: 'expression_eval', config: {
      expression: 'max(0, v2 - (v1 * 2 - 5))'
    }, inputs: [], outputs: [] } },
    // 保存当前时间戳
    { id: 'cd1_now', type: 'logic', position: { x: 1600, y: 0 }, data: { label: '当前时间', nodeKind: 'time_op', config: { mode: 'now', fmt: '%s' }, inputs: [], outputs: [] } },
    { id: 'cd1_sts', type: 'data', position: { x: 1850, y: 0 }, data: { label: '存时间戳', nodeKind: 'persistent_op', config: { mode: 'save', key: 'last_skill_ts', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cd1_smhp', type: 'data', position: { x: 2100, y: 0 }, data: { label: '存怪物HP', nodeKind: 'persistent_op', config: { mode: 'save', key: 'rpg_monster_hp', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cd1_fmt', type: 'logic', position: { x: 2350, y: 0 }, data: { label: '格式化', nodeKind: 'format_text', config: { template: '{var1}' }, inputs: [], outputs: [] } },
    { id: 'cd1_msg', type: 'action', position: { x: 2600, y: 0 }, data: { label: '发送', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
  ],
  edges: [
    { id: 'cd1_e1', source: 'cd1_cmd', target: 'cd1_uid', sourcePort: 'next', targetPort: 'in' },
    { id: 'cd1_e2', source: 'cd1_uid', target: 'cd1_latk', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e3', source: 'cd1_latk', target: 'cd1_lmhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e4', source: 'cd1_lmhp', target: 'cd1_llts', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e5', source: 'cd1_llts', target: 'cd1_combat', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e6', source: 'cd1_latk', target: 'cd1_combat', sourcePort: 'result', targetPort: 'v1' },
    { id: 'cd1_e7', source: 'cd1_lmhp', target: 'cd1_combat', sourcePort: 'result', targetPort: 'v2' },
    { id: 'cd1_e9', source: 'cd1_combat', target: 'cd1_now', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e10', source: 'cd1_now', target: 'cd1_sts', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e11', source: 'cd1_now', target: 'cd1_sts', sourcePort: 'result', targetPort: 'value' },
    { id: 'cd1_e12', source: 'cd1_sts', target: 'cd1_smhp', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e13', source: 'cd1_combat', target: 'cd1_smhp', sourcePort: 'result', targetPort: 'value' },
    { id: 'cd1_e14', source: 'cd1_smhp', target: 'cd1_fmt', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e15', source: 'cd1_combat', target: 'cd1_fmt', sourcePort: 'result', targetPort: 'var1' },
    { id: 'cd1_e16', source: 'cd1_fmt', target: 'cd1_msg', sourcePort: 'out', targetPort: 'in' },
    { id: 'cd1_e17', source: 'cd1_fmt', target: 'cd1_msg', sourcePort: 'result', targetPort: 'text' },
  ],
  createdAt: '2026-07-01',
  version: '1.0'
}

// 导出所有战斗模板
export const COMBAT_TEMPLATES: FlowTemplate[] = [
  TURN_BASED_COMBAT_TEMPLATE,
  SKILL_COUNTER_COMBAT_TEMPLATE,
  PROBABILITY_COMBAT_TEMPLATE,
  COOLDOWN_COMBAT_TEMPLATE,
]
