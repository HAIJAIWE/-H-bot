// 内置示例模板库 — 按 BotType 自动加载的模板集合

import type { FlowTemplate } from '@shared/types/template'
import type { FlowNode, FlowEdge } from '@shared/types/flow'

interface BuiltInNodeDef {
  id: string
  kind: string
  label: string
  type: FlowNode['type']
  x: number
  y: number
  config?: Record<string, unknown>
}

export function buildNodes(defs: BuiltInNodeDef[]): FlowNode[] {
  return defs.map((d) => ({
    id: d.id,
    type: d.type,
    position: { x: d.x, y: d.y },
    data: {
      label: d.label,
      nodeKind: d.kind,
      config: d.config ?? {},
      inputs: [],
      outputs: []
    }
  }))
}

/** 触发器节点 kind 集合——这些节点的控制输出端口为 'next' */
const TRIGGER_KINDS = new Set([
  'on_message', 'on_request', 'on_notice', 'schedule', 'on_schedule'
])

export function buildEdges(
  connections: Array<{ source: string; target: string; sourcePort?: string; targetPort?: string }>,
  nodeDefs?: BuiltInNodeDef[]
): FlowEdge[] {
  // 构建 node id → kind 映射，用于推断默认 sourcePort
  const kindMap = new Map<string, string>()
  if (nodeDefs) {
    for (const d of nodeDefs) kindMap.set(d.id, d.kind)
  }
  return connections.map((c) => {
    let sourcePort = c.sourcePort
    if (!sourcePort) {
      const kind = kindMap.get(c.source)
      // 有 nodeDefs 时：触发器用 'next'，其余用 'out'
      // 无 nodeDefs 时：默认 'next'（由 fixEdgePorts 后处理修正）
      sourcePort = kind ? (TRIGGER_KINDS.has(kind) ? 'next' : 'out') : 'next'
    }
    return {
      id: `e-${c.source}-${c.target}`,
      source: c.source,
      sourcePort,
      target: c.target,
      targetPort: c.targetPort ?? 'in'
    }
  })
}

/**
 * 后处理：修正模板中边的 sourcePort。
 * buildEdges 默认 sourcePort='next'，但非触发器节点的控制输出端口为 'out'。
 * 此函数根据节点 kind 修正所有从非触发器节点出发且 sourcePort='next' 的边。
 */
function fixEdgePorts(templates: FlowTemplate[]): FlowTemplate[] {
  return templates.map((tpl) => {
    const kindMap = new Map(tpl.nodes.map((n) => [n.id, n.data.nodeKind]))
    const fixedEdges = tpl.edges.map((e) => {
      // 只修正 sourcePort='next' 且源节点不是触发器的边
      if (e.sourcePort === 'next') {
        const kind = kindMap.get(e.source)
        if (kind && !TRIGGER_KINDS.has(kind)) {
          return { ...e, sourcePort: 'out' as const }
        }
      }
      return e
    })
    return { ...tpl, edges: fixedEdges }
  })
}

export const BUILT_IN_TEMPLATES: FlowTemplate[] = fixEdgePorts([
  // 2. 群管机器人 — 禁言/踢出/设置名片/撤回，多指令多系统
  {
    id: 'builtin-group-admin',
    botCategory: 'functional',
    name: '群管机器人',
    description: '多功能群管理：/禁言 /踢出 /设置名片 /撤回 /设置头衔 /帮助 /解除禁言 /全禁言 /警告 /设置管理员 /公告 入群欢迎 退群检测 关键词自动禁言 防刷屏检测，15条指令系统',
    category: '管理',
    tags: ['群管', '禁言', '踢出', '名片', '撤回', '欢迎', '头衔', '关键词', '帮助', '解除禁言', '全禁言', '警告', '管理员', '公告', '退群', '防刷屏'],
    author: '内置',
    nodes: buildNodes([
      // ── 链1 · /禁言 @用户 时长 ──
      { id: 'm1_cmd', kind: 'on_message', label: '禁言指令', type: 'trigger', x: 0, y: 0, config: { match: 'command', command: '禁言', prefix: '/' } },
      { id: 'm1_args', kind: 'get_context', label: '取时长参数', type: 'logic', x: 250, y: 0, config: { mode: 'command_args', index: 0 } },
      { id: 'm1_at', kind: 'get_context', label: '取@对象', type: 'logic', x: 500, y: 0, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 'm1_mute', kind: 'group_op', label: '执行禁言', type: 'action', x: 750, y: 0, config: { mode: 'ban', duration: 600 } },
      { id: 'm1_msg', kind: 'send_message', label: '通知', type: 'action', x: 1000, y: 0, config: { text: '该成员已被禁言。' } },
      // ── 链2 · /踢出 @用户 ──
      { id: 'm2_cmd', kind: 'on_message', label: '踢出指令', type: 'trigger', x: 0, y: 200, config: { match: 'command', command: '踢出', prefix: '/' } },
      { id: 'm2_at', kind: 'get_context', label: '取@对象', type: 'logic', x: 250, y: 200, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 'm2_kick', kind: 'group_op', label: '执行踢出', type: 'action', x: 500, y: 200, config: { mode: 'kick' } },
      { id: 'm2_msg', kind: 'send_message', label: '通知', type: 'action', x: 750, y: 200, config: { text: '该成员已被移出群聊。' } },
      // ── 链3 · /设置名片 @用户 名片 ──
      { id: 'm3_cmd', kind: 'on_message', label: '名片指令', type: 'trigger', x: 0, y: 400, config: { match: 'command', command: '设置名片', prefix: '/' } },
      { id: 'm3_args', kind: 'get_context', label: '取名片参数', type: 'logic', x: 250, y: 400, config: { mode: 'command_args', index: 0 } },
      { id: 'm3_at', kind: 'get_context', label: '取@对象', type: 'logic', x: 500, y: 400, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 'm3_card', kind: 'group_op', label: '设置名片', type: 'action', x: 750, y: 400, config: { mode: 'set_card' } },
      { id: 'm3_msg', kind: 'send_message', label: '通知', type: 'action', x: 1000, y: 400, config: { text: '群名片已更新。' } },
      // ── 链4 · /撤回 ──
      { id: 'm4_cmd', kind: 'on_message', label: '撤回指令', type: 'trigger', x: 0, y: 600, config: { match: 'command', command: '撤回', prefix: '/' } },
      { id: 'm4_recall', kind: 'recall', label: '撤回消息', type: 'action', x: 250, y: 600, config: {} },
      { id: 'm4_msg', kind: 'send_message', label: '通知', type: 'action', x: 500, y: 600, config: { text: '消息已撤回。' } },
      // ── 链5 · 入群欢迎 ──
      { id: 'w1_notice', kind: 'on_notice', label: '入群通知', type: 'trigger', x: 0, y: 800, config: { notice_type: 'group_increase' } },
      { id: 'w2_uid', kind: 'get_context', label: '取新人QQ', type: 'logic', x: 250, y: 800, config: { mode: 'user_id' } },
      { id: 'w3_fmt', kind: 'format_text', label: '欢迎文本', type: 'logic', x: 500, y: 800, config: { template: '欢迎新人 {var1} 加入本群！' } },
      { id: 'w4_msg', kind: 'send_message', label: '发送欢迎', type: 'action', x: 750, y: 800, config: { text: '' } },
      // ── 链6 · /设置头衔 @用户 头衔 ──
      { id: 't1_cmd', kind: 'on_message', label: '头衔指令', type: 'trigger', x: 0, y: 1000, config: { match: 'command', command: '设置头衔', prefix: '/' } },
      { id: 't2_at', kind: 'get_context', label: '取@对象', type: 'logic', x: 250, y: 1000, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 't3_args', kind: 'get_context', label: '取头衔参数', type: 'logic', x: 500, y: 1000, config: { mode: 'command_args', index: 0 } },
      { id: 't4_title', kind: 'group_op', label: '设置头衔', type: 'action', x: 750, y: 1000, config: { mode: 'set_title' } },
      { id: 't5_fmt', kind: 'format_text', label: '通知', type: 'logic', x: 1000, y: 1000, config: { template: '已设置头衔' } },
      { id: 't6_msg', kind: 'send_message', label: '发送通知', type: 'action', x: 1250, y: 1000, config: { text: '' } },
      // ── 链7 · 关键词检测自动禁言 ──
      { id: 'a1', kind: 'on_message', label: '消息监听', type: 'trigger', x: 0, y: 1200, config: {} },
      { id: 'a2', kind: 'get_context', label: '取消息文本', type: 'logic', x: 250, y: 1200, config: { mode: 'message_text' } },
      { id: 'a3', kind: 'if_branch', label: '含广告词？', type: 'logic', x: 500, y: 1200, config: { expression: "'广告' in value or '加群' in value or '代练' in value" } },
      { id: 'a4', kind: 'get_context', label: '取发送者QQ', type: 'logic', x: 750, y: 1200, config: { mode: 'user_id' } },
      { id: 'a5', kind: 'group_op', label: '自动禁言', type: 'action', x: 1000, y: 1200, config: { mode: 'ban', duration: 600 } },
      { id: 'a6', kind: 'format_text', label: '禁言通知', type: 'logic', x: 1250, y: 1200, config: { template: '检测到广告/刷屏，已自动禁言10分钟' } },
      { id: 'a7', kind: 'send_message', label: '发送通知', type: 'action', x: 1500, y: 1200, config: {} },
      // ── 链8 · /帮助 ──
      { id: 'gh1', kind: 'on_message', label: '帮助指令', type: 'trigger', x: 0, y: 1400, config: { match: 'command', command: '帮助', prefix: '/' } },
      { id: 'gh2', kind: 'format_text', label: '帮助列表', type: 'logic', x: 250, y: 1400, config: { template: '群管指令列表：\n/禁言 @用户 时长\n/踢出 @用户\n/设置名片 @用户 名片\n/设置头衔 @用户 头衔\n/撤回\n/解除禁言 @用户\n/全禁言 开|关\n/警告 @用户\n/设置管理员 @用户\n/公告 内容\n/投票 @用户\n入群/退群自动通知\n关键词自动禁言\n防刷屏检测' } },
      { id: 'gh3', kind: 'send_message', label: '发送', type: 'action', x: 500, y: 1400, config: {} },
      // ── 链9 · /解除禁言 ──
      { id: 'um1', kind: 'on_message', label: '解除禁言指令', type: 'trigger', x: 0, y: 1600, config: { match: 'command', command: '解除禁言', prefix: '/' } },
      { id: 'um2', kind: 'get_context', label: '取@对象', type: 'logic', x: 250, y: 1600, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 'um3', kind: 'group_op', label: '解除禁言', type: 'action', x: 500, y: 1600, config: { mode: 'ban', duration: 0 } },
      { id: 'um4', kind: 'format_text', label: '通知', type: 'logic', x: 750, y: 1600, config: { template: '已解除该成员的禁言' } },
      { id: 'um5', kind: 'send_message', label: '发送', type: 'action', x: 1000, y: 1600, config: {} },
      // ── 链10 · /全禁言 ──
      { id: 'am1', kind: 'on_message', label: '全禁言指令', type: 'trigger', x: 0, y: 1800, config: { match: 'command', command: '全禁言', prefix: '/' } },
      { id: 'am2', kind: 'get_context', label: '取开关参数', type: 'logic', x: 250, y: 1800, config: { mode: 'command_args', index: 0 } },
      { id: 'am3', kind: 'switch_case', label: '匹配开/关', type: 'logic', x: 500, y: 1800, config: { cases: '[{"match":"开","label":"开"},{"match":"关","label":"关"}]', default: '提示' } },
      // 开 分支
      { id: 'am4', kind: 'api_call', label: '开启全禁言', type: 'action', x: 750, y: 1680, config: { action: 'set_group_whole_ban', params: '{"enable": true}' } },
      { id: 'am5', kind: 'format_text', label: '开启提示', type: 'logic', x: 1000, y: 1680, config: { template: '已开启全员禁言' } },
      { id: 'am6', kind: 'send_message', label: '发送', type: 'action', x: 1250, y: 1680, config: {} },
      // 关 分支
      { id: 'am7', kind: 'api_call', label: '关闭全禁言', type: 'action', x: 750, y: 1800, config: { action: 'set_group_whole_ban', params: '{"enable": false}' } },
      { id: 'am8', kind: 'format_text', label: '关闭提示', type: 'logic', x: 1000, y: 1800, config: { template: '已关闭全员禁言' } },
      { id: 'am9', kind: 'send_message', label: '发送', type: 'action', x: 1250, y: 1800, config: {} },
      // 提示 分支
      { id: 'am10', kind: 'format_text', label: '用法提示', type: 'logic', x: 750, y: 1920, config: { template: '用法：/全禁言 开 或 /全禁言 关' } },
      { id: 'am11', kind: 'send_message', label: '发送', type: 'action', x: 1000, y: 1920, config: {} },
      // ── 链11 · /警告 ──
      { id: 'wn1', kind: 'on_message', label: '警告指令', type: 'trigger', x: 0, y: 2000, config: { match: 'command', command: '警告', prefix: '/' } },
      { id: 'wn2', kind: 'get_context', label: '取@对象', type: 'logic', x: 250, y: 2000, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 'wn3', kind: 'persistent_op', label: '警告次数+1', type: 'action', x: 500, y: 2000, config: { mode: 'increment', key: 'warn_count', amount: 1, scope: 'user', default: 0 } },
      { id: 'wn4', kind: 'format_text', label: '警告提示', type: 'logic', x: 750, y: 2000, config: { template: '已警告该成员，累计警告次数+1。达到3次将自动禁言。' } },
      { id: 'wn5', kind: 'send_message', label: '发送', type: 'action', x: 1000, y: 2000, config: {} },
      // ── 链12 · /设置管理员 ──
      { id: 'sa1', kind: 'on_message', label: '设置管理员指令', type: 'trigger', x: 0, y: 2200, config: { match: 'command', command: '设置管理员', prefix: '/' } },
      { id: 'sa2', kind: 'get_context', label: '取@对象', type: 'logic', x: 250, y: 2200, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 'sa3', kind: 'api_call', label: '设置管理员', type: 'action', x: 500, y: 2200, config: { action: 'set_group_admin', params: '{}' } },
      { id: 'sa4', kind: 'format_text', label: '通知', type: 'logic', x: 750, y: 2200, config: { template: '已设置/取消管理员' } },
      { id: 'sa5', kind: 'send_message', label: '发送', type: 'action', x: 1000, y: 2200, config: {} },
      // ── 链13 · 退群检测 ──
      { id: 'lv1', kind: 'on_notice', label: '退群通知', type: 'trigger', x: 0, y: 2400, config: { notice_type: 'group_decrease' } },
      { id: 'lv2', kind: 'format_text', label: '退群提示', type: 'logic', x: 250, y: 2400, config: { template: '有成员退出了本群...' } },
      { id: 'lv3', kind: 'send_message', label: '发送', type: 'action', x: 500, y: 2400, config: {} },
      // ── 链14 · 防刷屏检测 ──
      { id: 'sp1', kind: 'on_message', label: '消息监听', type: 'trigger', x: 0, y: 2600, config: {} },
      { id: 'sp2', kind: 'get_context', label: '取发送者QQ', type: 'logic', x: 250, y: 2600, config: { mode: 'user_id' } },
      { id: 'sp3', kind: 'persistent_op', label: '消息计数+1', type: 'action', x: 500, y: 2600, config: { mode: 'increment', key: 'msg_count', amount: 1, scope: 'user', default: 0 } },
      { id: 'sp4', kind: 'persistent_op', label: '读消息计数', type: 'data', x: 750, y: 2600, config: { mode: 'load', key: 'msg_count', scope: 'user' } },
      { id: 'sp5', kind: 'if_branch', label: '刷屏检测？', type: 'logic', x: 1000, y: 2600, config: { expression: 'value >= 10' } },
      { id: 'sp6', kind: 'group_op', label: '自动禁言', type: 'action', x: 1250, y: 2600, config: { mode: 'ban', duration: 300 } },
      { id: 'sp7', kind: 'format_text', label: '禁言通知', type: 'logic', x: 1500, y: 2600, config: { template: '检测到刷屏，已自动禁言5分钟' } },
      { id: 'sp8', kind: 'send_message', label: '发送通知', type: 'action', x: 1750, y: 2600, config: {} },
      // ── 链15 · /公告 ──
      { id: 'an1', kind: 'on_message', label: '公告指令', type: 'trigger', x: 0, y: 2800, config: { match: 'command', command: '公告', prefix: '/' } },
      { id: 'an2', kind: 'get_context', label: '取公告内容', type: 'logic', x: 250, y: 2800, config: { mode: 'command_args', index: 0 } },
      { id: 'an3', kind: 'format_text', label: '公告文本', type: 'logic', x: 500, y: 2800, config: { template: '📢 群公告\n{var1}' } },
      { id: 'an4', kind: 'send_message', label: '发送', type: 'action', x: 750, y: 2800, config: {} }
    ]),
    edges: buildEdges([
      // 链1
      { source: 'm1_cmd', target: 'm1_args' },
      { source: 'm1_args', target: 'm1_at' },
      { source: 'm1_at', target: 'm1_mute' },
      { source: 'm1_mute', target: 'm1_msg' },
      // 链2
      { source: 'm2_cmd', target: 'm2_at' },
      { source: 'm2_at', target: 'm2_kick' },
      { source: 'm2_kick', target: 'm2_msg' },
      // 链3
      { source: 'm3_cmd', target: 'm3_args' },
      { source: 'm3_args', target: 'm3_at' },
      { source: 'm3_at', target: 'm3_card' },
      { source: 'm3_card', target: 'm3_msg' },
      // 链4
      { source: 'm4_cmd', target: 'm4_recall' },
      { source: 'm4_recall', target: 'm4_msg' },
      // 数据流：@目标QQ → 群管操作目标
      { source: 'm1_at', target: 'm1_mute', sourcePort: 'current', targetPort: 'user_id' },
      { source: 'm2_at', target: 'm2_kick', sourcePort: 'current', targetPort: 'user_id' },
      { source: 'm3_at', target: 'm3_card', sourcePort: 'current', targetPort: 'user_id' },
      // 数据流：名片参数 → 设置名片值
      { source: 'm3_args', target: 'm3_card', sourcePort: 'result', targetPort: 'value' },
      // 链5
      { source: 'w1_notice', target: 'w2_uid' },
      { source: 'w2_uid', target: 'w3_fmt' },
      { source: 'w3_fmt', target: 'w4_msg' },
      // 链5 数据流
      { source: 'w2_uid', target: 'w3_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'w3_fmt', target: 'w4_msg', sourcePort: 'result', targetPort: 'text' },
      // 链6
      { source: 't1_cmd', target: 't2_at' },
      { source: 't2_at', target: 't3_args' },
      { source: 't3_args', target: 't4_title' },
      { source: 't4_title', target: 't5_fmt' },
      { source: 't5_fmt', target: 't6_msg' },
      // 链6 数据流
      { source: 't2_at', target: 't4_title', sourcePort: 'current', targetPort: 'user_id' },
      { source: 't3_args', target: 't4_title', sourcePort: 'result', targetPort: 'value' },
      { source: 't5_fmt', target: 't6_msg', sourcePort: 'result', targetPort: 'text' },
      // 链7 控制流: 关键词检测自动禁言
      { source: 'a1', target: 'a2' },
      { source: 'a2', target: 'a3' },
      { source: 'a3', target: 'a4', sourcePort: 'true' },
      { source: 'a4', target: 'a5' },
      { source: 'a5', target: 'a6' },
      { source: 'a6', target: 'a7' },
      // 链7 数据流
      { source: 'a2', target: 'a3', sourcePort: 'result', targetPort: 'value' },
      { source: 'a4', target: 'a5', sourcePort: 'result', targetPort: 'user_id' },
      { source: 'a6', target: 'a7', sourcePort: 'result', targetPort: 'text' },
      // 链8 控制流: /帮助
      { source: 'gh1', target: 'gh2' },
      { source: 'gh2', target: 'gh3' },
      // 链8 数据流
      { source: 'gh2', target: 'gh3', sourcePort: 'result', targetPort: 'text' },
      // 链9 控制流: /解除禁言
      { source: 'um1', target: 'um2' },
      { source: 'um2', target: 'um3' },
      { source: 'um3', target: 'um4' },
      { source: 'um4', target: 'um5' },
      // 链9 数据流
      { source: 'um2', target: 'um3', sourcePort: 'current', targetPort: 'user_id' },
      { source: 'um4', target: 'um5', sourcePort: 'result', targetPort: 'text' },
      // 链10 控制流: /全禁言
      { source: 'am1', target: 'am2' },
      { source: 'am2', target: 'am3' },
      { source: 'am3', target: 'am4', sourcePort: '开' },
      { source: 'am4', target: 'am5' },
      { source: 'am5', target: 'am6' },
      { source: 'am3', target: 'am7', sourcePort: '关' },
      { source: 'am7', target: 'am8' },
      { source: 'am8', target: 'am9' },
      { source: 'am3', target: 'am10', sourcePort: '提示' },
      { source: 'am10', target: 'am11' },
      // 链10 数据流
      { source: 'am2', target: 'am3', sourcePort: 'result', targetPort: 'value' },
      { source: 'am5', target: 'am6', sourcePort: 'result', targetPort: 'text' },
      { source: 'am8', target: 'am9', sourcePort: 'result', targetPort: 'text' },
      { source: 'am10', target: 'am11', sourcePort: 'result', targetPort: 'text' },
      // 链11 控制流: /警告
      { source: 'wn1', target: 'wn2' },
      { source: 'wn2', target: 'wn3' },
      { source: 'wn3', target: 'wn4' },
      { source: 'wn4', target: 'wn5' },
      // 链11 数据流
      { source: 'wn4', target: 'wn5', sourcePort: 'result', targetPort: 'text' },
      // 链12 控制流: /设置管理员
      { source: 'sa1', target: 'sa2' },
      { source: 'sa2', target: 'sa3' },
      { source: 'sa3', target: 'sa4' },
      { source: 'sa4', target: 'sa5' },
      // 链12 数据流
      { source: 'sa4', target: 'sa5', sourcePort: 'result', targetPort: 'text' },
      // 链13 控制流: 退群检测
      { source: 'lv1', target: 'lv2' },
      { source: 'lv2', target: 'lv3' },
      // 链13 数据流
      { source: 'lv2', target: 'lv3', sourcePort: 'result', targetPort: 'text' },
      // 链14 控制流: 防刷屏检测
      { source: 'sp1', target: 'sp2' },
      { source: 'sp2', target: 'sp3' },
      { source: 'sp3', target: 'sp4' },
      { source: 'sp4', target: 'sp5' },
      { source: 'sp5', target: 'sp6', sourcePort: 'true' },
      { source: 'sp6', target: 'sp7' },
      { source: 'sp7', target: 'sp8' },
      // 链14 数据流
      { source: 'sp4', target: 'sp5', sourcePort: 'result', targetPort: 'value' },
      { source: 'sp7', target: 'sp8', sourcePort: 'result', targetPort: 'text' },
      // 链15 控制流: /公告
      { source: 'an1', target: 'an2' },
      { source: 'an2', target: 'an3' },
      { source: 'an3', target: 'an4' },
      // 链15 数据流
      { source: 'an2', target: 'an3', sourcePort: 'result', targetPort: 'var1' },
      { source: 'an3', target: 'an4', sourcePort: 'result', targetPort: 'text' }
    ]),
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0'
  },
  // 3. LLM 智能聊天机器人 — @触发对话 + 历史记忆 + 冷却限流 + /清空 指令
  {
    id: 'builtin-smart-qa',
    botCategory: 'functional',
    name: 'LLM 智能聊天机器人',
    description: '完整AI聊天机器人：@对话/清空/人设/温度/记忆长度/关键词触发/拉黑/解拉黑/主动发言/统计/重置人设/入群引导/黑名单/退群提示/智能意图识别，16条系统（含自然语言配置，无需指令）',
    category: '消息',
    tags: ['AI', '聊天', '对话历史', '@机器人', '冷却', 'LLM', '人设', '温度', '记忆', '关键词', '拉黑', '主动发言', '意图识别', '自然语言'],
    author: '内置',
    nodes: buildNodes([
      // ════════════ 链1 · @触发对话 ════════════
      { id: 't1', kind: 'on_message', label: '@触发', type: 'trigger', x: 0, y: 0, config: { match: 'at_me' } },
      { id: 't2', kind: 'get_context', label: '获取消息', type: 'logic', x: 250, y: 0, config: { mode: 'message_text' } },
      { id: 't3', kind: 'persistent_op', label: '冷却检查', type: 'data', x: 500, y: 0, config: { mode: 'check', key: 'chat', scope: 'user', cooldown_seconds: 30 } },
      { id: 't4', kind: 'if_branch', label: '是否可对话', type: 'logic', x: 750, y: 0, config: { expression: 'value' } },
      // true 分支：先检查黑名单 → 加载配置 → LLM → 追加历史 → 发送 → 设置冷却 → 自增计数
      { id: 'tBL1', kind: 'get_context', label: '取用户ID', type: 'logic', x: 1000, y: 0, config: { mode: 'user_id' } },
      { id: 'tBL2', kind: 'persistent_op', label: '加载黑名单', type: 'data', x: 1250, y: 0, config: { mode: 'load', key: 'ai_blacklist', scope: 'group' } },
      { id: 'tBL3', kind: 'expression_eval', label: '黑名单检查', type: 'logic', x: 1500, y: 0, config: { expression: 'v1 in v2 if v2 else False' } },
      { id: 'tBL4', kind: 'if_branch', label: '是否拉黑', type: 'logic', x: 1750, y: 0, config: { expression: 'value' } },
      { id: 'tBL5', kind: 'flow_control', label: '拦截返回', type: 'logic', x: 1750, y: -150, config: { mode: 'return' } },
      // 加载历史/人设/温度/记忆长度
      { id: 't5', kind: 'persistent_op', label: '加载历史', type: 'data', x: 2000, y: -120, config: { mode: 'load', key: 'chat_history', scope: 'user' } },
      { id: 't5b', kind: 'persistent_op', label: '加载人设', type: 'data', x: 2000, y: -20, config: { mode: 'load', key: 'ai_persona', scope: 'user' } },
      { id: 't5c', kind: 'expression_eval', label: '人设回退', type: 'logic', x: 2250, y: -20, config: { expression: "v1 if v1 else '你是一个友好的AI助手，善于倾听和交流。'" } },
      { id: 'tTE1', kind: 'persistent_op', label: '加载温度', type: 'data', x: 2000, y: 80, config: { mode: 'load', key: 'ai_temperature', scope: 'user' } },
      { id: 'tTE2', kind: 'expression_eval', label: '温度转float', type: 'logic', x: 2250, y: 80, config: { expression: 'float(v1) if v1 else 0.7' } },
      { id: 'tMM1', kind: 'persistent_op', label: '加载记忆长度', type: 'data', x: 2000, y: 180, config: { mode: 'load', key: 'ai_mem_length', scope: 'user' } },
      { id: 'tMM2', kind: 'expression_eval', label: '记忆转int', type: 'logic', x: 2250, y: 180, config: { expression: 'int(v1) if v1 else 20' } },
      // LLM 对话
      { id: 't6', kind: 'llm_chat', label: 'AI回复', type: 'ai', x: 2500, y: -120, config: { system_prompt: '你是一个友好的AI助手，回复简洁有趣。', temperature: 0.7 } },
      // 追加用户消息到历史（json_op(set) 构建 dict → json_op(get) 解析 → listAppend）
      { id: 'tU1', kind: 'json_op', label: '建用户消息role', type: 'logic', x: 2750, y: -120, config: { source: '{}', key: 'role', value: 'user', mode: 'set' } },
      { id: 'tU2', kind: 'json_op', label: '建用户消息content', type: 'logic', x: 3000, y: -120, config: { key: 'content', mode: 'set' } },
      { id: 'tU3', kind: 'json_op', label: '解析用户消息', type: 'logic', x: 3250, y: -120, config: { mode: 'get', key: '$' } },
      { id: 'tU4', kind: 'persistent_op', label: '追加用户消息', type: 'data', x: 3500, y: -120, config: { mode: 'list_append', key: 'chat_history', scope: 'user' } },
      // 追加AI回复到历史
      { id: 'tA1', kind: 'json_op', label: '建AI消息role', type: 'logic', x: 3750, y: -120, config: { source: '{}', key: 'role', value: 'assistant', mode: 'set' } },
      { id: 'tA2', kind: 'json_op', label: '建AI消息content', type: 'logic', x: 4000, y: -120, config: { key: 'content', mode: 'set' } },
      { id: 'tA3', kind: 'json_op', label: '解析AI消息', type: 'logic', x: 4250, y: -120, config: { mode: 'get', key: '$' } },
      { id: 'tA4', kind: 'persistent_op', label: '追加AI消息', type: 'data', x: 4500, y: -120, config: { mode: 'list_append', key: 'chat_history', scope: 'user' } },
      // 格式化 → 发送 → 设置冷却 → 自增计数
      { id: 't8', kind: 'format_text', label: '格式化', type: 'logic', x: 4750, y: -120, config: { template: '{var1}' } },
      { id: 't9', kind: 'send_message', label: '发送回复', type: 'action', x: 5000, y: -120, config: {} },
      { id: 'tCD', kind: 'persistent_op', label: '设置冷却', type: 'data', x: 5250, y: -120, config: { mode: 'set', key: 'chat', scope: 'user', cooldown_seconds: 30 } },
      { id: 'tCC', kind: 'persistent_op', label: '对话计数+1', type: 'action', x: 5500, y: -120, config: { mode: 'increment', key: 'chat_count', scope: 'user', amount: 1, default: 0 } },
      // false 分支（冷却中）：提示
      { id: 't10', kind: 'format_text', label: '冷却提示', type: 'logic', x: 1000, y: 200, config: { template: '冷却中，请稍后再试~' } },
      { id: 't11', kind: 'send_message', label: '发送提示', type: 'action', x: 1250, y: 200, config: {} },
      // ════════════ 链2 · /清空 指令 ════════════
      { id: 'c1', kind: 'on_message', label: '/清空', type: 'trigger', x: 0, y: 400, config: { match: 'command', command: '清空', prefix: '/' } },
      { id: 'c2', kind: 'persistent_op', label: '删除历史', type: 'data', x: 250, y: 400, config: { mode: 'delete', key: 'chat_history', scope: 'user' } },
      { id: 'c3', kind: 'format_text', label: '清空提示', type: 'logic', x: 500, y: 400, config: { template: '对话历史已清空~' } },
      { id: 'c4', kind: 'send_message', label: '发送', type: 'action', x: 750, y: 400, config: {} },
      // ════════════ 链3 · /人设 切换 AI 性格 ════════════
      { id: 'p1', kind: 'on_message', label: '人设指令', type: 'trigger', x: 0, y: 600, config: { match: 'command', command: '人设', prefix: '/' } },
      { id: 'p2', kind: 'get_context', label: '取人设参数', type: 'logic', x: 250, y: 600, config: { mode: 'command_args', index: 0 } },
      { id: 'p3', kind: 'switch_case', label: '匹配人设', type: 'logic', x: 500, y: 600, config: { cases: '[{"match":"可爱","label":"可爱"},{"match":"严肃","label":"严肃"},{"match":"毒舌","label":"毒舌"}]', default: '默认' } },
      // 可爱分支
      { id: 'p4', kind: 'persistent_op', label: '保存可爱人设', type: 'data', x: 750, y: 480, config: { mode: 'save', key: 'ai_persona', scope: 'user', value: '你是一个可爱的AI助手，说话带~和颜文字' } },
      { id: 'p5', kind: 'format_text', label: '可爱提示', type: 'logic', x: 1000, y: 480, config: { template: '已切换为可爱模式~' } },
      { id: 'p6', kind: 'send_message', label: '发送', type: 'action', x: 1250, y: 480, config: {} },
      // 严肃分支
      { id: 'p7', kind: 'persistent_op', label: '保存严肃人设', type: 'data', x: 750, y: 600, config: { mode: 'save', key: 'ai_persona', scope: 'user', value: '你是一个严肃的AI助手，回答专业简洁' } },
      { id: 'p8', kind: 'format_text', label: '严肃提示', type: 'logic', x: 1000, y: 600, config: { template: '已切换为严肃模式' } },
      { id: 'p9', kind: 'send_message', label: '发送', type: 'action', x: 1250, y: 600, config: {} },
      // 毒舌分支
      { id: 'p10', kind: 'persistent_op', label: '保存毒舌人设', type: 'data', x: 750, y: 720, config: { mode: 'save', key: 'ai_persona', scope: 'user', value: '你是一个毒舌AI助手，回答带讽刺但有帮助' } },
      { id: 'p11', kind: 'format_text', label: '毒舌提示', type: 'logic', x: 1000, y: 720, config: { template: '已切换为毒舌模式~哼' } },
      { id: 'p12', kind: 'send_message', label: '发送', type: 'action', x: 1250, y: 720, config: {} },
      // 默认分支
      { id: 'p13', kind: 'format_text', label: '未知人设提示', type: 'logic', x: 750, y: 840, config: { template: '未知人设，可选：可爱/严肃/毒舌' } },
      { id: 'p14', kind: 'send_message', label: '发送', type: 'action', x: 1000, y: 840, config: {} },
      // ════════════ 链4 · /帮助 ════════════
      { id: 'h1', kind: 'on_message', label: '帮助指令', type: 'trigger', x: 1500, y: 0, config: { match: 'command', command: '帮助', prefix: '/' } },
      { id: 'h2', kind: 'format_text', label: '帮助列表', type: 'logic', x: 1500, y: 100, config: { template: 'AI聊天机器人指令列表：\n@机器人 - 触发对话\n/清空 - 清空对话历史\n/人设 可爱|严肃|毒舌 - 切换AI性格\n/温度 0-2 - 设置采样温度\n/记忆长度 4-100 - 设置记忆条数\n/统计 - 查看对话统计\n/重置人设 - 恢复默认人设\n/拉黑 @用户 - 管理员拉黑\n/解拉黑 @用户 - 解除拉黑\n/黑名单 - 查看黑名单' } },
      { id: 'h3', kind: 'send_message', label: '发送', type: 'action', x: 1500, y: 200, config: {} },
      // ════════════ 链5 · /温度 ════════════
      { id: 'te1', kind: 'on_message', label: '温度指令', type: 'trigger', x: 1900, y: 0, config: { match: 'command', command: '温度', prefix: '/' } },
      { id: 'te2', kind: 'get_context', label: '取温度参数', type: 'logic', x: 1900, y: 100, config: { mode: 'command_args', index: 0 } },
      { id: 'te3', kind: 'persistent_op', label: '保存温度', type: 'data', x: 1900, y: 200, config: { mode: 'save', key: 'ai_temperature', scope: 'user' } },
      { id: 'te4', kind: 'format_text', label: '温度提示', type: 'logic', x: 1900, y: 300, config: { template: '采样温度已设置为 {var1}' } },
      { id: 'te5', kind: 'send_message', label: '发送', type: 'action', x: 1900, y: 400, config: {} },
      // ════════════ 链6 · /记忆长度 ════════════
      { id: 'ml1', kind: 'on_message', label: '记忆长度指令', type: 'trigger', x: 2300, y: 0, config: { match: 'command', command: '记忆长度', prefix: '/' } },
      { id: 'ml2', kind: 'get_context', label: '取长度参数', type: 'logic', x: 2300, y: 100, config: { mode: 'command_args', index: 0 } },
      { id: 'ml3', kind: 'persistent_op', label: '保存记忆长度', type: 'data', x: 2300, y: 200, config: { mode: 'save', key: 'ai_mem_length', scope: 'user' } },
      { id: 'ml4', kind: 'format_text', label: '记忆长度提示', type: 'logic', x: 2300, y: 300, config: { template: '记忆长度已设置为 {var1} 条' } },
      { id: 'ml5', kind: 'send_message', label: '发送', type: 'action', x: 2300, y: 400, config: {} },
      // ════════════ 链7 · 关键词触发 ════════════
      { id: 'kw1', kind: 'on_message', label: '消息监听', type: 'trigger', x: 2700, y: 0, config: {} },
      { id: 'kwCC1', kind: 'persistent_op', label: '冷却检查', type: 'data', x: 2700, y: 50, config: { mode: 'check', key: 'kw_cooldown', scope: 'user', cooldown_seconds: 30 } },
      { id: 'kwCC2', kind: 'if_branch', label: '是否可触发', type: 'logic', x: 2700, y: 75, config: { expression: 'value' } },
      { id: 'kwCC3', kind: 'flow_control', label: '冷却中返回', type: 'logic', x: 2950, y: 75, config: { mode: 'return' } },
      { id: 'kw2', kind: 'get_context', label: '取消息文本', type: 'logic', x: 2700, y: 100, config: { mode: 'message_text' } },
      { id: 'kw3', kind: 'if_branch', label: '含关键词？', type: 'logic', x: 2700, y: 200, config: { expression: "not value.startswith('/') and ('AI' in value or '人工智能' in value or '机器人' in value)" } },
      // 黑名单拦截
      { id: 'kwBL1', kind: 'get_context', label: '取用户ID', type: 'logic', x: 2700, y: 300, config: { mode: 'user_id' } },
      { id: 'kwBL2', kind: 'persistent_op', label: '加载黑名单', type: 'data', x: 2700, y: 400, config: { mode: 'load', key: 'ai_blacklist', scope: 'group' } },
      { id: 'kwBL3', kind: 'expression_eval', label: '黑名单检查', type: 'logic', x: 2700, y: 500, config: { expression: 'v1 in v2 if v2 else False' } },
      { id: 'kwBL4', kind: 'if_branch', label: '是否拉黑', type: 'logic', x: 2700, y: 600, config: { expression: 'value' } },
      { id: 'kwBL5', kind: 'flow_control', label: '拦截返回', type: 'logic', x: 2900, y: 600, config: { mode: 'return' } },
      { id: 'kw4', kind: 'persistent_op', label: '加载历史', type: 'data', x: 2700, y: 700, config: { mode: 'load', key: 'chat_history', scope: 'user' } },
      { id: 'kw5b', kind: 'persistent_op', label: '加载人设', type: 'data', x: 2700, y: 770, config: { mode: 'load', key: 'ai_persona', scope: 'user' } },
      { id: 'kw5c', kind: 'expression_eval', label: '人设回退', type: 'logic', x: 3800, y: 60, config: { expression: "v1 if v1 else '你是一个友好的AI助手'" } },
      { id: 'kwTE1', kind: 'persistent_op', label: '加载温度', type: 'data', x: 2700, y: 810, config: { mode: 'load', key: 'ai_temperature', scope: 'user' } },
      { id: 'kwTE2', kind: 'expression_eval', label: '温度转float', type: 'logic', x: 2700, y: 840, config: { expression: 'float(v1) if v1 else 0.7' } },
      { id: 'kwMM1', kind: 'persistent_op', label: '加载记忆长度', type: 'data', x: 2700, y: 870, config: { mode: 'load', key: 'ai_mem_length', scope: 'user' } },
      { id: 'kwMM2', kind: 'expression_eval', label: '记忆转int', type: 'logic', x: 2700, y: 900, config: { expression: 'int(v1) if v1 else 20' } },
      { id: 'kw5', kind: 'llm_chat', label: 'AI回复', type: 'ai', x: 2700, y: 940, config: { system_prompt: '你是一个友好的AI助手', temperature: 0.7 } },
      // 追加用户消息到历史（json_op(set) 构建 dict → json_op(get) 解析 → listAppend）
      { id: 'kwU1', kind: 'json_op', label: '建用户消息role', type: 'logic', x: 2700, y: 980, config: { source: '{}', key: 'role', value: 'user', mode: 'set' } },
      { id: 'kwU2', kind: 'json_op', label: '建用户消息content', type: 'logic', x: 2700, y: 1010, config: { key: 'content', mode: 'set' } },
      { id: 'kwU3', kind: 'json_op', label: '解析用户消息', type: 'logic', x: 2700, y: 1040, config: { mode: 'get', key: '$' } },
      { id: 'kw6a', kind: 'persistent_op', label: '追加用户消息', type: 'data', x: 2700, y: 1070, config: { mode: 'list_append', key: 'chat_history', scope: 'user' } },
      // 追加AI回复到历史
      { id: 'kwA1', kind: 'json_op', label: '建AI消息role', type: 'logic', x: 2700, y: 1100, config: { source: '{}', key: 'role', value: 'assistant', mode: 'set' } },
      { id: 'kwA2', kind: 'json_op', label: '建AI消息content', type: 'logic', x: 2700, y: 1130, config: { key: 'content', mode: 'set' } },
      { id: 'kwA3', kind: 'json_op', label: '解析AI消息', type: 'logic', x: 2700, y: 1160, config: { mode: 'get', key: '$' } },
      { id: 'kw6b', kind: 'persistent_op', label: '追加AI消息', type: 'data', x: 2700, y: 1190, config: { mode: 'list_append', key: 'chat_history', scope: 'user' } },
      { id: 'kw6', kind: 'send_message', label: '发送回复', type: 'action', x: 2700, y: 1220, config: {} },
      { id: 'kwCD', kind: 'persistent_op', label: '设置冷却', type: 'data', x: 2700, y: 1250, config: { mode: 'set', key: 'kw_cooldown', scope: 'user', cooldown_seconds: 30 } },
      // ════════════ 链8 · /拉黑 ════════════
      { id: 'bl1', kind: 'on_message', label: '拉黑指令', type: 'trigger', x: 3100, y: 0, config: { match: 'command', command: '拉黑', prefix: '/' } },
      { id: 'bl2', kind: 'get_context', label: '取@对象', type: 'logic', x: 3100, y: 100, config: { mode: 'message_part', part_mode: 'at' } },
      { id: 'bl3', kind: 'persistent_op', label: '加入黑名单', type: 'data', x: 3100, y: 200, config: { mode: 'list_append', key: 'ai_blacklist', scope: 'group' } },
      { id: 'bl4', kind: 'format_text', label: '拉黑提示', type: 'logic', x: 3100, y: 300, config: { template: '已将该用户加入黑名单' } },
      { id: 'bl5', kind: 'send_message', label: '发送', type: 'action', x: 3100, y: 400, config: {} },
      // 权限检查
      { id: 'bl1b', kind: 'check_permission', label: '管理员权限', type: 'logic', x: 3100, y: 50, config: { role: 'admin' } },
      { id: 'bl1c', kind: 'if_branch', label: '有权限？', type: 'logic', x: 3100, y: 75, config: { expression: 'value' } },
      { id: 'bl1d', kind: 'format_text', label: '无权限提示', type: 'logic', x: 3350, y: 150, config: { template: '权限不足，仅管理员可执行此操作' } },
      { id: 'bl1e', kind: 'send_message', label: '发送', type: 'action', x: 3600, y: 150, config: {} },
      // ════════════ 链9 · /解拉黑 ════════════
      { id: 'ub1', kind: 'on_message', label: '解拉黑指令', type: 'trigger', x: 3500, y: 0, config: { match: 'command', command: '解拉黑', prefix: '/' } },
      { id: 'ub2', kind: 'get_context', label: '取@对象', type: 'logic', x: 3500, y: 100, config: { mode: 'message_part', part_mode: 'at' } },
      // 用 json_op(get) 过滤移出指定用户，而非删除整个黑名单列表
      { id: 'ub3a', kind: 'persistent_op', label: '加载黑名单', type: 'data', x: 3500, y: 200, config: { mode: 'load', key: 'ai_blacklist', scope: 'group' } },
      { id: 'ub3b', kind: 'format_text', label: '构建过滤表达式', type: 'logic', x: 3500, y: 300, config: { template: '$..[?(@ != "{var1}")]' } },
      { id: 'ub3c', kind: 'json_op', label: '过滤移出用户', type: 'logic', x: 3500, y: 400, config: { mode: 'get', key: '' } },
      { id: 'ub3d', kind: 'persistent_op', label: '保存黑名单', type: 'data', x: 3500, y: 500, config: { mode: 'save', key: 'ai_blacklist', scope: 'group' } },
      { id: 'ub4', kind: 'format_text', label: '解拉黑提示', type: 'logic', x: 3500, y: 600, config: { template: '已将该用户移出黑名单' } },
      { id: 'ub5', kind: 'send_message', label: '发送', type: 'action', x: 3500, y: 700, config: {} },
      // 权限检查
      { id: 'ub1b', kind: 'check_permission', label: '管理员权限', type: 'logic', x: 3500, y: 50, config: { role: 'admin' } },
      { id: 'ub1c', kind: 'if_branch', label: '有权限？', type: 'logic', x: 3500, y: 75, config: { expression: 'value' } },
      { id: 'ub1d', kind: 'format_text', label: '无权限提示', type: 'logic', x: 3750, y: 150, config: { template: '权限不足，仅管理员可执行此操作' } },
      { id: 'ub1e', kind: 'send_message', label: '发送', type: 'action', x: 4000, y: 150, config: {} },
      // ════════════ 链10 · 主动发言 ════════════
      { id: 'ar1', kind: 'on_message', label: '消息监听', type: 'trigger', x: 3900, y: 0, config: {} },
      { id: 'arCC1', kind: 'persistent_op', label: '冷却检查', type: 'data', x: 3900, y: 50, config: { mode: 'check', key: 'proactive_cooldown', scope: 'user', cooldown_seconds: 60 } },
      { id: 'arCC2', kind: 'if_branch', label: '是否可触发', type: 'logic', x: 3900, y: 75, config: { expression: 'value' } },
      { id: 'arCC3', kind: 'return_chain', label: '冷却中返回', type: 'logic', x: 4150, y: 75, config: {} },
      { id: 'ar2', kind: 'random', label: '随机数', type: 'logic', x: 3900, y: 100, config: { mode: 'int', min: 0, max: 50 } },
      { id: 'ar3', kind: 'if_branch', label: '是否触发？', type: 'logic', x: 3900, y: 200, config: { expression: 'value <= 3' } },
      // 黑名单拦截
      { id: 'arBL1', kind: 'get_context', label: '取用户ID', type: 'logic', x: 3900, y: 300, config: { mode: 'user_id' } },
      { id: 'arBL2', kind: 'persistent_op', label: '加载黑名单', type: 'data', x: 3900, y: 330, config: { mode: 'load', key: 'ai_blacklist', scope: 'group' } },
      { id: 'arBL3', kind: 'expression_eval', label: '黑名单检查', type: 'logic', x: 3900, y: 360, config: { expression: 'v1 in v2 if v2 else False' } },
      { id: 'arBL4', kind: 'if_branch', label: '是否拉黑', type: 'logic', x: 3900, y: 390, config: { expression: 'value' } },
      { id: 'arBL5', kind: 'flow_control', label: '拦截返回', type: 'logic', x: 4150, y: 390, config: { mode: 'return' } },
      // 加载历史/温度/记忆长度
      { id: 'ar4', kind: 'get_context', label: '取消息文本', type: 'logic', x: 3900, y: 430, config: { mode: 'message_text' } },
      { id: 'arH1', kind: 'persistent_op', label: '加载历史', type: 'data', x: 3900, y: 460, config: { mode: 'load', key: 'chat_history', scope: 'user' } },
      { id: 'arTE1', kind: 'persistent_op', label: '加载温度', type: 'data', x: 3900, y: 490, config: { mode: 'load', key: 'ai_temperature', scope: 'user' } },
      { id: 'arTE2', kind: 'expression_eval', label: '温度转float', type: 'logic', x: 3900, y: 520, config: { expression: 'float(v1) if v1 else 0.9' } },
      { id: 'arMM1', kind: 'persistent_op', label: '加载记忆长度', type: 'data', x: 3900, y: 550, config: { mode: 'load', key: 'ai_mem_length', scope: 'user' } },
      { id: 'arMM2', kind: 'expression_eval', label: '记忆转int', type: 'logic', x: 3900, y: 580, config: { expression: 'int(v1) if v1 else 20' } },
      { id: 'ar5', kind: 'llm_chat', label: 'AI发言', type: 'ai', x: 3900, y: 620, config: { system_prompt: '你是一个友好的群友，偶尔自然地参与群聊', temperature: 0.9 } },
      { id: 'ar6', kind: 'send_message', label: '发送', type: 'action', x: 3900, y: 660, config: {} },
      { id: 'arCD', kind: 'persistent_op', label: '设置冷却', type: 'data', x: 3900, y: 690, config: { mode: 'set', key: 'proactive_cooldown', scope: 'user', cooldown_seconds: 60 } },
      // ════════════ 链11 · /统计 ════════════
      { id: 'st1', kind: 'on_message', label: '统计指令', type: 'trigger', x: 4300, y: 0, config: { match: 'command', command: '统计', prefix: '/' } },
      { id: 'st2', kind: 'persistent_op', label: '读对话次数', type: 'data', x: 4300, y: 100, config: { mode: 'load', key: 'chat_count', scope: 'user' } },
      { id: 'st3', kind: 'format_text', label: '统计展示', type: 'logic', x: 4300, y: 200, config: { template: '你的对话统计：\n对话次数：{var1}' } },
      { id: 'st4', kind: 'send_message', label: '发送', type: 'action', x: 4300, y: 300, config: {} },
      // ════════════ 链12 · /重置人设 ════════════
      { id: 'rp1', kind: 'on_message', label: '重置人设指令', type: 'trigger', x: 4700, y: 0, config: { match: 'command', command: '重置人设', prefix: '/' } },
      { id: 'rp2', kind: 'persistent_op', label: '删除人设', type: 'data', x: 4700, y: 100, config: { mode: 'delete', key: 'ai_persona', scope: 'user' } },
      { id: 'rp3', kind: 'format_text', label: '重置提示', type: 'logic', x: 4700, y: 200, config: { template: '人设已重置为默认模式' } },
      { id: 'rp4', kind: 'send_message', label: '发送', type: 'action', x: 4700, y: 300, config: {} },
      // ════════════ 链13 · 入群引导 ════════════
      { id: 'wn1', kind: 'on_notice', label: '入群通知', type: 'trigger', x: 5100, y: 0, config: { notice_type: 'group_increase' } },
      { id: 'wn2', kind: 'format_text', label: '欢迎文本', type: 'logic', x: 5100, y: 100, config: { template: '欢迎新道友加入本群！\n我是AI聊天机器人，@我可以对话，输入 /帮助 查看更多功能~' } },
      { id: 'wn3', kind: 'send_message', label: '发送', type: 'action', x: 5100, y: 200, config: {} },
      // ════════════ 链14 · /黑名单 ════════════
      { id: 'vb1', kind: 'on_message', label: '黑名单指令', type: 'trigger', x: 5500, y: 0, config: { match: 'command', command: '黑名单', prefix: '/' } },
      { id: 'vb2', kind: 'persistent_op', label: '读黑名单', type: 'data', x: 5500, y: 100, config: { mode: 'load', key: 'ai_blacklist', scope: 'group' } },
      { id: 'vb3', kind: 'format_text', label: '黑名单展示', type: 'logic', x: 5500, y: 200, config: { template: '当前黑名单：\n{var1}' } },
      { id: 'vb4', kind: 'send_message', label: '发送', type: 'action', x: 5500, y: 300, config: {} },
      // ════════════ 链15 · 退群提示 ════════════
      { id: 'ln1', kind: 'on_notice', label: '退群通知', type: 'trigger', x: 5900, y: 0, config: { notice_type: 'group_decrease' } },
      { id: 'ln2', kind: 'format_text', label: '退群文本', type: 'logic', x: 5900, y: 100, config: { template: '有成员离开了本群...' } },
      { id: 'ln3', kind: 'send_message', label: '发送', type: 'action', x: 5900, y: 200, config: {} },
      // ════════════ 链16 · 智能意图识别（自然语言配置，无需指令） ════════════
      { id: 'ic0', kind: 'on_message', label: '消息监听', type: 'trigger', x: 6300, y: 0, config: {} },
      { id: 'ic1', kind: 'get_context', label: '取消息文本', type: 'logic', x: 6300, y: 100, config: { mode: 'message_text' } },
      { id: 'ic2', kind: 'if_branch', label: '含配置关键词？', type: 'logic', x: 6300, y: 200, config: { expression: "not value.startswith('/') and ('温度' in value or '人设' in value or '清空' in value or '记忆' in value or '可爱' in value or '严肃' in value or '毒舌' in value or '性格' in value or '重置' in value)" } },
      // true: 含配置关键词 → LLM意图识别
      { id: 'ic3', kind: 'llm_chat', label: '意图识别', type: 'ai', x: 6300, y: 320, config: { system_prompt: '你是意图识别助手。根据用户消息判断意图，只返回以下标签之一（不要其他内容）：\nPERSONA_CUTE（切换可爱人设）\nPERSONA_SERIOUS（切换严肃人设）\nPERSONA_POISON（切换毒舌人设）\nCLEAR_HISTORY（清空对话历史）\nRESET_PERSONA（重置人设）\nOTHER（其他意图）', temperature: 0.1 } },
      { id: 'ic4', kind: 'switch_case', label: '意图路由', type: 'logic', x: 6300, y: 420, config: { cases: '[{"match":"PERSONA_CUTE","label":"可爱"},{"match":"PERSONA_SERIOUS","label":"严肃"},{"match":"PERSONA_POISON","label":"毒舌"},{"match":"CLEAR_HISTORY","label":"清空"},{"match":"RESET_PERSONA","label":"重置"}]', default: '其他' } },
      // 可爱人设
      { id: 'ic5', kind: 'persistent_op', label: '保存可爱人设', type: 'data', x: 6300, y: 540, config: { mode: 'save', key: 'ai_persona', scope: 'user', value: '你是一个可爱的AI助手，说话带~和颜文字' } },
      { id: 'ic6', kind: 'format_text', label: '可爱提示', type: 'logic', x: 6300, y: 640, config: { template: '已切换为可爱模式~' } },
      { id: 'ic7', kind: 'send_message', label: '发送', type: 'action', x: 6300, y: 740, config: {} },
      // 严肃人设
      { id: 'ic8', kind: 'persistent_op', label: '保存严肃人设', type: 'data', x: 6600, y: 540, config: { mode: 'save', key: 'ai_persona', scope: 'user', value: '你是一个严肃的AI助手，回答专业简洁' } },
      { id: 'ic9', kind: 'format_text', label: '严肃提示', type: 'logic', x: 6600, y: 640, config: { template: '已切换为严肃模式' } },
      { id: 'ic10', kind: 'send_message', label: '发送', type: 'action', x: 6600, y: 740, config: {} },
      // 毒舌人设
      { id: 'ic11', kind: 'persistent_op', label: '保存毒舌人设', type: 'data', x: 6900, y: 540, config: { mode: 'save', key: 'ai_persona', scope: 'user', value: '你是一个毒舌AI助手，回答带讽刺但有帮助' } },
      { id: 'ic12', kind: 'format_text', label: '毒舌提示', type: 'logic', x: 6900, y: 640, config: { template: '已切换为毒舌模式~哼' } },
      { id: 'ic13', kind: 'send_message', label: '发送', type: 'action', x: 6900, y: 740, config: {} },
      // 清空历史
      { id: 'ic14', kind: 'persistent_op', label: '删除历史', type: 'data', x: 7200, y: 540, config: { mode: 'delete', key: 'chat_history', scope: 'user' } },
      { id: 'ic15', kind: 'format_text', label: '清空提示', type: 'logic', x: 7200, y: 640, config: { template: '对话历史已清空~' } },
      { id: 'ic16', kind: 'send_message', label: '发送', type: 'action', x: 7200, y: 740, config: {} },
      // 重置人设
      { id: 'ic17', kind: 'persistent_op', label: '删除人设', type: 'data', x: 7500, y: 540, config: { mode: 'delete', key: 'ai_persona', scope: 'user' } },
      { id: 'ic18', kind: 'format_text', label: '重置提示', type: 'logic', x: 7500, y: 640, config: { template: '人设已重置为默认模式' } },
      { id: 'ic19', kind: 'send_message', label: '发送', type: 'action', x: 7500, y: 740, config: {} },
      // 其他意图
      { id: 'ic20', kind: 'format_text', label: '未识别', type: 'logic', x: 7800, y: 540, config: { template: '未识别到配置意图，可用自然语言说：\n你变可爱点 / 切换严肃模式 / 清空记忆 / 重置性格' } },
      { id: 'ic21', kind: 'send_message', label: '发送', type: 'action', x: 7800, y: 640, config: {} }
    ]),
    edges: buildEdges([
      // ── 链1 控制流 ──
      { source: 't1', target: 't2' },
      { source: 't2', target: 't3' },
      { source: 't3', target: 't4' },
      { source: 't4', target: 'tBL1', sourcePort: 'true' },
      { source: 't4', target: 't10', sourcePort: 'false' },
      { source: 'tBL1', target: 'tBL2' },
      { source: 'tBL2', target: 'tBL3' },
      { source: 'tBL3', target: 'tBL4' },
      { source: 'tBL4', target: 'tBL5', sourcePort: 'true' },
      { source: 'tBL4', target: 't5', sourcePort: 'false' },
      { source: 't5', target: 't5b' },
      { source: 't5b', target: 't5c' },
      { source: 't5c', target: 'tTE1' },
      { source: 'tTE1', target: 'tTE2' },
      { source: 'tTE2', target: 'tMM1' },
      { source: 'tMM1', target: 'tMM2' },
      { source: 'tMM2', target: 't6' },
      { source: 't6', target: 'tU1' },
      { source: 'tU1', target: 'tU2' },
      { source: 'tU2', target: 'tU3' },
      { source: 'tU3', target: 'tU4' },
      { source: 'tU4', target: 'tA1' },
      { source: 'tA1', target: 'tA2' },
      { source: 'tA2', target: 'tA3' },
      { source: 'tA3', target: 'tA4' },
      { source: 'tA4', target: 't8' },
      { source: 't8', target: 't9' },
      { source: 't9', target: 'tCD' },
      { source: 'tCD', target: 'tCC' },
      { source: 't10', target: 't11' },
      // ── 链1 数据流 ──
      { source: 't3', target: 't4', sourcePort: 'ready', targetPort: 'value' },
      { source: 'tBL1', target: 'tBL3', sourcePort: 'result', targetPort: 'v1' },
      { source: 'tBL2', target: 'tBL3', sourcePort: 'result', targetPort: 'v2' },
      { source: 'tBL3', target: 'tBL4', sourcePort: 'result', targetPort: 'value' },
      { source: 't2', target: 't6', sourcePort: 'result', targetPort: 'prompt' },
      { source: 't5', target: 't6', sourcePort: 'result', targetPort: 'history' },
      { source: 't5b', target: 't5c', sourcePort: 'result', targetPort: 'v1' },
      { source: 't5c', target: 't6', sourcePort: 'result', targetPort: 'system_prompt' },
      { source: 'tTE2', target: 't6', sourcePort: 'result', targetPort: 'temperature' },
      { source: 'tTE1', target: 'tTE2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'tMM1', target: 'tMM2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'tU1', target: 'tU2', sourcePort: 'result', targetPort: 'source' },
      { source: 't2', target: 'tU2', sourcePort: 'result', targetPort: 'value' },
      { source: 'tU2', target: 'tU3', sourcePort: 'result', targetPort: 'source' },
      { source: 'tU3', target: 'tU4', sourcePort: 'result', targetPort: 'item' },
      { source: 'tMM2', target: 'tU4', sourcePort: 'result', targetPort: 'max_length' },
      { source: 'tA1', target: 'tA2', sourcePort: 'result', targetPort: 'source' },
      { source: 't6', target: 'tA2', sourcePort: 'response', targetPort: 'value' },
      { source: 'tA2', target: 'tA3', sourcePort: 'result', targetPort: 'source' },
      { source: 'tA3', target: 'tA4', sourcePort: 'result', targetPort: 'item' },
      { source: 'tMM2', target: 'tA4', sourcePort: 'result', targetPort: 'max_length' },
      { source: 't6', target: 't8', sourcePort: 'response', targetPort: 'var1' },
      { source: 't8', target: 't9', sourcePort: 'result', targetPort: 'text' },
      { source: 't10', target: 't11', sourcePort: 'result', targetPort: 'text' },
      // ── 链2 控制流 ──
      { source: 'c1', target: 'c2' },
      { source: 'c2', target: 'c3' },
      { source: 'c3', target: 'c4' },
      // ── 链2 数据流 ──
      { source: 'c3', target: 'c4', sourcePort: 'result', targetPort: 'text' },
      // ── 链3 控制流: /人设 ──
      { source: 'p1', target: 'p2' },
      { source: 'p2', target: 'p3' },
      { source: 'p3', target: 'p4', sourcePort: '可爱' },
      { source: 'p4', target: 'p5' },
      { source: 'p5', target: 'p6' },
      { source: 'p3', target: 'p7', sourcePort: '严肃' },
      { source: 'p7', target: 'p8' },
      { source: 'p8', target: 'p9' },
      { source: 'p3', target: 'p10', sourcePort: '毒舌' },
      { source: 'p10', target: 'p11' },
      { source: 'p11', target: 'p12' },
      { source: 'p3', target: 'p13', sourcePort: '默认' },
      { source: 'p13', target: 'p14' },
      // ── 链3 数据流 ──
      { source: 'p2', target: 'p3', sourcePort: 'result', targetPort: 'value' },
      { source: 'p5', target: 'p6', sourcePort: 'result', targetPort: 'text' },
      { source: 'p8', target: 'p9', sourcePort: 'result', targetPort: 'text' },
      { source: 'p11', target: 'p12', sourcePort: 'result', targetPort: 'text' },
      { source: 'p13', target: 'p14', sourcePort: 'result', targetPort: 'text' },
      // ── 链4 控制流: /帮助 ──
      { source: 'h1', target: 'h2' },
      { source: 'h2', target: 'h3' },
      // ── 链4 数据流 ──
      { source: 'h2', target: 'h3', sourcePort: 'result', targetPort: 'text' },
      // ── 链5 控制流: /温度 ──
      { source: 'te1', target: 'te2' },
      { source: 'te2', target: 'te3' },
      { source: 'te3', target: 'te4' },
      { source: 'te4', target: 'te5' },
      // ── 链5 数据流 ──
      { source: 'te2', target: 'te3', sourcePort: 'result', targetPort: 'value' },
      { source: 'te2', target: 'te4', sourcePort: 'result', targetPort: 'var1' },
      { source: 'te4', target: 'te5', sourcePort: 'result', targetPort: 'text' },
      // ── 链6 控制流: /记忆长度 ──
      { source: 'ml1', target: 'ml2' },
      { source: 'ml2', target: 'ml3' },
      { source: 'ml3', target: 'ml4' },
      { source: 'ml4', target: 'ml5' },
      // ── 链6 数据流 ──
      { source: 'ml2', target: 'ml3', sourcePort: 'result', targetPort: 'value' },
      { source: 'ml2', target: 'ml4', sourcePort: 'result', targetPort: 'var1' },
      { source: 'ml4', target: 'ml5', sourcePort: 'result', targetPort: 'text' },
      // ── 链7 控制流: 关键词触发 ──
      { source: 'kw1', target: 'kwCC1' },
      { source: 'kwCC1', target: 'kwCC2' },
      { source: 'kwCC2', target: 'kw2', sourcePort: 'true' },
      { source: 'kwCC2', target: 'kwCC3', sourcePort: 'false' },
      { source: 'kw2', target: 'kw3' },
      { source: 'kw3', target: 'kwBL1', sourcePort: 'true' },
      { source: 'kwBL1', target: 'kwBL2' },
      { source: 'kwBL2', target: 'kwBL3' },
      { source: 'kwBL3', target: 'kwBL4' },
      { source: 'kwBL4', target: 'kwBL5', sourcePort: 'true' },
      { source: 'kwBL4', target: 'kw4', sourcePort: 'false' },
      { source: 'kw4', target: 'kw5b' },
      { source: 'kw5b', target: 'kw5c' },
      { source: 'kw5c', target: 'kwTE1' },
      { source: 'kwTE1', target: 'kwTE2' },
      { source: 'kwTE2', target: 'kwMM1' },
      { source: 'kwMM1', target: 'kwMM2' },
      { source: 'kwMM2', target: 'kw5' },
      { source: 'kw5', target: 'kwU1' },
      { source: 'kwU1', target: 'kwU2' },
      { source: 'kwU2', target: 'kwU3' },
      { source: 'kwU3', target: 'kw6a' },
      { source: 'kw6a', target: 'kwA1' },
      { source: 'kwA1', target: 'kwA2' },
      { source: 'kwA2', target: 'kwA3' },
      { source: 'kwA3', target: 'kw6b' },
      { source: 'kw6b', target: 'kw6' },
      { source: 'kw6', target: 'kwCD' },
      // ── 链7 数据流 ──
      { source: 'kwCC1', target: 'kwCC2', sourcePort: 'ready', targetPort: 'value' },
      { source: 'kw2', target: 'kw3', sourcePort: 'result', targetPort: 'value' },
      { source: 'kwBL1', target: 'kwBL3', sourcePort: 'result', targetPort: 'v1' },
      { source: 'kwBL2', target: 'kwBL3', sourcePort: 'result', targetPort: 'v2' },
      { source: 'kwBL3', target: 'kwBL4', sourcePort: 'result', targetPort: 'value' },
      { source: 'kw2', target: 'kw5', sourcePort: 'result', targetPort: 'prompt' },
      { source: 'kw4', target: 'kw5', sourcePort: 'result', targetPort: 'history' },
      { source: 'kw5b', target: 'kw5c', sourcePort: 'result', targetPort: 'v1' },
      { source: 'kw5c', target: 'kw5', sourcePort: 'result', targetPort: 'system_prompt' },
      { source: 'kwTE1', target: 'kwTE2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'kwTE2', target: 'kw5', sourcePort: 'result', targetPort: 'temperature' },
      { source: 'kwMM1', target: 'kwMM2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'kwU1', target: 'kwU2', sourcePort: 'result', targetPort: 'source' },
      { source: 'kw2', target: 'kwU2', sourcePort: 'result', targetPort: 'value' },
      { source: 'kwU2', target: 'kwU3', sourcePort: 'result', targetPort: 'source' },
      { source: 'kwU3', target: 'kw6a', sourcePort: 'result', targetPort: 'item' },
      { source: 'kwMM2', target: 'kw6a', sourcePort: 'result', targetPort: 'max_length' },
      { source: 'kwA1', target: 'kwA2', sourcePort: 'result', targetPort: 'source' },
      { source: 'kw5', target: 'kwA2', sourcePort: 'response', targetPort: 'value' },
      { source: 'kwA2', target: 'kwA3', sourcePort: 'result', targetPort: 'source' },
      { source: 'kwA3', target: 'kw6b', sourcePort: 'result', targetPort: 'item' },
      { source: 'kwMM2', target: 'kw6b', sourcePort: 'result', targetPort: 'max_length' },
      { source: 'kw5', target: 'kw6', sourcePort: 'response', targetPort: 'text' },
      // ── 链8 控制流: /拉黑 ──
      { source: 'bl1', target: 'bl1b' },
      { source: 'bl1b', target: 'bl1c' },
      { source: 'bl1c', target: 'bl2', sourcePort: 'true' },
      { source: 'bl1c', target: 'bl1d', sourcePort: 'false' },
      { source: 'bl1d', target: 'bl1e' },
      { source: 'bl2', target: 'bl3' },
      { source: 'bl3', target: 'bl4' },
      { source: 'bl4', target: 'bl5' },
      // ── 链8 数据流 ──
      { source: 'bl1b', target: 'bl1c', sourcePort: 'passed', targetPort: 'value' },
      { source: 'bl2', target: 'bl3', sourcePort: 'current', targetPort: 'item' },
      { source: 'bl4', target: 'bl5', sourcePort: 'result', targetPort: 'text' },
      { source: 'bl1d', target: 'bl1e', sourcePort: 'result', targetPort: 'text' },
      // ── 链9 控制流: /解拉黑 ──
      { source: 'ub1', target: 'ub1b' },
      { source: 'ub1b', target: 'ub1c' },
      { source: 'ub1c', target: 'ub2', sourcePort: 'true' },
      { source: 'ub1c', target: 'ub1d', sourcePort: 'false' },
      { source: 'ub1d', target: 'ub1e' },
      { source: 'ub2', target: 'ub3a' },
      { source: 'ub3a', target: 'ub3b' },
      { source: 'ub3b', target: 'ub3c' },
      { source: 'ub3c', target: 'ub3d' },
      { source: 'ub3d', target: 'ub4' },
      { source: 'ub4', target: 'ub5' },
      // ── 链9 数据流 ──
      { source: 'ub1b', target: 'ub1c', sourcePort: 'passed', targetPort: 'value' },
      { source: 'ub2', target: 'ub3b', sourcePort: 'current', targetPort: 'var1' },
      { source: 'ub3b', target: 'ub3c', sourcePort: 'result', targetPort: 'expression' },
      { source: 'ub3a', target: 'ub3c', sourcePort: 'result', targetPort: 'source' },
      { source: 'ub3c', target: 'ub3d', sourcePort: 'result', targetPort: 'value' },
      { source: 'ub4', target: 'ub5', sourcePort: 'result', targetPort: 'text' },
      { source: 'ub1d', target: 'ub1e', sourcePort: 'result', targetPort: 'text' },
      // ── 链10 控制流: 主动发言 ──
      { source: 'ar1', target: 'arCC1' },
      { source: 'arCC1', target: 'arCC2' },
      { source: 'arCC2', target: 'ar2', sourcePort: 'true' },
      { source: 'arCC2', target: 'arCC3', sourcePort: 'false' },
      { source: 'ar2', target: 'ar3' },
      { source: 'ar3', target: 'arBL1', sourcePort: 'true' },
      { source: 'arBL1', target: 'arBL2' },
      { source: 'arBL2', target: 'arBL3' },
      { source: 'arBL3', target: 'arBL4' },
      { source: 'arBL4', target: 'arBL5', sourcePort: 'true' },
      { source: 'arBL4', target: 'ar4', sourcePort: 'false' },
      { source: 'ar4', target: 'arH1' },
      { source: 'arH1', target: 'arTE1' },
      { source: 'arTE1', target: 'arTE2' },
      { source: 'arTE2', target: 'arMM1' },
      { source: 'arMM1', target: 'arMM2' },
      { source: 'arMM2', target: 'ar5' },
      { source: 'ar5', target: 'ar6' },
      { source: 'ar6', target: 'arCD' },
      // ── 链10 数据流 ──
      { source: 'arCC1', target: 'arCC2', sourcePort: 'ready', targetPort: 'value' },
      { source: 'ar2', target: 'ar3', sourcePort: 'result', targetPort: 'value' },
      { source: 'arBL1', target: 'arBL3', sourcePort: 'result', targetPort: 'v1' },
      { source: 'arBL2', target: 'arBL3', sourcePort: 'result', targetPort: 'v2' },
      { source: 'arBL3', target: 'arBL4', sourcePort: 'result', targetPort: 'value' },
      { source: 'ar4', target: 'ar5', sourcePort: 'result', targetPort: 'prompt' },
      { source: 'arH1', target: 'ar5', sourcePort: 'result', targetPort: 'history' },
      { source: 'arTE1', target: 'arTE2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'arTE2', target: 'ar5', sourcePort: 'result', targetPort: 'temperature' },
      { source: 'arMM1', target: 'arMM2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'ar5', target: 'ar6', sourcePort: 'response', targetPort: 'text' },
      // ── 链11 控制流: /统计 ──
      { source: 'st1', target: 'st2' },
      { source: 'st2', target: 'st3' },
      { source: 'st3', target: 'st4' },
      // ── 链11 数据流 ──
      { source: 'st2', target: 'st3', sourcePort: 'result', targetPort: 'var1' },
      { source: 'st3', target: 'st4', sourcePort: 'result', targetPort: 'text' },
      // ── 链12 控制流: /重置人设 ──
      { source: 'rp1', target: 'rp2' },
      { source: 'rp2', target: 'rp3' },
      { source: 'rp3', target: 'rp4' },
      // ── 链12 数据流 ──
      { source: 'rp3', target: 'rp4', sourcePort: 'result', targetPort: 'text' },
      // ── 链13 控制流: 入群引导 ──
      { source: 'wn1', target: 'wn2' },
      { source: 'wn2', target: 'wn3' },
      // ── 链13 数据流 ──
      { source: 'wn2', target: 'wn3', sourcePort: 'result', targetPort: 'text' },
      // ── 链14 控制流: /黑名单 ──
      { source: 'vb1', target: 'vb2' },
      { source: 'vb2', target: 'vb3' },
      { source: 'vb3', target: 'vb4' },
      // ── 链14 数据流 ──
      { source: 'vb2', target: 'vb3', sourcePort: 'result', targetPort: 'var1' },
      { source: 'vb3', target: 'vb4', sourcePort: 'result', targetPort: 'text' },
      // ── 链15 控制流: 退群提示 ──
      { source: 'ln1', target: 'ln2' },
      { source: 'ln2', target: 'ln3' },
      // ── 链15 数据流 ──
      { source: 'ln2', target: 'ln3', sourcePort: 'result', targetPort: 'text' },
      // ── 链16 控制流: 智能意图识别 ──
      { source: 'ic0', target: 'ic1' },
      { source: 'ic1', target: 'ic2' },
      { source: 'ic2', target: 'ic3', sourcePort: 'true' },
      { source: 'ic3', target: 'ic4' },
      { source: 'ic4', target: 'ic5', sourcePort: '可爱' },
      { source: 'ic5', target: 'ic6' },
      { source: 'ic6', target: 'ic7' },
      { source: 'ic4', target: 'ic8', sourcePort: '严肃' },
      { source: 'ic8', target: 'ic9' },
      { source: 'ic9', target: 'ic10' },
      { source: 'ic4', target: 'ic11', sourcePort: '毒舌' },
      { source: 'ic11', target: 'ic12' },
      { source: 'ic12', target: 'ic13' },
      { source: 'ic4', target: 'ic14', sourcePort: '清空' },
      { source: 'ic14', target: 'ic15' },
      { source: 'ic15', target: 'ic16' },
      { source: 'ic4', target: 'ic17', sourcePort: '重置' },
      { source: 'ic17', target: 'ic18' },
      { source: 'ic18', target: 'ic19' },
      { source: 'ic4', target: 'ic20', sourcePort: '其他' },
      { source: 'ic20', target: 'ic21' },
      // ── 链16 数据流 ──
      { source: 'ic1', target: 'ic2', sourcePort: 'result', targetPort: 'value' },
      { source: 'ic1', target: 'ic3', sourcePort: 'result', targetPort: 'prompt' },
      { source: 'ic3', target: 'ic4', sourcePort: 'response', targetPort: 'value' },
      { source: 'ic6', target: 'ic7', sourcePort: 'result', targetPort: 'text' },
      { source: 'ic9', target: 'ic10', sourcePort: 'result', targetPort: 'text' },
      { source: 'ic12', target: 'ic13', sourcePort: 'result', targetPort: 'text' },
      { source: 'ic15', target: 'ic16', sourcePort: 'result', targetPort: 'text' },
      { source: 'ic18', target: 'ic19', sourcePort: 'result', targetPort: 'text' },
      { source: 'ic20', target: 'ic21', sourcePort: 'result', targetPort: 'text' }
    ]),
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0'
  },
  // 4. 挂机修仙游戏 — 修炼/收获/突破/境界/排行榜，挂机修仙多系统
  {
    id: 'builtin-cultivation',
    botCategory: 'game',
    name: '挂机修仙游戏',
    description: '挂机修仙：/修炼 /收获 /突破 /境界 /排行 /商店 /购买 /帮助 /签到 /打坐 /炼丹 /功法 /灵根 /秘境 /宗门 /渡劫 /属性 /药园 /出售药材 /轮回 /飞升，21条指令系统完整修仙（含轮回转生+飞升双进阶系统）',
    category: '其他',
    tags: ['修仙', '挂机', '修炼', '突破', '境界', '商店', '购买', '游戏', '帮助', '签到', '打坐', '炼丹', '功法', '灵根', '秘境', '宗门', '渡劫', '属性', '药园', '出售', '轮回', '飞升'],
    author: '内置',
    nodes: buildNodes([
      // ════════════ 链1 · /修炼 ════════════
      { id: 'c1', kind: 'on_message', label: '修炼指令', type: 'trigger', x: 0, y: 0, config: { match: 'command', command: '修炼', prefix: '/' } },
      { id: 'c2', kind: 'time_op', label: '当前时间', type: 'logic', x: 0, y: 100, config: { mode: 'now', fmt: '' } },
      { id: 'c3', kind: 'persistent_op', label: '记录修炼开始', type: 'data', x: 0, y: 200, config: { mode: 'save', key: 'cultivate_start', scope: 'user' } },
      { id: 'c4', kind: 'format_text', label: '修炼回复', type: 'logic', x: 0, y: 300, config: { template: '开始闭关修炼...归来后用 /收获 领取收益' } },
      { id: 'c5', kind: 'send_message', label: '发送消息', type: 'action', x: 0, y: 400, config: { text: '' } },
      // ════════════ 链2 · /收获 ════════════
      { id: 'h1', kind: 'on_message', label: '收获指令', type: 'trigger', x: 350, y: 0, config: { match: 'command', command: '收获', prefix: '/' } },
      { id: 'h2', kind: 'persistent_op', label: '读修炼开始时间', type: 'data', x: 350, y: 100, config: { mode: 'load', key: 'cultivate_start', scope: 'user' } },
      { id: 'h2b', kind: 'persistent_op', label: '读修炼加成', type: 'data', x: 350, y: 130, config: { mode: 'load', key: 'cultivate_bonus', scope: 'user' } },
      { id: 'h2c', kind: 'persistent_op', label: '读闭关令', type: 'data', x: 350, y: 160, config: { mode: 'load', key: 'retreat_pass', scope: 'user' } },
      { id: 'h3', kind: 'if_branch', label: '是否修炼中？', type: 'logic', x: 350, y: 200, config: { expression: 'value is not None' } },
      // true: 修炼中 → 结算
      { id: 'h4', kind: 'time_op', label: '当前时间', type: 'logic', x: 350, y: 300, config: { mode: 'now', fmt: '' } },
      { id: 'h5', kind: 'expression_eval', label: '计算修炼经验', type: 'logic', x: 350, y: 400, config: { expression: 'max(1, int((v2 - v1) / 60)) * (1 + v3) if v3 else max(1, int((v2 - v1) / 60))' } },
      { id: 'h5b', kind: 'expression_eval', label: '计算灵石收益', type: 'logic', x: 350, y: 450, config: { expression: 'max(1, int((v2 - v1) / 120))' } },
      { id: 'h6', kind: 'persistent_op', label: '经验+', type: 'action', x: 350, y: 500, config: { mode: 'increment', key: 'exp', scope: 'user', default: 0, amount: 0 } },
      { id: 'h7', kind: 'persistent_op', label: '灵石+', type: 'action', x: 350, y: 600, config: { mode: 'increment', key: 'stone', scope: 'user', default: 0, amount: 0 } },
      { id: 'h7b', kind: 'if_branch', label: '有闭关令？', type: 'logic', x: 620, y: 600, config: { expression: 'value' } },
      { id: 'h7c', kind: 'persistent_op', label: '额外经验+500', type: 'action', x: 870, y: 580, config: { mode: 'increment', key: 'exp', amount: 500, scope: 'user', default: 0 } },
      { id: 'h7d', kind: 'persistent_op', label: '消耗闭关令', type: 'data', x: 870, y: 680, config: { mode: 'delete', key: 'retreat_pass', scope: 'user' } },
      { id: 'h8', kind: 'persistent_op', label: '清除修炼状态', type: 'data', x: 350, y: 700, config: { mode: 'delete', key: 'cultivate_start', scope: 'user' } },
      { id: 'h9', kind: 'format_text', label: '收获回复', type: 'logic', x: 350, y: 800, config: { template: '闭关修炼归来！获得经验 +{var1}，灵石 +{var2}' } },
      { id: 'h10', kind: 'send_message', label: '发送消息', type: 'action', x: 350, y: 900, config: { text: '' } },
      // false: 未修炼
      { id: 'hf1', kind: 'format_text', label: '未修炼提示', type: 'logic', x: 620, y: 300, config: { template: '还未开始修炼，用 /修炼 开始' } },
      { id: 'hf2', kind: 'send_message', label: '发送消息', type: 'action', x: 620, y: 400, config: { text: '' } },
      // ════════════ 链3 · /突破 ════════════
      { id: 'b1', kind: 'on_message', label: '突破指令', type: 'trigger', x: 800, y: 0, config: { match: 'command', command: '突破', prefix: '/' } },
      { id: 'b2', kind: 'persistent_op', label: '读经验', type: 'data', x: 800, y: 100, config: { mode: 'load', key: 'exp', scope: 'user' } },
      { id: 'b3', kind: 'persistent_op', label: '读境界', type: 'data', x: 800, y: 200, config: { mode: 'load', key: 'level', scope: 'user' } },
      { id: 'b2d', kind: 'persistent_op', label: '读护身符', type: 'data', x: 800, y: 230, config: { mode: 'load', key: 'talisman', scope: 'user' } },
      { id: 'b4b', kind: 'if_branch', label: '已达最高境界？', type: 'logic', x: 800, y: 250, config: { expression: 'value >= 5' } },
      { id: 'b4', kind: 'expression_eval', label: '检查突破条件', type: 'logic', x: 800, y: 340, config: { expression: 'v1 >= 30000 if v2 >= 4 else (v1 >= 8000 if v2 >= 3 else (v1 >= 2000 if v2 >= 2 else (v1 >= 500 if v2 >= 1 else v1 >= 100)))' } },
      { id: 'b5', kind: 'if_branch', label: '可突破？', type: 'logic', x: 800, y: 420, config: { expression: 'value' } },
      // true: 经验足够 → 随机判定
      { id: 'b5b', kind: 'random', label: '突破随机数', type: 'logic', x: 800, y: 460, config: { mode: 'int', min: 0, max: 100 } },
      { id: 'b5c', kind: 'expression_eval', label: '突破成功判定', type: 'logic', x: 800, y: 490, config: { expression: 'v1 >= 30 if v2 is not None else v1 >= 60' } },
      { id: 'b5d', kind: 'if_branch', label: '突破成功？', type: 'logic', x: 800, y: 510, config: { expression: 'value' } },
      // true: 突破成功
      { id: 'b6', kind: 'persistent_op', label: '境界+1', type: 'action', x: 800, y: 560, config: { mode: 'increment', key: 'level', scope: 'user', amount: 1, default: 0 } },
      { id: 'b6b', kind: 'persistent_op', label: '扣除经验-100', type: 'action', x: 800, y: 600, config: { mode: 'increment', key: 'exp', amount: -100, scope: 'user', default: 0 } },
      { id: 'b6c', kind: 'persistent_op', label: '消耗护身符', type: 'data', x: 800, y: 640, config: { mode: 'delete', key: 'talisman', scope: 'user' } },
      { id: 'b7', kind: 'format_text', label: '突破成功', type: 'logic', x: 800, y: 680, config: { template: '突破成功！境界提升！消耗100经验' } },
      // false: 随机失败
      { id: 'bf1b', kind: 'format_text', label: '突破失败(随机)', type: 'logic', x: 1070, y: 510, config: { template: '突破失败！天意未至，下次再试' } },
      { id: 'bf2b', kind: 'send_message', label: '发送消息', type: 'action', x: 1070, y: 570, config: { text: '' } },
      // 最高境界提示
      { id: 'bf3', kind: 'format_text', label: '已达最高', type: 'logic', x: 1070, y: 300, config: { template: '已达最高境界（化神期），无法继续突破' } },
      { id: 'bf4', kind: 'send_message', label: '发送消息', type: 'action', x: 1070, y: 400, config: { text: '' } },
      { id: 'b8', kind: 'send_message', label: '发送消息', type: 'action', x: 800, y: 700, config: { text: '' } },
      // false: 经验不足
      { id: 'bf1', kind: 'format_text', label: '突破失败', type: 'logic', x: 1070, y: 500, config: { template: '经验不足，无法突破' } },
      { id: 'bf2', kind: 'send_message', label: '发送消息', type: 'action', x: 1070, y: 600, config: { text: '' } },
      // ════════════ 链4 · /境界 ════════════
      { id: 'j1', kind: 'on_message', label: '境界指令', type: 'trigger', x: 1250, y: 0, config: { match: 'command', command: '境界', prefix: '/' } },
      { id: 'j2', kind: 'persistent_op', label: '读境界', type: 'data', x: 1250, y: 100, config: { mode: 'load', key: 'level', scope: 'user' } },
      { id: 'j3', kind: 'expression_eval', label: '境界名称', type: 'logic', x: 1250, y: 200, config: { expression: "'化神' if v1 >= 5 else ('元婴' if v1 >= 4 else ('金丹' if v1 >= 3 else ('筑基' if v1 >= 2 else ('练气' if v1 >= 1 else '散修'))))" } },
      { id: 'j4', kind: 'format_text', label: '境界回复', type: 'logic', x: 1250, y: 300, config: { template: '你的当前境界：{var1}' } },
      { id: 'j5', kind: 'send_message', label: '发送消息', type: 'action', x: 1250, y: 400, config: { text: '' } },
      // ════════════ 链5 · /排行榜 ════════════
      // p1 触发 → p2 SQL 查 Top10 修为 → p3 expression_eval 格式化 → p4 发送
      // 注：原 persistent_op (leaderboard) 已移除，改用 query + expression_eval 通用组合
      { id: 'p1', kind: 'on_message', label: '排行榜指令', type: 'trigger', x: 1600, y: 0, config: { match: 'command', command: '排行榜', prefix: '/' } },
      { id: 'p2', kind: 'query', label: '查修为排行', type: 'data', x: 1600, y: 100, config: { mode: 'sort', key_pattern: 'user_*:exp', scope: 'user', sort_by: 'value', order: 'desc', limit: 10 } },
      { id: 'p3', kind: 'expression_eval', label: '格式化排行', type: 'logic', x: 1600, y: 200, config: { expression: "'🏆 修为排行榜 Top10:\\n' + '\\n'.join([f'{i+1}. QQ{r[0]} - 修为{r[1]}' for i, r in enumerate(v1)])" } },
      { id: 'p4', kind: 'send_message', label: '发送排行', type: 'action', x: 1600, y: 300, config: { text: '' } },
      // ════════════ 链6 · /商店 ════════════
      { id: 'sh1', kind: 'on_message', label: '商店指令', type: 'trigger', x: 1950, y: 0, config: { match: 'command', command: '商店', prefix: '/' } },
      { id: 'sh2', kind: 'format_text', label: '商店列表', type: 'logic', x: 1950, y: 100, config: { template: '修仙商店：\n1.修炼加速符(100灵石) - 立即获得500经验\n2.护身符(200灵石) - 突破成功率提升\n3.闭关令(500灵石) - 收获时额外获得500修为\n输入 /购买 序号' } },
      { id: 'sh3', kind: 'send_message', label: '发送商店', type: 'action', x: 1950, y: 200, config: {} },
      // ════════════ 链7 · /购买（switch_case 三种道具） ════════════
      { id: 'bp0', kind: 'on_message', label: '购买指令', type: 'trigger', x: 2300, y: 0, config: { match: 'command', command: '购买', prefix: '/' } },
      { id: 'bp1', kind: 'get_context', label: '取序号', type: 'logic', x: 2300, y: 100, config: { mode: 'command_args', index: 0 } },
      { id: 'bp2', kind: 'switch_case', label: '选择道具', type: 'logic', x: 2300, y: 200, config: { cases: '[{"match":"1","label":"1"},{"match":"2","label":"2"},{"match":"3","label":"3"}]', default: '未知' } },
      // 序号1: 修炼加速符（100灵石 → +500经验）
      { id: 'bp3a', kind: 'persistent_op', label: '读灵石(序号1)', type: 'data', x: 2100, y: 300, config: { mode: 'load', key: 'stone', scope: 'user' } },
      { id: 'bp3b', kind: 'if_branch', label: '灵石>=100?', type: 'logic', x: 2100, y: 360, config: { expression: 'value >= 100' } },
      { id: 'bp3', kind: 'persistent_op', label: '扣100灵石', type: 'action', x: 2100, y: 440, config: { mode: 'increment', key: 'stone', amount: -100, scope: 'user', default: 0 } },
      { id: 'bp4', kind: 'persistent_op', label: '加500经验', type: 'action', x: 2100, y: 520, config: { mode: 'increment', key: 'exp', amount: 500, scope: 'user', default: 0 } },
      { id: 'bp5', kind: 'format_text', label: '加速符成功', type: 'logic', x: 2100, y: 600, config: { template: '购买修炼加速符！扣除100灵石，获得500经验。' } },
      { id: 'bp6', kind: 'send_message', label: '发送', type: 'action', x: 2100, y: 680, config: { text: '' } },
      { id: 'bp3c', kind: 'format_text', label: '灵石不足(序号1)', type: 'logic', x: 1900, y: 440, config: { template: '灵石不足！需要100灵石' } },
      { id: 'bp3d', kind: 'send_message', label: '发送', type: 'action', x: 1900, y: 540, config: {} },
      // 序号2: 护身符（200灵石）
      { id: 'bp7a', kind: 'persistent_op', label: '读灵石(序号2)', type: 'data', x: 2500, y: 300, config: { mode: 'load', key: 'stone', scope: 'user' } },
      { id: 'bp7b', kind: 'if_branch', label: '灵石>=200?', type: 'logic', x: 2500, y: 360, config: { expression: 'value >= 200' } },
      { id: 'bp7', kind: 'persistent_op', label: '扣200灵石', type: 'action', x: 2500, y: 440, config: { mode: 'increment', key: 'stone', amount: -200, scope: 'user', default: 0 } },
      { id: 'bp8', kind: 'persistent_op', label: '保存护身符', type: 'data', x: 2500, y: 520, config: { mode: 'save', key: 'talisman', scope: 'user', value: true } },
      { id: 'bp9', kind: 'format_text', label: '护身符成功', type: 'logic', x: 2500, y: 600, config: { template: '购买护身符！扣除200灵石，突破时成功率提升。' } },
      { id: 'bp10', kind: 'send_message', label: '发送', type: 'action', x: 2500, y: 680, config: { text: '' } },
      { id: 'bp7c', kind: 'format_text', label: '灵石不足(序号2)', type: 'logic', x: 2350, y: 440, config: { template: '灵石不足！需要200灵石' } },
      { id: 'bp7d', kind: 'send_message', label: '发送', type: 'action', x: 2350, y: 540, config: {} },
      // 序号3: 闭关令（500灵石）
      { id: 'bp11a', kind: 'persistent_op', label: '读灵石(序号3)', type: 'data', x: 2900, y: 300, config: { mode: 'load', key: 'stone', scope: 'user' } },
      { id: 'bp11b', kind: 'if_branch', label: '灵石>=500?', type: 'logic', x: 2900, y: 360, config: { expression: 'value >= 500' } },
      { id: 'bp11', kind: 'persistent_op', label: '扣500灵石', type: 'action', x: 2900, y: 440, config: { mode: 'increment', key: 'stone', amount: -500, scope: 'user', default: 0 } },
      { id: 'bp12', kind: 'persistent_op', label: '保存闭关令', type: 'data', x: 2900, y: 520, config: { mode: 'save', key: 'retreat_pass', scope: 'user', value: true } },
      { id: 'bp13', kind: 'format_text', label: '闭关令成功', type: 'logic', x: 2900, y: 600, config: { template: '购买闭关令！扣除500灵石，收获时额外获得500修为。' } },
      { id: 'bp14', kind: 'send_message', label: '发送', type: 'action', x: 2900, y: 680, config: { text: '' } },
      { id: 'bp11c', kind: 'format_text', label: '灵石不足(序号3)', type: 'logic', x: 2750, y: 440, config: { template: '灵石不足！需要500灵石' } },
      { id: 'bp11d', kind: 'send_message', label: '发送', type: 'action', x: 2750, y: 540, config: {} },
      // 未知序号
      { id: 'bp15', kind: 'format_text', label: '未知序号', type: 'logic', x: 3200, y: 320, config: { template: '未知序号！商店出售：1.修炼加速符 2.护身符 3.闭关令' } },
      { id: 'bp16', kind: 'send_message', label: '发送', type: 'action', x: 3200, y: 420, config: { text: '' } },
      // ════════════ 链8 · /帮助 ════════════
      { id: 'xh1', kind: 'on_message', label: '帮助指令', type: 'trigger', x: 3550, y: 0, config: { match: 'command', command: '帮助', prefix: '/' } },
      { id: 'xh2', kind: 'format_text', label: '指令列表', type: 'logic', x: 3550, y: 100, config: { template: '修仙指令列表：\n/修炼 开始闭关\n/收获 领取修炼收益\n/突破 提升境界\n/境界 查看境界\n/排行榜 修为排行\n/商店 查看商店\n/购买 序号 购买道具\n/签到 每日签到\n/打坐 打坐修炼\n/炼丹 炼制丹药\n/功法 查看功法\n/灵根 查看灵根\n/秘境 探索秘境\n/宗门 宗门系统\n/渡劫 渡劫飞升\n/属性 详细属性\n/药园 灵田种药\n/出售 出售药材\n/轮回 轮回转生\n/飞升 飞升进阶' } },
      { id: 'xh3', kind: 'send_message', label: '发送消息', type: 'action', x: 3550, y: 200, config: {} },
      // ════════════ 链9 · /签到 ════════════
      { id: 'qd1', kind: 'on_message', label: '签到指令', type: 'trigger', x: 3950, y: 0, config: { match: 'command', command: '签到', prefix: '/' } },
      { id: 'qd2', kind: 'persistent_op', label: '读上次签到日期', type: 'data', x: 3950, y: 100, config: { mode: 'load', key: 'xiuxian_sign_date', scope: 'user' } },
      { id: 'qd2b', kind: 'time_op', label: '今天日期', type: 'logic', x: 3950, y: 140, config: { mode: 'now', fmt: '%Y-%m-%d' } },
      { id: 'qd2c', kind: 'expression_eval', label: '比较日期', type: 'logic', x: 3950, y: 180, config: { expression: 'v1 == v2' } },
      { id: 'qd3', kind: 'if_branch', label: '已签到？', type: 'logic', x: 3950, y: 220, config: { expression: 'value' } },
      // true: 已签到
      { id: 'qd4', kind: 'format_text', label: '已签到提示', type: 'logic', x: 3950, y: 340, config: { template: '今天已经签到过了，明天再来吧~' } },
      { id: 'qd5', kind: 'send_message', label: '发送消息', type: 'action', x: 3950, y: 440, config: {} },
      // false: 未签到
      { id: 'qd6', kind: 'time_op', label: '当前日期', type: 'logic', x: 4350, y: 340, config: { mode: 'now', fmt: '%Y-%m-%d' } },
      { id: 'qd7', kind: 'persistent_op', label: '保存签到日期', type: 'data', x: 4350, y: 440, config: { mode: 'save', key: 'xiuxian_sign_date', scope: 'user' } },
      { id: 'qd8', kind: 'persistent_op', label: '灵石+500', type: 'action', x: 4350, y: 540, config: { mode: 'increment', key: 'stone', amount: 500, scope: 'user', default: 0 } },
      { id: 'qd9', kind: 'persistent_op', label: '修为+200', type: 'action', x: 4350, y: 640, config: { mode: 'increment', key: 'exp', amount: 200, scope: 'user', default: 0 } },
      { id: 'qd10', kind: 'format_text', label: '签到成功', type: 'logic', x: 4350, y: 740, config: { template: '签到成功！获得500灵石、200修为' } },
      { id: 'qd11', kind: 'send_message', label: '发送消息', type: 'action', x: 4350, y: 840, config: {} },
      // ════════════ 链10 · /打坐 ════════════
      { id: 'dz1', kind: 'on_message', label: '打坐指令', type: 'trigger', x: 4750, y: 0, config: { match: 'command', command: '打坐', prefix: '/' } },
      { id: 'dz1b', kind: 'persistent_op', label: '打坐冷却检查', type: 'data', x: 4750, y: 50, config: { mode: 'check', key: 'meditate', scope: 'user', cooldown_seconds: 3600 } },
      { id: 'dz1c', kind: 'if_branch', label: '打坐冷却OK?', type: 'logic', x: 4750, y: 80, config: { expression: 'value' } },
      { id: 'dz1d', kind: 'format_text', label: '打坐冷却中', type: 'logic', x: 4550, y: 80, config: { template: '打坐冷却中，请1小时后再试' } },
      { id: 'dz1e', kind: 'send_message', label: '发送', type: 'action', x: 4550, y: 180, config: {} },
      { id: 'dz2b', kind: 'persistent_op', label: '经验+50', type: 'action', x: 4750, y: 100, config: { mode: 'increment', key: 'exp', amount: 50, scope: 'user', default: 0 } },
      { id: 'dz2c', kind: 'persistent_op', label: '设置打坐冷却', type: 'data', x: 4750, y: 140, config: { mode: 'set', key: 'meditate', scope: 'user', cooldown_seconds: 3600 } },
      { id: 'dz4', kind: 'format_text', label: '打坐回复', type: 'logic', x: 4750, y: 200, config: { template: '打坐冥想结束，心神合一，修为+50' } },
      { id: 'dz5', kind: 'send_message', label: '发送消息', type: 'action', x: 4750, y: 300, config: {} },
      // ════════════ 链11 · /炼丹 ════════════
      { id: 'ld1', kind: 'on_message', label: '炼丹指令', type: 'trigger', x: 5150, y: 0, config: { match: 'command', command: '炼丹', prefix: '/' } },
      { id: 'ld2', kind: 'persistent_op', label: '读药材', type: 'data', x: 5150, y: 100, config: { mode: 'load', key: 'herbs', scope: 'user' } },
      { id: 'ld3', kind: 'if_branch', label: '有药材？', type: 'logic', x: 5150, y: 200, config: { expression: 'value is not None and value >= 1' } },
      // true: 有药材
      { id: 'ld4', kind: 'persistent_op', label: '药材-1', type: 'action', x: 5150, y: 320, config: { mode: 'increment', key: 'herbs', amount: -1, scope: 'user', default: 0 } },
      { id: 'ld5', kind: 'random', label: '炼丹结果', type: 'logic', x: 5150, y: 420, config: { mode: 'choice', list: ['成功炼制回气丹！', '成功炼制培元丹！', '炼丹失败，药材损毁...', '成功炼制筑基丹！'] } },
      { id: 'ld6', kind: 'format_text', label: '炼丹回复', type: 'logic', x: 5150, y: 520, config: { template: '{var1}' } },
      { id: 'ld7', kind: 'send_message', label: '发送消息', type: 'action', x: 5150, y: 620, config: {} },
      // false: 无药材
      { id: 'ld8', kind: 'format_text', label: '药材不足', type: 'logic', x: 5550, y: 320, config: { template: '药材不足！可通过 /药园 种植或 /秘境 探索获取' } },
      { id: 'ld9', kind: 'send_message', label: '发送消息', type: 'action', x: 5550, y: 420, config: {} },
      // ════════════ 链12 · /功法 ════════════
      { id: 'gf1', kind: 'on_message', label: '功法指令', type: 'trigger', x: 5950, y: 0, config: { match: 'command', command: '功法', prefix: '/' } },
      { id: 'gf2', kind: 'persistent_op', label: '读功法', type: 'data', x: 5950, y: 100, config: { mode: 'load', key: 'gongfa', scope: 'user' } },
      { id: 'gf3', kind: 'if_branch', label: '有功法？', type: 'logic', x: 5950, y: 200, config: { expression: 'value is not None' } },
      // true: 有功法
      { id: 'gf4', kind: 'format_text', label: '功法回复', type: 'logic', x: 5950, y: 320, config: { template: '当前功法：{var1}' } },
      { id: 'gf5', kind: 'send_message', label: '发送消息', type: 'action', x: 5950, y: 420, config: {} },
      // false: 无功法
      { id: 'gf6', kind: 'format_text', label: '无功法', type: 'logic', x: 6350, y: 320, config: { template: '尚未学习功法。/灵根 觉醒后可自动获得基础功法' } },
      { id: 'gf7', kind: 'send_message', label: '发送消息', type: 'action', x: 6350, y: 420, config: {} },
      // ════════════ 链13 · /灵根 ════════════
      { id: 'lg1', kind: 'on_message', label: '灵根指令', type: 'trigger', x: 6750, y: 0, config: { match: 'command', command: '灵根', prefix: '/' } },
      { id: 'lg2', kind: 'persistent_op', label: '读灵根', type: 'data', x: 6750, y: 100, config: { mode: 'load', key: 'linggen', scope: 'user' } },
      { id: 'lg3', kind: 'if_branch', label: '有灵根？', type: 'logic', x: 6750, y: 200, config: { expression: 'value is not None' } },
      // true: 有灵根
      { id: 'lg4', kind: 'format_text', label: '灵根回复', type: 'logic', x: 6750, y: 320, config: { template: '你的灵根：{var1}' } },
      { id: 'lg5', kind: 'send_message', label: '发送消息', type: 'action', x: 6750, y: 420, config: {} },
      // false: 无灵根→觉醒
      { id: 'lg6', kind: 'random', label: '随机灵根', type: 'logic', x: 7150, y: 320, config: { mode: 'choice', list: ['天灵根', '地灵根', '玄灵根', '黄灵根', '混沌灵根', '变异灵根'] } },
      { id: 'lg7', kind: 'persistent_op', label: '保存灵根', type: 'data', x: 7150, y: 420, config: { mode: 'save', key: 'linggen', scope: 'user' } },
      { id: 'lg7b', kind: 'persistent_op', label: '赠送基础功法', type: 'data', x: 7150, y: 460, config: { mode: 'save', key: 'gongfa', scope: 'user', value: '基础吐纳功法' } },
      { id: 'lg7c', kind: 'expression_eval', label: '灵根加成', type: 'logic', x: 7150, y: 500, config: { expression: "2 if v1 == '天灵根' else (1 if v1 == '地灵根' else 0)" } },
      { id: 'lg7e', kind: 'persistent_op', label: '修炼加成', type: 'action', x: 7150, y: 540, config: { mode: 'increment', key: 'cultivate_bonus', scope: 'user', default: 0 } },
      { id: 'lg8', kind: 'format_text', label: '觉醒回复', type: 'logic', x: 7150, y: 580, config: { template: '灵根觉醒！你获得了 {var1}，修炼速度将受灵根影响。已赠送基础吐纳功法！' } },
      { id: 'lg9', kind: 'send_message', label: '发送消息', type: 'action', x: 7150, y: 680, config: {} },
      // ════════════ 链14 · /秘境 ════════════
      { id: 'mj1', kind: 'on_message', label: '秘境指令', type: 'trigger', x: 7550, y: 0, config: { match: 'command', command: '秘境', prefix: '/' } },
      { id: 'mj2', kind: 'random', label: '秘境事件', type: 'logic', x: 7550, y: 100, config: { mode: 'choice', list: ['发现上古洞府！获得300修为', '采到珍稀药材！', '遇到妖兽，险胜！获得500灵石', '秘境崩塌，匆忙逃离...', '找到前辈遗宝！获得500灵石'] } },
      { id: 'mj3', kind: 'if_branch', label: '有修为？', type: 'logic', x: 7550, y: 200, config: { expression: "'修为' in value" } },
      // true: 有修为
      { id: 'mj4', kind: 'persistent_op', label: '修为+300', type: 'action', x: 7550, y: 320, config: { mode: 'increment', key: 'exp', amount: 300, scope: 'user', default: 0 } },
      { id: 'mj5', kind: 'send_message', label: '发送消息', type: 'action', x: 7550, y: 420, config: {} },
      // false → 检查灵石
      { id: 'mj6', kind: 'if_branch', label: '有灵石？', type: 'logic', x: 7950, y: 320, config: { expression: "'灵石' in value" } },
      // true: 有灵石
      { id: 'mj7', kind: 'persistent_op', label: '灵石+500', type: 'action', x: 7950, y: 440, config: { mode: 'increment', key: 'stone', amount: 500, scope: 'user', default: 0 } },
      { id: 'mj8', kind: 'send_message', label: '发送消息', type: 'action', x: 7950, y: 540, config: {} },
      // false → 检查药材
      { id: 'mj9', kind: 'if_branch', label: '有药材？', type: 'logic', x: 8350, y: 440, config: { expression: "'药材' in value" } },
      // true: 有药材
      { id: 'mj10', kind: 'persistent_op', label: '药材+1', type: 'action', x: 8350, y: 560, config: { mode: 'increment', key: 'herbs', amount: 1, scope: 'user', default: 0 } },
      { id: 'mj11', kind: 'send_message', label: '发送消息', type: 'action', x: 8350, y: 660, config: {} },
      // false: 无收益
      { id: 'mj12', kind: 'send_message', label: '发送消息', type: 'action', x: 8750, y: 560, config: {} },
      // ════════════ 链15 · /宗门 ════════════
      { id: 'zm1', kind: 'on_message', label: '宗门指令', type: 'trigger', x: 9150, y: 0, config: { match: 'command', command: '宗门', prefix: '/' } },
      { id: 'zm2', kind: 'get_context', label: '取子命令', type: 'logic', x: 9150, y: 100, config: { mode: 'command_args', index: 0 } },
      { id: 'zm3', kind: 'switch_case', label: '宗门分支', type: 'logic', x: 9150, y: 200, config: { cases: '[{"match":"加入","label":"加入"},{"match":"创建","label":"创建"},{"match":"查看","label":"查看"}]', default: '帮助' } },
      // 加入
      { id: 'zm4', kind: 'persistent_op', label: '加入散修', type: 'data', x: 9550, y: 320, config: { mode: 'save', key: 'sect', scope: 'user', value: '散修' } },
      { id: 'zm5', kind: 'format_text', label: '加入回复', type: 'logic', x: 9550, y: 420, config: { template: '你已加入散修联盟' } },
      { id: 'zm6', kind: 'send_message', label: '发送消息', type: 'action', x: 9550, y: 520, config: {} },
      // 创建
      { id: 'zm7', kind: 'persistent_op', label: '读灵石', type: 'data', x: 9950, y: 320, config: { mode: 'load', key: 'stone', scope: 'user' } },
      { id: 'zm8', kind: 'if_branch', label: '灵石够？', type: 'logic', x: 9950, y: 420, config: { expression: 'value >= 1000' } },
      // true: 够灵石
      { id: 'zm9', kind: 'persistent_op', label: '扣1000灵石', type: 'action', x: 9950, y: 540, config: { mode: 'increment', key: 'stone', amount: -1000, scope: 'user', default: 0 } },
      { id: 'zm10', kind: 'persistent_op', label: '保存宗门', type: 'data', x: 9950, y: 640, config: { mode: 'save', key: 'sect', scope: 'user', value: '自创宗门' } },
      { id: 'zm11', kind: 'format_text', label: '创建成功', type: 'logic', x: 9950, y: 740, config: { template: '宗门创建成功！消耗1000灵石' } },
      { id: 'zm12', kind: 'send_message', label: '发送消息', type: 'action', x: 9950, y: 840, config: {} },
      // false: 不够
      { id: 'zm13', kind: 'format_text', label: '灵石不足', type: 'logic', x: 10350, y: 540, config: { template: '灵石不足！创建宗门需要1000灵石' } },
      { id: 'zm14', kind: 'send_message', label: '发送消息', type: 'action', x: 10350, y: 640, config: {} },
      // 查看
      { id: 'zm15', kind: 'persistent_op', label: '读宗门', type: 'data', x: 10750, y: 320, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'zm16', kind: 'format_text', label: '查看回复', type: 'logic', x: 10750, y: 420, config: { template: '当前宗门：{var1}' } },
      { id: 'zm17', kind: 'send_message', label: '发送消息', type: 'action', x: 10750, y: 520, config: {} },
      // 帮助
      { id: 'zm18', kind: 'format_text', label: '宗门帮助', type: 'logic', x: 11150, y: 320, config: { template: '宗门系统：\n/宗门 加入 - 加入散修联盟\n/宗门 创建 - 创建宗门(1000灵石)\n/宗门 查看 - 查看宗门' } },
      { id: 'zm19', kind: 'send_message', label: '发送消息', type: 'action', x: 11150, y: 420, config: {} },
      // ════════════ 链16 · /渡劫 ════════════
      { id: 'dj1', kind: 'on_message', label: '渡劫指令', type: 'trigger', x: 11550, y: 0, config: { match: 'command', command: '渡劫', prefix: '/' } },
      { id: 'dj2', kind: 'persistent_op', label: '读境界', type: 'data', x: 11550, y: 100, config: { mode: 'load', key: 'level', scope: 'user' } },
      { id: 'dj2b', kind: 'persistent_op', label: '读护身符', type: 'data', x: 11550, y: 150, config: { mode: 'load', key: 'talisman', scope: 'user' } },
      { id: 'dj3', kind: 'if_branch', label: '境界够？', type: 'logic', x: 11550, y: 200, config: { expression: 'value is not None and value >= 3' } },
      // true: 有境界
      { id: 'dj4', kind: 'random', label: '渡劫随机数', type: 'logic', x: 11550, y: 320, config: { mode: 'int', min: 0, max: 100 } },
      { id: 'dj4b', kind: 'expression_eval', label: '渡劫成功判定', type: 'logic', x: 11550, y: 370, config: { expression: 'v1 >= 40 if v2 is not None else v1 >= 60' } },
      { id: 'dj5', kind: 'if_branch', label: '渡劫成功？', type: 'logic', x: 11550, y: 420, config: { expression: 'value' } },
      // true: 渡劫成功
      { id: 'dj6', kind: 'persistent_op', label: '修为+500', type: 'action', x: 11550, y: 540, config: { mode: 'increment', key: 'exp', amount: 500, scope: 'user', default: 0 } },
      { id: 'dj5b', kind: 'persistent_op', label: '消耗护身符', type: 'data', x: 11550, y: 590, config: { mode: 'delete', key: 'talisman', scope: 'user' } },
      { id: 'dj7', kind: 'format_text', label: '渡劫成功', type: 'logic', x: 11550, y: 640, config: { template: '渡劫成功！天雷洗礼，修为大涨500！' } },
      { id: 'dj8', kind: 'send_message', label: '发送消息', type: 'action', x: 11550, y: 740, config: {} },
      // false: 渡劫失败
      { id: 'dj9', kind: 'persistent_op', label: '修为-200', type: 'action', x: 11950, y: 540, config: { mode: 'increment', key: 'exp', amount: -200, scope: 'user', default: 0 } },
      { id: 'dj10', kind: 'format_text', label: '渡劫失败', type: 'logic', x: 11950, y: 640, config: { template: '渡劫失败！修为受损-200，下次再战天劫！' } },
      { id: 'dj11', kind: 'send_message', label: '发送消息', type: 'action', x: 11950, y: 740, config: {} },
      // false: 无境界
      { id: 'dj12', kind: 'format_text', label: '境界不足提示', type: 'logic', x: 12350, y: 320, config: { template: '境界不足！需达到金丹期(level>=3)方可渡劫' } },
      { id: 'dj13', kind: 'send_message', label: '发送消息', type: 'action', x: 12350, y: 420, config: {} },
      // ════════════ 链17 · /属性 ════════════
      { id: 'sx1', kind: 'on_message', label: '属性指令', type: 'trigger', x: 12750, y: 0, config: { match: 'command', command: '属性', prefix: '/' } },
      { id: 'sx2', kind: 'persistent_op', label: '批量读取属性', type: 'data', x: 12750, y: 100, config: { mode: 'load', keys: '["exp","stone","level","linggen","gongfa","sect","cultivate_bonus"]', scope: 'user' } },
      { id: 'sx3', kind: 'format_text', label: '属性面板', type: 'logic', x: 12750, y: 200, config: { template: '===== 修仙属性 =====\n修为: {exp}\n灵石: {stone}\n境界等级: {level}（0=散修 1=练气 2=筑基 3=金丹 4=元婴 5+=化神）\n灵根: {linggen}\n功法: {gongfa}\n宗门: {sect}\n修炼加成: {cultivate_bonus}' } },
      { id: 'sx4', kind: 'send_message', label: '发送消息', type: 'action', x: 12750, y: 300, config: {} },
      // ════════════ 链18 · /药园 ════════════
      { id: 'yy1', kind: 'on_message', label: '药园指令', type: 'trigger', x: 13150, y: 0, config: { match: 'command', command: '药园', prefix: '/' } },
      { id: 'yy0a', kind: 'persistent_op', label: '药园冷却检查', type: 'data', x: 13150, y: 30, config: { mode: 'check', key: 'garden', scope: 'user', cooldown_seconds: 3600 } },
      { id: 'yy0b', kind: 'if_branch', label: '药园冷却OK?', type: 'logic', x: 13150, y: 60, config: { expression: 'value' } },
      { id: 'yy0c', kind: 'format_text', label: '药园冷却中', type: 'logic', x: 12950, y: 60, config: { template: '药园冷却中，请1小时后再试' } },
      { id: 'yy0e', kind: 'send_message', label: '发送冷却提示', type: 'action', x: 12950, y: 160, config: {} },
      { id: 'yy0d', kind: 'persistent_op', label: '设置药园冷却', type: 'data', x: 13150, y: 130, config: { mode: 'set', key: 'garden', scope: 'user', cooldown_seconds: 3600 } },
      { id: 'yy2', kind: 'persistent_op', label: '药材+1', type: 'action', x: 13150, y: 100, config: { mode: 'increment', key: 'herbs', amount: 1, scope: 'user', default: 0 } },
      { id: 'yy3', kind: 'format_text', label: '采药回复', type: 'logic', x: 13150, y: 200, config: { template: '在灵田采收到一株灵药！药材+1（当前药材：{var1}）' } },
      { id: 'yy4', kind: 'send_message', label: '发送消息', type: 'action', x: 13150, y: 300, config: {} },
      // ════════════ 链19 · /出售药材 ════════════
      { id: 'ys1', kind: 'on_message', label: '出售指令', type: 'trigger', x: 13550, y: 0, config: { match: 'command', command: '出售药材', prefix: '/' } },
      { id: 'ys2', kind: 'persistent_op', label: '读药材', type: 'data', x: 13550, y: 100, config: { mode: 'load', key: 'herbs', scope: 'user' } },
      { id: 'ys3', kind: 'if_branch', label: '有药材？', type: 'logic', x: 13550, y: 200, config: { expression: 'value is not None and value >= 1' } },
      // true: 有药材
      { id: 'ys4', kind: 'persistent_op', label: '灵石+50', type: 'action', x: 13550, y: 320, config: { mode: 'increment', key: 'stone', amount: 50, scope: 'user', default: 0 } },
      { id: 'ys5', kind: 'persistent_op', label: '药材-1', type: 'action', x: 13550, y: 420, config: { mode: 'increment', key: 'herbs', amount: -1, scope: 'user', default: 0 } },
      { id: 'ys6', kind: 'format_text', label: '出售成功', type: 'logic', x: 13550, y: 520, config: { template: '出售药材1株，获得50灵石' } },
      { id: 'ys7', kind: 'send_message', label: '发送消息', type: 'action', x: 13550, y: 620, config: {} },
      // false: 无药材
      { id: 'ys8', kind: 'format_text', label: '无药材', type: 'logic', x: 13950, y: 320, config: { template: '没有药材可出售' } },
      { id: 'ys9', kind: 'send_message', label: '发送消息', type: 'action', x: 13950, y: 420, config: {} },
      // ════════════ 链20 · /轮回 转生系统（保留部分修为） ════════════
      { id: 'rc0', kind: 'on_message', label: '轮回指令', type: 'trigger', x: 14350, y: 0, config: { match: 'command', command: '轮回', prefix: '/' } },
      { id: 'rc1', kind: 'persistent_op', label: '读境界', type: 'data', x: 14350, y: 100, config: { mode: 'load', key: 'level', scope: 'user' } },
      { id: 'rc2', kind: 'if_branch', label: '达化神期？', type: 'logic', x: 14350, y: 200, config: { expression: 'value >= 5' } },
      // true: 满足转生条件
      { id: 'rc3', kind: 'persistent_op', label: '读经验', type: 'data', x: 14350, y: 320, config: { mode: 'load', key: 'exp', scope: 'user' } },
      { id: 'rc4', kind: 'expression_eval', label: '保留经验', type: 'logic', x: 14350, y: 400, config: { expression: 'int(v1 * 0.5)' } },
      { id: 'rc5', kind: 'persistent_op', label: '境界重置', type: 'data', x: 14350, y: 480, config: { mode: 'save', key: 'level', value: 1, scope: 'user' } },
      { id: 'rc5a', kind: 'persistent_op', label: '清除修炼状态', type: 'data', x: 14350, y: 500, config: { mode: 'delete', key: 'cultivate_start', scope: 'user' } },
      { id: 'rc5b', kind: 'persistent_op', label: '清除护身符', type: 'data', x: 14350, y: 510, config: { mode: 'delete', key: 'talisman', scope: 'user' } },
      { id: 'rc5c', kind: 'persistent_op', label: '清除闭关令', type: 'data', x: 14350, y: 520, config: { mode: 'delete', key: 'retreat_pass', scope: 'user' } },
      { id: 'rc5d', kind: 'persistent_op', label: '清除药材', type: 'data', x: 14350, y: 530, config: { mode: 'delete', key: 'herbs', scope: 'user' } },
      { id: 'rc6', kind: 'persistent_op', label: '经验保留', type: 'data', x: 14350, y: 540, config: { mode: 'save', key: 'exp', scope: 'user' } },
      { id: 'rc7', kind: 'persistent_op', label: '转生次数+1', type: 'action', x: 14350, y: 600, config: { mode: 'increment', key: 'reincarnation', amount: 1, scope: 'user', default: 0 } },
      { id: 'rc8', kind: 'persistent_op', label: '修炼加成+1', type: 'action', x: 14350, y: 660, config: { mode: 'increment', key: 'cultivate_bonus', amount: 1, scope: 'user', default: 0 } },
      { id: 'rc9', kind: 'format_text', label: '转生成功', type: 'logic', x: 14350, y: 740, config: { template: '【轮回转生成功】\n你已突破凡尘，轮回转世！\n境界重置为：练气期\n保留经验：{var1}\n转生次数：+1\n修炼加成：+1（永久修炼速度提升）\n下次修炼将更快，再次冲击化神期吧！' } },
      { id: 'rc10', kind: 'send_message', label: '发送消息', type: 'action', x: 14350, y: 840, config: {} },
      // false: 境界不足
      { id: 'rc11', kind: 'format_text', label: '境界不足', type: 'logic', x: 14650, y: 320, config: { template: '境界不足！需达到化神期（level>=5）方可轮回转生。\n当前境界等级未达标，继续修炼吧！' } },
      { id: 'rc12', kind: 'send_message', label: '发送消息', type: 'action', x: 14650, y: 420, config: {} },
      // ════════════ 链21 · /飞升 飞升系统（与轮回互补，保留境界继续变强） ════════════
      { id: 'fl0', kind: 'on_message', label: '飞升指令', type: 'trigger', x: 15050, y: 0, config: { match: 'command', command: '飞升', prefix: '/' } },
      { id: 'fl0b', kind: 'persistent_op', label: '飞升冷却检查', type: 'data', x: 15050, y: 50, config: { mode: 'check', key: 'ascension', scope: 'user', cooldown_seconds: 86400 } },
      { id: 'fl0c', kind: 'if_branch', label: '飞升冷却OK?', type: 'logic', x: 15050, y: 80, config: { expression: 'value' } },
      { id: 'fl0d', kind: 'format_text', label: '飞升冷却中', type: 'logic', x: 14850, y: 80, config: { template: '飞升冷却中，请24小时后再试' } },
      { id: 'fl0e', kind: 'send_message', label: '发送', type: 'action', x: 14850, y: 180, config: {} },
      { id: 'fl1', kind: 'persistent_op', label: '读境界', type: 'data', x: 15050, y: 100, config: { mode: 'load', key: 'level', scope: 'user' } },
      { id: 'fl2', kind: 'if_branch', label: '达化神期？', type: 'logic', x: 15050, y: 200, config: { expression: 'value >= 5' } },
      // true: 满足飞升条件 → 境界提升 + 奖励
      { id: 'fl3', kind: 'persistent_op', label: '境界+1', type: 'action', x: 15050, y: 320, config: { mode: 'increment', key: 'level', amount: 1, scope: 'user', default: 0 } },
      { id: 'fl4', kind: 'persistent_op', label: '灵石+1000', type: 'action', x: 15050, y: 380, config: { mode: 'increment', key: 'stone', amount: 1000, scope: 'user', default: 0 } },
      { id: 'fl5', kind: 'persistent_op', label: '飞升次数+1', type: 'action', x: 15050, y: 440, config: { mode: 'increment', key: 'ascension_count', amount: 1, scope: 'user', default: 0 } },
      { id: 'fl6', kind: 'persistent_op', label: '修炼加成+2', type: 'action', x: 15050, y: 500, config: { mode: 'increment', key: 'cultivate_bonus', amount: 2, scope: 'user', default: 0 } },
      { id: 'fl6b', kind: 'persistent_op', label: '设置飞升冷却', type: 'data', x: 15050, y: 540, config: { mode: 'set', key: 'ascension', scope: 'user', cooldown_seconds: 86400 } },
      { id: 'fl7', kind: 'format_text', label: '飞升成功', type: 'logic', x: 15050, y: 580, config: { template: '【飞升成功】\n你已突破化神，飞升至更高境界！\n境界提升：+1\n灵石奖励：+1000\n飞升次数：+1\n修炼加成：+2（永久修炼速度提升）\n你选择了飞升之路，继续向更高境界迈进！\n（提示：/轮回 可重置境界重新修炼，与飞升互补）' } },
      { id: 'fl8', kind: 'send_message', label: '发送消息', type: 'action', x: 15050, y: 680, config: {} },
      // false: 境界不足
      { id: 'fl9', kind: 'format_text', label: '境界不足', type: 'logic', x: 15350, y: 320, config: { template: '境界不足！需达到化神期（level>=5）方可飞升。\n当前境界等级未达标，继续修炼吧！\n（提示：飞升保留境界继续变强，/轮回 则重置境界重新修炼）' } },
      { id: 'fl10', kind: 'send_message', label: '发送消息', type: 'action', x: 15350, y: 420, config: {} }
    ]),
    edges: buildEdges([
      // 链1 控制流: /修炼
      { source: 'c1', target: 'c2' },
      { source: 'c2', target: 'c3' },
      { source: 'c3', target: 'c4' },
      { source: 'c4', target: 'c5' },
      // 链1 数据流
      { source: 'c2', target: 'c3', sourcePort: 'timestamp', targetPort: 'value' },
      { source: 'c4', target: 'c5', sourcePort: 'result', targetPort: 'text' },
      // 链2 控制流: /收获
      { source: 'h1', target: 'h2' },
      { source: 'h2', target: 'h2b' },
      { source: 'h2b', target: 'h2c' },
      { source: 'h2c', target: 'h3' },
      { source: 'h3', target: 'h4', sourcePort: 'true' },
      { source: 'h4', target: 'h5' },
      { source: 'h5', target: 'h5b' },
      { source: 'h5b', target: 'h6' },
      { source: 'h6', target: 'h7' },
      { source: 'h7', target: 'h7b' },
      { source: 'h7b', target: 'h7c', sourcePort: 'true' },
      { source: 'h7c', target: 'h7d' },
      { source: 'h7d', target: 'h8' },
      { source: 'h7b', target: 'h8', sourcePort: 'false' },
      { source: 'h8', target: 'h9' },
      { source: 'h9', target: 'h10' },
      { source: 'h3', target: 'hf1', sourcePort: 'false' },
      { source: 'hf1', target: 'hf2' },
      // 链2 数据流
      { source: 'h2', target: 'h3', sourcePort: 'result', targetPort: 'value' },
      { source: 'h2', target: 'h5', sourcePort: 'result', targetPort: 'v1' },
      { source: 'h2', target: 'h5b', sourcePort: 'result', targetPort: 'v1' },
      { source: 'h2b', target: 'h5', sourcePort: 'result', targetPort: 'v3' },
      { source: 'h2c', target: 'h7b', sourcePort: 'result', targetPort: 'value' },
      { source: 'h4', target: 'h5', sourcePort: 'timestamp', targetPort: 'v2' },
      { source: 'h4', target: 'h5b', sourcePort: 'timestamp', targetPort: 'v2' },
      { source: 'h5', target: 'h6', sourcePort: 'result', targetPort: 'amount' },
      { source: 'h5b', target: 'h7', sourcePort: 'result', targetPort: 'amount' },
      { source: 'h5', target: 'h9', sourcePort: 'result', targetPort: 'var1' },
      { source: 'h5b', target: 'h9', sourcePort: 'result', targetPort: 'var2' },
      { source: 'h9', target: 'h10', sourcePort: 'result', targetPort: 'text' },
      { source: 'hf1', target: 'hf2', sourcePort: 'result', targetPort: 'text' },
      // 链3 控制流: /突破
      { source: 'b1', target: 'b2' },
      { source: 'b2', target: 'b3' },
      { source: 'b3', target: 'b4b' },
      { source: 'b4b', target: 'bf3', sourcePort: 'true' },
      { source: 'bf3', target: 'bf4' },
      { source: 'b4b', target: 'b4', sourcePort: 'false' },
      { source: 'b4', target: 'b5' },
      { source: 'b5', target: 'b5b', sourcePort: 'true' },
      { source: 'b5b', target: 'b5c' },
      { source: 'b5c', target: 'b5d' },
      { source: 'b5d', target: 'b6', sourcePort: 'true' },
      { source: 'b5d', target: 'bf1b', sourcePort: 'false' },
      { source: 'bf1b', target: 'bf2b' },
      { source: 'b6', target: 'b6b' },
      { source: 'b6b', target: 'b6c' },
      { source: 'b6c', target: 'b7' },
      { source: 'b7', target: 'b8' },
      { source: 'b5', target: 'bf1', sourcePort: 'false' },
      { source: 'bf1', target: 'bf2' },
      // 链3 数据流
      { source: 'b3', target: 'b4b', sourcePort: 'result', targetPort: 'value' },
      { source: 'b2', target: 'b4', sourcePort: 'result', targetPort: 'v1' },
      { source: 'b3', target: 'b4', sourcePort: 'result', targetPort: 'v2' },
      { source: 'b4', target: 'b5', sourcePort: 'result', targetPort: 'value' },
      { source: 'b5b', target: 'b5c', sourcePort: 'result', targetPort: 'v1' },
      { source: 'b2d', target: 'b5c', sourcePort: 'result', targetPort: 'v2' },
      { source: 'b5c', target: 'b5d', sourcePort: 'result', targetPort: 'value' },
      { source: 'b7', target: 'b8', sourcePort: 'result', targetPort: 'text' },
      { source: 'bf1', target: 'bf2', sourcePort: 'result', targetPort: 'text' },
      { source: 'bf1b', target: 'bf2b', sourcePort: 'result', targetPort: 'text' },
      { source: 'bf3', target: 'bf4', sourcePort: 'result', targetPort: 'text' },
      // 链4 控制流: /境界
      { source: 'j1', target: 'j2' },
      { source: 'j2', target: 'j3' },
      { source: 'j3', target: 'j4' },
      { source: 'j4', target: 'j5' },
      // 链4 数据流
      { source: 'j2', target: 'j3', sourcePort: 'result', targetPort: 'v1' },
      { source: 'j3', target: 'j4', sourcePort: 'result', targetPort: 'var1' },
      { source: 'j4', target: 'j5', sourcePort: 'result', targetPort: 'text' },
      // 链5 控制流: /排行榜（4 节点链：trigger → query → expression_eval → send_message）
      { source: 'p1', target: 'p2' },
      { source: 'p2', target: 'p3' },
      { source: 'p3', target: 'p4' },
      // 链5 数据流: query.results → expression_eval.v1, expression_eval.result → send_message.text
      { source: 'p2', target: 'p3', sourcePort: 'results', targetPort: 'v1' },
      { source: 'p3', target: 'p4', sourcePort: 'result', targetPort: 'text' },
      // 链6 控制流: /商店
      { source: 'sh1', target: 'sh2' },
      { source: 'sh2', target: 'sh3' },
      // 链6 数据流
      { source: 'sh2', target: 'sh3', sourcePort: 'result', targetPort: 'text' },
      // 链7 控制流: /购买（switch_case 三分支 + 每分支余额检查）
      { source: 'bp0', target: 'bp1' },
      { source: 'bp1', target: 'bp2' },
      { source: 'bp2', target: 'bp3a', sourcePort: '1' },
      { source: 'bp3a', target: 'bp3b' },
      { source: 'bp3b', target: 'bp3', sourcePort: 'true' },
      { source: 'bp3', target: 'bp4' },
      { source: 'bp4', target: 'bp5' },
      { source: 'bp5', target: 'bp6' },
      { source: 'bp3b', target: 'bp3c', sourcePort: 'false' },
      { source: 'bp3c', target: 'bp3d' },
      { source: 'bp2', target: 'bp7a', sourcePort: '2' },
      { source: 'bp7a', target: 'bp7b' },
      { source: 'bp7b', target: 'bp7', sourcePort: 'true' },
      { source: 'bp7', target: 'bp8' },
      { source: 'bp8', target: 'bp9' },
      { source: 'bp9', target: 'bp10' },
      { source: 'bp7b', target: 'bp7c', sourcePort: 'false' },
      { source: 'bp7c', target: 'bp7d' },
      { source: 'bp2', target: 'bp11a', sourcePort: '3' },
      { source: 'bp11a', target: 'bp11b' },
      { source: 'bp11b', target: 'bp11', sourcePort: 'true' },
      { source: 'bp11', target: 'bp12' },
      { source: 'bp12', target: 'bp13' },
      { source: 'bp13', target: 'bp14' },
      { source: 'bp11b', target: 'bp11c', sourcePort: 'false' },
      { source: 'bp11c', target: 'bp11d' },
      { source: 'bp2', target: 'bp15', sourcePort: '未知' },
      { source: 'bp15', target: 'bp16' },
      // 链7 数据流
      { source: 'bp1', target: 'bp2', sourcePort: 'result', targetPort: 'value' },
      { source: 'bp3a', target: 'bp3b', sourcePort: 'result', targetPort: 'value' },
      { source: 'bp5', target: 'bp6', sourcePort: 'result', targetPort: 'text' },
      { source: 'bp3c', target: 'bp3d', sourcePort: 'result', targetPort: 'text' },
      { source: 'bp7a', target: 'bp7b', sourcePort: 'result', targetPort: 'value' },
      { source: 'bp9', target: 'bp10', sourcePort: 'result', targetPort: 'text' },
      { source: 'bp7c', target: 'bp7d', sourcePort: 'result', targetPort: 'text' },
      { source: 'bp11a', target: 'bp11b', sourcePort: 'result', targetPort: 'value' },
      { source: 'bp13', target: 'bp14', sourcePort: 'result', targetPort: 'text' },
      { source: 'bp11c', target: 'bp11d', sourcePort: 'result', targetPort: 'text' },
      { source: 'bp15', target: 'bp16', sourcePort: 'result', targetPort: 'text' },
      // 链8 控制流: /帮助
      { source: 'xh1', target: 'xh2' },
      { source: 'xh2', target: 'xh3' },
      // 链8 数据流
      { source: 'xh2', target: 'xh3', sourcePort: 'result', targetPort: 'text' },
      // 链9 控制流: /签到
      { source: 'qd1', target: 'qd2' },
      { source: 'qd2', target: 'qd2b' },
      { source: 'qd2b', target: 'qd2c' },
      { source: 'qd2c', target: 'qd3' },
      { source: 'qd3', target: 'qd4', sourcePort: 'true' },
      { source: 'qd4', target: 'qd5' },
      { source: 'qd3', target: 'qd6', sourcePort: 'false' },
      { source: 'qd6', target: 'qd7' },
      { source: 'qd7', target: 'qd8' },
      { source: 'qd8', target: 'qd9' },
      { source: 'qd9', target: 'qd10' },
      { source: 'qd10', target: 'qd11' },
      // 链9 数据流
      { source: 'qd2', target: 'qd2c', sourcePort: 'result', targetPort: 'v1' },
      { source: 'qd2b', target: 'qd2c', sourcePort: 'datetime', targetPort: 'v2' },
      { source: 'qd2c', target: 'qd3', sourcePort: 'result', targetPort: 'value' },
      { source: 'qd6', target: 'qd7', sourcePort: 'datetime', targetPort: 'value' },
      { source: 'qd4', target: 'qd5', sourcePort: 'result', targetPort: 'text' },
      { source: 'qd10', target: 'qd11', sourcePort: 'result', targetPort: 'text' },
      // 链10 控制流: /打坐
      { source: 'dz1', target: 'dz1b' },
      { source: 'dz1b', target: 'dz1c' },
      { source: 'dz1c', target: 'dz2b', sourcePort: 'true' },
      { source: 'dz1c', target: 'dz1d', sourcePort: 'false' },
      { source: 'dz1d', target: 'dz1e' },
      { source: 'dz2b', target: 'dz2c' },
      { source: 'dz2c', target: 'dz4' },
      { source: 'dz4', target: 'dz5' },
      // 链10 数据流
      { source: 'dz1b', target: 'dz1c', sourcePort: 'ready', targetPort: 'value' },
      { source: 'dz1d', target: 'dz1e', sourcePort: 'result', targetPort: 'text' },
      { source: 'dz4', target: 'dz5', sourcePort: 'result', targetPort: 'text' },
      // 链11 控制流: /炼丹
      { source: 'ld1', target: 'ld2' },
      { source: 'ld2', target: 'ld3' },
      { source: 'ld3', target: 'ld4', sourcePort: 'true' },
      { source: 'ld4', target: 'ld5' },
      { source: 'ld5', target: 'ld6' },
      { source: 'ld6', target: 'ld7' },
      { source: 'ld3', target: 'ld8', sourcePort: 'false' },
      { source: 'ld8', target: 'ld9' },
      // 链11 数据流
      { source: 'ld2', target: 'ld3', sourcePort: 'result', targetPort: 'value' },
      { source: 'ld5', target: 'ld6', sourcePort: 'result', targetPort: 'var1' },
      { source: 'ld6', target: 'ld7', sourcePort: 'result', targetPort: 'text' },
      { source: 'ld8', target: 'ld9', sourcePort: 'result', targetPort: 'text' },
      // 链12 控制流: /功法
      { source: 'gf1', target: 'gf2' },
      { source: 'gf2', target: 'gf3' },
      { source: 'gf3', target: 'gf4', sourcePort: 'true' },
      { source: 'gf4', target: 'gf5' },
      { source: 'gf3', target: 'gf6', sourcePort: 'false' },
      { source: 'gf6', target: 'gf7' },
      // 链12 数据流
      { source: 'gf2', target: 'gf3', sourcePort: 'result', targetPort: 'value' },
      { source: 'gf2', target: 'gf4', sourcePort: 'result', targetPort: 'var1' },
      { source: 'gf4', target: 'gf5', sourcePort: 'result', targetPort: 'text' },
      { source: 'gf6', target: 'gf7', sourcePort: 'result', targetPort: 'text' },
      // 链13 控制流: /灵根
      { source: 'lg1', target: 'lg2' },
      { source: 'lg2', target: 'lg3' },
      { source: 'lg3', target: 'lg4', sourcePort: 'true' },
      { source: 'lg4', target: 'lg5' },
      { source: 'lg3', target: 'lg6', sourcePort: 'false' },
      { source: 'lg6', target: 'lg7' },
      { source: 'lg7', target: 'lg7b' },
      { source: 'lg7b', target: 'lg7c' },
      { source: 'lg7c', target: 'lg7e' },
      { source: 'lg7e', target: 'lg8' },
      { source: 'lg8', target: 'lg9' },
      // 链13 数据流
      { source: 'lg2', target: 'lg3', sourcePort: 'result', targetPort: 'value' },
      { source: 'lg2', target: 'lg4', sourcePort: 'result', targetPort: 'var1' },
      { source: 'lg6', target: 'lg7', sourcePort: 'result', targetPort: 'value' },
      { source: 'lg6', target: 'lg7c', sourcePort: 'result', targetPort: 'v1' },
      { source: 'lg6', target: 'lg8', sourcePort: 'result', targetPort: 'var1' },
      { source: 'lg7c', target: 'lg7e', sourcePort: 'result', targetPort: 'amount' },
      { source: 'lg4', target: 'lg5', sourcePort: 'result', targetPort: 'text' },
      { source: 'lg8', target: 'lg9', sourcePort: 'result', targetPort: 'text' },
      // 链14 控制流: /秘境
      { source: 'mj1', target: 'mj2' },
      { source: 'mj2', target: 'mj3' },
      { source: 'mj3', target: 'mj4', sourcePort: 'true' },
      { source: 'mj4', target: 'mj5' },
      { source: 'mj3', target: 'mj6', sourcePort: 'false' },
      { source: 'mj6', target: 'mj7', sourcePort: 'true' },
      { source: 'mj7', target: 'mj8' },
      { source: 'mj6', target: 'mj9', sourcePort: 'false' },
      { source: 'mj9', target: 'mj10', sourcePort: 'true' },
      { source: 'mj10', target: 'mj11' },
      { source: 'mj9', target: 'mj12', sourcePort: 'false' },
      // 链14 数据流
      { source: 'mj2', target: 'mj3', sourcePort: 'result', targetPort: 'value' },
      { source: 'mj2', target: 'mj5', sourcePort: 'result', targetPort: 'text' },
      { source: 'mj2', target: 'mj6', sourcePort: 'result', targetPort: 'value' },
      { source: 'mj2', target: 'mj8', sourcePort: 'result', targetPort: 'text' },
      { source: 'mj2', target: 'mj9', sourcePort: 'result', targetPort: 'value' },
      { source: 'mj2', target: 'mj11', sourcePort: 'result', targetPort: 'text' },
      { source: 'mj2', target: 'mj12', sourcePort: 'result', targetPort: 'text' },
      // 链15 控制流: /宗门
      { source: 'zm1', target: 'zm2' },
      { source: 'zm2', target: 'zm3' },
      { source: 'zm3', target: 'zm4', sourcePort: '加入' },
      { source: 'zm4', target: 'zm5' },
      { source: 'zm5', target: 'zm6' },
      { source: 'zm3', target: 'zm7', sourcePort: '创建' },
      { source: 'zm7', target: 'zm8' },
      { source: 'zm8', target: 'zm9', sourcePort: 'true' },
      { source: 'zm9', target: 'zm10' },
      { source: 'zm10', target: 'zm11' },
      { source: 'zm11', target: 'zm12' },
      { source: 'zm8', target: 'zm13', sourcePort: 'false' },
      { source: 'zm13', target: 'zm14' },
      { source: 'zm3', target: 'zm15', sourcePort: '查看' },
      { source: 'zm15', target: 'zm16' },
      { source: 'zm16', target: 'zm17' },
      { source: 'zm3', target: 'zm18', sourcePort: '帮助' },
      { source: 'zm18', target: 'zm19' },
      // 链15 数据流
      { source: 'zm2', target: 'zm3', sourcePort: 'result', targetPort: 'value' },
      { source: 'zm7', target: 'zm8', sourcePort: 'result', targetPort: 'value' },
      { source: 'zm5', target: 'zm6', sourcePort: 'result', targetPort: 'text' },
      { source: 'zm11', target: 'zm12', sourcePort: 'result', targetPort: 'text' },
      { source: 'zm13', target: 'zm14', sourcePort: 'result', targetPort: 'text' },
      { source: 'zm15', target: 'zm16', sourcePort: 'result', targetPort: 'var1' },
      { source: 'zm16', target: 'zm17', sourcePort: 'result', targetPort: 'text' },
      { source: 'zm18', target: 'zm19', sourcePort: 'result', targetPort: 'text' },
      // 链16 控制流: /渡劫
      { source: 'dj1', target: 'dj2' },
      { source: 'dj2', target: 'dj2b' },
      { source: 'dj2b', target: 'dj3' },
      { source: 'dj3', target: 'dj4', sourcePort: 'true' },
      { source: 'dj4', target: 'dj4b' },
      { source: 'dj4b', target: 'dj5' },
      { source: 'dj5', target: 'dj6', sourcePort: 'true' },
      { source: 'dj6', target: 'dj5b' },
      { source: 'dj5b', target: 'dj7' },
      { source: 'dj7', target: 'dj8' },
      { source: 'dj5', target: 'dj9', sourcePort: 'false' },
      { source: 'dj9', target: 'dj10' },
      { source: 'dj10', target: 'dj11' },
      { source: 'dj3', target: 'dj12', sourcePort: 'false' },
      { source: 'dj12', target: 'dj13' },
      // 链16 数据流
      { source: 'dj2', target: 'dj3', sourcePort: 'result', targetPort: 'value' },
      { source: 'dj4', target: 'dj4b', sourcePort: 'result', targetPort: 'v1' },
      { source: 'dj2b', target: 'dj4b', sourcePort: 'result', targetPort: 'v2' },
      { source: 'dj4b', target: 'dj5', sourcePort: 'result', targetPort: 'value' },
      { source: 'dj7', target: 'dj8', sourcePort: 'result', targetPort: 'text' },
      { source: 'dj10', target: 'dj11', sourcePort: 'result', targetPort: 'text' },
      { source: 'dj12', target: 'dj13', sourcePort: 'result', targetPort: 'text' },
      // 链17 控制流: /属性
      { source: 'sx1', target: 'sx2' },
      { source: 'sx2', target: 'sx3' },
      { source: 'sx3', target: 'sx4' },
      // 链17 数据流
      { source: 'sx2', target: 'sx3', sourcePort: 'values', targetPort: 'variables_json' },
      { source: 'sx3', target: 'sx4', sourcePort: 'result', targetPort: 'text' },
      // 链18 控制流: /药园
      { source: 'yy1', target: 'yy0a' },
      { source: 'yy0a', target: 'yy0b' },
      { source: 'yy0b', target: 'yy2', sourcePort: 'true' },
      { source: 'yy0b', target: 'yy0c', sourcePort: 'false' },
      { source: 'yy0c', target: 'yy0e' },
      { source: 'yy2', target: 'yy0d' },
      { source: 'yy0d', target: 'yy3' },
      { source: 'yy3', target: 'yy4' },
      // 链18 数据流
      { source: 'yy0a', target: 'yy0b', sourcePort: 'ready', targetPort: 'value' },
      { source: 'yy0c', target: 'yy0e', sourcePort: 'result', targetPort: 'text' },
      { source: 'yy2', target: 'yy3', sourcePort: 'result', targetPort: 'var1' },
      { source: 'yy3', target: 'yy4', sourcePort: 'result', targetPort: 'text' },
      // 链19 控制流: /出售药材
      { source: 'ys1', target: 'ys2' },
      { source: 'ys2', target: 'ys3' },
      { source: 'ys3', target: 'ys4', sourcePort: 'true' },
      { source: 'ys4', target: 'ys5' },
      { source: 'ys5', target: 'ys6' },
      { source: 'ys6', target: 'ys7' },
      { source: 'ys3', target: 'ys8', sourcePort: 'false' },
      { source: 'ys8', target: 'ys9' },
      // 链19 数据流
      { source: 'ys2', target: 'ys3', sourcePort: 'result', targetPort: 'value' },
      { source: 'ys6', target: 'ys7', sourcePort: 'result', targetPort: 'text' },
      { source: 'ys8', target: 'ys9', sourcePort: 'result', targetPort: 'text' },
      // ════════════ 链20 轮回 控制流 ════════════
      { source: 'rc0', target: 'rc1' },
      { source: 'rc1', target: 'rc2' },
      { source: 'rc2', target: 'rc3', sourcePort: 'true' },
      { source: 'rc3', target: 'rc4' },
      { source: 'rc4', target: 'rc5' },
      { source: 'rc5', target: 'rc5a' },
      { source: 'rc5a', target: 'rc5b' },
      { source: 'rc5b', target: 'rc5c' },
      { source: 'rc5c', target: 'rc5d' },
      { source: 'rc5d', target: 'rc6' },
      { source: 'rc6', target: 'rc7' },
      { source: 'rc7', target: 'rc8' },
      { source: 'rc8', target: 'rc9' },
      { source: 'rc9', target: 'rc10' },
      { source: 'rc2', target: 'rc11', sourcePort: 'false' },
      { source: 'rc11', target: 'rc12' },
      // 链20 数据流
      { source: 'rc1', target: 'rc2', sourcePort: 'result', targetPort: 'value' },
      { source: 'rc3', target: 'rc4', sourcePort: 'result', targetPort: 'v1' },
      { source: 'rc4', target: 'rc6', sourcePort: 'result', targetPort: 'value' },
      { source: 'rc4', target: 'rc9', sourcePort: 'result', targetPort: 'var1' },
      { source: 'rc9', target: 'rc10', sourcePort: 'result', targetPort: 'text' },
      { source: 'rc11', target: 'rc12', sourcePort: 'result', targetPort: 'text' },
      // ════════════ 链21 飞升 控制流 ════════════
      { source: 'fl0', target: 'fl0b' },
      { source: 'fl0b', target: 'fl0c' },
      { source: 'fl0c', target: 'fl1', sourcePort: 'true' },
      { source: 'fl0c', target: 'fl0d', sourcePort: 'false' },
      { source: 'fl0d', target: 'fl0e' },
      { source: 'fl1', target: 'fl2' },
      { source: 'fl2', target: 'fl3', sourcePort: 'true' },
      { source: 'fl3', target: 'fl4' },
      { source: 'fl4', target: 'fl5' },
      { source: 'fl5', target: 'fl6' },
      { source: 'fl6', target: 'fl6b' },
      { source: 'fl6b', target: 'fl7' },
      { source: 'fl7', target: 'fl8' },
      { source: 'fl2', target: 'fl9', sourcePort: 'false' },
      { source: 'fl9', target: 'fl10' },
      // 链21 数据流
      { source: 'fl0b', target: 'fl0c', sourcePort: 'ready', targetPort: 'value' },
      { source: 'fl0d', target: 'fl0e', sourcePort: 'result', targetPort: 'text' },
      { source: 'fl1', target: 'fl2', sourcePort: 'result', targetPort: 'value' },
      { source: 'fl7', target: 'fl8', sourcePort: 'result', targetPort: 'text' },
      { source: 'fl9', target: 'fl10', sourcePort: 'result', targetPort: 'text' }
    ]),
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0'
  },
  // 5. 答题竞赛机器人 — /答题(冷却+作答+计分) /积分 /清空积分
  {
    id: 'builtin-quiz-game',
    botCategory: 'game',
    name: '答题竞赛机器人',
    description: '/答题(冷却+作答+自动判分) /积分 /清空积分 /排行 /帮助 /连胜 /难度 /分类 /题库 /出题 每日答题 /成就，12条指令系统豪华版答题竞赛',
    category: '其他',
    tags: ['答题', '竞赛', '积分', '冷却', '持久化', '排行', '连胜', '难度', '分类', '成就', '定时', '权限'],
    author: '内置',
    nodes: buildNodes([
      // ── 链1 · /答题 ──
      { id: 'q1', kind: 'on_message', label: '答题指令', type: 'trigger', x: 0, y: 0, config: { match: 'command', command: '答题', prefix: '/' } },
      { id: 'q2', kind: 'persistent_op', label: '冷却检查', type: 'data', x: 0, y: 100, config: { mode: 'check', scope: 'user', cooldown_seconds: 60, key: 'quiz' } },
      { id: 'q3', kind: 'if_branch', label: '可答题？', type: 'logic', x: 0, y: 200, config: { expression: 'value' } },
      // true: 出题流程
      { id: 'q4', kind: 'format_text', label: '出题', type: 'logic', x: 0, y: 300, config: { template: '请听题：\n中国的首都是？\nA.上海 B.北京 C.广州 D.深圳\n(30秒内回复A/B/C/D)' } },
      { id: 'q5', kind: 'send_message', label: '发送题目', type: 'action', x: 0, y: 400, config: { text: '' } },
      { id: 'q6', kind: 'persistent_op', label: '保存答案', type: 'data', x: 0, y: 500, config: { mode: 'save', key: 'quiz_answer', value: 'B', scope: 'user' } },
      { id: 'q7', kind: 'wait_input', label: '等待回复', type: 'action', x: 0, y: 600, config: { timeout: 30 } },
      { id: 'q8', kind: 'get_context', label: '取回复文本', type: 'logic', x: 0, y: 700, config: { mode: 'message_text' } },
      { id: 'q9', kind: 'expression_eval', label: '规范化答案', type: 'logic', x: 0, y: 800, config: { expression: "v1.strip().upper() if v1 else ''" } },
      { id: 'q10', kind: 'if_branch', label: '答案正确？', type: 'logic', x: 0, y: 900, config: { expression: "value == 'B'" } },
      // true: 答对
      { id: 'q11', kind: 'persistent_op', label: '积分+10', type: 'action', x: 0, y: 1000, config: { mode: 'increment', key: 'score', amount: 10, scope: 'user' } },
      { id: 'q12', kind: 'format_text', label: '答对回复', type: 'logic', x: 0, y: 1100, config: { template: '回答正确！+10分' } },
      { id: 'q13', kind: 'send_message', label: '发送结果', type: 'action', x: 0, y: 1200, config: { text: '' } },
      // false: 答错
      { id: 'q14', kind: 'format_text', label: '答错回复', type: 'logic', x: 350, y: 1000, config: { template: '回答错误！正确答案是 B' } },
      { id: 'q15', kind: 'send_message', label: '发送结果', type: 'action', x: 350, y: 1100, config: { text: '' } },
      // false of q3: 冷却中
      { id: 'q16', kind: 'format_text', label: '冷却提示', type: 'logic', x: 350, y: 300, config: { template: '答题冷却中，1分钟一次' } },
      { id: 'q17', kind: 'send_message', label: '发送提示', type: 'action', x: 350, y: 400, config: { text: '' } },
      // ── 链2 · /积分 ──
      { id: 's1', kind: 'on_message', label: '积分指令', type: 'trigger', x: 700, y: 0, config: { match: 'command', command: '积分', prefix: '/' } },
      { id: 's2', kind: 'persistent_op', label: '读取积分', type: 'data', x: 700, y: 100, config: { mode: 'load', key: 'score', scope: 'user' } },
      { id: 's3', kind: 'format_text', label: '积分展示', type: 'logic', x: 700, y: 200, config: { template: '你的答题积分：{var1}' } },
      { id: 's4', kind: 'send_message', label: '发送积分', type: 'action', x: 700, y: 300, config: { text: '' } },
      // ── 链3 · /清空积分 ──
      { id: 'c1', kind: 'on_message', label: '清空积分指令', type: 'trigger', x: 1000, y: 0, config: { match: 'command', command: '清空积分', prefix: '/' } },
      { id: 'c2', kind: 'persistent_op', label: '删除积分', type: 'data', x: 1000, y: 100, config: { mode: 'delete', key: 'score', scope: 'user' } },
      { id: 'c3', kind: 'format_text', label: '清空提示', type: 'logic', x: 1000, y: 200, config: { template: '积分已清空' } },
      { id: 'c4', kind: 'send_message', label: '发送提示', type: 'action', x: 1000, y: 300, config: { text: '' } },
      // ── 链4 · /排行 ──
      { id: 'r1', kind: 'on_message', label: '排行指令', type: 'trigger', x: 1300, y: 0, config: { match: 'command', command: '排行', prefix: '/' } },
      { id: 'r2', kind: 'persistent_op', label: '读取积分', type: 'data', x: 1300, y: 100, config: { mode: 'load', key: 'score', scope: 'user' } },
      { id: 'r3', kind: 'persistent_op', label: '读取答题数', type: 'data', x: 1300, y: 200, config: { mode: 'load', key: 'total_answers', scope: 'user' } },
      { id: 'r4', kind: 'format_text', label: '排行展示', type: 'logic', x: 1300, y: 300, config: { template: '你的答题积分：{var1}\n累计答题：{var2}次\n继续努力！' } },
      { id: 'r5', kind: 'send_message', label: '发送排行', type: 'action', x: 1300, y: 400, config: {} },
      // ── 链5 · /帮助 ──
      { id: 'qh1', kind: 'on_message', label: '帮助指令', type: 'trigger', x: 1600, y: 0, config: { match: 'command', command: '帮助', prefix: '/' } },
      { id: 'qh2', kind: 'format_text', label: '帮助文本', type: 'logic', x: 1600, y: 100, config: { template: '答题竞赛指令：\n/答题 开始答题(60秒冷却)\n/积分 查看积分\n/清空积分 重置\n/排行 积分排行\n/连胜 查看连胜\n/难度 简单|中等|困难\n/分类 文科|理科|娱乐\n/题库 查看题库\n/成就 查看成就\n/出题 管理员手动出题\n每日0点自动每日答题' } },
      { id: 'qh3', kind: 'send_message', label: '发送帮助', type: 'action', x: 1600, y: 200, config: {} },
      // ── 链6 · /连胜 ──
      { id: 'qs1', kind: 'on_message', label: '连胜指令', type: 'trigger', x: 1900, y: 0, config: { match: 'command', command: '连胜', prefix: '/' } },
      { id: 'qs2', kind: 'persistent_op', label: '读取连胜', type: 'data', x: 1900, y: 100, config: { mode: 'load', key: 'quiz_streak', scope: 'user' } },
      { id: 'qs3', kind: 'format_text', label: '连胜展示', type: 'logic', x: 1900, y: 200, config: { template: '你当前连胜：{var1} 场\n最高连胜记录需继续答题突破！' } },
      { id: 'qs4', kind: 'send_message', label: '发送连胜', type: 'action', x: 1900, y: 300, config: {} },
      // ── 链7 · /难度 ──
      { id: 'qd1', kind: 'on_message', label: '难度指令', type: 'trigger', x: 2200, y: 0, config: { match: 'command', command: '难度', prefix: '/' } },
      { id: 'qd2', kind: 'get_context', label: '难度参数', type: 'logic', x: 2200, y: 100, config: { mode: 'command_args', index: 0 } },
      { id: 'qd3', kind: 'switch_case', label: '难度分支', type: 'logic', x: 2200, y: 200, config: { cases: '[{"match":"简单","label":"简单"},{"match":"中等","label":"中等"},{"match":"困难","label":"困难"}]', default: '查看' } },
      // 简单
      { id: 'qd4', kind: 'persistent_op', label: '设简单', type: 'data', x: 2200, y: 320, config: { mode: 'save', key: 'quiz_difficulty', scope: 'user', value: '简单' } },
      { id: 'qd5', kind: 'format_text', label: '简单提示', type: 'logic', x: 2200, y: 420, config: { template: '难度设为简单：答题积分x1.0，超时30秒' } },
      { id: 'qd6', kind: 'send_message', label: '发送', type: 'action', x: 2200, y: 520, config: {} },
      // 中等
      { id: 'qd7', kind: 'persistent_op', label: '设中等', type: 'data', x: 2450, y: 320, config: { mode: 'save', key: 'quiz_difficulty', scope: 'user', value: '中等' } },
      { id: 'qd8', kind: 'format_text', label: '中等提示', type: 'logic', x: 2450, y: 420, config: { template: '难度设为中等：答题积分x1.5，超时20秒' } },
      { id: 'qd9', kind: 'send_message', label: '发送', type: 'action', x: 2450, y: 520, config: {} },
      // 困难
      { id: 'qd10', kind: 'persistent_op', label: '设困难', type: 'data', x: 2700, y: 320, config: { mode: 'save', key: 'quiz_difficulty', scope: 'user', value: '困难' } },
      { id: 'qd11', kind: 'format_text', label: '困难提示', type: 'logic', x: 2700, y: 420, config: { template: '难度设为困难：答题积分x2.0，超时15秒' } },
      { id: 'qd12', kind: 'send_message', label: '发送', type: 'action', x: 2700, y: 520, config: {} },
      // 查看
      { id: 'qd13', kind: 'persistent_op', label: '读取难度', type: 'data', x: 2950, y: 320, config: { mode: 'load', key: 'quiz_difficulty', scope: 'user' } },
      { id: 'qd14', kind: 'format_text', label: '当前难度', type: 'logic', x: 2950, y: 420, config: { template: '当前难度：{var1}\n可选：简单/中等/困难' } },
      { id: 'qd15', kind: 'send_message', label: '发送', type: 'action', x: 2950, y: 520, config: {} },
      // ── 链8 · /分类 ──
      { id: 'qf1', kind: 'on_message', label: '分类指令', type: 'trigger', x: 3300, y: 0, config: { match: 'command', command: '分类', prefix: '/' } },
      { id: 'qf2', kind: 'get_context', label: '分类参数', type: 'logic', x: 3300, y: 100, config: { mode: 'command_args', index: 0 } },
      { id: 'qf3', kind: 'switch_case', label: '分类分支', type: 'logic', x: 3300, y: 200, config: { cases: '[{"match":"文科","label":"文科"},{"match":"理科","label":"理科"},{"match":"娱乐","label":"娱乐"}]', default: '查看' } },
      // 文科
      { id: 'qf4', kind: 'persistent_op', label: '设文科', type: 'data', x: 3300, y: 320, config: { mode: 'save', key: 'quiz_category', scope: 'user', value: '文科' } },
      { id: 'qf5', kind: 'format_text', label: '文科提示', type: 'logic', x: 3300, y: 420, config: { template: '分类设为文科：历史/地理/文学等' } },
      { id: 'qf6', kind: 'send_message', label: '发送', type: 'action', x: 3300, y: 520, config: {} },
      // 理科
      { id: 'qf7', kind: 'persistent_op', label: '设理科', type: 'data', x: 3550, y: 320, config: { mode: 'save', key: 'quiz_category', scope: 'user', value: '理科' } },
      { id: 'qf8', kind: 'format_text', label: '理科提示', type: 'logic', x: 3550, y: 420, config: { template: '分类设为理科：数学/物理/化学等' } },
      { id: 'qf9', kind: 'send_message', label: '发送', type: 'action', x: 3550, y: 520, config: {} },
      // 娱乐
      { id: 'qf10', kind: 'persistent_op', label: '设娱乐', type: 'data', x: 3800, y: 320, config: { mode: 'save', key: 'quiz_category', scope: 'user', value: '娱乐' } },
      { id: 'qf11', kind: 'format_text', label: '娱乐提示', type: 'logic', x: 3800, y: 420, config: { template: '分类设为娱乐：影视/音乐/游戏等' } },
      { id: 'qf12', kind: 'send_message', label: '发送', type: 'action', x: 3800, y: 520, config: {} },
      // 查看
      { id: 'qf13', kind: 'persistent_op', label: '读取分类', type: 'data', x: 4050, y: 320, config: { mode: 'load', key: 'quiz_category', scope: 'user' } },
      { id: 'qf14', kind: 'format_text', label: '当前分类', type: 'logic', x: 4050, y: 420, config: { template: '当前分类：{var1}\n可选：文科/理科/娱乐' } },
      { id: 'qf15', kind: 'send_message', label: '发送', type: 'action', x: 4050, y: 520, config: {} },
      // ── 链9 · /题库 ──
      { id: 'qb1', kind: 'on_message', label: '题库指令', type: 'trigger', x: 4400, y: 0, config: { match: 'command', command: '题库', prefix: '/' } },
      { id: 'qb2', kind: 'format_text', label: '题库信息', type: 'logic', x: 4400, y: 100, config: { template: '题库信息：\n文科：历史/地理/文学 50题\n理科：数学/物理/化学 50题\n娱乐：影视/音乐/游戏 50题\n共150题，持续更新中' } },
      { id: 'qb3', kind: 'send_message', label: '发送题库', type: 'action', x: 4400, y: 200, config: {} },
      // ── 链10 · /出题 ──
      { id: 'qa1', kind: 'on_message', label: '出题指令', type: 'trigger', x: 4700, y: 0, config: { match: 'command', command: '出题', prefix: '/' } },
      { id: 'qa2', kind: 'check_permission', label: '权限检查', type: 'action', x: 4700, y: 100, config: { role: 'admin' } },
      { id: 'qa3', kind: 'if_branch', label: '有权限？', type: 'logic', x: 4700, y: 200, config: { expression: 'value' } },
      // true: 出题
      { id: 'qa4', kind: 'random', label: '随机题目', type: 'logic', x: 4700, y: 320, config: { mode: 'choice', list: ['问：中国四大发明是什么？', '问：光速是多少？', '问：《红楼梦》作者是谁？', '问：1+1等于几？', '问：地球上最大的海洋是？'] } },
      { id: 'qa5', kind: 'format_text', label: '出题展示', type: 'logic', x: 4700, y: 420, config: { template: '管理员出题：\n{var1}\n请在30秒内回答' } },
      { id: 'qa6', kind: 'send_message', label: '发送题目', type: 'action', x: 4700, y: 520, config: {} },
      // false: 无权限
      { id: 'qa7', kind: 'format_text', label: '无权限提示', type: 'logic', x: 4950, y: 320, config: { template: '只有管理员才能手动出题' } },
      { id: 'qa8', kind: 'send_message', label: '发送提示', type: 'action', x: 4950, y: 420, config: {} },
      // ── 链11 · 每日答题 ──
      { id: 'dq1', kind: 'schedule', label: '每日定时', type: 'trigger', x: 5250, y: 0, config: { cron: '0 0 * * *', interval_seconds: 0 } },
      { id: 'dq2', kind: 'format_text', label: '每日提示', type: 'logic', x: 5250, y: 100, config: { template: '🌙 每日答题时间到！\n输入 /答题 开始今日挑战\n连续答题7天有额外奖励！' } },
      { id: 'dq3', kind: 'send_message', label: '发送提示', type: 'action', x: 5250, y: 200, config: {} },
      // ── 链12 · /成就 ──
      { id: 'ac1', kind: 'on_message', label: '成就指令', type: 'trigger', x: 5550, y: 0, config: { match: 'command', command: '成就', prefix: '/' } },
      { id: 'ac2', kind: 'persistent_op', label: '批量读取', type: 'data', x: 5550, y: 100, config: { mode: 'load', keys: '["quiz_score","quiz_streak","quiz_total"]', scope: 'user' } },
      { id: 'ac3', kind: 'format_text', label: '成就展示', type: 'logic', x: 5550, y: 200, config: { template: '===== 答题成就 =====\n当前积分：{quiz_score}\n当前连胜：{quiz_streak}场\n总答题数：{quiz_total}题\n\n成就：\n🏆 初出茅庐(答题10次)\n🏆 连胜高手(连胜5场)\n🏆 学霸(积分100)' } },
      { id: 'ac4', kind: 'send_message', label: '发送成就', type: 'action', x: 5550, y: 300, config: {} }
    ]),
    edges: buildEdges([
      // 链1 控制流
      { source: 'q1', target: 'q2' },
      { source: 'q2', target: 'q3' },
      { source: 'q3', target: 'q4', sourcePort: 'true' },
      { source: 'q3', target: 'q16', sourcePort: 'false' },
      { source: 'q4', target: 'q5' },
      { source: 'q5', target: 'q6' },
      { source: 'q6', target: 'q7' },
      { source: 'q7', target: 'q8' },
      { source: 'q8', target: 'q9' },
      { source: 'q9', target: 'q10' },
      { source: 'q10', target: 'q11', sourcePort: 'true' },
      { source: 'q10', target: 'q14', sourcePort: 'false' },
      { source: 'q11', target: 'q12' },
      { source: 'q12', target: 'q13' },
      { source: 'q14', target: 'q15' },
      { source: 'q16', target: 'q17' },
      // 链1 数据流
      { source: 'q2', target: 'q3', sourcePort: 'ready', targetPort: 'value' },
      { source: 'q4', target: 'q5', sourcePort: 'result', targetPort: 'text' },
      { source: 'q8', target: 'q9', sourcePort: 'result', targetPort: 'v1' },
      { source: 'q9', target: 'q10', sourcePort: 'result', targetPort: 'value' },
      { source: 'q12', target: 'q13', sourcePort: 'result', targetPort: 'text' },
      { source: 'q14', target: 'q15', sourcePort: 'result', targetPort: 'text' },
      { source: 'q16', target: 'q17', sourcePort: 'result', targetPort: 'text' },
      // 链2 控制流
      { source: 's1', target: 's2' },
      { source: 's2', target: 's3' },
      { source: 's3', target: 's4' },
      // 链2 数据流
      { source: 's2', target: 's3', sourcePort: 'result', targetPort: 'var1' },
      { source: 's3', target: 's4', sourcePort: 'result', targetPort: 'text' },
      // 链3 控制流
      { source: 'c1', target: 'c2' },
      { source: 'c2', target: 'c3' },
      { source: 'c3', target: 'c4' },
      // 链3 数据流
      { source: 'c3', target: 'c4', sourcePort: 'result', targetPort: 'text' },
      // 链4 控制流: /排行
      { source: 'r1', target: 'r2' },
      { source: 'r2', target: 'r3' },
      { source: 'r3', target: 'r4' },
      { source: 'r4', target: 'r5' },
      // 链4 数据流
      { source: 'r2', target: 'r4', sourcePort: 'result', targetPort: 'var1' },
      { source: 'r3', target: 'r4', sourcePort: 'result', targetPort: 'var2' },
      { source: 'r4', target: 'r5', sourcePort: 'result', targetPort: 'text' },
      // 链5 控制流: /帮助
      { source: 'qh1', target: 'qh2' },
      { source: 'qh2', target: 'qh3' },
      // 链5 数据流
      { source: 'qh2', target: 'qh3', sourcePort: 'result', targetPort: 'text' },
      // 链6 控制流: /连胜
      { source: 'qs1', target: 'qs2' },
      { source: 'qs2', target: 'qs3' },
      { source: 'qs3', target: 'qs4' },
      // 链6 数据流
      { source: 'qs2', target: 'qs3', sourcePort: 'result', targetPort: 'var1' },
      { source: 'qs3', target: 'qs4', sourcePort: 'result', targetPort: 'text' },
      // 链7 控制流: /难度
      { source: 'qd1', target: 'qd2' },
      { source: 'qd2', target: 'qd3' },
      { source: 'qd3', target: 'qd4', sourcePort: '简单' },
      { source: 'qd4', target: 'qd5' },
      { source: 'qd5', target: 'qd6' },
      { source: 'qd3', target: 'qd7', sourcePort: '中等' },
      { source: 'qd7', target: 'qd8' },
      { source: 'qd8', target: 'qd9' },
      { source: 'qd3', target: 'qd10', sourcePort: '困难' },
      { source: 'qd10', target: 'qd11' },
      { source: 'qd11', target: 'qd12' },
      { source: 'qd3', target: 'qd13', sourcePort: '查看' },
      { source: 'qd13', target: 'qd14' },
      { source: 'qd14', target: 'qd15' },
      // 链7 数据流
      { source: 'qd2', target: 'qd3', sourcePort: 'result', targetPort: 'value' },
      { source: 'qd5', target: 'qd6', sourcePort: 'result', targetPort: 'text' },
      { source: 'qd8', target: 'qd9', sourcePort: 'result', targetPort: 'text' },
      { source: 'qd11', target: 'qd12', sourcePort: 'result', targetPort: 'text' },
      { source: 'qd13', target: 'qd14', sourcePort: 'result', targetPort: 'var1' },
      { source: 'qd14', target: 'qd15', sourcePort: 'result', targetPort: 'text' },
      // 链8 控制流: /分类
      { source: 'qf1', target: 'qf2' },
      { source: 'qf2', target: 'qf3' },
      { source: 'qf3', target: 'qf4', sourcePort: '文科' },
      { source: 'qf4', target: 'qf5' },
      { source: 'qf5', target: 'qf6' },
      { source: 'qf3', target: 'qf7', sourcePort: '理科' },
      { source: 'qf7', target: 'qf8' },
      { source: 'qf8', target: 'qf9' },
      { source: 'qf3', target: 'qf10', sourcePort: '娱乐' },
      { source: 'qf10', target: 'qf11' },
      { source: 'qf11', target: 'qf12' },
      { source: 'qf3', target: 'qf13', sourcePort: '查看' },
      { source: 'qf13', target: 'qf14' },
      { source: 'qf14', target: 'qf15' },
      // 链8 数据流
      { source: 'qf2', target: 'qf3', sourcePort: 'result', targetPort: 'value' },
      { source: 'qf5', target: 'qf6', sourcePort: 'result', targetPort: 'text' },
      { source: 'qf8', target: 'qf9', sourcePort: 'result', targetPort: 'text' },
      { source: 'qf11', target: 'qf12', sourcePort: 'result', targetPort: 'text' },
      { source: 'qf13', target: 'qf14', sourcePort: 'result', targetPort: 'var1' },
      { source: 'qf14', target: 'qf15', sourcePort: 'result', targetPort: 'text' },
      // 链9 控制流: /题库
      { source: 'qb1', target: 'qb2' },
      { source: 'qb2', target: 'qb3' },
      // 链9 数据流
      { source: 'qb2', target: 'qb3', sourcePort: 'result', targetPort: 'text' },
      // 链10 控制流: /出题
      { source: 'qa1', target: 'qa2' },
      { source: 'qa2', target: 'qa3' },
      { source: 'qa3', target: 'qa4', sourcePort: 'true' },
      { source: 'qa4', target: 'qa5' },
      { source: 'qa5', target: 'qa6' },
      { source: 'qa3', target: 'qa7', sourcePort: 'false' },
      { source: 'qa7', target: 'qa8' },
      // 链10 数据流
      { source: 'qa2', target: 'qa3', sourcePort: 'passed', targetPort: 'value' },
      { source: 'qa4', target: 'qa5', sourcePort: 'result', targetPort: 'var1' },
      { source: 'qa5', target: 'qa6', sourcePort: 'result', targetPort: 'text' },
      { source: 'qa7', target: 'qa8', sourcePort: 'result', targetPort: 'text' },
      // 链11 控制流: 每日答题
      { source: 'dq1', target: 'dq2' },
      { source: 'dq2', target: 'dq3' },
      // 链11 数据流
      { source: 'dq2', target: 'dq3', sourcePort: 'result', targetPort: 'text' },
      // 链12 控制流: /成就
      { source: 'ac1', target: 'ac2' },
      { source: 'ac2', target: 'ac3' },
      { source: 'ac3', target: 'ac4' },
      // 链12 数据流
      { source: 'ac2', target: 'ac3', sourcePort: 'values', targetPort: 'variables_json' },
      { source: 'ac3', target: 'ac4', sourcePort: 'result', targetPort: 'text' }
    ]),
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0'
  },
  // ════════════════════════════════════════════════════════════════
  // 武侠 MUD 玩法模板（从 gameplayTemplates.ts 迁移）
  // 7 条链：/创建角色 · /拜师 · /练武 · /状态 · /切磋 · /行走江湖 · /武学
  // ════════════════════════════════════════════════════════════════
  {
    id: 'gameplay-wuxia',
    botCategory: 'game',
    name: '武侠 MUD 玩法',
    description: '武侠文字游戏：创建角色（门派/内功/武学/声望）、随机拜入门派、练武提升武学与声望、查看状态、切磋PVP、行走江湖、查看武学。多系统 + 随机选择 + 持久化示例。',
    category: '其他',
    tags: ['武侠', 'wuxia', '玩法', '游戏', '门派'],
    author: '内置',
    nodes: buildNodes([
      // ════════════ 链1 · /创建角色 初始化武侠角色 ════════════
      { id: 'wx1_cmd', kind: 'on_message', label: '创建角色', type: 'trigger', x: 0, y: 0, config: { match: 'command', command: '创建角色', prefix: '/' } },
      { id: 'wx1_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 0, config: { mode: 'user_id' } },
      { id: 'wx1_load', kind: 'persistent_op', label: '读门派', type: 'data', x: 500, y: 0, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'wx1_if', kind: 'if_branch', label: '已有角色？', type: 'logic', x: 750, y: 0, config: { expression: 'value != None' } },
      { id: 'wx1_exist', kind: 'send_message', label: '已创建', type: 'action', x: 1000, y: -80, config: { text: '已创建过角色' } },
      { id: 'wx1_ssect', kind: 'persistent_op', label: '存门派', type: 'data', x: 1000, y: 80, config: { mode: 'save', key: 'sect', value: '无门派', scope: 'user' } },
      { id: 'wx1_sskill', kind: 'persistent_op', label: '存内功', type: 'data', x: 1250, y: 80, config: { mode: 'save', key: 'inner_skill', value: '无', scope: 'user' } },
      { id: 'wx1_sma', kind: 'persistent_op', label: '存武学', type: 'data', x: 1500, y: 80, config: { mode: 'save', key: 'martial_arts', value: 0, scope: 'user' } },
      { id: 'wx1_srep', kind: 'persistent_op', label: '存声望', type: 'data', x: 1750, y: 80, config: { mode: 'save', key: 'jianghu_reputation', value: 0, scope: 'user' } },
      { id: 'wx1_msg', kind: 'send_message', label: '创建成功', type: 'action', x: 2000, y: 80, config: { text: '角色创建成功，行走江湖吧！' } },
      // ════════════ 链2 · /拜师 加入门派 ════════════
      { id: 'wx2_cmd', kind: 'on_message', label: '拜师', type: 'trigger', x: 0, y: 350, config: { match: 'command', command: '拜师', prefix: '/' } },
      { id: 'wx2_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 350, config: { mode: 'user_id' } },
      { id: 'wx2_load', kind: 'persistent_op', label: '读门派', type: 'data', x: 500, y: 350, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'wx2_if', kind: 'if_branch', label: '已有门派？', type: 'logic', x: 750, y: 350, config: { expression: 'value != "无门派" and value != None' } },
      { id: 'wx2_exist', kind: 'send_message', label: '已有门派', type: 'action', x: 1000, y: 270, config: { text: '已有门派' } },
      { id: 'wx2_rand', kind: 'random', label: '随机门派', type: 'logic', x: 1000, y: 430, config: { mode: 'choice', list: ['少林', '武当', '峨眉', '丐帮'] } },
      { id: 'wx2_ssect', kind: 'persistent_op', label: '存门派', type: 'data', x: 1250, y: 430, config: { mode: 'save', key: 'sect', scope: 'user' } },
      { id: 'wx2_sskill', kind: 'persistent_op', label: '存内功', type: 'data', x: 1500, y: 430, config: { mode: 'save', key: 'inner_skill', value: '本门内功', scope: 'user' } },
      { id: 'wx2_fmt', kind: 'format_text', label: '格式化拜师', type: 'logic', x: 1750, y: 430, config: { template: '拜入{var1}，习得本门内功' } },
      { id: 'wx2_msg', kind: 'send_message', label: '拜师成功', type: 'action', x: 2000, y: 430, config: { text: '' } },
      // ════════════ 链3 · /练武 提升武学 ════════════
      { id: 'wx3_cmd', kind: 'on_message', label: '练武', type: 'trigger', x: 0, y: 700, config: { match: 'command', command: '练武', prefix: '/' } },
      { id: 'wx3_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 700, config: { mode: 'user_id' } },
      { id: 'wx3_load', kind: 'persistent_op', label: '读门派', type: 'data', x: 500, y: 700, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'wx3_if', kind: 'if_branch', label: '有门派？', type: 'logic', x: 750, y: 700, config: { expression: 'value != "无门派" and value != None' } },
      { id: 'wx3_no', kind: 'send_message', label: '未入门派', type: 'action', x: 1000, y: 780, config: { text: '未加入门派，/拜师 加入门派' } },
      { id: 'wx3_lma', kind: 'persistent_op', label: '读武学', type: 'data', x: 1000, y: 620, config: { mode: 'load', key: 'martial_arts', scope: 'user' } },
      { id: 'wx3_math', kind: 'expression_eval', label: '武学+1', type: 'logic', x: 1250, y: 620, config: { expression: 'v1 + 1' } },
      { id: 'wx3_sma', kind: 'persistent_op', label: '存武学', type: 'data', x: 1500, y: 620, config: { mode: 'save', key: 'martial_arts', scope: 'user' } },
      { id: 'wx3_lrep', kind: 'persistent_op', label: '读声望', type: 'data', x: 1750, y: 620, config: { mode: 'load', key: 'jianghu_reputation', scope: 'user' } },
      { id: 'wx3_math2', kind: 'expression_eval', label: '声望+5', type: 'logic', x: 2000, y: 620, config: { expression: 'v1 + 5' } },
      { id: 'wx3_srep', kind: 'persistent_op', label: '存声望', type: 'data', x: 2250, y: 620, config: { mode: 'save', key: 'jianghu_reputation', scope: 'user' } },
      { id: 'wx3_msg', kind: 'send_message', label: '练武成功', type: 'action', x: 2500, y: 620, config: { text: '练武成功，武学+1，江湖声望+5' } },
      // ════════════ 链4 · /状态 查看状态 ════════════
      { id: 'wx4_cmd', kind: 'on_message', label: '状态', type: 'trigger', x: 0, y: 1050, config: { match: 'command', command: '状态', prefix: '/' } },
      { id: 'wx4_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1050, config: { mode: 'user_id' } },
      { id: 'wx4_load', kind: 'persistent_op', label: '读门派', type: 'data', x: 500, y: 1050, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'wx4_if', kind: 'if_branch', label: '有角色？', type: 'logic', x: 750, y: 1050, config: { expression: 'value != None' } },
      { id: 'wx4_no', kind: 'send_message', label: '未创建', type: 'action', x: 1000, y: 1130, config: { text: '未创建角色' } },
      { id: 'wx4_lma', kind: 'persistent_op', label: '读武学', type: 'data', x: 1000, y: 970, config: { mode: 'load', key: 'martial_arts', scope: 'user' } },
      { id: 'wx4_lrep', kind: 'persistent_op', label: '读声望', type: 'data', x: 1250, y: 970, config: { mode: 'load', key: 'jianghu_reputation', scope: 'user' } },
      { id: 'wx4_fmt', kind: 'format_text', label: '格式化状态', type: 'logic', x: 1500, y: 970, config: { template: '门派：{var1}\n武学：{var2}\n声望：{var3}' } },
      { id: 'wx4_msg', kind: 'send_message', label: '发送状态', type: 'action', x: 1750, y: 970, config: { text: '' } },
      // ════════════ 链5 · /切磋 PVP战斗 ════════════
      { id: 'wx5_cmd', kind: 'on_message', label: '切磋', type: 'trigger', x: 0, y: 1400, config: { match: 'command', command: '切磋', prefix: '/' } },
      { id: 'wx5_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1400, config: { mode: 'user_id' } },
      { id: 'wx5_load', kind: 'persistent_op', label: '读门派', type: 'data', x: 500, y: 1400, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'wx5_if', kind: 'if_branch', label: '有门派？', type: 'logic', x: 750, y: 1400, config: { expression: 'value != "无门派" and value != None' } },
      { id: 'wx5_no', kind: 'send_message', label: '未入门派', type: 'action', x: 1000, y: 1480, config: { text: '未加入门派，/拜师 加入门派' } },
      { id: 'wx5_lma', kind: 'persistent_op', label: '读武学', type: 'data', x: 1000, y: 1320, config: { mode: 'load', key: 'martial_arts', scope: 'user' } },
      { id: 'wx5_if2', kind: 'if_branch', label: '武学>=10?', type: 'logic', x: 1250, y: 1320, config: { expression: 'value >= 10' } },
      { id: 'wx5_nofail', kind: 'send_message', label: '武学不足', type: 'action', x: 1500, y: 1400, config: { text: '武学不足10，多练武再来' } },
      { id: 'wx5_rand', kind: 'random', label: '随机点数', type: 'logic', x: 1500, y: 1240, config: { mode: 'int', min: 1, max: 100 } },
      { id: 'wx5_if3', kind: 'if_branch', label: '点数>=50?', type: 'logic', x: 1750, y: 1240, config: { expression: 'value >= 50' } },
      { id: 'wx5_lrep1', kind: 'persistent_op', label: '读声望', type: 'data', x: 2000, y: 1160, config: { mode: 'load', key: 'jianghu_reputation', scope: 'user' } },
      { id: 'wx5_math1', kind: 'expression_eval', label: '声望+20', type: 'logic', x: 2250, y: 1160, config: { expression: 'v1 + 20' } },
      { id: 'wx5_srep1', kind: 'persistent_op', label: '存声望', type: 'data', x: 2500, y: 1160, config: { mode: 'save', key: 'jianghu_reputation', scope: 'user' } },
      { id: 'wx5_msg1', kind: 'send_message', label: '切磋胜利', type: 'action', x: 2750, y: 1160, config: { text: '切磋胜利！声望+20' } },
      { id: 'wx5_lrep2', kind: 'persistent_op', label: '读声望', type: 'data', x: 2000, y: 1320, config: { mode: 'load', key: 'jianghu_reputation', scope: 'user' } },
      { id: 'wx5_math2', kind: 'expression_eval', label: '声望-10', type: 'logic', x: 2250, y: 1320, config: { expression: 'v1 - 10' } },
      { id: 'wx5_srep2', kind: 'persistent_op', label: '存声望', type: 'data', x: 2500, y: 1320, config: { mode: 'save', key: 'jianghu_reputation', scope: 'user' } },
      { id: 'wx5_msg2', kind: 'send_message', label: '切磋失败', type: 'action', x: 2750, y: 1320, config: { text: '切磋失败，声望-10' } },
      // ════════════ 链6 · /行走江湖 随机事件 ════════════
      { id: 'wx6_cmd', kind: 'on_message', label: '行走江湖', type: 'trigger', x: 0, y: 1750, config: { match: 'command', command: '行走江湖', prefix: '/' } },
      { id: 'wx6_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1750, config: { mode: 'user_id' } },
      { id: 'wx6_load', kind: 'persistent_op', label: '读门派', type: 'data', x: 500, y: 1750, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'wx6_if', kind: 'if_branch', label: '有角色？', type: 'logic', x: 750, y: 1750, config: { expression: 'value != "无门派" and value != None' } },
      { id: 'wx6_no', kind: 'send_message', label: '未创建', type: 'action', x: 1000, y: 1830, config: { text: '未创建角色' } },
      { id: 'wx6_rand', kind: 'random', label: '随机事件', type: 'logic', x: 1000, y: 1670, config: { mode: 'weighted', items: [{ value: '遇到山贼，武学+2', weight: 30 }, { value: '偶遇高人指点，武学+5', weight: 20 }, { value: '发现秘籍，武学+10', weight: 5 }, { value: '无事发生', weight: 45 }] } },
      { id: 'wx6_msg', kind: 'send_message', label: '江湖行走', type: 'action', x: 1250, y: 1670, config: { text: '' } },
      // ════════════ 链7 · /武学 查看武学 ════════════
      { id: 'wx7_cmd', kind: 'on_message', label: '武学', type: 'trigger', x: 0, y: 2100, config: { match: 'command', command: '武学', prefix: '/' } },
      { id: 'wx7_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 2100, config: { mode: 'user_id' } },
      { id: 'wx7_load', kind: 'persistent_op', label: '读门派', type: 'data', x: 500, y: 2100, config: { mode: 'load', key: 'sect', scope: 'user' } },
      { id: 'wx7_if', kind: 'if_branch', label: '有角色？', type: 'logic', x: 750, y: 2100, config: { expression: 'value != None' } },
      { id: 'wx7_no', kind: 'send_message', label: '未创建', type: 'action', x: 1000, y: 2180, config: { text: '未创建角色' } },
      { id: 'wx7_lma', kind: 'persistent_op', label: '读武学', type: 'data', x: 1000, y: 2020, config: { mode: 'load', key: 'martial_arts', scope: 'user' } },
      { id: 'wx7_lskill', kind: 'persistent_op', label: '读内功', type: 'data', x: 1250, y: 2020, config: { mode: 'load', key: 'inner_skill', scope: 'user' } },
      { id: 'wx7_fmt', kind: 'format_text', label: '格式化武学', type: 'logic', x: 1500, y: 2020, config: { template: '武学：{var1}\n内功：{var2}' } },
      { id: 'wx7_msg', kind: 'send_message', label: '发送武学', type: 'action', x: 1750, y: 2020, config: { text: '' } }
    ]),
    edges: buildEdges([
      // ───── 链1 控制流：/创建角色 ─────
      { source: 'wx1_cmd', target: 'wx1_uid' },
      { source: 'wx1_uid', target: 'wx1_load' },
      { source: 'wx1_load', target: 'wx1_if' },
      { source: 'wx1_if', target: 'wx1_exist', sourcePort: 'true' },
      { source: 'wx1_if', target: 'wx1_ssect', sourcePort: 'false' },
      { source: 'wx1_ssect', target: 'wx1_sskill' },
      { source: 'wx1_sskill', target: 'wx1_sma' },
      { source: 'wx1_sma', target: 'wx1_srep' },
      { source: 'wx1_srep', target: 'wx1_msg' },
      // 链1 数据流
      { source: 'wx1_load', target: 'wx1_if', sourcePort: 'result', targetPort: 'value' },
      // ───── 链2 控制流：/拜师 ─────
      { source: 'wx2_cmd', target: 'wx2_uid' },
      { source: 'wx2_uid', target: 'wx2_load' },
      { source: 'wx2_load', target: 'wx2_if' },
      { source: 'wx2_if', target: 'wx2_exist', sourcePort: 'true' },
      { source: 'wx2_if', target: 'wx2_rand', sourcePort: 'false' },
      { source: 'wx2_rand', target: 'wx2_ssect' },
      { source: 'wx2_ssect', target: 'wx2_sskill' },
      { source: 'wx2_sskill', target: 'wx2_fmt' },
      { source: 'wx2_fmt', target: 'wx2_msg' },
      // 链2 数据流
      { source: 'wx2_load', target: 'wx2_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx2_rand', target: 'wx2_ssect', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx2_rand', target: 'wx2_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'wx2_fmt', target: 'wx2_msg', sourcePort: 'result', targetPort: 'text' },
      // ───── 链3 控制流：/练武 ─────
      { source: 'wx3_cmd', target: 'wx3_uid' },
      { source: 'wx3_uid', target: 'wx3_load' },
      { source: 'wx3_load', target: 'wx3_if' },
      { source: 'wx3_if', target: 'wx3_no', sourcePort: 'false' },
      { source: 'wx3_if', target: 'wx3_lma', sourcePort: 'true' },
      { source: 'wx3_lma', target: 'wx3_math' },
      { source: 'wx3_math', target: 'wx3_sma' },
      { source: 'wx3_sma', target: 'wx3_lrep' },
      { source: 'wx3_lrep', target: 'wx3_math2' },
      { source: 'wx3_math2', target: 'wx3_srep' },
      { source: 'wx3_srep', target: 'wx3_msg' },
      // 链3 数据流
      { source: 'wx3_load', target: 'wx3_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx3_lma', target: 'wx3_math', sourcePort: 'result', targetPort: 'v1' },
      { source: 'wx3_math', target: 'wx3_sma', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx3_lrep', target: 'wx3_math2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'wx3_math2', target: 'wx3_srep', sourcePort: 'result', targetPort: 'value' },
      // ───── 链4 控制流：/状态 ─────
      { source: 'wx4_cmd', target: 'wx4_uid' },
      { source: 'wx4_uid', target: 'wx4_load' },
      { source: 'wx4_load', target: 'wx4_if' },
      { source: 'wx4_if', target: 'wx4_no', sourcePort: 'false' },
      { source: 'wx4_if', target: 'wx4_lma', sourcePort: 'true' },
      { source: 'wx4_lma', target: 'wx4_lrep' },
      { source: 'wx4_lrep', target: 'wx4_fmt' },
      { source: 'wx4_fmt', target: 'wx4_msg' },
      // 链4 数据流
      { source: 'wx4_load', target: 'wx4_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx4_fmt', target: 'wx4_msg', sourcePort: 'result', targetPort: 'text' },
      { source: 'wx4_load', target: 'wx4_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'wx4_lma', target: 'wx4_fmt', sourcePort: 'result', targetPort: 'var2' },
      { source: 'wx4_lrep', target: 'wx4_fmt', sourcePort: 'result', targetPort: 'var3' },
      // ───── 链5 控制流：/切磋 ─────
      { source: 'wx5_cmd', target: 'wx5_uid' },
      { source: 'wx5_uid', target: 'wx5_load' },
      { source: 'wx5_load', target: 'wx5_if' },
      { source: 'wx5_if', target: 'wx5_no', sourcePort: 'false' },
      { source: 'wx5_if', target: 'wx5_lma', sourcePort: 'true' },
      { source: 'wx5_lma', target: 'wx5_if2' },
      { source: 'wx5_if2', target: 'wx5_nofail', sourcePort: 'false' },
      { source: 'wx5_if2', target: 'wx5_rand', sourcePort: 'true' },
      { source: 'wx5_rand', target: 'wx5_if3' },
      { source: 'wx5_if3', target: 'wx5_lrep1', sourcePort: 'true' },
      { source: 'wx5_lrep1', target: 'wx5_math1' },
      { source: 'wx5_math1', target: 'wx5_srep1' },
      { source: 'wx5_srep1', target: 'wx5_msg1' },
      { source: 'wx5_if3', target: 'wx5_lrep2', sourcePort: 'false' },
      { source: 'wx5_lrep2', target: 'wx5_math2' },
      { source: 'wx5_math2', target: 'wx5_srep2' },
      { source: 'wx5_srep2', target: 'wx5_msg2' },
      // 链5 数据流
      { source: 'wx5_load', target: 'wx5_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx5_lma', target: 'wx5_if2', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx5_rand', target: 'wx5_if3', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx5_lrep1', target: 'wx5_math1', sourcePort: 'result', targetPort: 'v1' },
      { source: 'wx5_math1', target: 'wx5_srep1', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx5_lrep2', target: 'wx5_math2', sourcePort: 'result', targetPort: 'v1' },
      { source: 'wx5_math2', target: 'wx5_srep2', sourcePort: 'result', targetPort: 'value' },
      // ───── 链6 控制流：/行走江湖 ─────
      { source: 'wx6_cmd', target: 'wx6_uid' },
      { source: 'wx6_uid', target: 'wx6_load' },
      { source: 'wx6_load', target: 'wx6_if' },
      { source: 'wx6_if', target: 'wx6_no', sourcePort: 'false' },
      { source: 'wx6_if', target: 'wx6_rand', sourcePort: 'true' },
      { source: 'wx6_rand', target: 'wx6_msg' },
      // 链6 数据流
      { source: 'wx6_load', target: 'wx6_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx6_rand', target: 'wx6_msg', sourcePort: 'result', targetPort: 'text' },
      // ───── 链7 控制流：/武学 ─────
      { source: 'wx7_cmd', target: 'wx7_uid' },
      { source: 'wx7_uid', target: 'wx7_load' },
      { source: 'wx7_load', target: 'wx7_if' },
      { source: 'wx7_if', target: 'wx7_no', sourcePort: 'false' },
      { source: 'wx7_if', target: 'wx7_lma', sourcePort: 'true' },
      { source: 'wx7_lma', target: 'wx7_lskill' },
      { source: 'wx7_lskill', target: 'wx7_fmt' },
      { source: 'wx7_fmt', target: 'wx7_msg' },
      // 链7 数据流
      { source: 'wx7_load', target: 'wx7_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'wx7_fmt', target: 'wx7_msg', sourcePort: 'result', targetPort: 'text' },
      { source: 'wx7_lma', target: 'wx7_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'wx7_lskill', target: 'wx7_fmt', sourcePort: 'result', targetPort: 'var2' }
    ]),
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0'
  },
  // ════════════════════════════════════════════════════════════════
  // 卡牌收集模板（从 gameplayTemplatesExtra.ts 迁移）
  // 6 条链：/抽卡 · /创建角色 · /图鉴 · /强化 · /卡组 · /碎片
  // ════════════════════════════════════════════════════════════════
  {
    id: 'gameplay-card',
    botCategory: 'game',
    name: '卡牌收集机器人',
    description: '卡牌收集系统：抽卡（含保底机制）、创建角色、查看图鉴、强化卡牌、查看卡组、领取碎片。使用持久化存储按QQ号隔离数据。',
    category: '指令',
    tags: ['卡牌', '抽卡', '保底', '图鉴', '指令', '持久化'],
    author: '内置',
    nodes: buildNodes([
      // ─── 链1 · /抽卡 抽卡系统（含保底机制） ───
      { id: 'ca1_cmd', kind: 'on_message', label: '抽卡指令', type: 'trigger', x: 0, y: 0, config: { match: 'command', command: '抽卡', prefix: '/' } },
      { id: 'ca1_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 0, config: { mode: 'user_id' } },
      { id: 'ca1_load', kind: 'persistent_op', label: '读抽卡数', type: 'data', x: 500, y: 0, config: { mode: 'load', key: 'card_count', scope: 'user' } },
      { id: 'ca1_if', kind: 'if_branch', label: '有角色？', type: 'logic', x: 750, y: 0, config: { expression: 'value != None' } },
      { id: 'ca1_no', kind: 'send_message', label: '未创建角色', type: 'action', x: 1000, y: 150, config: { text: '未创建角色，输入 /创建角色' } },
      { id: 'ca1_load_pity', kind: 'persistent_op', label: '读保底数', type: 'data', x: 1000, y: -150, config: { mode: 'load', key: 'gacha_pity', scope: 'user' } },
      { id: 'ca1_if_pity', kind: 'if_branch', label: '保底>=10?', type: 'logic', x: 1250, y: -150, config: { expression: 'value >= 10' } },
      { id: 'ca1_pity_rand', kind: 'random', label: '保底SSR', type: 'logic', x: 1500, y: -300, config: { mode: 'choice', list: ['SSR传说卡', 'SSR神话卡'] } },
      { id: 'ca1_pity_save0', kind: 'persistent_op', label: '重置保底', type: 'data', x: 1750, y: -300, config: { mode: 'save', key: 'gacha_pity', value: 0, scope: 'user' } },
      { id: 'ca1_pity_math', kind: 'expression_eval', label: '抽卡数+1', type: 'logic', x: 2000, y: -300, config: { expression: 'v1 + 1' } },
      { id: 'ca1_pity_save', kind: 'persistent_op', label: '存抽卡数', type: 'data', x: 2250, y: -300, config: { mode: 'save', key: 'card_count', scope: 'user' } },
      { id: 'ca1_pity_fmt', kind: 'format_text', label: '格式化保底', type: 'logic', x: 2500, y: -300, config: { template: '🎉 保底触发！抽到 {var1}' } },
      { id: 'ca1_pity_msg', kind: 'send_message', label: '保底消息', type: 'action', x: 2750, y: -300, config: { text: '' } },
      { id: 'ca1_norm_rand', kind: 'random', label: '普通抽卡', type: 'logic', x: 1500, y: 0, config: { mode: 'weighted', items: [{ value: 'N普通卡', weight: 60 }, { value: 'R稀有卡', weight: 30 }, { value: 'SR史诗卡', weight: 9 }, { value: 'SSR传说卡', weight: 1 }] } },
      { id: 'ca1_norm_math_p', kind: 'expression_eval', label: '保底+1', type: 'logic', x: 1750, y: 0, config: { expression: 'v1 + 1' } },
      { id: 'ca1_norm_save_p', kind: 'persistent_op', label: '存保底', type: 'data', x: 2000, y: 0, config: { mode: 'save', key: 'gacha_pity', scope: 'user' } },
      { id: 'ca1_norm_math_c', kind: 'expression_eval', label: '抽卡数+1', type: 'logic', x: 2250, y: 0, config: { expression: 'v1 + 1' } },
      { id: 'ca1_norm_save_c', kind: 'persistent_op', label: '存抽卡数', type: 'data', x: 2500, y: 0, config: { mode: 'save', key: 'card_count', scope: 'user' } },
      { id: 'ca1_norm_fmt', kind: 'format_text', label: '格式化抽卡', type: 'logic', x: 2750, y: 0, config: { template: '抽到 {var1}' } },
      { id: 'ca1_norm_msg', kind: 'send_message', label: '抽卡消息', type: 'action', x: 3000, y: 0, config: { text: '' } },
      // ─── 链2 · /创建角色 初始化卡牌账号 ───
      { id: 'ca2_cmd', kind: 'on_message', label: '创建角色', type: 'trigger', x: 0, y: 350, config: { match: 'command', command: '创建角色', prefix: '/' } },
      { id: 'ca2_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 350, config: { mode: 'user_id' } },
      { id: 'ca2_load', kind: 'persistent_op', label: '读抽卡数', type: 'data', x: 500, y: 350, config: { mode: 'load', key: 'card_count', scope: 'user' } },
      { id: 'ca2_if', kind: 'if_branch', label: '已有账号？', type: 'logic', x: 750, y: 350, config: { expression: 'value != None' } },
      { id: 'ca2_exist', kind: 'send_message', label: '已创建', type: 'action', x: 1000, y: 250, config: { text: '已创建账号' } },
      { id: 'ca2_s_count', kind: 'persistent_op', label: '存抽卡数', type: 'data', x: 1000, y: 450, config: { mode: 'save', key: 'card_count', value: 0, scope: 'user' } },
      { id: 'ca2_s_pity', kind: 'persistent_op', label: '存保底', type: 'data', x: 1250, y: 450, config: { mode: 'save', key: 'gacha_pity', value: 0, scope: 'user' } },
      { id: 'ca2_s_total', kind: 'persistent_op', label: '存图鉴总数', type: 'data', x: 1500, y: 450, config: { mode: 'save', key: 'collection_total', value: 100, scope: 'user' } },
      { id: 'ca2_msg', kind: 'send_message', label: '创建成功', type: 'action', x: 1750, y: 450, config: { text: '账号创建成功！输入 /抽卡 开始抽卡' } },
      // ─── 链3 · /图鉴 查看收藏 ───
      { id: 'ca3_cmd', kind: 'on_message', label: '图鉴指令', type: 'trigger', x: 0, y: 700, config: { match: 'command', command: '图鉴', prefix: '/' } },
      { id: 'ca3_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 700, config: { mode: 'user_id' } },
      { id: 'ca3_load', kind: 'persistent_op', label: '读抽卡数', type: 'data', x: 500, y: 700, config: { mode: 'load', key: 'card_count', scope: 'user' } },
      { id: 'ca3_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 700, config: { expression: 'value != None' } },
      { id: 'ca3_no', kind: 'send_message', label: '未创建', type: 'action', x: 1000, y: 800, config: { text: '未创建账号' } },
      { id: 'ca3_load_total', kind: 'persistent_op', label: '读图鉴总数', type: 'data', x: 1000, y: 600, config: { mode: 'load', key: 'collection_total', scope: 'user' } },
      { id: 'ca3_fmt', kind: 'format_text', label: '格式化收藏', type: 'logic', x: 1250, y: 600, config: { template: '📊 卡牌收藏\n已拥有：{var1}\n图鉴总数：{var2}' } },
      { id: 'ca3_msg', kind: 'send_message', label: '发送收藏', type: 'action', x: 1500, y: 600, config: { text: '' } },
      // ─── 链4 · /强化 消耗碎片强化卡牌 ───
      { id: 'ca4_cmd', kind: 'on_message', label: '强化指令', type: 'trigger', x: 0, y: 1050, config: { match: 'command', command: '强化', prefix: '/' } },
      { id: 'ca4_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1050, config: { mode: 'user_id' } },
      { id: 'ca4_load', kind: 'persistent_op', label: '读卡牌数', type: 'data', x: 500, y: 1050, config: { mode: 'load', key: 'card_count', scope: 'user' } },
      { id: 'ca4_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 1050, config: { expression: 'value != None' } },
      { id: 'ca4_no', kind: 'send_message', label: '未创建账号', type: 'action', x: 1000, y: 1200, config: { text: '未创建账号，输入 /创建角色' } },
      { id: 'ca4_load_frag', kind: 'persistent_op', label: '读碎片', type: 'data', x: 1000, y: 900, config: { mode: 'load', key: 'fragments', scope: 'user' } },
      { id: 'ca4_if_frag', kind: 'if_branch', label: '碎片>=10?', type: 'logic', x: 1250, y: 900, config: { expression: 'value >= 10' } },
      { id: 'ca4_no_frag', kind: 'send_message', label: '碎片不足', type: 'action', x: 1500, y: 1050, config: { text: '碎片不足，需要10个碎片' } },
      { id: 'ca4_math_frag', kind: 'expression_eval', label: '碎片-10', type: 'logic', x: 1500, y: 750, config: { expression: 'v1 - 10' } },
      { id: 'ca4_save_frag', kind: 'persistent_op', label: '存碎片', type: 'data', x: 1750, y: 750, config: { mode: 'save', key: 'fragments', scope: 'user' } },
      { id: 'ca4_math_card', kind: 'expression_eval', label: '卡牌数+1', type: 'logic', x: 2000, y: 750, config: { expression: 'v1 + 1' } },
      { id: 'ca4_save_card', kind: 'persistent_op', label: '存卡牌数', type: 'data', x: 2250, y: 750, config: { mode: 'save', key: 'card_count', scope: 'user' } },
      { id: 'ca4_msg', kind: 'send_message', label: '强化成功', type: 'action', x: 2500, y: 750, config: { text: '强化成功！消耗10碎片，卡牌+1' } },
      // ─── 链5 · /卡组 查看卡组 ───
      { id: 'ca5_cmd', kind: 'on_message', label: '卡组指令', type: 'trigger', x: 0, y: 1400, config: { match: 'command', command: '卡组', prefix: '/' } },
      { id: 'ca5_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1400, config: { mode: 'user_id' } },
      { id: 'ca5_load', kind: 'persistent_op', label: '读卡牌数', type: 'data', x: 500, y: 1400, config: { mode: 'load', key: 'card_count', scope: 'user' } },
      { id: 'ca5_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 1400, config: { expression: 'value != None' } },
      { id: 'ca5_no', kind: 'send_message', label: '未创建', type: 'action', x: 1000, y: 1550, config: { text: '未创建账号' } },
      { id: 'ca5_load_frag', kind: 'persistent_op', label: '读碎片', type: 'data', x: 1000, y: 1250, config: { mode: 'load', key: 'fragments', scope: 'user' } },
      { id: 'ca5_load_pity', kind: 'persistent_op', label: '读保底数', type: 'data', x: 1250, y: 1250, config: { mode: 'load', key: 'gacha_pity', scope: 'user' } },
      { id: 'ca5_fmt', kind: 'format_text', label: '格式化卡组', type: 'logic', x: 1500, y: 1250, config: { template: '📊 卡组信息\n卡牌数：{var1}\n碎片：{var2}\n保底进度：{var3}/10' } },
      { id: 'ca5_msg', kind: 'send_message', label: '发送卡组', type: 'action', x: 1750, y: 1250, config: { text: '' } },
      // ─── 链6 · /碎片 每日领碎片 ───
      { id: 'ca6_cmd', kind: 'on_message', label: '碎片指令', type: 'trigger', x: 0, y: 1750, config: { match: 'command', command: '碎片', prefix: '/' } },
      { id: 'ca6_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1750, config: { mode: 'user_id' } },
      { id: 'ca6_load', kind: 'persistent_op', label: '读卡牌数', type: 'data', x: 500, y: 1750, config: { mode: 'load', key: 'card_count', scope: 'user' } },
      { id: 'ca6_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 1750, config: { expression: 'value != None' } },
      { id: 'ca6_no', kind: 'send_message', label: '未创建', type: 'action', x: 1000, y: 1900, config: { text: '未创建账号' } },
      { id: 'ca6_load_frag', kind: 'persistent_op', label: '读碎片', type: 'data', x: 1000, y: 1600, config: { mode: 'load', key: 'fragments', scope: 'user' } },
      { id: 'ca6_math', kind: 'expression_eval', label: '碎片+5', type: 'logic', x: 1250, y: 1600, config: { expression: 'v1 + 5' } },
      { id: 'ca6_save', kind: 'persistent_op', label: '存碎片', type: 'data', x: 1500, y: 1600, config: { mode: 'save', key: 'fragments', scope: 'user' } },
      { id: 'ca6_fmt', kind: 'format_text', label: '格式化领取', type: 'logic', x: 1750, y: 1600, config: { template: '领取5个碎片！当前碎片：{var1}' } },
      { id: 'ca6_msg', kind: 'send_message', label: '发送领取', type: 'action', x: 2000, y: 1600, config: { text: '' } }
    ]),
    edges: buildEdges([
      // ── 链1 控制流：/抽卡 ──
      { source: 'ca1_cmd', target: 'ca1_uid' },
      { source: 'ca1_uid', target: 'ca1_load' },
      { source: 'ca1_load', target: 'ca1_if' },
      { source: 'ca1_if', target: 'ca1_no', sourcePort: 'false' },
      { source: 'ca1_if', target: 'ca1_load_pity', sourcePort: 'true' },
      { source: 'ca1_load_pity', target: 'ca1_if_pity' },
      { source: 'ca1_if_pity', target: 'ca1_pity_rand', sourcePort: 'true' },
      { source: 'ca1_pity_rand', target: 'ca1_pity_save0' },
      { source: 'ca1_pity_save0', target: 'ca1_pity_math' },
      { source: 'ca1_pity_math', target: 'ca1_pity_save' },
      { source: 'ca1_pity_save', target: 'ca1_pity_fmt' },
      { source: 'ca1_pity_fmt', target: 'ca1_pity_msg' },
      { source: 'ca1_if_pity', target: 'ca1_norm_rand', sourcePort: 'false' },
      { source: 'ca1_norm_rand', target: 'ca1_norm_math_p' },
      { source: 'ca1_norm_math_p', target: 'ca1_norm_save_p' },
      { source: 'ca1_norm_save_p', target: 'ca1_norm_math_c' },
      { source: 'ca1_norm_math_c', target: 'ca1_norm_save_c' },
      { source: 'ca1_norm_save_c', target: 'ca1_norm_fmt' },
      { source: 'ca1_norm_fmt', target: 'ca1_norm_msg' },
      // 链1 数据流
      { source: 'ca1_load', target: 'ca1_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca1_load_pity', target: 'ca1_if_pity', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca1_load', target: 'ca1_pity_math', sourcePort: 'result', targetPort: 'v1' },
      { source: 'ca1_pity_math', target: 'ca1_pity_save', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca1_load_pity', target: 'ca1_norm_math_p', sourcePort: 'result', targetPort: 'v1' },
      { source: 'ca1_norm_math_p', target: 'ca1_norm_save_p', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca1_load', target: 'ca1_norm_math_c', sourcePort: 'result', targetPort: 'v1' },
      { source: 'ca1_norm_math_c', target: 'ca1_norm_save_c', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca1_pity_rand', target: 'ca1_pity_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'ca1_pity_fmt', target: 'ca1_pity_msg', sourcePort: 'result', targetPort: 'text' },
      { source: 'ca1_norm_rand', target: 'ca1_norm_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'ca1_norm_fmt', target: 'ca1_norm_msg', sourcePort: 'result', targetPort: 'text' },
      // ── 链2 控制流：/创建角色 ──
      { source: 'ca2_cmd', target: 'ca2_uid' },
      { source: 'ca2_uid', target: 'ca2_load' },
      { source: 'ca2_load', target: 'ca2_if' },
      { source: 'ca2_if', target: 'ca2_exist', sourcePort: 'true' },
      { source: 'ca2_if', target: 'ca2_s_count', sourcePort: 'false' },
      { source: 'ca2_s_count', target: 'ca2_s_pity' },
      { source: 'ca2_s_pity', target: 'ca2_s_total' },
      { source: 'ca2_s_total', target: 'ca2_msg' },
      // 链2 数据流
      { source: 'ca2_load', target: 'ca2_if', sourcePort: 'result', targetPort: 'value' },
      // ── 链3 控制流：/图鉴 ──
      { source: 'ca3_cmd', target: 'ca3_uid' },
      { source: 'ca3_uid', target: 'ca3_load' },
      { source: 'ca3_load', target: 'ca3_if' },
      { source: 'ca3_if', target: 'ca3_no', sourcePort: 'false' },
      { source: 'ca3_if', target: 'ca3_load_total', sourcePort: 'true' },
      { source: 'ca3_load_total', target: 'ca3_fmt' },
      { source: 'ca3_fmt', target: 'ca3_msg' },
      // 链3 数据流
      { source: 'ca3_load', target: 'ca3_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca3_load', target: 'ca3_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'ca3_load_total', target: 'ca3_fmt', sourcePort: 'result', targetPort: 'var2' },
      { source: 'ca3_fmt', target: 'ca3_msg', sourcePort: 'result', targetPort: 'text' },
      // ── 链4 控制流：/强化 ──
      { source: 'ca4_cmd', target: 'ca4_uid' },
      { source: 'ca4_uid', target: 'ca4_load' },
      { source: 'ca4_load', target: 'ca4_if' },
      { source: 'ca4_if', target: 'ca4_no', sourcePort: 'false' },
      { source: 'ca4_if', target: 'ca4_load_frag', sourcePort: 'true' },
      { source: 'ca4_load_frag', target: 'ca4_if_frag' },
      { source: 'ca4_if_frag', target: 'ca4_no_frag', sourcePort: 'false' },
      { source: 'ca4_if_frag', target: 'ca4_math_frag', sourcePort: 'true' },
      { source: 'ca4_math_frag', target: 'ca4_save_frag' },
      { source: 'ca4_save_frag', target: 'ca4_math_card' },
      { source: 'ca4_math_card', target: 'ca4_save_card' },
      { source: 'ca4_save_card', target: 'ca4_msg' },
      // 链4 数据流
      { source: 'ca4_load', target: 'ca4_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca4_load_frag', target: 'ca4_if_frag', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca4_load_frag', target: 'ca4_math_frag', sourcePort: 'result', targetPort: 'v1' },
      { source: 'ca4_math_frag', target: 'ca4_save_frag', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca4_load', target: 'ca4_math_card', sourcePort: 'result', targetPort: 'v1' },
      { source: 'ca4_math_card', target: 'ca4_save_card', sourcePort: 'result', targetPort: 'value' },
      // ── 链5 控制流：/卡组 ──
      { source: 'ca5_cmd', target: 'ca5_uid' },
      { source: 'ca5_uid', target: 'ca5_load' },
      { source: 'ca5_load', target: 'ca5_if' },
      { source: 'ca5_if', target: 'ca5_no', sourcePort: 'false' },
      { source: 'ca5_if', target: 'ca5_load_frag', sourcePort: 'true' },
      { source: 'ca5_load_frag', target: 'ca5_load_pity' },
      { source: 'ca5_load_pity', target: 'ca5_fmt' },
      { source: 'ca5_fmt', target: 'ca5_msg' },
      // 链5 数据流
      { source: 'ca5_load', target: 'ca5_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca5_load', target: 'ca5_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'ca5_load_frag', target: 'ca5_fmt', sourcePort: 'result', targetPort: 'var2' },
      { source: 'ca5_load_pity', target: 'ca5_fmt', sourcePort: 'result', targetPort: 'var3' },
      { source: 'ca5_fmt', target: 'ca5_msg', sourcePort: 'result', targetPort: 'text' },
      // ── 链6 控制流：/碎片 ──
      { source: 'ca6_cmd', target: 'ca6_uid' },
      { source: 'ca6_uid', target: 'ca6_load' },
      { source: 'ca6_load', target: 'ca6_if' },
      { source: 'ca6_if', target: 'ca6_no', sourcePort: 'false' },
      { source: 'ca6_if', target: 'ca6_load_frag', sourcePort: 'true' },
      { source: 'ca6_load_frag', target: 'ca6_math' },
      { source: 'ca6_math', target: 'ca6_save' },
      { source: 'ca6_save', target: 'ca6_fmt' },
      { source: 'ca6_fmt', target: 'ca6_msg' },
      // 链6 数据流
      { source: 'ca6_load', target: 'ca6_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'ca6_load_frag', target: 'ca6_math', sourcePort: 'result', targetPort: 'v1' },
      { source: 'ca6_load_frag', target: 'ca6_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'ca6_math', target: 'ca6_save', sourcePort: 'result', targetPort: 'value' }
    ]),
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0'
  },
  // ════════════════════════════════════════════════════════════════
  // 模拟经营模板（从 gameplayTemplatesExtra.ts 迁移）
  // 6 条系统：/建造 · /创建账号 · /产业 · /生产 · /卖出 · /升级
  // ════════════════════════════════════════════════════════════════
  {
    id: 'gameplay-management',
    botCategory: 'game',
    name: '模拟经营机器人',
    description: '模拟经营系统：建造建筑（消耗金币）、创建账号、查看产业、生产商品、出售商品、升级建筑。使用持久化存储按QQ号隔离数据。',
    category: '指令',
    tags: ['经营', '建造', '金币', '产业', '指令', '持久化'],
    author: '内置',
    nodes: buildNodes([
      // ─── 链1 · /建造 建造建筑 ───
      { id: 'mg1_cmd', kind: 'on_message', label: '建造指令', type: 'trigger', x: 0, y: 0, config: { match: 'command', command: '建造', prefix: '/' } },
      { id: 'mg1_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 0, config: { mode: 'user_id' } },
      { id: 'mg1_load', kind: 'persistent_op', label: '读建筑数', type: 'data', x: 500, y: 0, config: { mode: 'load', key: 'building_count', scope: 'user' } },
      { id: 'mg1_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 0, config: { expression: 'value != None' } },
      { id: 'mg1_no', kind: 'send_message', label: '未创建账号', type: 'action', x: 1000, y: 150, config: { text: '未创建账号，输入 /创建账号' } },
      { id: 'mg1_load_gold', kind: 'persistent_op', label: '读金币', type: 'data', x: 1000, y: -150, config: { mode: 'load', key: 'gold', scope: 'user' } },
      { id: 'mg1_if_gold', kind: 'if_branch', label: '金币>=100?', type: 'logic', x: 1250, y: -150, config: { expression: 'value >= 100' } },
      { id: 'mg1_no_gold', kind: 'send_message', label: '金币不足', type: 'action', x: 1500, y: 0, config: { text: '金币不足，需要100金币' } },
      { id: 'mg1_math_gold', kind: 'expression_eval', label: '金币-100', type: 'logic', x: 1500, y: -300, config: { expression: 'v1 - 100' } },
      { id: 'mg1_save_gold', kind: 'persistent_op', label: '存金币', type: 'data', x: 1750, y: -300, config: { mode: 'save', key: 'gold', scope: 'user' } },
      { id: 'mg1_math_bc', kind: 'expression_eval', label: '建筑数+1', type: 'logic', x: 2000, y: -300, config: { expression: 'v1 + 1' } },
      { id: 'mg1_save_bc', kind: 'persistent_op', label: '存建筑数', type: 'data', x: 2250, y: -300, config: { mode: 'save', key: 'building_count', scope: 'user' } },
      { id: 'mg1_save_stock', kind: 'persistent_op', label: '库存归零', type: 'data', x: 2500, y: -300, config: { mode: 'save', key: 'stock', value: 0, scope: 'user' } },
      { id: 'mg1_msg', kind: 'send_message', label: '建造成功', type: 'action', x: 2750, y: -300, config: { text: '建筑建造成功！建筑数+1' } },
      // ─── 链2 · /创建账号 初始化经营账号 ───
      { id: 'mg2_cmd', kind: 'on_message', label: '创建账号', type: 'trigger', x: 0, y: 350, config: { match: 'command', command: '创建账号', prefix: '/' } },
      { id: 'mg2_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 350, config: { mode: 'user_id' } },
      { id: 'mg2_load', kind: 'persistent_op', label: '读建筑数', type: 'data', x: 500, y: 350, config: { mode: 'load', key: 'building_count', scope: 'user' } },
      { id: 'mg2_if', kind: 'if_branch', label: '已有账号？', type: 'logic', x: 750, y: 350, config: { expression: 'value != None' } },
      { id: 'mg2_exist', kind: 'send_message', label: '已创建', type: 'action', x: 1000, y: 250, config: { text: '已创建账号' } },
      { id: 'mg2_s_bc', kind: 'persistent_op', label: '存建筑数', type: 'data', x: 1000, y: 450, config: { mode: 'save', key: 'building_count', value: 0, scope: 'user' } },
      { id: 'mg2_s_gold', kind: 'persistent_op', label: '存金币', type: 'data', x: 1250, y: 450, config: { mode: 'save', key: 'gold', value: 500, scope: 'user' } },
      { id: 'mg2_s_stock', kind: 'persistent_op', label: '存库存', type: 'data', x: 1500, y: 450, config: { mode: 'save', key: 'stock', value: 0, scope: 'user' } },
      { id: 'mg2_s_pros', kind: 'persistent_op', label: '存繁荣度', type: 'data', x: 1750, y: 450, config: { mode: 'save', key: 'prosperity', value: 0, scope: 'user' } },
      { id: 'mg2_msg', kind: 'send_message', label: '创建成功', type: 'action', x: 2000, y: 450, config: { text: '账号创建成功！初始金币500，输入 /建造 开始经营' } },
      // ─── 链3 · /产业 查看产业 ───
      { id: 'mg3_cmd', kind: 'on_message', label: '产业指令', type: 'trigger', x: 0, y: 700, config: { match: 'command', command: '产业', prefix: '/' } },
      { id: 'mg3_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 700, config: { mode: 'user_id' } },
      { id: 'mg3_load', kind: 'persistent_op', label: '读建筑数', type: 'data', x: 500, y: 700, config: { mode: 'load', key: 'building_count', scope: 'user' } },
      { id: 'mg3_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 700, config: { expression: 'value != None' } },
      { id: 'mg3_no', kind: 'send_message', label: '未创建', type: 'action', x: 1000, y: 800, config: { text: '未创建账号' } },
      { id: 'mg3_load_gold', kind: 'persistent_op', label: '读金币', type: 'data', x: 1000, y: 600, config: { mode: 'load', key: 'gold', scope: 'user' } },
      { id: 'mg3_load_stock', kind: 'persistent_op', label: '读库存', type: 'data', x: 1250, y: 600, config: { mode: 'load', key: 'stock', scope: 'user' } },
      { id: 'mg3_fmt', kind: 'format_text', label: '格式化产业', type: 'logic', x: 1500, y: 600, config: { template: '🏭 你的产业\n建筑数：{var1}\n金币：{var2}\n库存：{var3}' } },
      { id: 'mg3_msg', kind: 'send_message', label: '发送产业', type: 'action', x: 1750, y: 600, config: { text: '' } },
      // ─── 链4 · /生产 生产商品 ───
      { id: 'mg4_cmd', kind: 'on_message', label: '生产指令', type: 'trigger', x: 0, y: 1050, config: { match: 'command', command: '生产', prefix: '/' } },
      { id: 'mg4_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1050, config: { mode: 'user_id' } },
      { id: 'mg4_load', kind: 'persistent_op', label: '读建筑数', type: 'data', x: 500, y: 1050, config: { mode: 'load', key: 'building_count', scope: 'user' } },
      { id: 'mg4_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 1050, config: { expression: 'value != None' } },
      { id: 'mg4_no', kind: 'send_message', label: '未创建账号', type: 'action', x: 1000, y: 1200, config: { text: '未创建账号' } },
      { id: 'mg4_if_bc', kind: 'if_branch', label: '建筑数>0?', type: 'logic', x: 1000, y: 900, config: { expression: 'value > 0' } },
      { id: 'mg4_no_bc', kind: 'send_message', label: '没有建筑', type: 'action', x: 1250, y: 1050, config: { text: '没有建筑，/建造 先建造' } },
      { id: 'mg4_load_stock', kind: 'persistent_op', label: '读库存', type: 'data', x: 1250, y: 750, config: { mode: 'load', key: 'stock', scope: 'user' } },
      { id: 'mg4_math', kind: 'expression_eval', label: '库存+10', type: 'logic', x: 1500, y: 750, config: { expression: 'v1 + 10' } },
      { id: 'mg4_save', kind: 'persistent_op', label: '存库存', type: 'data', x: 1750, y: 750, config: { mode: 'save', key: 'stock', scope: 'user' } },
      { id: 'mg4_msg', kind: 'send_message', label: '生产成功', type: 'action', x: 2000, y: 750, config: { text: '生产成功！库存+10' } },
      // ─── 链5 · /卖出 出售商品 ───
      { id: 'mg5_cmd', kind: 'on_message', label: '卖出指令', type: 'trigger', x: 0, y: 1400, config: { match: 'command', command: '卖出', prefix: '/' } },
      { id: 'mg5_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1400, config: { mode: 'user_id' } },
      { id: 'mg5_load', kind: 'persistent_op', label: '读建筑数', type: 'data', x: 500, y: 1400, config: { mode: 'load', key: 'building_count', scope: 'user' } },
      { id: 'mg5_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 1400, config: { expression: 'value != None' } },
      { id: 'mg5_no', kind: 'send_message', label: '未创建账号', type: 'action', x: 1000, y: 1550, config: { text: '未创建账号' } },
      { id: 'mg5_load_stock', kind: 'persistent_op', label: '读库存', type: 'data', x: 1000, y: 1250, config: { mode: 'load', key: 'stock', scope: 'user' } },
      { id: 'mg5_if_stock', kind: 'if_branch', label: '库存>=10?', type: 'logic', x: 1250, y: 1250, config: { expression: 'value >= 10' } },
      { id: 'mg5_no_stock', kind: 'send_message', label: '库存不足', type: 'action', x: 1500, y: 1400, config: { text: '库存不足，需要10个商品' } },
      { id: 'mg5_math_stock', kind: 'expression_eval', label: '库存-10', type: 'logic', x: 1500, y: 1100, config: { expression: 'v1 - 10' } },
      { id: 'mg5_save_stock', kind: 'persistent_op', label: '存库存', type: 'data', x: 1750, y: 1100, config: { mode: 'save', key: 'stock', scope: 'user' } },
      { id: 'mg5_load_gold', kind: 'persistent_op', label: '读金币', type: 'data', x: 2000, y: 1100, config: { mode: 'load', key: 'gold', scope: 'user' } },
      { id: 'mg5_math_gold', kind: 'expression_eval', label: '金币+100', type: 'logic', x: 2250, y: 1100, config: { expression: 'v1 + 100' } },
      { id: 'mg5_save_gold', kind: 'persistent_op', label: '存金币', type: 'data', x: 2500, y: 1100, config: { mode: 'save', key: 'gold', scope: 'user' } },
      { id: 'mg5_msg', kind: 'send_message', label: '卖出成功', type: 'action', x: 2750, y: 1100, config: { text: '卖出10个商品，获得100金币！' } },
      // ─── 链6 · /升级 升级建筑 ───
      { id: 'mg6_cmd', kind: 'on_message', label: '升级指令', type: 'trigger', x: 0, y: 1750, config: { match: 'command', command: '升级', prefix: '/' } },
      { id: 'mg6_uid', kind: 'get_context', label: '获取QQ号', type: 'logic', x: 250, y: 1750, config: { mode: 'user_id' } },
      { id: 'mg6_load', kind: 'persistent_op', label: '读建筑数', type: 'data', x: 500, y: 1750, config: { mode: 'load', key: 'building_count', scope: 'user' } },
      { id: 'mg6_if', kind: 'if_branch', label: '有账号？', type: 'logic', x: 750, y: 1750, config: { expression: 'value != None' } },
      { id: 'mg6_no', kind: 'send_message', label: '未创建账号', type: 'action', x: 1000, y: 1900, config: { text: '未创建账号' } },
      { id: 'mg6_load_gold', kind: 'persistent_op', label: '读金币', type: 'data', x: 1000, y: 1600, config: { mode: 'load', key: 'gold', scope: 'user' } },
      { id: 'mg6_if_gold', kind: 'if_branch', label: '金币>=200?', type: 'logic', x: 1250, y: 1600, config: { expression: 'value >= 200' } },
      { id: 'mg6_no_gold', kind: 'send_message', label: '金币不足', type: 'action', x: 1500, y: 1750, config: { text: '金币不足，需要200' } },
      { id: 'mg6_math_gold', kind: 'expression_eval', label: '金币-200', type: 'logic', x: 1500, y: 1450, config: { expression: 'v1 - 200' } },
      { id: 'mg6_save_gold', kind: 'persistent_op', label: '存金币', type: 'data', x: 1750, y: 1450, config: { mode: 'save', key: 'gold', scope: 'user' } },
      { id: 'mg6_math_bc', kind: 'expression_eval', label: '建筑数+1', type: 'logic', x: 2000, y: 1450, config: { expression: 'v1 + 1' } },
      { id: 'mg6_save_bc', kind: 'persistent_op', label: '存建筑数', type: 'data', x: 2250, y: 1450, config: { mode: 'save', key: 'building_count', scope: 'user' } },
      { id: 'mg6_msg', kind: 'send_message', label: '升级成功', type: 'action', x: 2500, y: 1450, config: { text: '建筑升级！建筑数+1' } }
    ]),
    edges: buildEdges([
      // ── 链1 控制流：/建造 ──
      { source: 'mg1_cmd', target: 'mg1_uid' },
      { source: 'mg1_uid', target: 'mg1_load' },
      { source: 'mg1_load', target: 'mg1_if' },
      { source: 'mg1_if', target: 'mg1_no', sourcePort: 'false' },
      { source: 'mg1_if', target: 'mg1_load_gold', sourcePort: 'true' },
      { source: 'mg1_load_gold', target: 'mg1_if_gold' },
      { source: 'mg1_if_gold', target: 'mg1_no_gold', sourcePort: 'false' },
      { source: 'mg1_if_gold', target: 'mg1_math_gold', sourcePort: 'true' },
      { source: 'mg1_math_gold', target: 'mg1_save_gold' },
      { source: 'mg1_save_gold', target: 'mg1_math_bc' },
      { source: 'mg1_math_bc', target: 'mg1_save_bc' },
      { source: 'mg1_save_bc', target: 'mg1_save_stock' },
      { source: 'mg1_save_stock', target: 'mg1_msg' },
      // 链1 数据流
      { source: 'mg1_load', target: 'mg1_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg1_load_gold', target: 'mg1_if_gold', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg1_load_gold', target: 'mg1_math_gold', sourcePort: 'result', targetPort: 'v1' },
      { source: 'mg1_math_gold', target: 'mg1_save_gold', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg1_load', target: 'mg1_math_bc', sourcePort: 'result', targetPort: 'v1' },
      { source: 'mg1_math_bc', target: 'mg1_save_bc', sourcePort: 'result', targetPort: 'value' },
      // ── 链2 控制流：/创建账号 ──
      { source: 'mg2_cmd', target: 'mg2_uid' },
      { source: 'mg2_uid', target: 'mg2_load' },
      { source: 'mg2_load', target: 'mg2_if' },
      { source: 'mg2_if', target: 'mg2_exist', sourcePort: 'true' },
      { source: 'mg2_if', target: 'mg2_s_bc', sourcePort: 'false' },
      { source: 'mg2_s_bc', target: 'mg2_s_gold' },
      { source: 'mg2_s_gold', target: 'mg2_s_stock' },
      { source: 'mg2_s_stock', target: 'mg2_s_pros' },
      { source: 'mg2_s_pros', target: 'mg2_msg' },
      // 链2 数据流
      { source: 'mg2_load', target: 'mg2_if', sourcePort: 'result', targetPort: 'value' },
      // ── 链3 控制流：/产业 ──
      { source: 'mg3_cmd', target: 'mg3_uid' },
      { source: 'mg3_uid', target: 'mg3_load' },
      { source: 'mg3_load', target: 'mg3_if' },
      { source: 'mg3_if', target: 'mg3_no', sourcePort: 'false' },
      { source: 'mg3_if', target: 'mg3_load_gold', sourcePort: 'true' },
      { source: 'mg3_load_gold', target: 'mg3_load_stock' },
      { source: 'mg3_load_stock', target: 'mg3_fmt' },
      { source: 'mg3_fmt', target: 'mg3_msg' },
      // 链3 数据流
      { source: 'mg3_load', target: 'mg3_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg3_load', target: 'mg3_fmt', sourcePort: 'result', targetPort: 'var1' },
      { source: 'mg3_load_gold', target: 'mg3_fmt', sourcePort: 'result', targetPort: 'var2' },
      { source: 'mg3_load_stock', target: 'mg3_fmt', sourcePort: 'result', targetPort: 'var3' },
      { source: 'mg3_fmt', target: 'mg3_msg', sourcePort: 'result', targetPort: 'text' },
      // ── 链4 控制流：/生产 ──
      { source: 'mg4_cmd', target: 'mg4_uid' },
      { source: 'mg4_uid', target: 'mg4_load' },
      { source: 'mg4_load', target: 'mg4_if' },
      { source: 'mg4_if', target: 'mg4_no', sourcePort: 'false' },
      { source: 'mg4_if', target: 'mg4_if_bc', sourcePort: 'true' },
      { source: 'mg4_if_bc', target: 'mg4_no_bc', sourcePort: 'false' },
      { source: 'mg4_if_bc', target: 'mg4_load_stock', sourcePort: 'true' },
      { source: 'mg4_load_stock', target: 'mg4_math' },
      { source: 'mg4_math', target: 'mg4_save' },
      { source: 'mg4_save', target: 'mg4_msg' },
      // 链4 数据流
      { source: 'mg4_load', target: 'mg4_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg4_load', target: 'mg4_if_bc', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg4_load_stock', target: 'mg4_math', sourcePort: 'result', targetPort: 'v1' },
      { source: 'mg4_math', target: 'mg4_save', sourcePort: 'result', targetPort: 'value' },
      // ── 链5 控制流：/卖出 ──
      { source: 'mg5_cmd', target: 'mg5_uid' },
      { source: 'mg5_uid', target: 'mg5_load' },
      { source: 'mg5_load', target: 'mg5_if' },
      { source: 'mg5_if', target: 'mg5_no', sourcePort: 'false' },
      { source: 'mg5_if', target: 'mg5_load_stock', sourcePort: 'true' },
      { source: 'mg5_load_stock', target: 'mg5_if_stock' },
      { source: 'mg5_if_stock', target: 'mg5_no_stock', sourcePort: 'false' },
      { source: 'mg5_if_stock', target: 'mg5_math_stock', sourcePort: 'true' },
      { source: 'mg5_math_stock', target: 'mg5_save_stock' },
      { source: 'mg5_save_stock', target: 'mg5_load_gold' },
      { source: 'mg5_load_gold', target: 'mg5_math_gold' },
      { source: 'mg5_math_gold', target: 'mg5_save_gold' },
      { source: 'mg5_save_gold', target: 'mg5_msg' },
      // 链5 数据流
      { source: 'mg5_load', target: 'mg5_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg5_load_stock', target: 'mg5_if_stock', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg5_load_stock', target: 'mg5_math_stock', sourcePort: 'result', targetPort: 'v1' },
      { source: 'mg5_math_stock', target: 'mg5_save_stock', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg5_load_gold', target: 'mg5_math_gold', sourcePort: 'result', targetPort: 'v1' },
      { source: 'mg5_math_gold', target: 'mg5_save_gold', sourcePort: 'result', targetPort: 'value' },
      // ── 链6 控制流：/升级 ──
      { source: 'mg6_cmd', target: 'mg6_uid' },
      { source: 'mg6_uid', target: 'mg6_load' },
      { source: 'mg6_load', target: 'mg6_if' },
      { source: 'mg6_if', target: 'mg6_no', sourcePort: 'false' },
      { source: 'mg6_if', target: 'mg6_load_gold', sourcePort: 'true' },
      { source: 'mg6_load_gold', target: 'mg6_if_gold' },
      { source: 'mg6_if_gold', target: 'mg6_no_gold', sourcePort: 'false' },
      { source: 'mg6_if_gold', target: 'mg6_math_gold', sourcePort: 'true' },
      { source: 'mg6_math_gold', target: 'mg6_save_gold' },
      { source: 'mg6_save_gold', target: 'mg6_math_bc' },
      { source: 'mg6_math_bc', target: 'mg6_save_bc' },
      { source: 'mg6_save_bc', target: 'mg6_msg' },
      // 链6 数据流
      { source: 'mg6_load', target: 'mg6_if', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg6_load_gold', target: 'mg6_if_gold', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg6_load_gold', target: 'mg6_math_gold', sourcePort: 'result', targetPort: 'v1' },
      { source: 'mg6_math_gold', target: 'mg6_save_gold', sourcePort: 'result', targetPort: 'value' },
      { source: 'mg6_load', target: 'mg6_math_bc', sourcePort: 'result', targetPort: 'v1' },
      { source: 'mg6_math_bc', target: 'mg6_save_bc', sourcePort: 'result', targetPort: 'value' }
    ]),
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0'
  },

  // ════════════════════════════════════════════════════════════════
  // 教学模板：极简战斗闭环（最小可运行示例）
  // 目标：演示"按钮闭环"——最关键的交互模式
  // 模式：发按钮 → 等点击(新事件) → 处理 → 判断 → 再发按钮(循环)
  // 3 条链 / 10 个节点，每条链都有详细注释
  // ════════════════════════════════════════════════════════════════
  {
    id: 'tutorial-combat-loop',
    botCategory: 'game',
    name: '教学：战斗闭环（最小可运行示例）',
    description: '【教学模板】极简战斗闭环演示：/战斗 发按钮 → 点攻击 → 算伤害 → 判断胜负 → 胜利结束/未胜再发按钮（形成循环）。3条链10节点，演示"按钮闭环"这一最关键的模式。建议先看此模板理解闭环结构，再去做复杂机器人。',
    category: '教学',
    tags: ['教学', '战斗', '闭环', '按钮', '状态机', 'persistent_op', 'if_branch'],
    author: '内置',
    nodes: buildNodes([
      // ════════════════════════════════════════════════
      // 链1 · /战斗 指令 → 初始化怪物HP → 发攻击/逃跑按钮
      // ════════════════════════════════════════════════
      // 触发器：用户输入 /战斗
      { id: 't1', kind: 'on_message', label: '/战斗 指令', type: 'trigger', x: 0, y: 0, config: { match: 'command', command: '战斗', prefix: '/' } },
      // 持久化：把 monster_hp=100 存到 user 作用域（每个玩家独立怪物HP）
      // scope='user' 是关键：跨事件保留状态，按钮点击事件能读到这个值
      { id: 't2', kind: 'persistent_op', label: '初始化怪物HP=100', type: 'data', x: 0, y: 100, config: { mode: 'save', key: 'monster_hp', value: 100, scope: 'user' } },
      // 发按钮消息：mode='keyboard' 会动态生成 btn_attack / btn_flee 两个输出端口
      // 每个按钮点击会作为独立事件触发下游节点——这就是"闭环入口"
      { id: 't3', kind: 'send_message', label: '发战斗按钮', type: 'action', x: 0, y: 200, config: {
        mode: 'keyboard',
        markdown: '## ⚔️ 一只史莱姆出现了！\nHP: 100\n选择你的行动：',
        keyboard: { rows: [
          { buttons: [
            { id: 'attack', render_data: { label: '⚔️ 攻击', style: 1 }, action: { type: 2, permission: { type: 2 }, data: 'attack' } },
            { id: 'flee',    render_data: { label: '🏃 逃跑', style: 0 }, action: { type: 2, permission: { type: 2 }, data: 'flee' } }
          ] }
        ]},
        panelId: ''
      }},

      // ════════════════════════════════════════════════
      // 链2 · 点"攻击"按钮 → 读HP → 算伤害 → 保存 → 判断 → 闭环
      // ════════════════════════════════════════════════
      // 入口：t3 的 btn_attack 端口（用户点了攻击按钮）
      // 读取当前 monster_hp（链1 初始化的 100，或上次循环保存的新值）
      { id: 'a1', kind: 'persistent_op', label: '读取当前HP', type: 'data', x: 300, y: 0, config: { mode: 'load', key: 'monster_hp', scope: 'user' } },
      // 表达式：v1 - 20（v1 绑定 a1.result 即当前HP；固定伤害20）
      { id: 'a2', kind: 'expression_eval', label: '计算伤害(HP-20)', type: 'logic', x: 300, y: 100, config: { expression: 'v1 - 20' } },
      // 保存新HP到持久化（下一次按钮点击能读到）
      { id: 'a3', kind: 'persistent_op', label: '保存新HP', type: 'data', x: 300, y: 200, config: { mode: 'save', key: 'monster_hp', scope: 'user' } },
      // 判断：新HP <= 0？ expression 用 'value' 引用输入端口值
      { id: 'a4', kind: 'if_branch', label: 'HP<=0?', type: 'logic', x: 300, y: 300, config: { expression: 'value <= 0' } },
      // true 分支：胜利结束
      { id: 'a5', kind: 'send_message', label: '胜利！', type: 'action', x: 100, y: 400, config: { mode: 'text', text: '🎉 你击败了史莱姆！获得 50 金币。' } },
      // false 分支：拼文本 → 再发按钮（闭环关键！）
      // format_text 用 {var1} 占位符，var1 绑定 a2.result（新HP）
      { id: 'a6', kind: 'format_text', label: '拼剩余HP文本', type: 'logic', x: 500, y: 400, config: { template: '## ⚔️ 史莱姆受伤了！\n剩余 HP: {var1}\n继续选择行动：' } },
      // 再次发按钮：markdown 绑定 a6.result（动态显示剩余HP）
      // 这个节点的 btn_attack 端口会连回 a1——形成闭环循环！
      { id: 'a7', kind: 'send_message', label: '继续战斗(再发按钮)', type: 'action', x: 500, y: 500, config: {
        mode: 'keyboard',
        markdown: '',
        keyboard: { rows: [
          { buttons: [
            { id: 'attack', render_data: { label: '⚔️ 攻击', style: 1 }, action: { type: 2, permission: { type: 2 }, data: 'attack' } },
            { id: 'flee',    render_data: { label: '🏃 逃跑', style: 0 }, action: { type: 2, permission: { type: 2 }, data: 'flee' } }
          ] }
        ]},
        panelId: ''
      }},

      // ════════════════════════════════════════════════
      // 链3 · 点"逃跑"按钮 → 直接结束
      // ════════════════════════════════════════════════
      // t3 和 a7 的 btn_flee 端口都连到这里——任何时刻点逃跑都能逃
      { id: 'f1', kind: 'send_message', label: '逃跑成功', type: 'action', x: 800, y: 0, config: { mode: 'text', text: '🏃 你逃跑了，战斗结束。' } }
    ]),
    edges: buildEdges([
      // ── 链1 控制流：/战斗 → 初始化 → 发按钮 ──
      { source: 't1', target: 't2' },
      { source: 't2', target: 't3' },

      // ── 链2 入口：t3 的 btn_attack 端口 → a1 ──
      // 关键：send_message(keyboard) 的 btn_<id> 端口 = 按钮点击事件触发器
      { source: 't3', target: 'a1', sourcePort: 'btn_attack' },

      // ── 链2 控制流：读 → 算 → 存 → 判断 ──
      { source: 'a1', target: 'a2' },
      { source: 'a2', target: 'a3' },
      { source: 'a3', target: 'a4' },
      // if_branch 的 true/false 是两个独立控制输出端口
      { source: 'a4', target: 'a5', sourcePort: 'true' },
      { source: 'a4', target: 'a6', sourcePort: 'false' },
      { source: 'a6', target: 'a7' },

      // ── 链2 数据流（核心教学点！）──
      // a1.result(当前HP) → a2.v1：把"读取的HP"喂给表达式当 v1
      { source: 'a1', target: 'a2', sourcePort: 'result', targetPort: 'v1' },
      // a2.result(新HP) → a3.value：把"算出的新HP"喂给 save 当 value
      { source: 'a2', target: 'a3', sourcePort: 'result', targetPort: 'value' },
      // a2.result(新HP) → a4.value：用新HP判断是否<=0（注意不是 a3，因为 save 不输出 result）
      { source: 'a2', target: 'a4', sourcePort: 'result', targetPort: 'value' },
      // a2.result(新HP) → a6.var1：把新HP喂给 format_text 替换 {var1}
      { source: 'a2', target: 'a6', sourcePort: 'result', targetPort: 'var1' },
      // a6.result(拼接文本) → a7.markdown：把拼好的文本作为按钮消息的 markdown
      { source: 'a6', target: 'a7', sourcePort: 'result', targetPort: 'markdown' },

      // ── 闭环关键！a7 的 btn_attack 端口 → a1 ──
      // 用户点 a7 发的"攻击"按钮 → 再次进入 a1 读取HP → 形成循环
      // 这就是"按钮闭环"的核心：每次发按钮都给自己留了回来的路
      { source: 'a7', target: 'a1', sourcePort: 'btn_attack' },

      // ── 链3 入口：逃跑按钮 → 结束 ──
      // t3（首次战斗）和 a7（循环中）的 btn_flee 端口都连到 f1
      { source: 't3', target: 'f1', sourcePort: 'btn_flee' },
      { source: 'a7', target: 'f1', sourcePort: 'btn_flee' }
    ]),
    createdAt: '2026-07-09T00:00:00.000Z',
    version: '1.0'
  }
])
