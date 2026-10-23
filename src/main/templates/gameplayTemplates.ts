// src/main/templates/gameplayTemplates.ts
// 玩法模块模板：按 botType 索引。用户创建项目时选择 botType，
// 系统自动加载对应模板（修仙 cultivation / 武侠 wuxia）。
import type { FlowTemplate } from '@shared/types/template'

// ════════════════════════════════════════════════════════════════
// 修仙修真玩法模板
// 7 条链：/创建角色 · /修炼 · /突破 · /状态 · /炼丹 · /渡劫 · /拜师
// ════════════════════════════════════════════════════════════════
export const CULTIVATION_TEMPLATE: FlowTemplate = {
  id: 'gameplay-cultivation',
  name: '修仙修真玩法',
  description: '修仙文字游戏：创建角色（灵根/境界/灵气）、修炼积累灵气、境界突破、查看状态、炼丹、渡劫飞升、拜入宗门。多链路 + 持久化 + 条件分支示例。',
  botCategory: 'game',
  category: '其他',
  tags: ['修仙', 'cultivation', '玩法', '游戏', '持久化', '多链'],
  author: '内置',
  nodes: [
    // ════════════ 链1 · /创建角色 初始化修仙角色 ════════════
    { id: 'cu1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '创建角色', nodeKind: 'on_command', config: { command: '创建角色', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cu1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cu1_load', type: 'data', position: { x: 500, y: 0 }, data: { label: '读境界', nodeKind: 'load_persistent', config: { key: 'realm', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu1_if', type: 'logic', position: { x: 750, y: 0 }, data: { label: '已有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // true: 已创建过角色
    { id: 'cu1_exist', type: 'action', position: { x: 1000, y: -80 }, data: { label: '已创建', nodeKind: 'send_message', config: { text: '已创建过角色' }, inputs: [], outputs: [] } },
    // false: 初始化属性
    { id: 'cu1_srealm', type: 'data', position: { x: 1000, y: 80 }, data: { label: '存境界', nodeKind: 'save_persistent', config: { key: 'realm', value: '练气期', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu1_sqi', type: 'data', position: { x: 1250, y: 80 }, data: { label: '存灵气', nodeKind: 'save_persistent', config: { key: 'qi', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu1_sexp', type: 'data', position: { x: 1500, y: 80 }, data: { label: '存修为', nodeKind: 'save_persistent', config: { key: 'cultivation_exp', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu1_slg', type: 'data', position: { x: 1750, y: 80 }, data: { label: '存灵根', nodeKind: 'save_persistent', config: { key: 'linggen', value: '随机', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu1_msg', type: 'action', position: { x: 2000, y: 80 }, data: { label: '创建成功', nodeKind: 'send_message', config: { text: '角色创建成功，你的灵根是随机属性' }, inputs: [], outputs: [] } },

    // ════════════ 链2 · /修炼 获取灵气 ════════════
    { id: 'cu2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '修炼', nodeKind: 'on_command', config: { command: '修炼', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cu2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cu2_load', type: 'data', position: { x: 500, y: 350 }, data: { label: '读境界', nodeKind: 'load_persistent', config: { key: 'realm', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu2_if', type: 'logic', position: { x: 750, y: 350 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'cu2_no', type: 'action', position: { x: 1000, y: 430 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建角色' }, inputs: [], outputs: [] } },
    // true: 灵气 +10
    { id: 'cu2_lqi', type: 'data', position: { x: 1000, y: 270 }, data: { label: '读灵气', nodeKind: 'load_persistent', config: { key: 'qi', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu2_math', type: 'logic', position: { x: 1250, y: 270 }, data: { label: '灵气+10', nodeKind: 'expression_eval', config: { expression: 'v1 + 10' }, inputs: [], outputs: [] } },
    { id: 'cu2_sqi', type: 'data', position: { x: 1500, y: 270 }, data: { label: '存灵气', nodeKind: 'save_persistent', config: { key: 'qi', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu2_msg', type: 'action', position: { x: 1750, y: 270 }, data: { label: '修炼成功', nodeKind: 'send_message', config: { text: '修炼成功，灵气+10' }, inputs: [], outputs: [] } },

    // ════════════ 链3 · /突破 境界突破 ════════════
    { id: 'cu3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '突破', nodeKind: 'on_command', config: { command: '突破', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cu3_uid', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cu3_load', type: 'data', position: { x: 500, y: 700 }, data: { label: '读境界', nodeKind: 'load_persistent', config: { key: 'realm', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu3_if', type: 'logic', position: { x: 750, y: 700 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'cu3_no', type: 'action', position: { x: 1000, y: 780 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建角色' }, inputs: [], outputs: [] } },
    // true: 判断灵气是否足够
    { id: 'cu3_lqi', type: 'data', position: { x: 1000, y: 620 }, data: { label: '读灵气', nodeKind: 'load_persistent', config: { key: 'qi', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu3_if2', type: 'logic', position: { x: 1250, y: 620 }, data: { label: '灵气>=100?', nodeKind: 'if_branch', config: { expression: 'value >= 100' }, inputs: [], outputs: [] } },
    // if2 true: 突破成功
    { id: 'cu3_srealm', type: 'data', position: { x: 1500, y: 540 }, data: { label: '存境界', nodeKind: 'save_persistent', config: { key: 'realm', value: '筑基期', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu3_sqi', type: 'data', position: { x: 1750, y: 540 }, data: { label: '清灵气', nodeKind: 'save_persistent', config: { key: 'qi', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu3_msg', type: 'action', position: { x: 2000, y: 540 }, data: { label: '突破成功', nodeKind: 'send_message', config: { text: '突破成功！进入筑基期' }, inputs: [], outputs: [] } },
    // if2 false: 灵气不足
    { id: 'cu3_nofail', type: 'action', position: { x: 1500, y: 700 }, data: { label: '灵气不足', nodeKind: 'send_message', config: { text: '灵气不足，需要100点灵气' }, inputs: [], outputs: [] } },

    // ════════════ 链4 · /状态 查看状态 ════════════
    { id: 'cu4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: '状态', nodeKind: 'on_command', config: { command: '状态', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cu4_uid', type: 'logic', position: { x: 250, y: 1050 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cu4_load', type: 'data', position: { x: 500, y: 1050 }, data: { label: '读境界', nodeKind: 'load_persistent', config: { key: 'realm', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu4_if', type: 'logic', position: { x: 750, y: 1050 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'cu4_no', type: 'action', position: { x: 1000, y: 1130 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建角色' }, inputs: [], outputs: [] } },
    // true: 格式化状态文本
    { id: 'cu4_lqi', type: 'data', position: { x: 1000, y: 970 }, data: { label: '读灵气', nodeKind: 'load_persistent', config: { key: 'qi', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu4_fmt', type: 'logic', position: { x: 1250, y: 970 }, data: { label: '格式化状态', nodeKind: 'format_text', config: { template: '境界：{var1}\n灵气：{var2}' }, inputs: [], outputs: [] } },
    { id: 'cu4_msg', type: 'action', position: { x: 1500, y: 970 }, data: { label: '发送状态', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ════════════ 链5 · /炼丹 消耗灵气炼丹 ════════════
    { id: 'cu5_cmd', type: 'trigger', position: { x: 0, y: 1400 }, data: { label: '炼丹', nodeKind: 'on_command', config: { command: '炼丹', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cu5_uid', type: 'logic', position: { x: 250, y: 1400 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cu5_load', type: 'data', position: { x: 500, y: 1400 }, data: { label: '读境界', nodeKind: 'load_persistent', config: { key: 'realm', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu5_if', type: 'logic', position: { x: 750, y: 1400 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'cu5_no', type: 'action', position: { x: 1000, y: 1480 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建角色' }, inputs: [], outputs: [] } },
    // true: 判断灵气是否足够
    { id: 'cu5_lqi', type: 'data', position: { x: 1000, y: 1320 }, data: { label: '读灵气', nodeKind: 'load_persistent', config: { key: 'qi', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu5_if2', type: 'logic', position: { x: 1250, y: 1320 }, data: { label: '灵气>=50?', nodeKind: 'if_branch', config: { expression: 'value >= 50' }, inputs: [], outputs: [] } },
    // if2 false: 灵气不足
    { id: 'cu5_nofail', type: 'action', position: { x: 1500, y: 1400 }, data: { label: '灵气不足', nodeKind: 'send_message', config: { text: '灵气不足，需要50点' }, inputs: [], outputs: [] } },
    // if2 true: 炼丹成功
    { id: 'cu5_math', type: 'logic', position: { x: 1500, y: 1240 }, data: { label: '灵气-50', nodeKind: 'expression_eval', config: { expression: 'v1 - 50' }, inputs: [], outputs: [] } },
    { id: 'cu5_sqi', type: 'data', position: { x: 1750, y: 1240 }, data: { label: '存灵气', nodeKind: 'save_persistent', config: { key: 'qi', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu5_rand', type: 'logic', position: { x: 2000, y: 1240 }, data: { label: '随机丹药', nodeKind: 'random', config: { mode: 'choice', list: ['回气丹', '筑基丹', '聚灵丹'] }, inputs: [], outputs: [] } },
    { id: 'cu5_msg', type: 'action', position: { x: 2250, y: 1240 }, data: { label: '炼丹成功', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ════════════ 链6 · /渡劫 大境界突破 ════════════
    { id: 'cu6_cmd', type: 'trigger', position: { x: 0, y: 1750 }, data: { label: '渡劫', nodeKind: 'on_command', config: { command: '渡劫', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cu6_uid', type: 'logic', position: { x: 250, y: 1750 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cu6_load', type: 'data', position: { x: 500, y: 1750 }, data: { label: '读境界', nodeKind: 'load_persistent', config: { key: 'realm', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu6_if', type: 'logic', position: { x: 750, y: 1750 }, data: { label: '筑基期?', nodeKind: 'if_branch', config: { expression: 'value == "筑基期"' }, inputs: [], outputs: [] } },
    // false: 未达到筑基期
    { id: 'cu6_no', type: 'action', position: { x: 1000, y: 1830 }, data: { label: '境界不足', nodeKind: 'send_message', config: { text: '需达到筑基期才能渡劫' }, inputs: [], outputs: [] } },
    // true: 判断灵气是否足够
    { id: 'cu6_lqi', type: 'data', position: { x: 1000, y: 1670 }, data: { label: '读灵气', nodeKind: 'load_persistent', config: { key: 'qi', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu6_if2', type: 'logic', position: { x: 1250, y: 1670 }, data: { label: '灵气>=1000?', nodeKind: 'if_branch', config: { expression: 'value >= 1000' }, inputs: [], outputs: [] } },
    // if2 false: 灵气不足
    { id: 'cu6_nofail', type: 'action', position: { x: 1500, y: 1750 }, data: { label: '灵气不足', nodeKind: 'send_message', config: { text: '灵气不足，需要1000点' }, inputs: [], outputs: [] } },
    // if2 true: 渡劫成功
    { id: 'cu6_srealm', type: 'data', position: { x: 1500, y: 1590 }, data: { label: '存境界', nodeKind: 'save_persistent', config: { key: 'realm', value: '金丹期', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu6_sqi', type: 'data', position: { x: 1750, y: 1590 }, data: { label: '清灵气', nodeKind: 'save_persistent', config: { key: 'qi', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu6_msg', type: 'action', position: { x: 2000, y: 1590 }, data: { label: '渡劫成功', nodeKind: 'send_message', config: { text: '渡劫成功！飞升金丹期' }, inputs: [], outputs: [] } },

    // ════════════ 链7 · /拜师 加入宗门 ════════════
    { id: 'cu7_cmd', type: 'trigger', position: { x: 0, y: 2100 }, data: { label: '拜师', nodeKind: 'on_command', config: { command: '拜师', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'cu7_uid', type: 'logic', position: { x: 250, y: 2100 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'cu7_load', type: 'data', position: { x: 500, y: 2100 }, data: { label: '读宗门', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu7_if', type: 'logic', position: { x: 750, y: 2100 }, data: { label: '已有宗门?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // true: 已有宗门
    { id: 'cu7_exist', type: 'action', position: { x: 1000, y: 2020 }, data: { label: '已有宗门', nodeKind: 'send_message', config: { text: '已有宗门' }, inputs: [], outputs: [] } },
    // false: 随机分配宗门
    { id: 'cu7_rand', type: 'logic', position: { x: 1000, y: 2180 }, data: { label: '随机宗门', nodeKind: 'random', config: { mode: 'choice', list: ['青云宗', '天剑门', '万法宗', '太虚观'] }, inputs: [], outputs: [] } },
    { id: 'cu7_ssect', type: 'data', position: { x: 1250, y: 2180 }, data: { label: '存宗门', nodeKind: 'save_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'cu7_fmt', type: 'logic', position: { x: 1500, y: 2180 }, data: { label: '格式化拜师', nodeKind: 'format_text', config: { template: '拜入{var1}，成为外门弟子' }, inputs: [], outputs: [] } },
    { id: 'cu7_msg', type: 'action', position: { x: 1750, y: 2180 }, data: { label: '拜师成功', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } }
  ],
  edges: [
    // ───── 链1 控制流：/创建角色 ─────
    { id: 'e-cu1cmd-cu1uid', source: 'cu1_cmd', sourcePort: 'next', target: 'cu1_uid', targetPort: 'in' },
    { id: 'e-cu1uid-cu1load', source: 'cu1_uid', sourcePort: 'out', target: 'cu1_load', targetPort: 'in' },
    { id: 'e-cu1load-cu1if', source: 'cu1_load', sourcePort: 'out', target: 'cu1_if', targetPort: 'in' },
    { id: 'e-cu1if-cu1exist', source: 'cu1_if', sourcePort: 'true', target: 'cu1_exist', targetPort: 'in' },
    { id: 'e-cu1if-cu1srealm', source: 'cu1_if', sourcePort: 'false', target: 'cu1_srealm', targetPort: 'in' },
    { id: 'e-cu1srealm-cu1sqi', source: 'cu1_srealm', sourcePort: 'out', target: 'cu1_sqi', targetPort: 'in' },
    { id: 'e-cu1sqi-cu1sexp', source: 'cu1_sqi', sourcePort: 'out', target: 'cu1_sexp', targetPort: 'in' },
    { id: 'e-cu1sexp-cu1slg', source: 'cu1_sexp', sourcePort: 'out', target: 'cu1_slg', targetPort: 'in' },
    { id: 'e-cu1slg-cu1msg', source: 'cu1_slg', sourcePort: 'out', target: 'cu1_msg', targetPort: 'in' },
    // 链1 数据流
    { id: 'e-cu1load-cu1if-v', source: 'cu1_load', sourcePort: 'result', target: 'cu1_if', targetPort: 'value' },

    // ───── 链2 控制流：/修炼 ─────
    { id: 'e-cu2cmd-cu2uid', source: 'cu2_cmd', sourcePort: 'next', target: 'cu2_uid', targetPort: 'in' },
    { id: 'e-cu2uid-cu2load', source: 'cu2_uid', sourcePort: 'out', target: 'cu2_load', targetPort: 'in' },
    { id: 'e-cu2load-cu2if', source: 'cu2_load', sourcePort: 'out', target: 'cu2_if', targetPort: 'in' },
    { id: 'e-cu2if-cu2no', source: 'cu2_if', sourcePort: 'false', target: 'cu2_no', targetPort: 'in' },
    { id: 'e-cu2if-cu2lqi', source: 'cu2_if', sourcePort: 'true', target: 'cu2_lqi', targetPort: 'in' },
    { id: 'e-cu2lqi-cu2math', source: 'cu2_lqi', sourcePort: 'out', target: 'cu2_math', targetPort: 'in' },
    { id: 'e-cu2math-cu2sqi', source: 'cu2_math', sourcePort: 'out', target: 'cu2_sqi', targetPort: 'in' },
    { id: 'e-cu2sqi-cu2msg', source: 'cu2_sqi', sourcePort: 'out', target: 'cu2_msg', targetPort: 'in' },
    // 链2 数据流
    { id: 'e-cu2load-cu2if-v', source: 'cu2_load', sourcePort: 'result', target: 'cu2_if', targetPort: 'value' },
    { id: 'e-cu2lqi-cu2math-a', source: 'cu2_lqi', sourcePort: 'result', target: 'cu2_math', targetPort: 'v1' },
    { id: 'e-cu2math-cu2sqi-v', source: 'cu2_math', sourcePort: 'result', target: 'cu2_sqi', targetPort: 'value' },

    // ───── 链3 控制流：/突破 ─────
    { id: 'e-cu3cmd-cu3uid', source: 'cu3_cmd', sourcePort: 'next', target: 'cu3_uid', targetPort: 'in' },
    { id: 'e-cu3uid-cu3load', source: 'cu3_uid', sourcePort: 'out', target: 'cu3_load', targetPort: 'in' },
    { id: 'e-cu3load-cu3if', source: 'cu3_load', sourcePort: 'out', target: 'cu3_if', targetPort: 'in' },
    { id: 'e-cu3if-cu3no', source: 'cu3_if', sourcePort: 'false', target: 'cu3_no', targetPort: 'in' },
    { id: 'e-cu3if-cu3lqi', source: 'cu3_if', sourcePort: 'true', target: 'cu3_lqi', targetPort: 'in' },
    { id: 'e-cu3lqi-cu3if2', source: 'cu3_lqi', sourcePort: 'out', target: 'cu3_if2', targetPort: 'in' },
    // if2 true: 突破成功
    { id: 'e-cu3if2-cu3srealm', source: 'cu3_if2', sourcePort: 'true', target: 'cu3_srealm', targetPort: 'in' },
    { id: 'e-cu3srealm-cu3sqi', source: 'cu3_srealm', sourcePort: 'out', target: 'cu3_sqi', targetPort: 'in' },
    { id: 'e-cu3sqi-cu3msg', source: 'cu3_sqi', sourcePort: 'out', target: 'cu3_msg', targetPort: 'in' },
    // if2 false: 灵气不足
    { id: 'e-cu3if2-cu3nofail', source: 'cu3_if2', sourcePort: 'false', target: 'cu3_nofail', targetPort: 'in' },
    // 链3 数据流
    { id: 'e-cu3load-cu3if-v', source: 'cu3_load', sourcePort: 'result', target: 'cu3_if', targetPort: 'value' },
    { id: 'e-cu3lqi-cu3if2-v', source: 'cu3_lqi', sourcePort: 'result', target: 'cu3_if2', targetPort: 'value' },

    // ───── 链4 控制流：/状态 ─────
    { id: 'e-cu4cmd-cu4uid', source: 'cu4_cmd', sourcePort: 'next', target: 'cu4_uid', targetPort: 'in' },
    { id: 'e-cu4uid-cu4load', source: 'cu4_uid', sourcePort: 'out', target: 'cu4_load', targetPort: 'in' },
    { id: 'e-cu4load-cu4if', source: 'cu4_load', sourcePort: 'out', target: 'cu4_if', targetPort: 'in' },
    { id: 'e-cu4if-cu4no', source: 'cu4_if', sourcePort: 'false', target: 'cu4_no', targetPort: 'in' },
    { id: 'e-cu4if-cu4lqi', source: 'cu4_if', sourcePort: 'true', target: 'cu4_lqi', targetPort: 'in' },
    { id: 'e-cu4lqi-cu4fmt', source: 'cu4_lqi', sourcePort: 'out', target: 'cu4_fmt', targetPort: 'in' },
    { id: 'e-cu4fmt-cu4msg', source: 'cu4_fmt', sourcePort: 'out', target: 'cu4_msg', targetPort: 'in' },
    // 链4 数据流
    { id: 'e-cu4load-cu4if-v', source: 'cu4_load', sourcePort: 'result', target: 'cu4_if', targetPort: 'value' },
    { id: 'e-cu4fmt-cu4msg-t', source: 'cu4_fmt', sourcePort: 'result', target: 'cu4_msg', targetPort: 'text' },
    { id: 'e-cu4load-cu4fmt-v1', source: 'cu4_load', sourcePort: 'result', target: 'cu4_fmt', targetPort: 'var1' },
    { id: 'e-cu4lqi-cu4fmt-v2', source: 'cu4_lqi', sourcePort: 'result', target: 'cu4_fmt', targetPort: 'var2' },

    // ───── 链5 控制流：/炼丹 ─────
    { id: 'e-cu5cmd-cu5uid', source: 'cu5_cmd', sourcePort: 'next', target: 'cu5_uid', targetPort: 'in' },
    { id: 'e-cu5uid-cu5load', source: 'cu5_uid', sourcePort: 'out', target: 'cu5_load', targetPort: 'in' },
    { id: 'e-cu5load-cu5if', source: 'cu5_load', sourcePort: 'out', target: 'cu5_if', targetPort: 'in' },
    { id: 'e-cu5if-cu5no', source: 'cu5_if', sourcePort: 'false', target: 'cu5_no', targetPort: 'in' },
    { id: 'e-cu5if-cu5lqi', source: 'cu5_if', sourcePort: 'true', target: 'cu5_lqi', targetPort: 'in' },
    { id: 'e-cu5lqi-cu5if2', source: 'cu5_lqi', sourcePort: 'out', target: 'cu5_if2', targetPort: 'in' },
    { id: 'e-cu5if2-cu5nofail', source: 'cu5_if2', sourcePort: 'false', target: 'cu5_nofail', targetPort: 'in' },
    { id: 'e-cu5if2-cu5math', source: 'cu5_if2', sourcePort: 'true', target: 'cu5_math', targetPort: 'in' },
    { id: 'e-cu5math-cu5sqi', source: 'cu5_math', sourcePort: 'out', target: 'cu5_sqi', targetPort: 'in' },
    { id: 'e-cu5sqi-cu5rand', source: 'cu5_sqi', sourcePort: 'out', target: 'cu5_rand', targetPort: 'in' },
    { id: 'e-cu5rand-cu5msg', source: 'cu5_rand', sourcePort: 'out', target: 'cu5_msg', targetPort: 'in' },
    // 链5 数据流
    { id: 'e-cu5load-cu5if-v', source: 'cu5_load', sourcePort: 'result', target: 'cu5_if', targetPort: 'value' },
    { id: 'e-cu5lqi-cu5if2-v', source: 'cu5_lqi', sourcePort: 'result', target: 'cu5_if2', targetPort: 'value' },
    { id: 'e-cu5lqi-cu5math-a', source: 'cu5_lqi', sourcePort: 'result', target: 'cu5_math', targetPort: 'v1' },
    { id: 'e-cu5math-cu5sqi-v', source: 'cu5_math', sourcePort: 'result', target: 'cu5_sqi', targetPort: 'value' },
    { id: 'e-cu5rand-cu5msg-t', source: 'cu5_rand', sourcePort: 'result', target: 'cu5_msg', targetPort: 'text' },

    // ───── 链6 控制流：/渡劫 ─────
    { id: 'e-cu6cmd-cu6uid', source: 'cu6_cmd', sourcePort: 'next', target: 'cu6_uid', targetPort: 'in' },
    { id: 'e-cu6uid-cu6load', source: 'cu6_uid', sourcePort: 'out', target: 'cu6_load', targetPort: 'in' },
    { id: 'e-cu6load-cu6if', source: 'cu6_load', sourcePort: 'out', target: 'cu6_if', targetPort: 'in' },
    { id: 'e-cu6if-cu6no', source: 'cu6_if', sourcePort: 'false', target: 'cu6_no', targetPort: 'in' },
    { id: 'e-cu6if-cu6lqi', source: 'cu6_if', sourcePort: 'true', target: 'cu6_lqi', targetPort: 'in' },
    { id: 'e-cu6lqi-cu6if2', source: 'cu6_lqi', sourcePort: 'out', target: 'cu6_if2', targetPort: 'in' },
    { id: 'e-cu6if2-cu6nofail', source: 'cu6_if2', sourcePort: 'false', target: 'cu6_nofail', targetPort: 'in' },
    { id: 'e-cu6if2-cu6srealm', source: 'cu6_if2', sourcePort: 'true', target: 'cu6_srealm', targetPort: 'in' },
    { id: 'e-cu6srealm-cu6sqi', source: 'cu6_srealm', sourcePort: 'out', target: 'cu6_sqi', targetPort: 'in' },
    { id: 'e-cu6sqi-cu6msg', source: 'cu6_sqi', sourcePort: 'out', target: 'cu6_msg', targetPort: 'in' },
    // 链6 数据流
    { id: 'e-cu6load-cu6if-v', source: 'cu6_load', sourcePort: 'result', target: 'cu6_if', targetPort: 'value' },
    { id: 'e-cu6lqi-cu6if2-v', source: 'cu6_lqi', sourcePort: 'result', target: 'cu6_if2', targetPort: 'value' },

    // ───── 链7 控制流：/拜师 ─────
    { id: 'e-cu7cmd-cu7uid', source: 'cu7_cmd', sourcePort: 'next', target: 'cu7_uid', targetPort: 'in' },
    { id: 'e-cu7uid-cu7load', source: 'cu7_uid', sourcePort: 'out', target: 'cu7_load', targetPort: 'in' },
    { id: 'e-cu7load-cu7if', source: 'cu7_load', sourcePort: 'out', target: 'cu7_if', targetPort: 'in' },
    { id: 'e-cu7if-cu7exist', source: 'cu7_if', sourcePort: 'true', target: 'cu7_exist', targetPort: 'in' },
    { id: 'e-cu7if-cu7rand', source: 'cu7_if', sourcePort: 'false', target: 'cu7_rand', targetPort: 'in' },
    { id: 'e-cu7rand-cu7ssect', source: 'cu7_rand', sourcePort: 'out', target: 'cu7_ssect', targetPort: 'in' },
    { id: 'e-cu7ssect-cu7fmt', source: 'cu7_ssect', sourcePort: 'out', target: 'cu7_fmt', targetPort: 'in' },
    { id: 'e-cu7fmt-cu7msg', source: 'cu7_fmt', sourcePort: 'out', target: 'cu7_msg', targetPort: 'in' },
    // 链7 数据流
    { id: 'e-cu7load-cu7if-v', source: 'cu7_load', sourcePort: 'result', target: 'cu7_if', targetPort: 'value' },
    { id: 'e-cu7rand-cu7ssect-v', source: 'cu7_rand', sourcePort: 'result', target: 'cu7_ssect', targetPort: 'value' },
    { id: 'e-cu7rand-cu7fmt-v1', source: 'cu7_rand', sourcePort: 'result', target: 'cu7_fmt', targetPort: 'var1' },
    { id: 'e-cu7fmt-cu7msg-t', source: 'cu7_fmt', sourcePort: 'result', target: 'cu7_msg', targetPort: 'text' }
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 武侠 MUD 玩法模板
// 7 条链：/创建角色 · /拜师 · /练武 · /状态 · /切磋 · /行走江湖 · /武学
// ════════════════════════════════════════════════════════════════
export const WUXIA_TEMPLATE: FlowTemplate = {
  id: 'gameplay-wuxia',
  name: '武侠 MUD 玩法',
  description: '武侠文字游戏：创建角色（门派/内功/武学/声望）、随机拜入门派、练武提升武学与声望、查看状态、切磋PVP、行走江湖、查看武学。多链路 + 随机选择 + 持久化示例。',
  botCategory: 'game',
  category: '其他',
  tags: ['武侠', 'wuxia', '玩法', '游戏', '门派', '多链'],
  author: '内置',
  nodes: [
    // ════════════ 链1 · /创建角色 初始化武侠角色 ════════════
    { id: 'wx1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '创建角色', nodeKind: 'on_command', config: { command: '创建角色', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'wx1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'wx1_load', type: 'data', position: { x: 500, y: 0 }, data: { label: '读门派', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx1_if', type: 'logic', position: { x: 750, y: 0 }, data: { label: '已有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // true: 已创建过角色
    { id: 'wx1_exist', type: 'action', position: { x: 1000, y: -80 }, data: { label: '已创建', nodeKind: 'send_message', config: { text: '已创建过角色' }, inputs: [], outputs: [] } },
    // false: 初始化属性
    { id: 'wx1_ssect', type: 'data', position: { x: 1000, y: 80 }, data: { label: '存门派', nodeKind: 'save_persistent', config: { key: 'sect', value: '无门派', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx1_sskill', type: 'data', position: { x: 1250, y: 80 }, data: { label: '存内功', nodeKind: 'save_persistent', config: { key: 'inner_skill', value: '无', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx1_sma', type: 'data', position: { x: 1500, y: 80 }, data: { label: '存武学', nodeKind: 'save_persistent', config: { key: 'martial_arts', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx1_srep', type: 'data', position: { x: 1750, y: 80 }, data: { label: '存声望', nodeKind: 'save_persistent', config: { key: 'jianghu_reputation', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx1_msg', type: 'action', position: { x: 2000, y: 80 }, data: { label: '创建成功', nodeKind: 'send_message', config: { text: '角色创建成功，行走江湖吧！' }, inputs: [], outputs: [] } },

    // ════════════ 链2 · /拜师 加入门派 ════════════
    { id: 'wx2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '拜师', nodeKind: 'on_command', config: { command: '拜师', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'wx2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'wx2_load', type: 'data', position: { x: 500, y: 350 }, data: { label: '读门派', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx2_if', type: 'logic', position: { x: 750, y: 350 }, data: { label: '已有门派?', nodeKind: 'if_branch', config: { expression: 'value != "无门派" and value != None' }, inputs: [], outputs: [] } },
    // true: 已有门派
    { id: 'wx2_exist', type: 'action', position: { x: 1000, y: 270 }, data: { label: '已有门派', nodeKind: 'send_message', config: { text: '已有门派' }, inputs: [], outputs: [] } },
    // false: 随机分配门派
    { id: 'wx2_rand', type: 'logic', position: { x: 1000, y: 430 }, data: { label: '随机门派', nodeKind: 'random', config: { mode: 'choice', list: ['少林', '武当', '峨眉', '丐帮'] }, inputs: [], outputs: [] } },
    { id: 'wx2_ssect', type: 'data', position: { x: 1250, y: 430 }, data: { label: '存门派', nodeKind: 'save_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx2_sskill', type: 'data', position: { x: 1500, y: 430 }, data: { label: '存内功', nodeKind: 'save_persistent', config: { key: 'inner_skill', value: '本门内功', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx2_fmt', type: 'logic', position: { x: 1750, y: 430 }, data: { label: '格式化拜师', nodeKind: 'format_text', config: { template: '拜入{var1}，习得本门内功' }, inputs: [], outputs: [] } },
    { id: 'wx2_msg', type: 'action', position: { x: 2000, y: 430 }, data: { label: '拜师成功', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ════════════ 链3 · /练武 提升武学 ════════════
    { id: 'wx3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '练武', nodeKind: 'on_command', config: { command: '练武', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'wx3_uid', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'wx3_load', type: 'data', position: { x: 500, y: 700 }, data: { label: '读门派', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx3_if', type: 'logic', position: { x: 750, y: 700 }, data: { label: '有门派?', nodeKind: 'if_branch', config: { expression: 'value != "无门派" and value != None' }, inputs: [], outputs: [] } },
    // false: 未加入门派
    { id: 'wx3_no', type: 'action', position: { x: 1000, y: 780 }, data: { label: '未入门派', nodeKind: 'send_message', config: { text: '未加入门派，/拜师 加入门派' }, inputs: [], outputs: [] } },
    // true: 武学+1, 声望+5
    { id: 'wx3_lma', type: 'data', position: { x: 1000, y: 620 }, data: { label: '读武学', nodeKind: 'load_persistent', config: { key: 'martial_arts', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx3_math', type: 'logic', position: { x: 1250, y: 620 }, data: { label: '武学+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'wx3_sma', type: 'data', position: { x: 1500, y: 620 }, data: { label: '存武学', nodeKind: 'save_persistent', config: { key: 'martial_arts', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx3_lrep', type: 'data', position: { x: 1750, y: 620 }, data: { label: '读声望', nodeKind: 'load_persistent', config: { key: 'jianghu_reputation', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx3_math2', type: 'logic', position: { x: 2000, y: 620 }, data: { label: '声望+5', nodeKind: 'expression_eval', config: { expression: 'v1 + 5' }, inputs: [], outputs: [] } },
    { id: 'wx3_srep', type: 'data', position: { x: 2250, y: 620 }, data: { label: '存声望', nodeKind: 'save_persistent', config: { key: 'jianghu_reputation', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx3_msg', type: 'action', position: { x: 2500, y: 620 }, data: { label: '练武成功', nodeKind: 'send_message', config: { text: '练武成功，武学+1，江湖声望+5' }, inputs: [], outputs: [] } },

    // ════════════ 链4 · /状态 查看状态 ════════════
    { id: 'wx4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: '状态', nodeKind: 'on_command', config: { command: '状态', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'wx4_uid', type: 'logic', position: { x: 250, y: 1050 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'wx4_load', type: 'data', position: { x: 500, y: 1050 }, data: { label: '读门派', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx4_if', type: 'logic', position: { x: 750, y: 1050 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'wx4_no', type: 'action', position: { x: 1000, y: 1130 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建角色' }, inputs: [], outputs: [] } },
    // true: 格式化状态文本
    { id: 'wx4_lma', type: 'data', position: { x: 1000, y: 970 }, data: { label: '读武学', nodeKind: 'load_persistent', config: { key: 'martial_arts', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx4_lrep', type: 'data', position: { x: 1250, y: 970 }, data: { label: '读声望', nodeKind: 'load_persistent', config: { key: 'jianghu_reputation', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx4_fmt', type: 'logic', position: { x: 1500, y: 970 }, data: { label: '格式化状态', nodeKind: 'format_text', config: { template: '门派：{var1}\n武学：{var2}\n声望：{var3}' }, inputs: [], outputs: [] } },
    { id: 'wx4_msg', type: 'action', position: { x: 1750, y: 970 }, data: { label: '发送状态', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ════════════ 链5 · /切磋 PVP战斗 ════════════
    { id: 'wx5_cmd', type: 'trigger', position: { x: 0, y: 1400 }, data: { label: '切磋', nodeKind: 'on_command', config: { command: '切磋', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'wx5_uid', type: 'logic', position: { x: 250, y: 1400 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'wx5_load', type: 'data', position: { x: 500, y: 1400 }, data: { label: '读门派', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx5_if', type: 'logic', position: { x: 750, y: 1400 }, data: { label: '有门派?', nodeKind: 'if_branch', config: { expression: 'value != "无门派" and value != None' }, inputs: [], outputs: [] } },
    // false: 未加入门派
    { id: 'wx5_no', type: 'action', position: { x: 1000, y: 1480 }, data: { label: '未入门派', nodeKind: 'send_message', config: { text: '未加入门派，/拜师 加入门派' }, inputs: [], outputs: [] } },
    // true: 判断武学是否足够
    { id: 'wx5_lma', type: 'data', position: { x: 1000, y: 1320 }, data: { label: '读武学', nodeKind: 'load_persistent', config: { key: 'martial_arts', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx5_if2', type: 'logic', position: { x: 1250, y: 1320 }, data: { label: '武学>=10?', nodeKind: 'if_branch', config: { expression: 'value >= 10' }, inputs: [], outputs: [] } },
    // if2 false: 武学不足
    { id: 'wx5_nofail', type: 'action', position: { x: 1500, y: 1400 }, data: { label: '武学不足', nodeKind: 'send_message', config: { text: '武学不足10，多练武再来' }, inputs: [], outputs: [] } },
    // if2 true: 随机切磋
    { id: 'wx5_rand', type: 'logic', position: { x: 1500, y: 1240 }, data: { label: '随机点数', nodeKind: 'random', config: { mode: 'int', min: 1, max: 100 }, inputs: [], outputs: [] } },
    { id: 'wx5_if3', type: 'logic', position: { x: 1750, y: 1240 }, data: { label: '点数>=50?', nodeKind: 'if_branch', config: { expression: 'value >= 50' }, inputs: [], outputs: [] } },
    // if3 true: 切磋胜利
    { id: 'wx5_lrep1', type: 'data', position: { x: 2000, y: 1160 }, data: { label: '读声望', nodeKind: 'load_persistent', config: { key: 'jianghu_reputation', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx5_math1', type: 'logic', position: { x: 2250, y: 1160 }, data: { label: '声望+20', nodeKind: 'expression_eval', config: { expression: 'v1 + 20' }, inputs: [], outputs: [] } },
    { id: 'wx5_srep1', type: 'data', position: { x: 2500, y: 1160 }, data: { label: '存声望', nodeKind: 'save_persistent', config: { key: 'jianghu_reputation', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx5_msg1', type: 'action', position: { x: 2750, y: 1160 }, data: { label: '切磋胜利', nodeKind: 'send_message', config: { text: '切磋胜利！声望+20' }, inputs: [], outputs: [] } },
    // if3 false: 切磋失败
    { id: 'wx5_lrep2', type: 'data', position: { x: 2000, y: 1320 }, data: { label: '读声望', nodeKind: 'load_persistent', config: { key: 'jianghu_reputation', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx5_math2', type: 'logic', position: { x: 2250, y: 1320 }, data: { label: '声望-10', nodeKind: 'expression_eval', config: { expression: 'v1 - 10' }, inputs: [], outputs: [] } },
    { id: 'wx5_srep2', type: 'data', position: { x: 2500, y: 1320 }, data: { label: '存声望', nodeKind: 'save_persistent', config: { key: 'jianghu_reputation', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx5_msg2', type: 'action', position: { x: 2750, y: 1320 }, data: { label: '切磋失败', nodeKind: 'send_message', config: { text: '切磋失败，声望-10' }, inputs: [], outputs: [] } },

    // ════════════ 链6 · /行走江湖 随机事件 ════════════
    { id: 'wx6_cmd', type: 'trigger', position: { x: 0, y: 1750 }, data: { label: '行走江湖', nodeKind: 'on_command', config: { command: '行走江湖', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'wx6_uid', type: 'logic', position: { x: 250, y: 1750 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'wx6_load', type: 'data', position: { x: 500, y: 1750 }, data: { label: '读门派', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx6_if', type: 'logic', position: { x: 750, y: 1750 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != "无门派" and value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'wx6_no', type: 'action', position: { x: 1000, y: 1830 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建角色' }, inputs: [], outputs: [] } },
    // true: 随机事件
    { id: 'wx6_rand', type: 'logic', position: { x: 1000, y: 1670 }, data: { label: '随机事件', nodeKind: 'random', config: { mode: 'weighted', items: [{ value: '遇到山贼，武学+2', weight: 30 }, { value: '偶遇高人指点，武学+5', weight: 20 }, { value: '发现秘籍，武学+10', weight: 5 }, { value: '无事发生', weight: 45 }] }, inputs: [], outputs: [] } },
    { id: 'wx6_msg', type: 'action', position: { x: 1250, y: 1670 }, data: { label: '江湖行走', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ════════════ 链7 · /武学 查看武学 ════════════
    { id: 'wx7_cmd', type: 'trigger', position: { x: 0, y: 2100 }, data: { label: '武学', nodeKind: 'on_command', config: { command: '武学', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'wx7_uid', type: 'logic', position: { x: 250, y: 2100 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'wx7_load', type: 'data', position: { x: 500, y: 2100 }, data: { label: '读门派', nodeKind: 'load_persistent', config: { key: 'sect', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx7_if', type: 'logic', position: { x: 750, y: 2100 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'wx7_no', type: 'action', position: { x: 1000, y: 2180 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建角色' }, inputs: [], outputs: [] } },
    // true: 格式化武学
    { id: 'wx7_lma', type: 'data', position: { x: 1000, y: 2020 }, data: { label: '读武学', nodeKind: 'load_persistent', config: { key: 'martial_arts', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx7_lskill', type: 'data', position: { x: 1250, y: 2020 }, data: { label: '读内功', nodeKind: 'load_persistent', config: { key: 'inner_skill', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'wx7_fmt', type: 'logic', position: { x: 1500, y: 2020 }, data: { label: '格式化武学', nodeKind: 'format_text', config: { template: '武学：{var1}\n内功：{var2}' }, inputs: [], outputs: [] } },
    { id: 'wx7_msg', type: 'action', position: { x: 1750, y: 2020 }, data: { label: '发送武学', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } }
  ],
  edges: [
    // ───── 链1 控制流：/创建角色 ─────
    { id: 'e-wx1cmd-wx1uid', source: 'wx1_cmd', sourcePort: 'next', target: 'wx1_uid', targetPort: 'in' },
    { id: 'e-wx1uid-wx1load', source: 'wx1_uid', sourcePort: 'out', target: 'wx1_load', targetPort: 'in' },
    { id: 'e-wx1load-wx1if', source: 'wx1_load', sourcePort: 'out', target: 'wx1_if', targetPort: 'in' },
    { id: 'e-wx1if-wx1exist', source: 'wx1_if', sourcePort: 'true', target: 'wx1_exist', targetPort: 'in' },
    { id: 'e-wx1if-wx1ssect', source: 'wx1_if', sourcePort: 'false', target: 'wx1_ssect', targetPort: 'in' },
    { id: 'e-wx1ssect-wx1sskill', source: 'wx1_ssect', sourcePort: 'out', target: 'wx1_sskill', targetPort: 'in' },
    { id: 'e-wx1sskill-wx1sma', source: 'wx1_sskill', sourcePort: 'out', target: 'wx1_sma', targetPort: 'in' },
    { id: 'e-wx1sma-wx1srep', source: 'wx1_sma', sourcePort: 'out', target: 'wx1_srep', targetPort: 'in' },
    { id: 'e-wx1srep-wx1msg', source: 'wx1_srep', sourcePort: 'out', target: 'wx1_msg', targetPort: 'in' },
    // 链1 数据流
    { id: 'e-wx1load-wx1if-v', source: 'wx1_load', sourcePort: 'result', target: 'wx1_if', targetPort: 'value' },

    // ───── 链2 控制流：/拜师 ─────
    { id: 'e-wx2cmd-wx2uid', source: 'wx2_cmd', sourcePort: 'next', target: 'wx2_uid', targetPort: 'in' },
    { id: 'e-wx2uid-wx2load', source: 'wx2_uid', sourcePort: 'out', target: 'wx2_load', targetPort: 'in' },
    { id: 'e-wx2load-wx2if', source: 'wx2_load', sourcePort: 'out', target: 'wx2_if', targetPort: 'in' },
    { id: 'e-wx2if-wx2exist', source: 'wx2_if', sourcePort: 'true', target: 'wx2_exist', targetPort: 'in' },
    { id: 'e-wx2if-wx2rand', source: 'wx2_if', sourcePort: 'false', target: 'wx2_rand', targetPort: 'in' },
    { id: 'e-wx2rand-wx2ssect', source: 'wx2_rand', sourcePort: 'out', target: 'wx2_ssect', targetPort: 'in' },
    { id: 'e-wx2ssect-wx2sskill', source: 'wx2_ssect', sourcePort: 'out', target: 'wx2_sskill', targetPort: 'in' },
    { id: 'e-wx2sskill-wx2fmt', source: 'wx2_sskill', sourcePort: 'out', target: 'wx2_fmt', targetPort: 'in' },
    { id: 'e-wx2fmt-wx2msg', source: 'wx2_fmt', sourcePort: 'out', target: 'wx2_msg', targetPort: 'in' },
    // 链2 数据流
    { id: 'e-wx2load-wx2if-v', source: 'wx2_load', sourcePort: 'result', target: 'wx2_if', targetPort: 'value' },
    { id: 'e-wx2rand-wx2ssect-v', source: 'wx2_rand', sourcePort: 'result', target: 'wx2_ssect', targetPort: 'value' },
    { id: 'e-wx2rand-wx2fmt-v1', source: 'wx2_rand', sourcePort: 'result', target: 'wx2_fmt', targetPort: 'var1' },
    { id: 'e-wx2fmt-wx2msg-t', source: 'wx2_fmt', sourcePort: 'result', target: 'wx2_msg', targetPort: 'text' },

    // ───── 链3 控制流：/练武 ─────
    { id: 'e-wx3cmd-wx3uid', source: 'wx3_cmd', sourcePort: 'next', target: 'wx3_uid', targetPort: 'in' },
    { id: 'e-wx3uid-wx3load', source: 'wx3_uid', sourcePort: 'out', target: 'wx3_load', targetPort: 'in' },
    { id: 'e-wx3load-wx3if', source: 'wx3_load', sourcePort: 'out', target: 'wx3_if', targetPort: 'in' },
    { id: 'e-wx3if-wx3no', source: 'wx3_if', sourcePort: 'false', target: 'wx3_no', targetPort: 'in' },
    { id: 'e-wx3if-wx3lma', source: 'wx3_if', sourcePort: 'true', target: 'wx3_lma', targetPort: 'in' },
    { id: 'e-wx3lma-wx3math', source: 'wx3_lma', sourcePort: 'out', target: 'wx3_math', targetPort: 'in' },
    { id: 'e-wx3math-wx3sma', source: 'wx3_math', sourcePort: 'out', target: 'wx3_sma', targetPort: 'in' },
    { id: 'e-wx3sma-wx3lrep', source: 'wx3_sma', sourcePort: 'out', target: 'wx3_lrep', targetPort: 'in' },
    { id: 'e-wx3lrep-wx3math2', source: 'wx3_lrep', sourcePort: 'out', target: 'wx3_math2', targetPort: 'in' },
    { id: 'e-wx3math2-wx3srep', source: 'wx3_math2', sourcePort: 'out', target: 'wx3_srep', targetPort: 'in' },
    { id: 'e-wx3srep-wx3msg', source: 'wx3_srep', sourcePort: 'out', target: 'wx3_msg', targetPort: 'in' },
    // 链3 数据流
    { id: 'e-wx3load-wx3if-v', source: 'wx3_load', sourcePort: 'result', target: 'wx3_if', targetPort: 'value' },
    { id: 'e-wx3lma-wx3math-a', source: 'wx3_lma', sourcePort: 'result', target: 'wx3_math', targetPort: 'v1' },
    { id: 'e-wx3math-wx3sma-v', source: 'wx3_math', sourcePort: 'result', target: 'wx3_sma', targetPort: 'value' },
    { id: 'e-wx3lrep-wx3math2-a', source: 'wx3_lrep', sourcePort: 'result', target: 'wx3_math2', targetPort: 'v1' },
    { id: 'e-wx3math2-wx3srep-v', source: 'wx3_math2', sourcePort: 'result', target: 'wx3_srep', targetPort: 'value' },

    // ───── 链4 控制流：/状态 ─────
    { id: 'e-wx4cmd-wx4uid', source: 'wx4_cmd', sourcePort: 'next', target: 'wx4_uid', targetPort: 'in' },
    { id: 'e-wx4uid-wx4load', source: 'wx4_uid', sourcePort: 'out', target: 'wx4_load', targetPort: 'in' },
    { id: 'e-wx4load-wx4if', source: 'wx4_load', sourcePort: 'out', target: 'wx4_if', targetPort: 'in' },
    { id: 'e-wx4if-wx4no', source: 'wx4_if', sourcePort: 'false', target: 'wx4_no', targetPort: 'in' },
    { id: 'e-wx4if-wx4lma', source: 'wx4_if', sourcePort: 'true', target: 'wx4_lma', targetPort: 'in' },
    { id: 'e-wx4lma-wx4lrep', source: 'wx4_lma', sourcePort: 'out', target: 'wx4_lrep', targetPort: 'in' },
    { id: 'e-wx4lrep-wx4fmt', source: 'wx4_lrep', sourcePort: 'out', target: 'wx4_fmt', targetPort: 'in' },
    { id: 'e-wx4fmt-wx4msg', source: 'wx4_fmt', sourcePort: 'out', target: 'wx4_msg', targetPort: 'in' },
    // 链4 数据流
    { id: 'e-wx4load-wx4if-v', source: 'wx4_load', sourcePort: 'result', target: 'wx4_if', targetPort: 'value' },
    { id: 'e-wx4fmt-wx4msg-t', source: 'wx4_fmt', sourcePort: 'result', target: 'wx4_msg', targetPort: 'text' },
    { id: 'e-wx4load-wx4fmt-v1', source: 'wx4_load', sourcePort: 'result', target: 'wx4_fmt', targetPort: 'var1' },
    { id: 'e-wx4lma-wx4fmt-v2', source: 'wx4_lma', sourcePort: 'result', target: 'wx4_fmt', targetPort: 'var2' },
    { id: 'e-wx4lrep-wx4fmt-v3', source: 'wx4_lrep', sourcePort: 'result', target: 'wx4_fmt', targetPort: 'var3' },

    // ───── 链5 控制流：/切磋 ─────
    { id: 'e-wx5cmd-wx5uid', source: 'wx5_cmd', sourcePort: 'next', target: 'wx5_uid', targetPort: 'in' },
    { id: 'e-wx5uid-wx5load', source: 'wx5_uid', sourcePort: 'out', target: 'wx5_load', targetPort: 'in' },
    { id: 'e-wx5load-wx5if', source: 'wx5_load', sourcePort: 'out', target: 'wx5_if', targetPort: 'in' },
    { id: 'e-wx5if-wx5no', source: 'wx5_if', sourcePort: 'false', target: 'wx5_no', targetPort: 'in' },
    { id: 'e-wx5if-wx5lma', source: 'wx5_if', sourcePort: 'true', target: 'wx5_lma', targetPort: 'in' },
    { id: 'e-wx5lma-wx5if2', source: 'wx5_lma', sourcePort: 'out', target: 'wx5_if2', targetPort: 'in' },
    { id: 'e-wx5if2-wx5nofail', source: 'wx5_if2', sourcePort: 'false', target: 'wx5_nofail', targetPort: 'in' },
    { id: 'e-wx5if2-wx5rand', source: 'wx5_if2', sourcePort: 'true', target: 'wx5_rand', targetPort: 'in' },
    { id: 'e-wx5rand-wx5if3', source: 'wx5_rand', sourcePort: 'out', target: 'wx5_if3', targetPort: 'in' },
    // if3 true: 切磋胜利
    { id: 'e-wx5if3-wx5lrep1', source: 'wx5_if3', sourcePort: 'true', target: 'wx5_lrep1', targetPort: 'in' },
    { id: 'e-wx5lrep1-wx5math1', source: 'wx5_lrep1', sourcePort: 'out', target: 'wx5_math1', targetPort: 'in' },
    { id: 'e-wx5math1-wx5srep1', source: 'wx5_math1', sourcePort: 'out', target: 'wx5_srep1', targetPort: 'in' },
    { id: 'e-wx5srep1-wx5msg1', source: 'wx5_srep1', sourcePort: 'out', target: 'wx5_msg1', targetPort: 'in' },
    // if3 false: 切磋失败
    { id: 'e-wx5if3-wx5lrep2', source: 'wx5_if3', sourcePort: 'false', target: 'wx5_lrep2', targetPort: 'in' },
    { id: 'e-wx5lrep2-wx5math2', source: 'wx5_lrep2', sourcePort: 'out', target: 'wx5_math2', targetPort: 'in' },
    { id: 'e-wx5math2-wx5srep2', source: 'wx5_math2', sourcePort: 'out', target: 'wx5_srep2', targetPort: 'in' },
    { id: 'e-wx5srep2-wx5msg2', source: 'wx5_srep2', sourcePort: 'out', target: 'wx5_msg2', targetPort: 'in' },
    // 链5 数据流
    { id: 'e-wx5load-wx5if-v', source: 'wx5_load', sourcePort: 'result', target: 'wx5_if', targetPort: 'value' },
    { id: 'e-wx5lma-wx5if2-v', source: 'wx5_lma', sourcePort: 'result', target: 'wx5_if2', targetPort: 'value' },
    { id: 'e-wx5rand-wx5if3-v', source: 'wx5_rand', sourcePort: 'result', target: 'wx5_if3', targetPort: 'value' },
    { id: 'e-wx5lrep1-wx5math1-a', source: 'wx5_lrep1', sourcePort: 'result', target: 'wx5_math1', targetPort: 'v1' },
    { id: 'e-wx5math1-wx5srep1-v', source: 'wx5_math1', sourcePort: 'result', target: 'wx5_srep1', targetPort: 'value' },
    { id: 'e-wx5lrep2-wx5math2-a', source: 'wx5_lrep2', sourcePort: 'result', target: 'wx5_math2', targetPort: 'v1' },
    { id: 'e-wx5math2-wx5srep2-v', source: 'wx5_math2', sourcePort: 'result', target: 'wx5_srep2', targetPort: 'value' },

    // ───── 链6 控制流：/行走江湖 ─────
    { id: 'e-wx6cmd-wx6uid', source: 'wx6_cmd', sourcePort: 'next', target: 'wx6_uid', targetPort: 'in' },
    { id: 'e-wx6uid-wx6load', source: 'wx6_uid', sourcePort: 'out', target: 'wx6_load', targetPort: 'in' },
    { id: 'e-wx6load-wx6if', source: 'wx6_load', sourcePort: 'out', target: 'wx6_if', targetPort: 'in' },
    { id: 'e-wx6if-wx6no', source: 'wx6_if', sourcePort: 'false', target: 'wx6_no', targetPort: 'in' },
    { id: 'e-wx6if-wx6rand', source: 'wx6_if', sourcePort: 'true', target: 'wx6_rand', targetPort: 'in' },
    { id: 'e-wx6rand-wx6msg', source: 'wx6_rand', sourcePort: 'out', target: 'wx6_msg', targetPort: 'in' },
    // 链6 数据流
    { id: 'e-wx6load-wx6if-v', source: 'wx6_load', sourcePort: 'result', target: 'wx6_if', targetPort: 'value' },
    { id: 'e-wx6rand-wx6msg-t', source: 'wx6_rand', sourcePort: 'result', target: 'wx6_msg', targetPort: 'text' },

    // ───── 链7 控制流：/武学 ─────
    { id: 'e-wx7cmd-wx7uid', source: 'wx7_cmd', sourcePort: 'next', target: 'wx7_uid', targetPort: 'in' },
    { id: 'e-wx7uid-wx7load', source: 'wx7_uid', sourcePort: 'out', target: 'wx7_load', targetPort: 'in' },
    { id: 'e-wx7load-wx7if', source: 'wx7_load', sourcePort: 'out', target: 'wx7_if', targetPort: 'in' },
    { id: 'e-wx7if-wx7no', source: 'wx7_if', sourcePort: 'false', target: 'wx7_no', targetPort: 'in' },
    { id: 'e-wx7if-wx7lma', source: 'wx7_if', sourcePort: 'true', target: 'wx7_lma', targetPort: 'in' },
    { id: 'e-wx7lma-wx7lskill', source: 'wx7_lma', sourcePort: 'out', target: 'wx7_lskill', targetPort: 'in' },
    { id: 'e-wx7lskill-wx7fmt', source: 'wx7_lskill', sourcePort: 'out', target: 'wx7_fmt', targetPort: 'in' },
    { id: 'e-wx7fmt-wx7msg', source: 'wx7_fmt', sourcePort: 'out', target: 'wx7_msg', targetPort: 'in' },
    // 链7 数据流
    { id: 'e-wx7load-wx7if-v', source: 'wx7_load', sourcePort: 'result', target: 'wx7_if', targetPort: 'value' },
    { id: 'e-wx7fmt-wx7msg-t', source: 'wx7_fmt', sourcePort: 'result', target: 'wx7_msg', targetPort: 'text' },
    { id: 'e-wx7lma-wx7fmt-v1', source: 'wx7_lma', sourcePort: 'result', target: 'wx7_fmt', targetPort: 'var1' },
    { id: 'e-wx7lskill-wx7fmt-v2', source: 'wx7_lskill', sourcePort: 'result', target: 'wx7_fmt', targetPort: 'var2' }
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════════
// 所有玩法模板按 botType 索引
// 用户创建项目时选择 botType，系统从此映射加载对应模板。
// ════════════════════════════════════════════════════════════════
export const GAMEPLAY_TEMPLATES: Record<string, FlowTemplate> = {
  cultivation: CULTIVATION_TEMPLATE,
  wuxia: WUXIA_TEMPLATE
}
