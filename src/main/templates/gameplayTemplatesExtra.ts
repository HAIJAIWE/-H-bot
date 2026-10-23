// src/main/templates/gameplayTemplatesExtra.ts
// 卡牌收集 / 模拟经营 / 功能型 三种机器人类型的玩法模块模板。
// 每个模板是一个 FlowTemplate，包含 nodes 和 edges，定义节点控制流与数据流连接。
// 用户创建项目时选择 botType，系统自动加载对应模板。
import type { FlowTemplate } from '@shared/types/template'

// ════════════════════════════════════════════════════════════
// 卡牌收集模板 (CARD_TEMPLATE)
// 三条链：/抽卡（含保底）、/创建角色、/图鉴
// ════════════════════════════════════════════════════════════
export const CARD_TEMPLATE: FlowTemplate = {
  id: 'gameplay-card',
  name: '卡牌收集机器人',
  description: '卡牌收集系统：抽卡（含保底机制）、创建角色、查看图鉴。使用持久化存储按QQ号隔离数据。',
  botCategory: 'game',
  category: '指令',
  tags: ['卡牌', '抽卡', '保底', '图鉴', '指令', '持久化'],
  author: '内置',
  nodes: [
    // ─── 链1 · /抽卡 抽卡系统（含保底机制） ───
    { id: 'ca1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '抽卡指令', nodeKind: 'on_command', config: { command: '抽卡', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'ca1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'ca1_load', type: 'data', position: { x: 500, y: 0 }, data: { label: '读抽卡数', nodeKind: 'load_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca1_if', type: 'logic', position: { x: 750, y: 0 }, data: { label: '有角色?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建角色
    { id: 'ca1_no', type: 'action', position: { x: 1000, y: 150 }, data: { label: '未创建角色', nodeKind: 'send_message', config: { text: '未创建角色，输入 /创建角色' }, inputs: [], outputs: [] } },
    // true: 检查保底
    { id: 'ca1_load_pity', type: 'data', position: { x: 1000, y: -150 }, data: { label: '读保底数', nodeKind: 'load_persistent', config: { key: 'gacha_pity', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca1_if_pity', type: 'logic', position: { x: 1250, y: -150 }, data: { label: '保底>=10?', nodeKind: 'if_branch', config: { expression: 'value >= 10' }, inputs: [], outputs: [] } },
    // true(保底): 随机SSR + 重置保底 + 抽卡数+1
    { id: 'ca1_pity_rand', type: 'logic', position: { x: 1500, y: -300 }, data: { label: '保底SSR', nodeKind: 'random', config: { mode: 'choice', list: ['SSR传说卡', 'SSR神话卡'] }, inputs: [], outputs: [] } },
    { id: 'ca1_pity_save0', type: 'data', position: { x: 1750, y: -300 }, data: { label: '重置保底', nodeKind: 'save_persistent', config: { key: 'gacha_pity', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca1_pity_math', type: 'logic', position: { x: 2000, y: -300 }, data: { label: '抽卡数+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'ca1_pity_save', type: 'data', position: { x: 2250, y: -300 }, data: { label: '存抽卡数', nodeKind: 'save_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca1_pity_fmt', type: 'logic', position: { x: 2500, y: -300 }, data: { label: '格式化保底', nodeKind: 'format_text', config: { template: '🎉 保底触发！抽到 {var1}' }, inputs: [], outputs: [] } },
    { id: 'ca1_pity_msg', type: 'action', position: { x: 2750, y: -300 }, data: { label: '保底消息', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
    // false(普通): 权重随机 + 保底+1 + 抽卡数+1
    { id: 'ca1_norm_rand', type: 'logic', position: { x: 1500, y: 0 }, data: { label: '普通抽卡', nodeKind: 'random', config: { mode: 'weighted', items: [{ value: 'N普通卡', weight: 60 }, { value: 'R稀有卡', weight: 30 }, { value: 'SR史诗卡', weight: 9 }, { value: 'SSR传说卡', weight: 1 }] }, inputs: [], outputs: [] } },
    { id: 'ca1_norm_math_p', type: 'logic', position: { x: 1750, y: 0 }, data: { label: '保底+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'ca1_norm_save_p', type: 'data', position: { x: 2000, y: 0 }, data: { label: '存保底', nodeKind: 'save_persistent', config: { key: 'gacha_pity', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca1_norm_math_c', type: 'logic', position: { x: 2250, y: 0 }, data: { label: '抽卡数+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'ca1_norm_save_c', type: 'data', position: { x: 2500, y: 0 }, data: { label: '存抽卡数', nodeKind: 'save_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca1_norm_fmt', type: 'logic', position: { x: 2750, y: 0 }, data: { label: '格式化抽卡', nodeKind: 'format_text', config: { template: '抽到 {var1}' }, inputs: [], outputs: [] } },
    { id: 'ca1_norm_msg', type: 'action', position: { x: 3000, y: 0 }, data: { label: '抽卡消息', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ─── 链2 · /创建角色 初始化卡牌账号 ───
    { id: 'ca2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '创建角色', nodeKind: 'on_command', config: { command: '创建角色', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'ca2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'ca2_load', type: 'data', position: { x: 500, y: 350 }, data: { label: '读抽卡数', nodeKind: 'load_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca2_if', type: 'logic', position: { x: 750, y: 350 }, data: { label: '已有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // true: 已创建
    { id: 'ca2_exist', type: 'action', position: { x: 1000, y: 250 }, data: { label: '已创建', nodeKind: 'send_message', config: { text: '已创建账号' }, inputs: [], outputs: [] } },
    // false: 初始化
    { id: 'ca2_s_count', type: 'data', position: { x: 1000, y: 450 }, data: { label: '存抽卡数', nodeKind: 'save_persistent', config: { key: 'card_count', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca2_s_pity', type: 'data', position: { x: 1250, y: 450 }, data: { label: '存保底', nodeKind: 'save_persistent', config: { key: 'gacha_pity', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca2_s_total', type: 'data', position: { x: 1500, y: 450 }, data: { label: '存图鉴总数', nodeKind: 'save_persistent', config: { key: 'collection_total', value: 100, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca2_msg', type: 'action', position: { x: 1750, y: 450 }, data: { label: '创建成功', nodeKind: 'send_message', config: { text: '账号创建成功！输入 /抽卡 开始抽卡' }, inputs: [], outputs: [] } },

    // ─── 链3 · /图鉴 查看收藏 ───
    { id: 'ca3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '图鉴指令', nodeKind: 'on_command', config: { command: '图鉴', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'ca3_uid', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'ca3_load', type: 'data', position: { x: 500, y: 700 }, data: { label: '读抽卡数', nodeKind: 'load_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca3_if', type: 'logic', position: { x: 750, y: 700 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建
    { id: 'ca3_no', type: 'action', position: { x: 1000, y: 800 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建账号' }, inputs: [], outputs: [] } },
    // true: 显示收藏
    { id: 'ca3_load_total', type: 'data', position: { x: 1000, y: 600 }, data: { label: '读图鉴总数', nodeKind: 'load_persistent', config: { key: 'collection_total', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca3_fmt', type: 'logic', position: { x: 1250, y: 600 }, data: { label: '格式化收藏', nodeKind: 'format_text', config: { template: '📊 卡牌收藏\n已拥有：{var1}\n图鉴总数：{var2}' }, inputs: [], outputs: [] } },
    { id: 'ca3_msg', type: 'action', position: { x: 1500, y: 600 }, data: { label: '发送收藏', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ─── 链4 · /强化 消耗碎片强化卡牌 ───
    { id: 'ca4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: '强化指令', nodeKind: 'on_command', config: { command: '强化', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'ca4_uid', type: 'logic', position: { x: 250, y: 1050 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'ca4_load', type: 'data', position: { x: 500, y: 1050 }, data: { label: '读卡牌数', nodeKind: 'load_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca4_if', type: 'logic', position: { x: 750, y: 1050 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建账号
    { id: 'ca4_no', type: 'action', position: { x: 1000, y: 1200 }, data: { label: '未创建账号', nodeKind: 'send_message', config: { text: '未创建账号，输入 /创建角色' }, inputs: [], outputs: [] } },
    // true: 检查碎片
    { id: 'ca4_load_frag', type: 'data', position: { x: 1000, y: 900 }, data: { label: '读碎片', nodeKind: 'load_persistent', config: { key: 'fragments', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca4_if_frag', type: 'logic', position: { x: 1250, y: 900 }, data: { label: '碎片>=10?', nodeKind: 'if_branch', config: { expression: 'value >= 10' }, inputs: [], outputs: [] } },
    // false: 碎片不足
    { id: 'ca4_no_frag', type: 'action', position: { x: 1500, y: 1050 }, data: { label: '碎片不足', nodeKind: 'send_message', config: { text: '碎片不足，需要10个碎片' }, inputs: [], outputs: [] } },
    // true: 扣碎片 + 卡牌数+1
    { id: 'ca4_math_frag', type: 'logic', position: { x: 1500, y: 750 }, data: { label: '碎片-10', nodeKind: 'expression_eval', config: { expression: 'v1 - 10' }, inputs: [], outputs: [] } },
    { id: 'ca4_save_frag', type: 'data', position: { x: 1750, y: 750 }, data: { label: '存碎片', nodeKind: 'save_persistent', config: { key: 'fragments', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca4_math_card', type: 'logic', position: { x: 2000, y: 750 }, data: { label: '卡牌数+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'ca4_save_card', type: 'data', position: { x: 2250, y: 750 }, data: { label: '存卡牌数', nodeKind: 'save_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca4_msg', type: 'action', position: { x: 2500, y: 750 }, data: { label: '强化成功', nodeKind: 'send_message', config: { text: '强化成功！消耗10碎片，卡牌+1' }, inputs: [], outputs: [] } },

    // ─── 链5 · /卡组 查看卡组 ───
    { id: 'ca5_cmd', type: 'trigger', position: { x: 0, y: 1400 }, data: { label: '卡组指令', nodeKind: 'on_command', config: { command: '卡组', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'ca5_uid', type: 'logic', position: { x: 250, y: 1400 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'ca5_load', type: 'data', position: { x: 500, y: 1400 }, data: { label: '读卡牌数', nodeKind: 'load_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca5_if', type: 'logic', position: { x: 750, y: 1400 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建
    { id: 'ca5_no', type: 'action', position: { x: 1000, y: 1550 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建账号' }, inputs: [], outputs: [] } },
    // true: 显示卡组
    { id: 'ca5_load_frag', type: 'data', position: { x: 1000, y: 1250 }, data: { label: '读碎片', nodeKind: 'load_persistent', config: { key: 'fragments', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca5_load_pity', type: 'data', position: { x: 1250, y: 1250 }, data: { label: '读保底数', nodeKind: 'load_persistent', config: { key: 'gacha_pity', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca5_fmt', type: 'logic', position: { x: 1500, y: 1250 }, data: { label: '格式化卡组', nodeKind: 'format_text', config: { template: '📊 卡组信息\n卡牌数：{var1}\n碎片：{var2}\n保底进度：{var3}/10' }, inputs: [], outputs: [] } },
    { id: 'ca5_msg', type: 'action', position: { x: 1750, y: 1250 }, data: { label: '发送卡组', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ─── 链6 · /碎片 每日领碎片 ───
    { id: 'ca6_cmd', type: 'trigger', position: { x: 0, y: 1750 }, data: { label: '碎片指令', nodeKind: 'on_command', config: { command: '碎片', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'ca6_uid', type: 'logic', position: { x: 250, y: 1750 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'ca6_load', type: 'data', position: { x: 500, y: 1750 }, data: { label: '读卡牌数', nodeKind: 'load_persistent', config: { key: 'card_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca6_if', type: 'logic', position: { x: 750, y: 1750 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建
    { id: 'ca6_no', type: 'action', position: { x: 1000, y: 1900 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建账号' }, inputs: [], outputs: [] } },
    // true: 领碎片
    { id: 'ca6_load_frag', type: 'data', position: { x: 1000, y: 1600 }, data: { label: '读碎片', nodeKind: 'load_persistent', config: { key: 'fragments', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca6_math', type: 'logic', position: { x: 1250, y: 1600 }, data: { label: '碎片+5', nodeKind: 'expression_eval', config: { expression: 'v1 + 5' }, inputs: [], outputs: [] } },
    { id: 'ca6_save', type: 'data', position: { x: 1500, y: 1600 }, data: { label: '存碎片', nodeKind: 'save_persistent', config: { key: 'fragments', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'ca6_fmt', type: 'logic', position: { x: 1750, y: 1600 }, data: { label: '格式化领取', nodeKind: 'format_text', config: { template: '领取5个碎片！当前碎片：{var1}' }, inputs: [], outputs: [] } },
    { id: 'ca6_msg', type: 'action', position: { x: 2000, y: 1600 }, data: { label: '发送领取', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } }
  ],
  edges: [
    // ── 链1 控制流：/抽卡 ──
    { id: 'e-ca1cmd-ca1uid', source: 'ca1_cmd', sourcePort: 'next', target: 'ca1_uid', targetPort: 'in' },
    { id: 'e-ca1uid-ca1load', source: 'ca1_uid', sourcePort: 'out', target: 'ca1_load', targetPort: 'in' },
    { id: 'e-ca1load-ca1if', source: 'ca1_load', sourcePort: 'out', target: 'ca1_if', targetPort: 'in' },
    { id: 'e-ca1if-ca1no', source: 'ca1_if', sourcePort: 'false', target: 'ca1_no', targetPort: 'in' },
    { id: 'e-ca1if-ca1loadpity', source: 'ca1_if', sourcePort: 'true', target: 'ca1_load_pity', targetPort: 'in' },
    { id: 'e-ca1loadpity-ca1ifpity', source: 'ca1_load_pity', sourcePort: 'out', target: 'ca1_if_pity', targetPort: 'in' },
    // 保底分支
    { id: 'e-ca1ifpity-ca1pityrand', source: 'ca1_if_pity', sourcePort: 'true', target: 'ca1_pity_rand', targetPort: 'in' },
    { id: 'e-ca1pityrand-ca1pitysave0', source: 'ca1_pity_rand', sourcePort: 'out', target: 'ca1_pity_save0', targetPort: 'in' },
    { id: 'e-ca1pitysave0-ca1pitymath', source: 'ca1_pity_save0', sourcePort: 'out', target: 'ca1_pity_math', targetPort: 'in' },
    { id: 'e-ca1pitymath-ca1pitysave', source: 'ca1_pity_math', sourcePort: 'out', target: 'ca1_pity_save', targetPort: 'in' },
    { id: 'e-ca1pitysave-ca1pityfmt', source: 'ca1_pity_save', sourcePort: 'out', target: 'ca1_pity_fmt', targetPort: 'in' },
    { id: 'e-ca1pityfmt-ca1pitymsg', source: 'ca1_pity_fmt', sourcePort: 'out', target: 'ca1_pity_msg', targetPort: 'in' },
    { id: 'e-ca1pityrand-ca1pityfmt-v1', source: 'ca1_pity_rand', sourcePort: 'result', target: 'ca1_pity_fmt', targetPort: 'var1' },
    { id: 'e-ca1pityfmt-ca1pitymsg-t', source: 'ca1_pity_fmt', sourcePort: 'result', target: 'ca1_pity_msg', targetPort: 'text' },
    // 普通分支
    { id: 'e-ca1ifpity-ca1normrand', source: 'ca1_if_pity', sourcePort: 'false', target: 'ca1_norm_rand', targetPort: 'in' },
    { id: 'e-ca1normrand-ca1normmathp', source: 'ca1_norm_rand', sourcePort: 'out', target: 'ca1_norm_math_p', targetPort: 'in' },
    { id: 'e-ca1normmathp-ca1normsavep', source: 'ca1_norm_math_p', sourcePort: 'out', target: 'ca1_norm_save_p', targetPort: 'in' },
    { id: 'e-ca1normsavep-ca1normmathc', source: 'ca1_norm_save_p', sourcePort: 'out', target: 'ca1_norm_math_c', targetPort: 'in' },
    { id: 'e-ca1normmathc-ca1normsavec', source: 'ca1_norm_math_c', sourcePort: 'out', target: 'ca1_norm_save_c', targetPort: 'in' },
    { id: 'e-ca1normsavec-ca1normfmt', source: 'ca1_norm_save_c', sourcePort: 'out', target: 'ca1_norm_fmt', targetPort: 'in' },
    { id: 'e-ca1normfmt-ca1normmsg', source: 'ca1_norm_fmt', sourcePort: 'out', target: 'ca1_norm_msg', targetPort: 'in' },
    { id: 'e-ca1normrand-ca1normfmt-v1', source: 'ca1_norm_rand', sourcePort: 'result', target: 'ca1_norm_fmt', targetPort: 'var1' },
    { id: 'e-ca1normfmt-ca1normmsg-t', source: 'ca1_norm_fmt', sourcePort: 'result', target: 'ca1_norm_msg', targetPort: 'text' },
    // 链1 数据流
    { id: 'e-ca1load-ca1if-v', source: 'ca1_load', sourcePort: 'result', target: 'ca1_if', targetPort: 'value' },
    { id: 'e-ca1loadpity-ca1ifpity-v', source: 'ca1_load_pity', sourcePort: 'result', target: 'ca1_if_pity', targetPort: 'value' },
    { id: 'e-ca1load-ca1pitymath-a', source: 'ca1_load', sourcePort: 'result', target: 'ca1_pity_math', targetPort: 'v1' },
    { id: 'e-ca1pitymath-ca1pitysave-v', source: 'ca1_pity_math', sourcePort: 'result', target: 'ca1_pity_save', targetPort: 'value' },
    { id: 'e-ca1loadpity-ca1normmathp-a', source: 'ca1_load_pity', sourcePort: 'result', target: 'ca1_norm_math_p', targetPort: 'v1' },
    { id: 'e-ca1normmathp-ca1normsavep-v', source: 'ca1_norm_math_p', sourcePort: 'result', target: 'ca1_norm_save_p', targetPort: 'value' },
    { id: 'e-ca1load-ca1normmathc-a', source: 'ca1_load', sourcePort: 'result', target: 'ca1_norm_math_c', targetPort: 'v1' },
    { id: 'e-ca1normmathc-ca1normsavec-v', source: 'ca1_norm_math_c', sourcePort: 'result', target: 'ca1_norm_save_c', targetPort: 'value' },

    // ── 链2 控制流：/创建角色 ──
    { id: 'e-ca2cmd-ca2uid', source: 'ca2_cmd', sourcePort: 'next', target: 'ca2_uid', targetPort: 'in' },
    { id: 'e-ca2uid-ca2load', source: 'ca2_uid', sourcePort: 'out', target: 'ca2_load', targetPort: 'in' },
    { id: 'e-ca2load-ca2if', source: 'ca2_load', sourcePort: 'out', target: 'ca2_if', targetPort: 'in' },
    { id: 'e-ca2if-ca2exist', source: 'ca2_if', sourcePort: 'true', target: 'ca2_exist', targetPort: 'in' },
    { id: 'e-ca2if-ca2scount', source: 'ca2_if', sourcePort: 'false', target: 'ca2_s_count', targetPort: 'in' },
    { id: 'e-ca2scount-ca2spity', source: 'ca2_s_count', sourcePort: 'out', target: 'ca2_s_pity', targetPort: 'in' },
    { id: 'e-ca2spity-ca2stotal', source: 'ca2_s_pity', sourcePort: 'out', target: 'ca2_s_total', targetPort: 'in' },
    { id: 'e-ca2stotal-ca2msg', source: 'ca2_s_total', sourcePort: 'out', target: 'ca2_msg', targetPort: 'in' },
    // 链2 数据流
    { id: 'e-ca2load-ca2if-v', source: 'ca2_load', sourcePort: 'result', target: 'ca2_if', targetPort: 'value' },

    // ── 链3 控制流：/图鉴 ──
    { id: 'e-ca3cmd-ca3uid', source: 'ca3_cmd', sourcePort: 'next', target: 'ca3_uid', targetPort: 'in' },
    { id: 'e-ca3uid-ca3load', source: 'ca3_uid', sourcePort: 'out', target: 'ca3_load', targetPort: 'in' },
    { id: 'e-ca3load-ca3if', source: 'ca3_load', sourcePort: 'out', target: 'ca3_if', targetPort: 'in' },
    { id: 'e-ca3if-ca3no', source: 'ca3_if', sourcePort: 'false', target: 'ca3_no', targetPort: 'in' },
    { id: 'e-ca3if-ca3loadtotal', source: 'ca3_if', sourcePort: 'true', target: 'ca3_load_total', targetPort: 'in' },
    { id: 'e-ca3loadtotal-ca3fmt', source: 'ca3_load_total', sourcePort: 'out', target: 'ca3_fmt', targetPort: 'in' },
    { id: 'e-ca3fmt-ca3msg', source: 'ca3_fmt', sourcePort: 'out', target: 'ca3_msg', targetPort: 'in' },
    // 链3 数据流
    { id: 'e-ca3load-ca3if-v', source: 'ca3_load', sourcePort: 'result', target: 'ca3_if', targetPort: 'value' },
    { id: 'e-ca3load-ca3fmt-v1', source: 'ca3_load', sourcePort: 'result', target: 'ca3_fmt', targetPort: 'var1' },
    { id: 'e-ca3loadtotal-ca3fmt-v2', source: 'ca3_load_total', sourcePort: 'result', target: 'ca3_fmt', targetPort: 'var2' },
    { id: 'e-ca3fmt-ca3msg-t', source: 'ca3_fmt', sourcePort: 'result', target: 'ca3_msg', targetPort: 'text' },

    // ── 链4 控制流：/强化 ──
    { id: 'e-ca4cmd-ca4uid', source: 'ca4_cmd', sourcePort: 'next', target: 'ca4_uid', targetPort: 'in' },
    { id: 'e-ca4uid-ca4load', source: 'ca4_uid', sourcePort: 'out', target: 'ca4_load', targetPort: 'in' },
    { id: 'e-ca4load-ca4if', source: 'ca4_load', sourcePort: 'out', target: 'ca4_if', targetPort: 'in' },
    { id: 'e-ca4if-ca4no', source: 'ca4_if', sourcePort: 'false', target: 'ca4_no', targetPort: 'in' },
    { id: 'e-ca4if-ca4loadfrag', source: 'ca4_if', sourcePort: 'true', target: 'ca4_load_frag', targetPort: 'in' },
    { id: 'e-ca4loadfrag-ca4iffrag', source: 'ca4_load_frag', sourcePort: 'out', target: 'ca4_if_frag', targetPort: 'in' },
    { id: 'e-ca4iffrag-ca4nofrag', source: 'ca4_if_frag', sourcePort: 'false', target: 'ca4_no_frag', targetPort: 'in' },
    { id: 'e-ca4iffrag-ca4mathfrag', source: 'ca4_if_frag', sourcePort: 'true', target: 'ca4_math_frag', targetPort: 'in' },
    { id: 'e-ca4mathfrag-ca4savefrag', source: 'ca4_math_frag', sourcePort: 'out', target: 'ca4_save_frag', targetPort: 'in' },
    { id: 'e-ca4savefrag-ca4mathcard', source: 'ca4_save_frag', sourcePort: 'out', target: 'ca4_math_card', targetPort: 'in' },
    { id: 'e-ca4mathcard-ca4savecard', source: 'ca4_math_card', sourcePort: 'out', target: 'ca4_save_card', targetPort: 'in' },
    { id: 'e-ca4savecard-ca4msg', source: 'ca4_save_card', sourcePort: 'out', target: 'ca4_msg', targetPort: 'in' },
    // 链4 数据流
    { id: 'e-ca4load-ca4if-v', source: 'ca4_load', sourcePort: 'result', target: 'ca4_if', targetPort: 'value' },
    { id: 'e-ca4loadfrag-ca4iffrag-v', source: 'ca4_load_frag', sourcePort: 'result', target: 'ca4_if_frag', targetPort: 'value' },
    { id: 'e-ca4loadfrag-ca4mathfrag-a', source: 'ca4_load_frag', sourcePort: 'result', target: 'ca4_math_frag', targetPort: 'v1' },
    { id: 'e-ca4mathfrag-ca4savefrag-v', source: 'ca4_math_frag', sourcePort: 'result', target: 'ca4_save_frag', targetPort: 'value' },
    { id: 'e-ca4load-ca4mathcard-a', source: 'ca4_load', sourcePort: 'result', target: 'ca4_math_card', targetPort: 'v1' },
    { id: 'e-ca4mathcard-ca4savecard-v', source: 'ca4_math_card', sourcePort: 'result', target: 'ca4_save_card', targetPort: 'value' },

    // ── 链5 控制流：/卡组 ──
    { id: 'e-ca5cmd-ca5uid', source: 'ca5_cmd', sourcePort: 'next', target: 'ca5_uid', targetPort: 'in' },
    { id: 'e-ca5uid-ca5load', source: 'ca5_uid', sourcePort: 'out', target: 'ca5_load', targetPort: 'in' },
    { id: 'e-ca5load-ca5if', source: 'ca5_load', sourcePort: 'out', target: 'ca5_if', targetPort: 'in' },
    { id: 'e-ca5if-ca5no', source: 'ca5_if', sourcePort: 'false', target: 'ca5_no', targetPort: 'in' },
    { id: 'e-ca5if-ca5loadfrag', source: 'ca5_if', sourcePort: 'true', target: 'ca5_load_frag', targetPort: 'in' },
    { id: 'e-ca5loadfrag-ca5loadpity', source: 'ca5_load_frag', sourcePort: 'out', target: 'ca5_load_pity', targetPort: 'in' },
    { id: 'e-ca5loadpity-ca5fmt', source: 'ca5_load_pity', sourcePort: 'out', target: 'ca5_fmt', targetPort: 'in' },
    { id: 'e-ca5fmt-ca5msg', source: 'ca5_fmt', sourcePort: 'out', target: 'ca5_msg', targetPort: 'in' },
    // 链5 数据流
    { id: 'e-ca5load-ca5if-v', source: 'ca5_load', sourcePort: 'result', target: 'ca5_if', targetPort: 'value' },
    { id: 'e-ca5load-ca5fmt-v1', source: 'ca5_load', sourcePort: 'result', target: 'ca5_fmt', targetPort: 'var1' },
    { id: 'e-ca5loadfrag-ca5fmt-v2', source: 'ca5_load_frag', sourcePort: 'result', target: 'ca5_fmt', targetPort: 'var2' },
    { id: 'e-ca5loadpity-ca5fmt-v3', source: 'ca5_load_pity', sourcePort: 'result', target: 'ca5_fmt', targetPort: 'var3' },
    { id: 'e-ca5fmt-ca5msg-t', source: 'ca5_fmt', sourcePort: 'result', target: 'ca5_msg', targetPort: 'text' },

    // ── 链6 控制流：/碎片 ──
    { id: 'e-ca6cmd-ca6uid', source: 'ca6_cmd', sourcePort: 'next', target: 'ca6_uid', targetPort: 'in' },
    { id: 'e-ca6uid-ca6load', source: 'ca6_uid', sourcePort: 'out', target: 'ca6_load', targetPort: 'in' },
    { id: 'e-ca6load-ca6if', source: 'ca6_load', sourcePort: 'out', target: 'ca6_if', targetPort: 'in' },
    { id: 'e-ca6if-ca6no', source: 'ca6_if', sourcePort: 'false', target: 'ca6_no', targetPort: 'in' },
    { id: 'e-ca6if-ca6loadfrag', source: 'ca6_if', sourcePort: 'true', target: 'ca6_load_frag', targetPort: 'in' },
    { id: 'e-ca6loadfrag-ca6math', source: 'ca6_load_frag', sourcePort: 'out', target: 'ca6_math', targetPort: 'in' },
    { id: 'e-ca6math-ca6save', source: 'ca6_math', sourcePort: 'out', target: 'ca6_save', targetPort: 'in' },
    { id: 'e-ca6save-ca6fmt', source: 'ca6_save', sourcePort: 'out', target: 'ca6_fmt', targetPort: 'in' },
    { id: 'e-ca6fmt-ca6msg', source: 'ca6_fmt', sourcePort: 'out', target: 'ca6_msg', targetPort: 'in' },
    // 链6 数据流
    { id: 'e-ca6load-ca6if-v', source: 'ca6_load', sourcePort: 'result', target: 'ca6_if', targetPort: 'value' },
    { id: 'e-ca6loadfrag-ca6math-a', source: 'ca6_load_frag', sourcePort: 'result', target: 'ca6_math', targetPort: 'v1' },
    { id: 'e-ca6loadfrag-ca6fmt-v1', source: 'ca6_load_frag', sourcePort: 'result', target: 'ca6_fmt', targetPort: 'var1' },
    { id: 'e-ca6math-ca6save-v', source: 'ca6_math', sourcePort: 'result', target: 'ca6_save', targetPort: 'value' }
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════
// 模拟经营模板 (MANAGEMENT_TEMPLATE)
// 三条链：/建造、/创建账号、/产业
// ════════════════════════════════════════════════════════════
export const MANAGEMENT_TEMPLATE: FlowTemplate = {
  id: 'gameplay-management',
  name: '模拟经营机器人',
  description: '模拟经营系统：建造建筑（消耗金币）、创建账号、查看产业。使用持久化存储按QQ号隔离数据。',
  botCategory: 'game',
  category: '指令',
  tags: ['经营', '建造', '金币', '产业', '指令', '持久化'],
  author: '内置',
  nodes: [
    // ─── 链1 · /建造 建造建筑 ───
    { id: 'mg1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '建造指令', nodeKind: 'on_command', config: { command: '建造', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'mg1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'mg1_load', type: 'data', position: { x: 500, y: 0 }, data: { label: '读建筑数', nodeKind: 'load_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg1_if', type: 'logic', position: { x: 750, y: 0 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建账号
    { id: 'mg1_no', type: 'action', position: { x: 1000, y: 150 }, data: { label: '未创建账号', nodeKind: 'send_message', config: { text: '未创建账号，输入 /创建账号' }, inputs: [], outputs: [] } },
    // true: 检查金币
    { id: 'mg1_load_gold', type: 'data', position: { x: 1000, y: -150 }, data: { label: '读金币', nodeKind: 'load_persistent', config: { key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg1_if_gold', type: 'logic', position: { x: 1250, y: -150 }, data: { label: '金币>=100?', nodeKind: 'if_branch', config: { expression: 'value >= 100' }, inputs: [], outputs: [] } },
    // false: 金币不足
    { id: 'mg1_no_gold', type: 'action', position: { x: 1500, y: 0 }, data: { label: '金币不足', nodeKind: 'send_message', config: { text: '金币不足，需要100金币' }, inputs: [], outputs: [] } },
    // true: 扣金币 + 建筑数+1 + 库存归零
    { id: 'mg1_math_gold', type: 'logic', position: { x: 1500, y: -300 }, data: { label: '金币-100', nodeKind: 'expression_eval', config: { expression: 'v1 - 100' }, inputs: [], outputs: [] } },
    { id: 'mg1_save_gold', type: 'data', position: { x: 1750, y: -300 }, data: { label: '存金币', nodeKind: 'save_persistent', config: { key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg1_math_bc', type: 'logic', position: { x: 2000, y: -300 }, data: { label: '建筑数+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'mg1_save_bc', type: 'data', position: { x: 2250, y: -300 }, data: { label: '存建筑数', nodeKind: 'save_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg1_save_stock', type: 'data', position: { x: 2500, y: -300 }, data: { label: '库存归零', nodeKind: 'save_persistent', config: { key: 'stock', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg1_msg', type: 'action', position: { x: 2750, y: -300 }, data: { label: '建造成功', nodeKind: 'send_message', config: { text: '建筑建造成功！建筑数+1' }, inputs: [], outputs: [] } },

    // ─── 链2 · /创建账号 初始化经营账号 ───
    { id: 'mg2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '创建账号', nodeKind: 'on_command', config: { command: '创建账号', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'mg2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'mg2_load', type: 'data', position: { x: 500, y: 350 }, data: { label: '读建筑数', nodeKind: 'load_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg2_if', type: 'logic', position: { x: 750, y: 350 }, data: { label: '已有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // true: 已创建
    { id: 'mg2_exist', type: 'action', position: { x: 1000, y: 250 }, data: { label: '已创建', nodeKind: 'send_message', config: { text: '已创建账号' }, inputs: [], outputs: [] } },
    // false: 初始化
    { id: 'mg2_s_bc', type: 'data', position: { x: 1000, y: 450 }, data: { label: '存建筑数', nodeKind: 'save_persistent', config: { key: 'building_count', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg2_s_gold', type: 'data', position: { x: 1250, y: 450 }, data: { label: '存金币', nodeKind: 'save_persistent', config: { key: 'gold', value: 500, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg2_s_stock', type: 'data', position: { x: 1500, y: 450 }, data: { label: '存库存', nodeKind: 'save_persistent', config: { key: 'stock', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg2_s_pros', type: 'data', position: { x: 1750, y: 450 }, data: { label: '存繁荣度', nodeKind: 'save_persistent', config: { key: 'prosperity', value: 0, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg2_msg', type: 'action', position: { x: 2000, y: 450 }, data: { label: '创建成功', nodeKind: 'send_message', config: { text: '账号创建成功！初始金币500，输入 /建造 开始经营' }, inputs: [], outputs: [] } },

    // ─── 链3 · /产业 查看产业 ───
    { id: 'mg3_cmd', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '产业指令', nodeKind: 'on_command', config: { command: '产业', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'mg3_uid', type: 'logic', position: { x: 250, y: 700 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'mg3_load', type: 'data', position: { x: 500, y: 700 }, data: { label: '读建筑数', nodeKind: 'load_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg3_if', type: 'logic', position: { x: 750, y: 700 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建
    { id: 'mg3_no', type: 'action', position: { x: 1000, y: 800 }, data: { label: '未创建', nodeKind: 'send_message', config: { text: '未创建账号' }, inputs: [], outputs: [] } },
    // true: 显示产业
    { id: 'mg3_load_gold', type: 'data', position: { x: 1000, y: 600 }, data: { label: '读金币', nodeKind: 'load_persistent', config: { key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg3_load_stock', type: 'data', position: { x: 1250, y: 600 }, data: { label: '读库存', nodeKind: 'load_persistent', config: { key: 'stock', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg3_fmt', type: 'logic', position: { x: 1500, y: 600 }, data: { label: '格式化产业', nodeKind: 'format_text', config: { template: '🏭 你的产业\n建筑数：{var1}\n金币：{var2}\n库存：{var3}' }, inputs: [], outputs: [] } },
    { id: 'mg3_msg', type: 'action', position: { x: 1750, y: 600 }, data: { label: '发送产业', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },

    // ─── 链4 · /生产 生产商品 ───
    { id: 'mg4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: '生产指令', nodeKind: 'on_command', config: { command: '生产', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'mg4_uid', type: 'logic', position: { x: 250, y: 1050 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'mg4_load', type: 'data', position: { x: 500, y: 1050 }, data: { label: '读建筑数', nodeKind: 'load_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg4_if', type: 'logic', position: { x: 750, y: 1050 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建账号
    { id: 'mg4_no', type: 'action', position: { x: 1000, y: 1200 }, data: { label: '未创建账号', nodeKind: 'send_message', config: { text: '未创建账号' }, inputs: [], outputs: [] } },
    // true: 检查建筑数
    { id: 'mg4_if_bc', type: 'logic', position: { x: 1000, y: 900 }, data: { label: '建筑数>0?', nodeKind: 'if_branch', config: { expression: 'value > 0' }, inputs: [], outputs: [] } },
    // false: 没有建筑
    { id: 'mg4_no_bc', type: 'action', position: { x: 1250, y: 1050 }, data: { label: '没有建筑', nodeKind: 'send_message', config: { text: '没有建筑，/建造 先建造' }, inputs: [], outputs: [] } },
    // true: 库存+10
    { id: 'mg4_load_stock', type: 'data', position: { x: 1250, y: 750 }, data: { label: '读库存', nodeKind: 'load_persistent', config: { key: 'stock', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg4_math', type: 'logic', position: { x: 1500, y: 750 }, data: { label: '库存+10', nodeKind: 'expression_eval', config: { expression: 'v1 + 10' }, inputs: [], outputs: [] } },
    { id: 'mg4_save', type: 'data', position: { x: 1750, y: 750 }, data: { label: '存库存', nodeKind: 'save_persistent', config: { key: 'stock', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg4_msg', type: 'action', position: { x: 2000, y: 750 }, data: { label: '生产成功', nodeKind: 'send_message', config: { text: '生产成功！库存+10' }, inputs: [], outputs: [] } },

    // ─── 链5 · /卖出 出售商品 ───
    { id: 'mg5_cmd', type: 'trigger', position: { x: 0, y: 1400 }, data: { label: '卖出指令', nodeKind: 'on_command', config: { command: '卖出', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'mg5_uid', type: 'logic', position: { x: 250, y: 1400 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'mg5_load', type: 'data', position: { x: 500, y: 1400 }, data: { label: '读建筑数', nodeKind: 'load_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg5_if', type: 'logic', position: { x: 750, y: 1400 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建账号
    { id: 'mg5_no', type: 'action', position: { x: 1000, y: 1550 }, data: { label: '未创建账号', nodeKind: 'send_message', config: { text: '未创建账号' }, inputs: [], outputs: [] } },
    // true: 检查库存
    { id: 'mg5_load_stock', type: 'data', position: { x: 1000, y: 1250 }, data: { label: '读库存', nodeKind: 'load_persistent', config: { key: 'stock', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg5_if_stock', type: 'logic', position: { x: 1250, y: 1250 }, data: { label: '库存>=10?', nodeKind: 'if_branch', config: { expression: 'value >= 10' }, inputs: [], outputs: [] } },
    // false: 库存不足
    { id: 'mg5_no_stock', type: 'action', position: { x: 1500, y: 1400 }, data: { label: '库存不足', nodeKind: 'send_message', config: { text: '库存不足，需要10个商品' }, inputs: [], outputs: [] } },
    // true: 扣库存 + 加金币
    { id: 'mg5_math_stock', type: 'logic', position: { x: 1500, y: 1100 }, data: { label: '库存-10', nodeKind: 'expression_eval', config: { expression: 'v1 - 10' }, inputs: [], outputs: [] } },
    { id: 'mg5_save_stock', type: 'data', position: { x: 1750, y: 1100 }, data: { label: '存库存', nodeKind: 'save_persistent', config: { key: 'stock', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg5_load_gold', type: 'data', position: { x: 2000, y: 1100 }, data: { label: '读金币', nodeKind: 'load_persistent', config: { key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg5_math_gold', type: 'logic', position: { x: 2250, y: 1100 }, data: { label: '金币+100', nodeKind: 'expression_eval', config: { expression: 'v1 + 100' }, inputs: [], outputs: [] } },
    { id: 'mg5_save_gold', type: 'data', position: { x: 2500, y: 1100 }, data: { label: '存金币', nodeKind: 'save_persistent', config: { key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg5_msg', type: 'action', position: { x: 2750, y: 1100 }, data: { label: '卖出成功', nodeKind: 'send_message', config: { text: '卖出10个商品，获得100金币！' }, inputs: [], outputs: [] } },

    // ─── 链6 · /升级 升级建筑 ───
    { id: 'mg6_cmd', type: 'trigger', position: { x: 0, y: 1750 }, data: { label: '升级指令', nodeKind: 'on_command', config: { command: '升级', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'mg6_uid', type: 'logic', position: { x: 250, y: 1750 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'mg6_load', type: 'data', position: { x: 500, y: 1750 }, data: { label: '读建筑数', nodeKind: 'load_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg6_if', type: 'logic', position: { x: 750, y: 1750 }, data: { label: '有账号?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未创建账号
    { id: 'mg6_no', type: 'action', position: { x: 1000, y: 1900 }, data: { label: '未创建账号', nodeKind: 'send_message', config: { text: '未创建账号' }, inputs: [], outputs: [] } },
    // true: 检查金币
    { id: 'mg6_load_gold', type: 'data', position: { x: 1000, y: 1600 }, data: { label: '读金币', nodeKind: 'load_persistent', config: { key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg6_if_gold', type: 'logic', position: { x: 1250, y: 1600 }, data: { label: '金币>=200?', nodeKind: 'if_branch', config: { expression: 'value >= 200' }, inputs: [], outputs: [] } },
    // false: 金币不足
    { id: 'mg6_no_gold', type: 'action', position: { x: 1500, y: 1750 }, data: { label: '金币不足', nodeKind: 'send_message', config: { text: '金币不足，需要200' }, inputs: [], outputs: [] } },
    // true: 扣金币 + 建筑数+1
    { id: 'mg6_math_gold', type: 'logic', position: { x: 1500, y: 1450 }, data: { label: '金币-200', nodeKind: 'expression_eval', config: { expression: 'v1 - 200' }, inputs: [], outputs: [] } },
    { id: 'mg6_save_gold', type: 'data', position: { x: 1750, y: 1450 }, data: { label: '存金币', nodeKind: 'save_persistent', config: { key: 'gold', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg6_math_bc', type: 'logic', position: { x: 2000, y: 1450 }, data: { label: '建筑数+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'mg6_save_bc', type: 'data', position: { x: 2250, y: 1450 }, data: { label: '存建筑数', nodeKind: 'save_persistent', config: { key: 'building_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'mg6_msg', type: 'action', position: { x: 2500, y: 1450 }, data: { label: '升级成功', nodeKind: 'send_message', config: { text: '建筑升级！建筑数+1' }, inputs: [], outputs: [] } }
  ],
  edges: [
    // ── 链1 控制流：/建造 ──
    { id: 'e-mg1cmd-mg1uid', source: 'mg1_cmd', sourcePort: 'next', target: 'mg1_uid', targetPort: 'in' },
    { id: 'e-mg1uid-mg1load', source: 'mg1_uid', sourcePort: 'out', target: 'mg1_load', targetPort: 'in' },
    { id: 'e-mg1load-mg1if', source: 'mg1_load', sourcePort: 'out', target: 'mg1_if', targetPort: 'in' },
    { id: 'e-mg1if-mg1no', source: 'mg1_if', sourcePort: 'false', target: 'mg1_no', targetPort: 'in' },
    { id: 'e-mg1if-mg1loadgold', source: 'mg1_if', sourcePort: 'true', target: 'mg1_load_gold', targetPort: 'in' },
    { id: 'e-mg1loadgold-mg1ifgold', source: 'mg1_load_gold', sourcePort: 'out', target: 'mg1_if_gold', targetPort: 'in' },
    { id: 'e-mg1ifgold-mg1nogold', source: 'mg1_if_gold', sourcePort: 'false', target: 'mg1_no_gold', targetPort: 'in' },
    // 建造分支
    { id: 'e-mg1ifgold-mg1mathgold', source: 'mg1_if_gold', sourcePort: 'true', target: 'mg1_math_gold', targetPort: 'in' },
    { id: 'e-mg1mathgold-mg1savegold', source: 'mg1_math_gold', sourcePort: 'out', target: 'mg1_save_gold', targetPort: 'in' },
    { id: 'e-mg1savegold-mg1mathbc', source: 'mg1_save_gold', sourcePort: 'out', target: 'mg1_math_bc', targetPort: 'in' },
    { id: 'e-mg1mathbc-mg1savebc', source: 'mg1_math_bc', sourcePort: 'out', target: 'mg1_save_bc', targetPort: 'in' },
    { id: 'e-mg1savebc-mg1savestock', source: 'mg1_save_bc', sourcePort: 'out', target: 'mg1_save_stock', targetPort: 'in' },
    { id: 'e-mg1savestock-mg1msg', source: 'mg1_save_stock', sourcePort: 'out', target: 'mg1_msg', targetPort: 'in' },
    // 链1 数据流
    { id: 'e-mg1load-mg1if-v', source: 'mg1_load', sourcePort: 'result', target: 'mg1_if', targetPort: 'value' },
    { id: 'e-mg1loadgold-mg1ifgold-v', source: 'mg1_load_gold', sourcePort: 'result', target: 'mg1_if_gold', targetPort: 'value' },
    { id: 'e-mg1loadgold-mg1mathgold-a', source: 'mg1_load_gold', sourcePort: 'result', target: 'mg1_math_gold', targetPort: 'v1' },
    { id: 'e-mg1mathgold-mg1savegold-v', source: 'mg1_math_gold', sourcePort: 'result', target: 'mg1_save_gold', targetPort: 'value' },
    { id: 'e-mg1load-mg1mathbc-a', source: 'mg1_load', sourcePort: 'result', target: 'mg1_math_bc', targetPort: 'v1' },
    { id: 'e-mg1mathbc-mg1savebc-v', source: 'mg1_math_bc', sourcePort: 'result', target: 'mg1_save_bc', targetPort: 'value' },

    // ── 链2 控制流：/创建账号 ──
    { id: 'e-mg2cmd-mg2uid', source: 'mg2_cmd', sourcePort: 'next', target: 'mg2_uid', targetPort: 'in' },
    { id: 'e-mg2uid-mg2load', source: 'mg2_uid', sourcePort: 'out', target: 'mg2_load', targetPort: 'in' },
    { id: 'e-mg2load-mg2if', source: 'mg2_load', sourcePort: 'out', target: 'mg2_if', targetPort: 'in' },
    { id: 'e-mg2if-mg2exist', source: 'mg2_if', sourcePort: 'true', target: 'mg2_exist', targetPort: 'in' },
    { id: 'e-mg2if-mg2sbc', source: 'mg2_if', sourcePort: 'false', target: 'mg2_s_bc', targetPort: 'in' },
    { id: 'e-mg2sbc-mg2sgold', source: 'mg2_s_bc', sourcePort: 'out', target: 'mg2_s_gold', targetPort: 'in' },
    { id: 'e-mg2sgold-mg2sstock', source: 'mg2_s_gold', sourcePort: 'out', target: 'mg2_s_stock', targetPort: 'in' },
    { id: 'e-mg2sstock-mg2spros', source: 'mg2_s_stock', sourcePort: 'out', target: 'mg2_s_pros', targetPort: 'in' },
    { id: 'e-mg2spros-mg2msg', source: 'mg2_s_pros', sourcePort: 'out', target: 'mg2_msg', targetPort: 'in' },
    // 链2 数据流
    { id: 'e-mg2load-mg2if-v', source: 'mg2_load', sourcePort: 'result', target: 'mg2_if', targetPort: 'value' },

    // ── 链3 控制流：/产业 ──
    { id: 'e-mg3cmd-mg3uid', source: 'mg3_cmd', sourcePort: 'next', target: 'mg3_uid', targetPort: 'in' },
    { id: 'e-mg3uid-mg3load', source: 'mg3_uid', sourcePort: 'out', target: 'mg3_load', targetPort: 'in' },
    { id: 'e-mg3load-mg3if', source: 'mg3_load', sourcePort: 'out', target: 'mg3_if', targetPort: 'in' },
    { id: 'e-mg3if-mg3no', source: 'mg3_if', sourcePort: 'false', target: 'mg3_no', targetPort: 'in' },
    { id: 'e-mg3if-mg3loadgold', source: 'mg3_if', sourcePort: 'true', target: 'mg3_load_gold', targetPort: 'in' },
    { id: 'e-mg3loadgold-mg3loadstock', source: 'mg3_load_gold', sourcePort: 'out', target: 'mg3_load_stock', targetPort: 'in' },
    { id: 'e-mg3loadstock-mg3fmt', source: 'mg3_load_stock', sourcePort: 'out', target: 'mg3_fmt', targetPort: 'in' },
    { id: 'e-mg3fmt-mg3msg', source: 'mg3_fmt', sourcePort: 'out', target: 'mg3_msg', targetPort: 'in' },
    // 链3 数据流
    { id: 'e-mg3load-mg3if-v', source: 'mg3_load', sourcePort: 'result', target: 'mg3_if', targetPort: 'value' },
    { id: 'e-mg3load-mg3fmt-v1', source: 'mg3_load', sourcePort: 'result', target: 'mg3_fmt', targetPort: 'var1' },
    { id: 'e-mg3loadgold-mg3fmt-v2', source: 'mg3_load_gold', sourcePort: 'result', target: 'mg3_fmt', targetPort: 'var2' },
    { id: 'e-mg3loadstock-mg3fmt-v3', source: 'mg3_load_stock', sourcePort: 'result', target: 'mg3_fmt', targetPort: 'var3' },
    { id: 'e-mg3fmt-mg3msg-t', source: 'mg3_fmt', sourcePort: 'result', target: 'mg3_msg', targetPort: 'text' },

    // ── 链4 控制流：/生产 ──
    { id: 'e-mg4cmd-mg4uid', source: 'mg4_cmd', sourcePort: 'next', target: 'mg4_uid', targetPort: 'in' },
    { id: 'e-mg4uid-mg4load', source: 'mg4_uid', sourcePort: 'out', target: 'mg4_load', targetPort: 'in' },
    { id: 'e-mg4load-mg4if', source: 'mg4_load', sourcePort: 'out', target: 'mg4_if', targetPort: 'in' },
    { id: 'e-mg4if-mg4no', source: 'mg4_if', sourcePort: 'false', target: 'mg4_no', targetPort: 'in' },
    { id: 'e-mg4if-mg4ifbc', source: 'mg4_if', sourcePort: 'true', target: 'mg4_if_bc', targetPort: 'in' },
    { id: 'e-mg4ifbc-mg4nobc', source: 'mg4_if_bc', sourcePort: 'false', target: 'mg4_no_bc', targetPort: 'in' },
    { id: 'e-mg4ifbc-mg4loadstock', source: 'mg4_if_bc', sourcePort: 'true', target: 'mg4_load_stock', targetPort: 'in' },
    { id: 'e-mg4loadstock-mg4math', source: 'mg4_load_stock', sourcePort: 'out', target: 'mg4_math', targetPort: 'in' },
    { id: 'e-mg4math-mg4save', source: 'mg4_math', sourcePort: 'out', target: 'mg4_save', targetPort: 'in' },
    { id: 'e-mg4save-mg4msg', source: 'mg4_save', sourcePort: 'out', target: 'mg4_msg', targetPort: 'in' },
    // 链4 数据流
    { id: 'e-mg4load-mg4if-v', source: 'mg4_load', sourcePort: 'result', target: 'mg4_if', targetPort: 'value' },
    { id: 'e-mg4load-mg4ifbc-v', source: 'mg4_load', sourcePort: 'result', target: 'mg4_if_bc', targetPort: 'value' },
    { id: 'e-mg4loadstock-mg4math-a', source: 'mg4_load_stock', sourcePort: 'result', target: 'mg4_math', targetPort: 'v1' },
    { id: 'e-mg4math-mg4save-v', source: 'mg4_math', sourcePort: 'result', target: 'mg4_save', targetPort: 'value' },

    // ── 链5 控制流：/卖出 ──
    { id: 'e-mg5cmd-mg5uid', source: 'mg5_cmd', sourcePort: 'next', target: 'mg5_uid', targetPort: 'in' },
    { id: 'e-mg5uid-mg5load', source: 'mg5_uid', sourcePort: 'out', target: 'mg5_load', targetPort: 'in' },
    { id: 'e-mg5load-mg5if', source: 'mg5_load', sourcePort: 'out', target: 'mg5_if', targetPort: 'in' },
    { id: 'e-mg5if-mg5no', source: 'mg5_if', sourcePort: 'false', target: 'mg5_no', targetPort: 'in' },
    { id: 'e-mg5if-mg5loadstock', source: 'mg5_if', sourcePort: 'true', target: 'mg5_load_stock', targetPort: 'in' },
    { id: 'e-mg5loadstock-mg5ifstock', source: 'mg5_load_stock', sourcePort: 'out', target: 'mg5_if_stock', targetPort: 'in' },
    { id: 'e-mg5ifstock-mg5nostock', source: 'mg5_if_stock', sourcePort: 'false', target: 'mg5_no_stock', targetPort: 'in' },
    { id: 'e-mg5ifstock-mg5mathstock', source: 'mg5_if_stock', sourcePort: 'true', target: 'mg5_math_stock', targetPort: 'in' },
    { id: 'e-mg5mathstock-mg5savestock', source: 'mg5_math_stock', sourcePort: 'out', target: 'mg5_save_stock', targetPort: 'in' },
    { id: 'e-mg5savestock-mg5loadgold', source: 'mg5_save_stock', sourcePort: 'out', target: 'mg5_load_gold', targetPort: 'in' },
    { id: 'e-mg5loadgold-mg5mathgold', source: 'mg5_load_gold', sourcePort: 'out', target: 'mg5_math_gold', targetPort: 'in' },
    { id: 'e-mg5mathgold-mg5savegold', source: 'mg5_math_gold', sourcePort: 'out', target: 'mg5_save_gold', targetPort: 'in' },
    { id: 'e-mg5savegold-mg5msg', source: 'mg5_save_gold', sourcePort: 'out', target: 'mg5_msg', targetPort: 'in' },
    // 链5 数据流
    { id: 'e-mg5load-mg5if-v', source: 'mg5_load', sourcePort: 'result', target: 'mg5_if', targetPort: 'value' },
    { id: 'e-mg5loadstock-mg5ifstock-v', source: 'mg5_load_stock', sourcePort: 'result', target: 'mg5_if_stock', targetPort: 'value' },
    { id: 'e-mg5loadstock-mg5mathstock-a', source: 'mg5_load_stock', sourcePort: 'result', target: 'mg5_math_stock', targetPort: 'v1' },
    { id: 'e-mg5mathstock-mg5savestock-v', source: 'mg5_math_stock', sourcePort: 'result', target: 'mg5_save_stock', targetPort: 'value' },
    { id: 'e-mg5loadgold-mg5mathgold-a', source: 'mg5_load_gold', sourcePort: 'result', target: 'mg5_math_gold', targetPort: 'v1' },
    { id: 'e-mg5mathgold-mg5savegold-v', source: 'mg5_math_gold', sourcePort: 'result', target: 'mg5_save_gold', targetPort: 'value' },

    // ── 链6 控制流：/升级 ──
    { id: 'e-mg6cmd-mg6uid', source: 'mg6_cmd', sourcePort: 'next', target: 'mg6_uid', targetPort: 'in' },
    { id: 'e-mg6uid-mg6load', source: 'mg6_uid', sourcePort: 'out', target: 'mg6_load', targetPort: 'in' },
    { id: 'e-mg6load-mg6if', source: 'mg6_load', sourcePort: 'out', target: 'mg6_if', targetPort: 'in' },
    { id: 'e-mg6if-mg6no', source: 'mg6_if', sourcePort: 'false', target: 'mg6_no', targetPort: 'in' },
    { id: 'e-mg6if-mg6loadgold', source: 'mg6_if', sourcePort: 'true', target: 'mg6_load_gold', targetPort: 'in' },
    { id: 'e-mg6loadgold-mg6ifgold', source: 'mg6_load_gold', sourcePort: 'out', target: 'mg6_if_gold', targetPort: 'in' },
    { id: 'e-mg6ifgold-mg6nogold', source: 'mg6_if_gold', sourcePort: 'false', target: 'mg6_no_gold', targetPort: 'in' },
    { id: 'e-mg6ifgold-mg6mathgold', source: 'mg6_if_gold', sourcePort: 'true', target: 'mg6_math_gold', targetPort: 'in' },
    { id: 'e-mg6mathgold-mg6savegold', source: 'mg6_math_gold', sourcePort: 'out', target: 'mg6_save_gold', targetPort: 'in' },
    { id: 'e-mg6savegold-mg6mathbc', source: 'mg6_save_gold', sourcePort: 'out', target: 'mg6_math_bc', targetPort: 'in' },
    { id: 'e-mg6mathbc-mg6savebc', source: 'mg6_math_bc', sourcePort: 'out', target: 'mg6_save_bc', targetPort: 'in' },
    { id: 'e-mg6savebc-mg6msg', source: 'mg6_save_bc', sourcePort: 'out', target: 'mg6_msg', targetPort: 'in' },
    // 链6 数据流
    { id: 'e-mg6load-mg6if-v', source: 'mg6_load', sourcePort: 'result', target: 'mg6_if', targetPort: 'value' },
    { id: 'e-mg6loadgold-mg6ifgold-v', source: 'mg6_load_gold', sourcePort: 'result', target: 'mg6_if_gold', targetPort: 'value' },
    { id: 'e-mg6loadgold-mg6mathgold-a', source: 'mg6_load_gold', sourcePort: 'result', target: 'mg6_math_gold', targetPort: 'v1' },
    { id: 'e-mg6mathgold-mg6savegold-v', source: 'mg6_math_gold', sourcePort: 'result', target: 'mg6_save_gold', targetPort: 'value' },
    { id: 'e-mg6load-mg6mathbc-a', source: 'mg6_load', sourcePort: 'result', target: 'mg6_math_bc', targetPort: 'v1' },
    { id: 'e-mg6mathbc-mg6savebc-v', source: 'mg6_math_bc', sourcePort: 'result', target: 'mg6_save_bc', targetPort: 'value' }
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  version: '1.0'
}

// ════════════════════════════════════════════════════════════
// 功能型模板 (FUNCTIONAL_TEMPLATE)
// 三条链：/签到、/积分、@机器人（AI 对话）
// ════════════════════════════════════════════════════════════
export const FUNCTIONAL_TEMPLATE: FlowTemplate = {
  id: 'gameplay-functional',
  name: '功能型机器人',
  description: '功能型机器人：每日签到（累计次数）、查询积分、@机器人 AI 对话。使用持久化存储按QQ号隔离数据。',
  botCategory: 'functional',
  category: '其他',
  tags: ['签到', '积分', 'AI对话', '功能', '持久化'],
  author: '内置',
  nodes: [
    // ─── 链1 · /签到 每日签到 ───
    { id: 'fn1_cmd', type: 'trigger', position: { x: 0, y: 0 }, data: { label: '签到指令', nodeKind: 'on_command', config: { command: '签到', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fn1_uid', type: 'logic', position: { x: 250, y: 0 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'fn1_load', type: 'data', position: { x: 500, y: 0 }, data: { label: '读签到数', nodeKind: 'load_persistent', config: { key: 'signin_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn1_if', type: 'logic', position: { x: 750, y: 0 }, data: { label: '有记录?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // true: 签到数+1
    { id: 'fn1_math', type: 'logic', position: { x: 1000, y: -100 }, data: { label: '签到数+1', nodeKind: 'expression_eval', config: { expression: 'v1 + 1' }, inputs: [], outputs: [] } },
    { id: 'fn1_save', type: 'data', position: { x: 1250, y: -100 }, data: { label: '存签到数', nodeKind: 'save_persistent', config: { key: 'signin_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn1_fmt', type: 'logic', position: { x: 1500, y: -100 }, data: { label: '格式化签到', nodeKind: 'format_text', config: { template: '签到成功！累计签到 {var1} 次' }, inputs: [], outputs: [] } },
    { id: 'fn1_msg', type: 'action', position: { x: 1750, y: -100 }, data: { label: '签到成功', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
    // false: 首次签到
    { id: 'fn1_save_init', type: 'data', position: { x: 1000, y: 150 }, data: { label: '初始化签到', nodeKind: 'save_persistent', config: { key: 'signin_count', value: 1, scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn1_msg_init', type: 'action', position: { x: 1250, y: 150 }, data: { label: '首次签到', nodeKind: 'send_message', config: { text: '首次签到成功！' }, inputs: [], outputs: [] } },

    // ─── 链2 · /积分 查询积分 ───
    { id: 'fn2_cmd', type: 'trigger', position: { x: 0, y: 350 }, data: { label: '积分指令', nodeKind: 'on_command', config: { command: '积分', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fn2_uid', type: 'logic', position: { x: 250, y: 350 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'fn2_load', type: 'data', position: { x: 500, y: 350 }, data: { label: '读签到数', nodeKind: 'load_persistent', config: { key: 'signin_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn2_if', type: 'logic', position: { x: 750, y: 350 }, data: { label: '有记录?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // true: 显示积分
    { id: 'fn2_fmt', type: 'logic', position: { x: 1000, y: 250 }, data: { label: '格式化积分', nodeKind: 'format_text', config: { template: '你的签到积分：{var1}' }, inputs: [], outputs: [] } },
    { id: 'fn2_msg', type: 'action', position: { x: 1250, y: 250 }, data: { label: '发送积分', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } },
    // false: 未签到
    { id: 'fn2_no', type: 'action', position: { x: 1000, y: 450 }, data: { label: '未签到', nodeKind: 'send_message', config: { text: '你还没有签到过，输入 /签到 开始' }, inputs: [], outputs: [] } },

    // ─── 链3 · @机器人 AI 对话 ───
    { id: 'fn3_at', type: 'trigger', position: { x: 0, y: 700 }, data: { label: '@机器人', nodeKind: 'on_at_me', config: {}, inputs: [], outputs: [] } },
    { id: 'fn3_reply', type: 'action', position: { x: 250, y: 700 }, data: { label: 'AI 智能回复', nodeKind: 'reply_message', config: { mode: 'llm', system_prompt: '你是一个友好的QQ群助手' }, inputs: [], outputs: [] } },

    // ─── 链4 · /help 查看可用指令 ───
    { id: 'fn4_cmd', type: 'trigger', position: { x: 0, y: 1050 }, data: { label: 'help 指令', nodeKind: 'on_command', config: { command: 'help', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fn4_msg', type: 'action', position: { x: 250, y: 1050 }, data: { label: '发送帮助', nodeKind: 'send_message', config: { text: '📋 可用指令：\n/签到 - 每日签到\n/积分 - 查询积分\n/transfer @对方 数量 - 转账\n/rank - 排行榜\n/help - 查看帮助' }, inputs: [], outputs: [] } },

    // ─── 链5 · /transfer 积分转账（简化版） ───
    { id: 'fn5_cmd', type: 'trigger', position: { x: 0, y: 1400 }, data: { label: 'transfer 指令', nodeKind: 'on_command', config: { command: 'transfer', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fn5_uid', type: 'logic', position: { x: 250, y: 1400 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'fn5_load', type: 'data', position: { x: 500, y: 1400 }, data: { label: '读签到数', nodeKind: 'load_persistent', config: { key: 'signin_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn5_if', type: 'logic', position: { x: 750, y: 1400 }, data: { label: '有记录?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未签到
    { id: 'fn5_no', type: 'action', position: { x: 1000, y: 1550 }, data: { label: '未签到', nodeKind: 'send_message', config: { text: '你还没有签到过' }, inputs: [], outputs: [] } },
    // true: 检查积分
    { id: 'fn5_load2', type: 'data', position: { x: 1000, y: 1250 }, data: { label: '读签到数', nodeKind: 'load_persistent', config: { key: 'signin_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn5_if2', type: 'logic', position: { x: 1250, y: 1250 }, data: { label: '积分>=1?', nodeKind: 'if_branch', config: { expression: 'value >= 1' }, inputs: [], outputs: [] } },
    // false: 积分不足
    { id: 'fn5_no2', type: 'action', position: { x: 1500, y: 1400 }, data: { label: '积分不足', nodeKind: 'send_message', config: { text: '积分不足' }, inputs: [], outputs: [] } },
    // true: 扣积分
    { id: 'fn5_math', type: 'logic', position: { x: 1500, y: 1100 }, data: { label: '签到数-1', nodeKind: 'expression_eval', config: { expression: 'v1 - 1' }, inputs: [], outputs: [] } },
    { id: 'fn5_save', type: 'data', position: { x: 1750, y: 1100 }, data: { label: '存签到数', nodeKind: 'save_persistent', config: { key: 'signin_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn5_msg', type: 'action', position: { x: 2000, y: 1100 }, data: { label: '转账成功', nodeKind: 'send_message', config: { text: '转账成功！扣除1积分' }, inputs: [], outputs: [] } },

    // ─── 链6 · /rank 排行榜（简化版，只显示自己） ───
    { id: 'fn6_cmd', type: 'trigger', position: { x: 0, y: 1750 }, data: { label: 'rank 指令', nodeKind: 'on_command', config: { command: 'rank', prefix: '/' }, inputs: [], outputs: [] } },
    { id: 'fn6_uid', type: 'logic', position: { x: 250, y: 1750 }, data: { label: '获取QQ号', nodeKind: 'get_context_id', config: { mode: 'user_id' }, inputs: [], outputs: [] } },
    { id: 'fn6_load', type: 'data', position: { x: 500, y: 1750 }, data: { label: '读签到数', nodeKind: 'load_persistent', config: { key: 'signin_count', scope: 'user' }, inputs: [], outputs: [] } },
    { id: 'fn6_if', type: 'logic', position: { x: 750, y: 1750 }, data: { label: '有记录?', nodeKind: 'if_branch', config: { expression: 'value != None' }, inputs: [], outputs: [] } },
    // false: 未签到
    { id: 'fn6_no', type: 'action', position: { x: 1000, y: 1900 }, data: { label: '未签到', nodeKind: 'send_message', config: { text: '你还没有签到过' }, inputs: [], outputs: [] } },
    // true: 显示排名
    { id: 'fn6_fmt', type: 'logic', position: { x: 1000, y: 1600 }, data: { label: '格式化排名', nodeKind: 'format_text', config: { template: '📊 你的积分排名\n积分：{var1}\n输入 /签到 增加积分' }, inputs: [], outputs: [] } },
    { id: 'fn6_msg', type: 'action', position: { x: 1250, y: 1600 }, data: { label: '发送排名', nodeKind: 'send_message', config: { text: '' }, inputs: [], outputs: [] } }
  ],
  edges: [
    // ── 链1 控制流：/签到 ──
    { id: 'e-fn1cmd-fn1uid', source: 'fn1_cmd', sourcePort: 'next', target: 'fn1_uid', targetPort: 'in' },
    { id: 'e-fn1uid-fn1load', source: 'fn1_uid', sourcePort: 'out', target: 'fn1_load', targetPort: 'in' },
    { id: 'e-fn1load-fn1if', source: 'fn1_load', sourcePort: 'out', target: 'fn1_if', targetPort: 'in' },
    { id: 'e-fn1if-fn1math', source: 'fn1_if', sourcePort: 'true', target: 'fn1_math', targetPort: 'in' },
    { id: 'e-fn1math-fn1save', source: 'fn1_math', sourcePort: 'out', target: 'fn1_save', targetPort: 'in' },
    { id: 'e-fn1save-fn1fmt', source: 'fn1_save', sourcePort: 'out', target: 'fn1_fmt', targetPort: 'in' },
    { id: 'e-fn1fmt-fn1msg', source: 'fn1_fmt', sourcePort: 'out', target: 'fn1_msg', targetPort: 'in' },
    { id: 'e-fn1math-fn1fmt-v1', source: 'fn1_math', sourcePort: 'result', target: 'fn1_fmt', targetPort: 'var1' },
    { id: 'e-fn1fmt-fn1msg-t', source: 'fn1_fmt', sourcePort: 'result', target: 'fn1_msg', targetPort: 'text' },
    { id: 'e-fn1if-fn1saveinit', source: 'fn1_if', sourcePort: 'false', target: 'fn1_save_init', targetPort: 'in' },
    { id: 'e-fn1saveinit-fn1msginit', source: 'fn1_save_init', sourcePort: 'out', target: 'fn1_msg_init', targetPort: 'in' },
    // 链1 数据流
    { id: 'e-fn1load-fn1if-v', source: 'fn1_load', sourcePort: 'result', target: 'fn1_if', targetPort: 'value' },
    { id: 'e-fn1load-fn1math-a', source: 'fn1_load', sourcePort: 'result', target: 'fn1_math', targetPort: 'v1' },
    { id: 'e-fn1math-fn1save-v', source: 'fn1_math', sourcePort: 'result', target: 'fn1_save', targetPort: 'value' },

    // ── 链2 控制流：/积分 ──
    { id: 'e-fn2cmd-fn2uid', source: 'fn2_cmd', sourcePort: 'next', target: 'fn2_uid', targetPort: 'in' },
    { id: 'e-fn2uid-fn2load', source: 'fn2_uid', sourcePort: 'out', target: 'fn2_load', targetPort: 'in' },
    { id: 'e-fn2load-fn2if', source: 'fn2_load', sourcePort: 'out', target: 'fn2_if', targetPort: 'in' },
    { id: 'e-fn2if-fn2fmt', source: 'fn2_if', sourcePort: 'true', target: 'fn2_fmt', targetPort: 'in' },
    { id: 'e-fn2fmt-fn2msg', source: 'fn2_fmt', sourcePort: 'out', target: 'fn2_msg', targetPort: 'in' },
    { id: 'e-fn2if-fn2no', source: 'fn2_if', sourcePort: 'false', target: 'fn2_no', targetPort: 'in' },
    // 链2 数据流
    { id: 'e-fn2load-fn2if-v', source: 'fn2_load', sourcePort: 'result', target: 'fn2_if', targetPort: 'value' },
    { id: 'e-fn2load-fn2fmt-v1', source: 'fn2_load', sourcePort: 'result', target: 'fn2_fmt', targetPort: 'var1' },
    { id: 'e-fn2fmt-fn2msg-t', source: 'fn2_fmt', sourcePort: 'result', target: 'fn2_msg', targetPort: 'text' },

    // ── 链3 控制流：@机器人 ──
    { id: 'e-fn3at-fn3reply', source: 'fn3_at', sourcePort: 'next', target: 'fn3_reply', targetPort: 'in' },

    // ── 链4 控制流：/help ──
    { id: 'e-fn4cmd-fn4msg', source: 'fn4_cmd', sourcePort: 'next', target: 'fn4_msg', targetPort: 'in' },

    // ── 链5 控制流：/transfer ──
    { id: 'e-fn5cmd-fn5uid', source: 'fn5_cmd', sourcePort: 'next', target: 'fn5_uid', targetPort: 'in' },
    { id: 'e-fn5uid-fn5load', source: 'fn5_uid', sourcePort: 'out', target: 'fn5_load', targetPort: 'in' },
    { id: 'e-fn5load-fn5if', source: 'fn5_load', sourcePort: 'out', target: 'fn5_if', targetPort: 'in' },
    { id: 'e-fn5if-fn5no', source: 'fn5_if', sourcePort: 'false', target: 'fn5_no', targetPort: 'in' },
    { id: 'e-fn5if-fn5load2', source: 'fn5_if', sourcePort: 'true', target: 'fn5_load2', targetPort: 'in' },
    { id: 'e-fn5load2-fn5if2', source: 'fn5_load2', sourcePort: 'out', target: 'fn5_if2', targetPort: 'in' },
    { id: 'e-fn5if2-fn5no2', source: 'fn5_if2', sourcePort: 'false', target: 'fn5_no2', targetPort: 'in' },
    { id: 'e-fn5if2-fn5math', source: 'fn5_if2', sourcePort: 'true', target: 'fn5_math', targetPort: 'in' },
    { id: 'e-fn5math-fn5save', source: 'fn5_math', sourcePort: 'out', target: 'fn5_save', targetPort: 'in' },
    { id: 'e-fn5save-fn5msg', source: 'fn5_save', sourcePort: 'out', target: 'fn5_msg', targetPort: 'in' },
    // 链5 数据流
    { id: 'e-fn5load-fn5if-v', source: 'fn5_load', sourcePort: 'result', target: 'fn5_if', targetPort: 'value' },
    { id: 'e-fn5load2-fn5if2-v', source: 'fn5_load2', sourcePort: 'result', target: 'fn5_if2', targetPort: 'value' },
    { id: 'e-fn5load2-fn5math-a', source: 'fn5_load2', sourcePort: 'result', target: 'fn5_math', targetPort: 'v1' },
    { id: 'e-fn5math-fn5save-v', source: 'fn5_math', sourcePort: 'result', target: 'fn5_save', targetPort: 'value' },

    // ── 链6 控制流：/rank ──
    { id: 'e-fn6cmd-fn6uid', source: 'fn6_cmd', sourcePort: 'next', target: 'fn6_uid', targetPort: 'in' },
    { id: 'e-fn6uid-fn6load', source: 'fn6_uid', sourcePort: 'out', target: 'fn6_load', targetPort: 'in' },
    { id: 'e-fn6load-fn6if', source: 'fn6_load', sourcePort: 'out', target: 'fn6_if', targetPort: 'in' },
    { id: 'e-fn6if-fn6no', source: 'fn6_if', sourcePort: 'false', target: 'fn6_no', targetPort: 'in' },
    { id: 'e-fn6if-fn6fmt', source: 'fn6_if', sourcePort: 'true', target: 'fn6_fmt', targetPort: 'in' },
    { id: 'e-fn6fmt-fn6msg', source: 'fn6_fmt', sourcePort: 'out', target: 'fn6_msg', targetPort: 'in' },
    // 链6 数据流
    { id: 'e-fn6load-fn6if-v', source: 'fn6_load', sourcePort: 'result', target: 'fn6_if', targetPort: 'value' },
    { id: 'e-fn6load-fn6fmt-v1', source: 'fn6_load', sourcePort: 'result', target: 'fn6_fmt', targetPort: 'var1' },
    { id: 'e-fn6fmt-fn6msg-t', source: 'fn6_fmt', sourcePort: 'result', target: 'fn6_msg', targetPort: 'text' }
  ],
  createdAt: '2025-01-01T00:00:00.000Z',
  version: '1.0'
}

export const GAMEPLAY_TEMPLATES_EXTRA: Record<string, FlowTemplate> = {
  card: CARD_TEMPLATE,
  management: MANAGEMENT_TEMPLATE,
  functional: FUNCTIONAL_TEMPLATE
}
