// src/shared/nodes/groups/context.ts
//
// # 目录分片：上下文（4 个节点）
//
// 从 `builtinCatalog.ts` 按 `group` 拆出来（2026-10-03）。**条目原文搬运，未做任何改写**；
// 等价性由「按 kind 排序后的哈希」证明（见提交说明）。加新节点请加在本文件里。
import { inModes } from '../catalogHelpers';
import {
  GET_CONTEXT_MODE_OPTIONS,
  GET_CONTEXT_PART_MODE_OPTIONS,
  GET_IDS_MODE_OPTIONS,
  GET_MESSAGE_MODE_OPTIONS,
  GET_PROFILE_MODE_OPTIONS,
} from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const contextNodes: NodeSpecV2[] = [
  {
    kind: 'get_context',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'context',
    label: '获取上下文（旧版，已拆分）',
    /**
     * ⚠️ 已弃用（2026-10-03）：按「数据来源」拆成 6 个节点 ——
     * get_ids / get_message / get_member / get_group / get_group_lists / get_bot_state。
     *
     * 保留在目录里是因为它**仍是老 flow.json 的有效契约**（迁移见 graphPreprocess 的
     * CONTEXT_SPLIT_BY_MODE）；但**面板、搜索与 AI 工具列表都会隐藏它**，
     * 用户与 AI 看到的是 3 个语义单一的节点。
     */
    deprecated: {
      since: '2026-10-03',
      // 拆分轴 = **调用成本**（零开销 / 本地 / 要调接口），不是"数据来源"
      replacedBy: ['get_ids', 'get_message', 'get_profile'],
      reason: '19 个模式 + 17 个输出端口：选完模式面板上还挂着 16 个无关输出，AI 也拿不到单一语义',
    },
    group: '上下文',
    icon: '🆔',
    description:
      '统一上下文节点（模式切换）：提取 QQ 号/群号/消息文本/指令参数/群成员/消息片段/用户昵称/群名称',
    summary: '按需要提取上下文：基础信息、指令参数、群成员、消息片段、名称查询',
    sideEffects: [],
    tags: ['QQ', '上下文', 'QQ号', '群号', '消息', '指令参数', '群成员', '昵称', 'composite'],
    handler: { source: 'builtin', module: 'get_context' },
    exposedAsTool: true,
    toolName: '获取上下文',
    toolArgs: ['mode', 'index', 'group_id', 'user_id', 'cursor', 'part_mode'],
    defaultConfig: {
      mode: 'user_id',
      index: 0,
      group_id: '',
      user_id: '',
      cursor: '',
      part_mode: 'at',
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'user_id',
        description:
          '可选：用户ID / 群ID / 消息文本 / 机器人QQ / 操作者ID / 消息ID / 原始消息 / 子类型 / 指令参数 / 群成员列表 / 消息片段 / 用户名 / 群名称',
        options: GET_CONTEXT_MODE_OPTIONS,
      },
      {
        id: 'index',
        name: '索引',
        kind: 'data',
        dataType: 'number',
        default: 0,
        description:
          '「指令参数」填第几个参数；「消息片段」填第几个片段（0 表示第一个，-1 表示最后一个）',
        showWhen: inModes('command_args', 'message_part'),
      },
      {
        id: 'group_id',
        name: '群号',
        kind: 'data',
        dataType: 'string',
        description: '「群成员列表 / 群名称 / 用户名」模式：目标群号（留空取当前群）',
        showWhen: inModes('group_members', 'group_name', 'user_name'),
      },
      {
        id: 'user_id',
        name: 'QQ号',
        kind: 'data',
        dataType: 'string',
        description: '「用户名 / 群成员信息」模式：要查询的 QQ 号（留空取触发者）',
        showWhen: inModes('user_name', 'member_info'),
      },
      {
        id: 'cursor',
        name: '分页游标',
        kind: 'data',
        dataType: 'string',
        description:
          '「群成员列表 / 入群申请 / 群黑名单」模式：上一页返回的「下一页游标」，留空取第一页',
        showWhen: inModes('group_members', 'join_requests', 'blacklist_list'),
      },
      {
        id: 'part_mode',
        name: '片段模式',
        kind: 'data',
        dataType: 'string',
        default: 'at',
        description: '「消息片段」模式：可选 @某人 / 图片 / 文件 / 引用回复 / 语音 / 视频 / JSON',
        showWhen: inModes('message_part'),
        options: GET_CONTEXT_PART_MODE_OPTIONS,
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        name: '结果',
        kind: 'data',
        dataType: 'any',
        description: '提取结果（字符串 / 列表 / 字典，取决于所选模式）',
      },
      {
        id: 'args_list',
        name: '全部参数',
        kind: 'data',
        dataType: 'list',
        description: '「指令参数」模式：所有参数列表',
      },
      {
        id: 'members',
        name: '成员列表',
        kind: 'data',
        dataType: 'list',
        description: '「群成员列表」模式：成员列表',
      },
      {
        id: 'part_list',
        name: '片段列表',
        kind: 'data',
        dataType: 'list',
        description: '「消息片段」模式：所有匹配片段列表',
      },
      {
        id: 'part_count',
        name: '片段数量',
        kind: 'data',
        dataType: 'number',
        description: '「消息片段」模式：匹配片段总数',
      },
      {
        id: 'card',
        name: '群昵称',
        kind: 'data',
        dataType: 'string',
        description: '「用户名」模式：群名片（仅群聊时）',
      },
      {
        id: 'nickname',
        name: '用户昵称',
        kind: 'data',
        dataType: 'string',
        description: '「用户名」模式：用户昵称',
      },
      {
        id: 'next_cursor',
        name: '下一页游标',
        kind: 'data',
        dataType: 'string',
        description:
          '「群成员列表 / 入群申请 / 群黑名单」模式：下一页游标（空=没有更多页）；填回「分页游标」即可翻页',
      },
      {
        id: 'role',
        name: '群内角色',
        kind: 'data',
        dataType: 'string',
        description: '「群成员信息 / 机器人群内状态」模式：owner / admin / member',
      },
      {
        id: 'is_admin',
        name: '是管理员',
        kind: 'data',
        dataType: 'boolean',
        description:
          '「群成员信息 / 机器人群内状态」模式：是否管理员或群主（布尔，省得流程里比较字符串）',
      },
      {
        id: 'recv_msg_setting',
        name: '收消息模式',
        kind: 'data',
        dataType: 'string',
        description: '「机器人群内状态」模式：机器人接收消息的设置（如 only_mention）',
      },
      {
        id: 'mute_mode',
        name: '禁言模式',
        kind: 'data',
        dataType: 'string',
        description: '「群禁言状态」模式：none / always / schedule（原始值，不做判定）',
      },
      {
        id: 'mute_rules',
        name: '禁言规则',
        kind: 'data',
        dataType: 'any',
        description:
          '「群禁言状态」模式：官方返回的原始禁言规则（定时与周期规则原样透出，不做判定）',
      },
      {
        id: 'muted_members',
        name: '被禁言成员',
        kind: 'data',
        dataType: 'list',
        description: '「群禁言状态」模式：当前被单独禁言的成员列表',
      },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '「群成员列表」模式：是否获取成功',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）',
      },
    ],
  },
  {
    kind: 'get_ids',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'context',
    label: '取身份 ID',
    group: '上下文',
    icon: '🆔',
    description: '取当前事件的各类 ID（零开销，不调用接口）',
    summary: '要 QQ 号 / 群号 / 机器人号 / 操作者号时用它 —— 只读事件自带字段，最快',
    sideEffects: [],
    tags: ['QQ', '上下文', 'QQ号', '群号', 'ID'],
    handler: { source: 'builtin', module: 'get_ids' },
    exposedAsTool: true,
    toolName: '取身份 ID',
    defaultConfig: {
      mode: 'user_id',
    },
    inputs: [
      {
        id: 'in',
        name: '入口',
        kind: 'control',
      },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'user_id',
        description: '取哪个 ID',
        options: GET_IDS_MODE_OPTIONS,
      },
    ],
    outputs: [
      {
        id: 'out',
        name: '出口',
        kind: 'control',
      },
      {
        id: 'result',
        name: '结果',
        kind: 'data',
        dataType: 'any',
        description: '取到的 ID（消息里没有时为空串）',
      },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '是否成功',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）',
      },
    ],
  },
  {
    kind: 'get_message',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'context',
    // 7 个模式都是**读当前这条消息**的某个方面（文本 / 原文 / ID / 引用 / 片段 /
    // 子类型 / 指令参数）：不调接口、不改状态，是同一个动作的不同字段。
    modeRationale: '同一动作（读当前消息）的不同字段，零副作用',
    label: '取消息内容',
    group: '上下文',
    icon: '💬',
    description: '取当前消息的文本 / 原文 / ID / 引用 / 片段 / 子类型 / 指令参数',
    summary: '处理"用户说了什么"时用它：指令参数、消息片段、引用回复都在这',
    sideEffects: [],
    tags: ['QQ', '上下文', '消息', '指令参数', '片段'],
    handler: { source: 'builtin', module: 'get_message' },
    exposedAsTool: true,
    toolName: '取消息内容',
    defaultConfig: {
      mode: 'message_text',
      index: 0,
      part_mode: 'at',
    },
    inputs: [
      {
        id: 'in',
        name: '入口',
        kind: 'control',
      },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'message_text',
        description: '取消息的哪一部分',
        options: GET_MESSAGE_MODE_OPTIONS,
      },
      {
        id: 'index',
        name: '索引',
        kind: 'data',
        dataType: 'number',
        default: 0,
        description: '「指令参数」第几个参数；「消息片段」第几个片段（0=第一个，-1=最后一个）',
        showWhen: inModes('command_args', 'message_part'),
      },
      {
        id: 'part_mode',
        name: '片段模式',
        kind: 'data',
        dataType: 'string',
        default: 'at',
        description: '「消息片段」提取哪类片段',
        showWhen: inModes('message_part'),
        options: GET_CONTEXT_PART_MODE_OPTIONS,
      },
    ],
    outputs: [
      {
        id: 'out',
        name: '出口',
        kind: 'control',
      },
      {
        id: 'result',
        name: '结果',
        kind: 'data',
        dataType: 'any',
        description: '文本 / ID / 引用对象 / 片段',
      },
      {
        id: 'args_list',
        name: '全部参数',
        kind: 'data',
        dataType: 'list',
        description: '「指令参数」模式：所有参数列表',
      },
      {
        id: 'part_list',
        name: '片段列表',
        kind: 'data',
        dataType: 'list',
        description: '「消息片段」模式：所有匹配片段',
      },
      {
        id: 'part_count',
        name: '片段数量',
        kind: 'data',
        dataType: 'number',
        description: '「消息片段」模式：匹配片段总数',
      },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '是否成功',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）',
      },
    ],
  },
  {
    kind: 'get_profile',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'context',
    // 8 个模式**性质相同**：都要调 QQ 接口、都可能因权限失败；输入形态也相同
    // （群号 / QQ号 / 分页游标）。拆开会让「要查点东西」变成先在几个节点里找。
    modeRationale: '同一性质（调接口查资料、可能失败）且输入形态相同',
    label: '查资料（需调接口）',
    group: '上下文',
    icon: '🔎',
    description: '查成员资料 / 群资料 / 群列表 / 机器人自身状态 —— 这些都要调接口，可能失败',
    summary:
      '要昵称、群名、成员名单、入群申请、黑名单、机器人权限时用它（比取 ID 慢，且可能因权限失败）',
    sideEffects: [],
    tags: ['QQ', '上下文', '成员', '群', '昵称', '权限', '需调接口'],
    handler: { source: 'builtin', module: 'get_profile' },
    exposedAsTool: true,
    toolName: '查资料（需调接口）',
    defaultConfig: {
      mode: 'user_name',
      group_id: '',
      user_id: '',
      cursor: '',
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'user_name',
        description:
          '要查什么：成员资料 / 群资料 / 群列表 / 机器人状态（按「群信息」「成员」分组）',
        options: GET_PROFILE_MODE_OPTIONS,
      },
      {
        id: 'group_id',
        name: '群号',
        kind: 'data',
        dataType: 'string',
        description: '目标群号（留空取当前群）',
        showWhen: inModes(
          'group_name',
          'group_members',
          'group_mute_state',
          'join_requests',
          'blacklist_list',
          'bot_state',
          'member_info',
          'user_name',
        ),
      },
      {
        id: 'user_id',
        name: 'QQ号',
        kind: 'data',
        dataType: 'string',
        description: '要查询的 QQ 号（留空取触发者）',
        showWhen: inModes('user_name', 'member_info'),
      },
      {
        id: 'cursor',
        name: '分页游标',
        kind: 'data',
        dataType: 'string',
        description: '「群成员列表 / 入群申请 / 黑名单」上一页返回的「下一页游标」，留空取第一页',
        showWhen: inModes('group_members', 'join_requests', 'blacklist_list'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        name: '结果',
        kind: 'data',
        dataType: 'any',
        description: '查到的内容（字典 / 列表，取决于所选模式）',
      },
      {
        id: 'nickname',
        showWhen: inModes('user_name'),
        name: '用户昵称',
        kind: 'data',
        dataType: 'string',
        description: '「用户名」模式：用户昵称',
      },
      {
        id: 'card',
        showWhen: inModes('user_name'),
        name: '群昵称',
        kind: 'data',
        dataType: 'string',
        description: '「用户名」模式：群名片（仅群聊时）',
      },
      {
        id: 'members',
        showWhen: inModes('group_members'),
        name: '成员列表',
        kind: 'data',
        dataType: 'list',
        description: '「群成员列表」模式：成员列表',
      },
      {
        id: 'next_cursor',
        showWhen: inModes('group_members', 'join_requests', 'blacklist_list'),
        name: '下一页游标',
        kind: 'data',
        dataType: 'string',
        description: '「群成员列表 / 入群申请 / 黑名单」下一页游标（空=没有更多页）',
      },
      {
        id: 'role',
        name: '群内角色',
        kind: 'data',
        dataType: 'string',
        description: 'owner / admin / member',
      },
      {
        id: 'is_admin',
        name: '是管理员',
        kind: 'data',
        dataType: 'boolean',
        description: '是否管理员或群主',
      },
      {
        id: 'recv_msg_setting',
        showWhen: inModes('bot_state'),
        name: '收消息模式',
        kind: 'data',
        dataType: 'string',
        description: '「机器人群内状态」模式：接收消息的设置（如 only_mention）',
      },
      {
        id: 'mute_mode',
        showWhen: inModes('group_mute_state'),
        name: '禁言模式',
        kind: 'data',
        dataType: 'string',
        description: '「群禁言状态」模式：none / always / schedule（原始值，不做判定）',
      },
      {
        id: 'mute_rules',
        showWhen: inModes('group_mute_state'),
        name: '禁言规则',
        kind: 'data',
        dataType: 'any',
        description: '「群禁言状态」模式：官方原始禁言规则（原样透出）',
      },
      {
        id: 'muted_members',
        showWhen: inModes('group_mute_state'),
        name: '被禁言成员',
        kind: 'data',
        dataType: 'list',
        description: '「群禁言状态」模式：被单独禁言的成员列表',
      },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '是否成功（调接口的模式可能失败）',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）',
      },
    ],
  },
];
