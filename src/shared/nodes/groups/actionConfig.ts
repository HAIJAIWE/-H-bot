// src/shared/nodes/groups/actionConfig.ts
//
// # 目录分片：action / 界面配置动作（菜单 / 面板）（2 个节点）
//
// 从 `builtinCatalog.ts` 按 group 拆出（2026-10-03）；这一层是按"节点性质"再分的子片
// （第一层拆完后 action/data/storage 仍 >1200 行，被 fileSize 闸门点名）。
// **条目原文搬运**；等价性由「按 kind 排序后的哈希」证明。
import {
  MENU_CONFIG_MODE_OPTIONS,
  PANEL_CONFIG_MODE_OPTIONS,
  PANEL_SCOPE_OPTIONS,
  PANEL_TARGET_TYPE_OPTIONS,
} from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const actionConfigNodes: NodeSpecV2[] = [
  {
    kind: 'menu_config',
    type: 'action',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'menu',
    label: '自定义菜单',
    group: '动作',
    icon: '📋',
    description: '查询或设置机器人的全局自定义菜单',
    summary:
      '查询当前菜单，或用一份新菜单整个替换它。菜单只在单聊场景生效，是"把功能摆到用户面前"的入口。',
    sideEffects: ['call_api'],
    tags: ['QQ', '菜单', '自定义菜单', '配置', '动作'],
    platform: 'qq',
    handler: { source: 'builtin', module: 'menu_config' },
    exposedAsTool: true,
    toolName: '自定义菜单',
    toolArgs: ['mode', 'menu'],
    defaultConfig: {
      mode: 'get',
      menu: '',
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
        default: 'get',
        options: MENU_CONFIG_MODE_OPTIONS,
        description: '查询当前菜单，或用新菜单整个替换',
      },
      {
        id: 'menu',
        name: '菜单内容',
        kind: 'data',
        dataType: 'json',
        description: '菜单结构（对象或 JSON 字符串）。设置时是**整个替换**，不是增量合并',
        showWhen: (c) => c.mode === 'set',
      },
    ],
    outputs: [
      {
        id: 'out',
        name: '出口',
        kind: 'control',
      },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '是否成功',
      },
      {
        id: 'data',
        name: '数据',
        kind: 'data',
        dataType: 'any',
        description: '查询时返回当前菜单；设置时含菜单版本',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功），含数量上限与内容安全拒绝',
      },
    ],
  },
  {
    kind: 'panel_config',
    type: 'action',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'panel',
    label: '指令面板',
    group: '动作',
    icon: '🧭',
    description: '管理机器人的指令面板',
    summary:
      '管理指令面板（单聊 / 群聊 / 文字子频道 / 频道私信）：查询列表与详情，或创建、改内容、改生效对象、删除。面板项被点击时是"填输入框"或"打开链接"。',
    sideEffects: ['call_api'],
    tags: ['QQ', '指令面板', '面板', '配置', '动作'],
    platform: 'qq',
    handler: { source: 'builtin', module: 'panel_config' },
    exposedAsTool: true,
    toolName: '指令面板',
    toolArgs: [
      'mode',
      'scope',
      'panel_id',
      'target_type',
      'user_openids',
      'group_openids',
      'panel',
    ],
    defaultConfig: {
      mode: 'list',
      scope: 'c2c',
      panel_id: '',
      target_type: 'all',
      user_openids: '',
      group_openids: '',
      panel: '',
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
        default: 'list',
        options: PANEL_CONFIG_MODE_OPTIONS,
        description: '要执行的panel操作',
      },
      {
        id: 'scope',
        name: '生效场景',
        kind: 'data',
        dataType: 'string',
        default: 'c2c',
        options: PANEL_SCOPE_OPTIONS,
        description: '面板在哪种场景生效。文字子频道与频道私信只支持全局面板',
        showWhen: (c) => c.mode === 'list' || c.mode === 'create',
      },
      {
        id: 'panel_id',
        name: '面板 ID',
        kind: 'data',
        dataType: 'string',
        description: '目标面板 ID（创建时由接口返回）',
        showWhen: (c) => c.mode !== 'list' && c.mode !== 'create',
      },
      {
        id: 'target_type',
        name: '作用范围',
        kind: 'data',
        dataType: 'string',
        default: 'all',
        options: PANEL_TARGET_TYPE_OPTIONS,
        description: '全部对象，或仅列出的用户/群（指定对象只支持单聊与群聊）',
        showWhen: (c) => c.mode === 'create' || c.mode === 'set_target',
      },
      {
        id: 'user_openids',
        name: '用户',
        kind: 'data',
        dataType: 'string',
        description: '单聊目标用户 openid；逗号或空格分隔（最多 20 个）',
        showWhen: (c) => c.mode === 'create' || c.mode === 'set_target',
      },
      {
        id: 'group_openids',
        name: '群聊',
        kind: 'data',
        dataType: 'string',
        description: '目标群 openid；逗号或空格分隔（最多 20 个）',
        showWhen: (c) => c.mode === 'create' || c.mode === 'set_target',
      },
      {
        id: 'panel',
        name: '面板内容',
        kind: 'data',
        dataType: 'json',
        description:
          '面板配置（创建/修改必填）。最多 20 项；项类型为指令或链接，链接须以 https 开头',
        showWhen: (c) => c.mode === 'create' || c.mode === 'update',
      },
    ],
    outputs: [
      {
        id: 'out',
        name: '出口',
        kind: 'control',
      },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '是否成功',
      },
      {
        id: 'data',
        name: '数据',
        kind: 'data',
        dataType: 'any',
        description: '列表/详情返回的面板数据；创建时含 panel_id',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功），含场景/范围非法与数量上限',
      },
    ],
  },
];
