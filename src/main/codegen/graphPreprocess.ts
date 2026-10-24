// src/main/codegen/graphPreprocess.ts
// 图预处理：填充缺失端口 + 旧 kind 迁移。
// 从 generator.ts 拆分而来。
// - populateMissingPorts: flow.json 端口定义丢失时从 NodeSpecV2 重新填充
// - migrateLegacyKinds: 旧版节点 kind（on_at_me/send_to/sqlite_query 等）自动迁移为新版合并节点
//   后端（迁移前的 Python 实现）是兜底迁移，两端的转换规则必须保持完全一致。
import type { FlowGraph, Port } from '@shared/types/flow'
import { getNodeRegistry } from '../nodes/registry'

/**
 * 填充节点中缺失的 input/output 端口定义（从 NodeSpecV2 获取）。
 * 处理 flow.json 存储时端口定义丢失的情况。
 */
export function populateMissingPorts(graph: FlowGraph): void {
  const registry = getNodeRegistry()
  for (const node of graph.nodes) {
    if (node.data.inputs.length === 0 || node.data.outputs.length === 0) {
      const spec = registry.find(node.data.nodeKind)
      if (spec) {
        if (node.data.inputs.length === 0) {
          node.data.inputs = spec.inputs.map((p) => ({ ...p })) as Port[]
        }
        if (node.data.outputs.length === 0) {
          node.data.outputs = spec.outputs.map((p) => ({ ...p })) as Port[]
        }
      }
    }
  }
}

const LEGACY_KIND_MIGRATIONS: Record<string, { newKind: string; mode: string }> = {
  now: { newKind: 'time_op', mode: 'now' },
  is_today: { newKind: 'time_op', mode: 'is_today' },
  date_diff: { newKind: 'time_op', mode: 'date_diff' },
  // JSON 类合并：json_process → json_op + mode='get'
  json_process: { newKind: 'json_op', mode: 'get' },
  // json_set 的旧 config 已有 mode 字段（set/delete/merge），迁移时保留原 mode
  // 特殊处理：json_set 的 mode 字段值需要透传到新节点的 mode，见下方特殊逻辑
  // 上下文类合并：5 个节点 → get_context
  get_context_id: { newKind: 'get_context', mode: 'user_id' },
  get_command_args: { newKind: 'get_context', mode: 'command_args' },
  get_group_member_list: { newKind: 'get_context', mode: 'group_members' },
  get_message_part: { newKind: 'get_context', mode: 'message_part' },
  get_name: { newKind: 'get_context', mode: 'user_name' },
  // 状态管理类合并：7 个节点 → persistent_op
  // 注：check_cooldown / leaderboard_query 已移除且无自动迁移（需手动重构为 time_op+expression_eval / query）
  save_persistent: { newKind: 'persistent_op', mode: 'save' },
  load_persistent: { newKind: 'persistent_op', mode: 'load' },
  persistent_check: { newKind: 'persistent_op', mode: 'delete' },
  load_or_default: { newKind: 'persistent_op', mode: 'load_or_default' },
  increment_persistent: { newKind: 'persistent_op', mode: 'increment' },
  batch_persistent: { newKind: 'persistent_op', mode: 'batch_load' },
  list_append: { newKind: 'persistent_op', mode: 'list_append' },
  // 消息段类合并：9 个旧节点 → message_op(mode='segment')，需同时设置 segment_type，见下方特殊处理
  // 文件操作类合并：2 个节点 → file_op
  file_read: { newKind: 'file_op', mode: 'read' },
  file_write: { newKind: 'file_op', mode: 'write' },
  // 群管理类合并：8 个节点 → group_op
  // 注意：group_punish 与 set_member_attr 有特殊处理（保留旧 config.mode），见下方特殊逻辑
  group_punish: { newKind: 'group_op', mode: 'ban' },
  set_member_attr: { newKind: 'group_op', mode: 'set_card' },
  set_group_leave: { newKind: 'group_op', mode: 'leave' },
  approve_friend_request: { newKind: 'group_op', mode: 'approve_friend' },
  approve_group_request: { newKind: 'group_op', mode: 'approve_group' },
  send_group_notice: { newKind: 'group_op', mode: 'notice' },
  set_group_whole_ban: { newKind: 'group_op', mode: 'mute_all' },
  upload_group_file: { newKind: 'group_op', mode: 'upload_file' },
  essence_msg: { newKind: 'group_op', mode: 'essence' },
  // call_command 合并到 subflow_call：语义不同（前者模拟指令触发，后者调用子流程），
  // 迁移后 command 字段保留但需用户手动绑定 subflow_id 到对应的 subflow_define
  // S1 修复：与 generator.ts 保持一致（graphPreprocess.ts 之前遗漏此迁移）
  call_command: { newKind: 'subflow_call', mode: '' },
  // combat_calc 已移除：业务级封装节点，迁移到 expression_eval 后
  // 需用户手动调整表达式（如 'max(0, v2 - v1 * 2)'）和重新绑定输入端口（v1/v2/v3）
  combat_calc: { newKind: 'expression_eval', mode: '' },
  // 循环三合一：foreach/loop_while → loop(mode)
  foreach: { newKind: 'loop', mode: 'iterate' },
  loop_while: { newKind: 'loop', mode: 'while' },
  // 流程控制二合一：break_loop/return_chain → flow_control(mode)
  break_loop: { newKind: 'flow_control', mode: 'break' },
  return_chain: { newKind: 'flow_control', mode: 'return' },
  // 错误操作二合一：assert_node → error_op(mode='assert')（throw_error 需字段重命名，见下方特殊处理）
  assert_node: { newKind: 'error_op', mode: 'assert' },
}

/**
 * 迁移旧节点 kind 到合并后的新节点。
 * 节点合并后，旧 flow.json 中的 kind 需要自动转换为新 kind + mode。
 * 例如: now → time_op + mode='now'
 */
export function migrateLegacyKinds(graph: FlowGraph): void {
  for (const node of graph.nodes) {
    // on_at_me → on_message(match='at_me', message_type='any')
    // 旧 on_at_me 无配置参数，新 on_message 用 match=at_me + message_type=any 覆盖
    if (node.data.nodeKind === 'on_at_me') {
      node.data.nodeKind = 'on_message'
      node.data.config = { match: 'at_me', message_type: 'any' }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // on_command → on_message(match='command')，保留 command/prefix 字段并设默认值
    if (node.data.nodeKind === 'on_command') {
      node.data.nodeKind = 'on_message'
      node.data.config = {
        match: 'command',
        message_type: 'any',
        command: (node.data.config.command as string) ?? '',
        prefix: (node.data.config.prefix as string) ?? '/',
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // on_regex → on_message(match='regex')，保留 pattern/flags 字段并补齐默认值
    if (node.data.nodeKind === 'on_regex') {
      node.data.nodeKind = 'on_message'
      node.data.config = {
        match: 'regex',
        message_type: 'any',
        pattern: (node.data.config.pattern as string) ?? '',
        flags: (node.data.config.flags as string) ?? '',
        command: '',
        prefix: '/',
        keywords: [],
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // send_to → send_message(mode='text', target_type=..., target_id=...)
    // send_to 旧 config 可能使用 message_type/user_id/group_id/message 字段，
    // 也可能已使用 target_type/target_id/text 字段（前端新版导出）。
    // 两种格式都兼容，统一转换为新 send_message 的 config 结构。
    if (node.data.nodeKind === 'send_to') {
      const oldConfig = node.data.config
      // 文本内容：优先 message，其次 text
      let msgContent = (oldConfig.message as string) ?? ''
      if (msgContent === '') {
        msgContent = (oldConfig.text as string) ?? ''
      }
      // 发送目标：优先 target_type/target_id（已是新格式），否则从 message_type/user_id/group_id 转换
      let targetType: string
      let targetId: string
      if ('target_type' in oldConfig) {
        targetType = (oldConfig.target_type as string) ?? ''
        targetId = String(oldConfig.target_id ?? '')
      } else {
        const oldType = String(oldConfig.message_type ?? 'private').toLowerCase()
        if (oldType === 'group') {
          targetType = 'group'
          targetId = String(oldConfig.group_id ?? '')
        } else {
          targetType = 'user'
          targetId = String(oldConfig.user_id ?? '')
        }
      }
      node.data.nodeKind = 'send_message'
      node.data.config = { mode: 'text', text: msgContent, target_type: targetType, target_id: targetId }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // send_keyboard_message → send_message(mode='keyboard')
    // send_keyboard_message 已合并到 send_message 的 keyboard 模式
    if (node.data.nodeKind === 'send_keyboard_message') {
      const oldConfig = node.data.config
      node.data.nodeKind = 'send_message'
      node.data.config = {
        mode: 'keyboard',
        markdown: (oldConfig.markdown as string) ?? '',
        keyboard: oldConfig.keyboard ?? '',
        text: '',
        segments: '',
        messages: '',
        user_id: '',
        target_type: '',
        target_id: '',
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // sqlite_query → query(mode='list', key_pattern='*')
    // sqlite_query 的 SQL 查询语义在新 query 节点中无直接对应（query 面向
    // persistent_op 的 key-value 存储，不执行 SQL），迁移为最通用的 list 模式
    // （列出所有匹配 key_pattern=* 的记录），用户可后续手动调整参数。
    if (node.data.nodeKind === 'sqlite_query') {
      node.data.nodeKind = 'query'
      node.data.config = { mode: 'list', key_pattern: '*' }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // wait_reply → wait_input，保留 prompt/timeout/expected_pattern/invalid_message/max_retries
    // 丢弃 timeout_message（wait_input 无此字段，超时由 timed_out 输出端口表示）
    if (node.data.nodeKind === 'wait_reply') {
      const oldConfig = node.data.config
      node.data.nodeKind = 'wait_input'
      node.data.config = {
        prompt: (oldConfig.prompt as string) ?? '',
        timeout: (oldConfig.timeout as number) ?? 60,
        expected_pattern: (oldConfig.expected_pattern as string) ?? '',
        invalid_message: (oldConfig.invalid_message as string) ?? '输入格式不正确',
        max_retries: (oldConfig.max_retries as number) ?? 3,
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // message_concat → expression_eval，用列表推导式复刻"过滤非 dict 项后合并"语义
    // 原 segments 输入需用户重新绑定到 expression_eval 的命名变量 segments（通过
    // variables_json 传入）或改用 v1，迁移后提示用户检查表达式与变量绑定。
    if (node.data.nodeKind === 'message_concat') {
      node.data.nodeKind = 'expression_eval'
      node.data.config = {
        expression: '[s for s in segments if isinstance(s, dict)]',
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // formula_block → expression_eval(mode='formulas')，保留 formulas 配置
    // formula_block 已合并到 expression_eval，多公式批量计算模式，v1~v6 变量继续可用
    if (node.data.nodeKind === 'formula_block') {
      const oldFormulas = node.data.config.formulas
      node.data.nodeKind = 'expression_eval'
      node.data.config = {
        mode: 'formulas',
        formulas: Array.isArray(oldFormulas) ? oldFormulas : [],
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // persistent_check 特殊处理：旧 config.mode 可能是 'exists' 或 'delete'，需要保留
    // 如果旧 config.mode === 'exists'，迁移时 mode 应为 'exists'
    // 如果旧 config.mode === 'delete' 或未设置，迁移时 mode 应为 'delete'
    // 注意：必须在映射表检查之前处理，否则会被映射表覆盖
    if (node.data.nodeKind === 'persistent_check') {
      const oldMode = (node.data.config.mode as string) || 'delete'
      const newMode = oldMode === 'exists' ? 'exists' : 'delete'
      node.data.nodeKind = 'persistent_op'
      node.data.config = { ...node.data.config, mode: newMode }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // group_punish 特殊处理：旧 config.mode 可能是 'ban' 或 'kick'
    // 必须在映射表检查之前处理，否则会被映射表的默认 mode='ban' 覆盖旧值
    if (node.data.nodeKind === 'group_punish') {
      const oldMode = (node.data.config.mode as string) || 'ban'
      const newMode = oldMode === 'kick' ? 'kick' : 'ban'
      node.data.nodeKind = 'group_op'
      node.data.config = { ...node.data.config, mode: newMode }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // set_member_attr 特殊处理：旧 config.mode 可能是 'set_card' 或 'set_title'
    // 必须在映射表检查之前处理，否则会被映射表的默认 mode='set_card' 覆盖旧值
    if (node.data.nodeKind === 'set_member_attr') {
      const oldMode = (node.data.config.mode as string) || 'set_card'
      const newMode = oldMode === 'set_title' ? 'set_title' : 'set_card'
      node.data.nodeKind = 'group_op'
      node.data.config = { ...node.data.config, mode: newMode }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // loop count→times 别名处理：旧 loop 节点 mode='count' → loop mode='times'
    // loop 节点已三合一（times/iterate/while），仅统一旧 mode 值 'count' → 'times'
    if (node.data.nodeKind === 'loop' && (node.data.config.mode as string) === 'count') {
      node.data.config = { ...node.data.config, mode: 'times' }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // throw_error → error_op(mode='throw')，字段重命名 error_message → message
    if (node.data.nodeKind === 'throw_error') {
      node.data.nodeKind = 'error_op'
      node.data.config = {
        mode: 'throw',
        message: (node.data.config.error_message as string) ?? '业务异常',
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // 消息操作重构：message_op 的 send/forward 模式已合并到 send_message
    // message_segment → message_op(segment_type)（只构造消息段，不发送）
    if (node.data.nodeKind === 'message_segment') {
      node.data.nodeKind = 'message_op'
      const oldSegMode = (node.data.config.mode as string) ?? 'at'
      const { mode: _dropMode, ...restConfig } = node.data.config
      void _dropMode
      node.data.config = {
        ...restConfig,
        segment_type: oldSegMode,
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // send_segment → send_message(mode='segment')（发送消息段）
    if (node.data.nodeKind === 'send_segment') {
      node.data.nodeKind = 'send_message'
      node.data.config = {
        mode: 'segment',
        segments: node.data.config.segments ?? '',
        messages: '',
        user_id: '',
        text: '',
        target_type: node.data.config.target_type ?? '',
        target_id: node.data.config.target_id ?? '',
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // forward_construct → send_message(mode='forward')（合并转发）
    if (node.data.nodeKind === 'forward_construct') {
      node.data.nodeKind = 'send_message'
      node.data.config = {
        mode: 'forward',
        messages: node.data.config.messages ?? '',
        user_id: node.data.config.user_id ?? '',
        segments: '',
        text: '',
        target_type: node.data.config.target_type ?? '',
        target_id: node.data.config.target_id ?? '',
      }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // 已迁移的 message_op 节点：send/forward 模式 → send_message；segment 模式去除 mode 字段
    if (node.data.nodeKind === 'message_op') {
      const opMode = (node.data.config.mode as string) ?? 'segment'
      if (opMode === 'send') {
        node.data.nodeKind = 'send_message'
        const { mode: _m, segments: seg, messages: msg, user_id: uid, ..._rest } = node.data.config
        void _m; void _rest
        node.data.config = {
          mode: 'segment',
          segments: seg ?? '',
          messages: '',
          user_id: '',
          text: '',
          target_type: '',
          target_id: '',
        }
        node.data.inputs = []
        node.data.outputs = []
        continue
      }
      if (opMode === 'forward') {
        node.data.nodeKind = 'send_message'
        const { mode: _m, segments: seg, messages: msg, user_id: uid, ..._rest } = node.data.config
        void _m; void seg; void _rest
        node.data.config = {
          mode: 'forward',
          messages: msg ?? '',
          user_id: uid ?? '',
          segments: '',
          text: '',
          target_type: '',
          target_id: '',
        }
        node.data.inputs = []
        node.data.outputs = []
        continue
      }
      // segment 模式：去除 mode 字段，保留 segment_type
      if (opMode === 'segment') {
        const { mode: _m, ...restConfig } = node.data.config
        void _m
        node.data.config = { ...restConfig }
        node.data.inputs = []
        node.data.outputs = []
        continue
      }
    }
    // 旧消息段节点（at/image/face/record/share/music/poke/reply_segment/forward）→ message_op(segment_type=...)
    const SEGMENT_KIND_MAP: Record<string, string> = {
      at: 'at', image: 'image', face: 'face', record: 'record',
      share: 'share', music: 'music', poke: 'poke',
      reply_segment: 'reply', forward: 'forward',
    }
    const segType = SEGMENT_KIND_MAP[node.data.nodeKind]
    if (segType) {
      node.data.nodeKind = 'message_op'
      const { mode: _dropMode, ...restConfig } = node.data.config
      void _dropMode
      node.data.config = { ...restConfig, segment_type: segType }
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    const migration = LEGACY_KIND_MIGRATIONS[node.data.nodeKind]
    if (migration) {
      node.data.nodeKind = migration.newKind
      node.data.config = { ...node.data.config, mode: migration.mode }
      // 清空端口定义，让 populateMissingPorts 从新 spec 填充
      node.data.inputs = []
      node.data.outputs = []
      continue
    }
    // json_set 特殊处理：保留原 config.mode（set/delete/merge）作为新节点的 mode
    if (node.data.nodeKind === 'json_set') {
      const oldMode = (node.data.config.mode as string) || 'set'
      node.data.nodeKind = 'json_op'
      node.data.config = { ...node.data.config, mode: oldMode }
      node.data.inputs = []
      node.data.outputs = []
      // M2 修复：与其他分支一致，迁移完成后 continue 到下一个节点
      continue
    }
  }
}
