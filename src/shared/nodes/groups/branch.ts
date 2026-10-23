// src/shared/nodes/groups/branch.ts
//
// # 目录分片：判断（3 个节点）
//
// 从 `builtinCatalog.ts` 按 `group` 拆出来（2026-10-03）。**条目原文搬运，未做任何改写**；
// 等价性由「按 kind 排序后的哈希」证明（见提交说明）。加新节点请加在本文件里。
import { CHECK_PERMISSION_ROLE_OPTIONS } from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const branchNodes: NodeSpecV2[] = [
  {
    kind: 'branch_if',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：interpreter
    execution: 'interpreter',
    label: '条件分支',
    group: '判断',
    icon: '🔀',
    description: 'if/else 分支',
    summary: '根据条件表达式走 true 或 false 分支，适用于根据数据分支处理',
    sideEffects: [],
    tags: ['条件', '分支', '逻辑'],
    handler: { source: 'builtin', module: 'branch_if' },
    exposedAsTool: false,
    defaultConfig: { expression: 'value' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'value',
        name: '判断值',
        kind: 'data',
        dataType: 'any',
        description:
          '参与条件判断的值。表达式支持：value（真值判断）、not value（假值判断）、value == xxx、value > 5 等（表达式语法：True/False/None 首字母大写，另支持 and/or/not）',
      },
    ],
    outputs: [
      { id: 'true', name: '真分支', kind: 'control' },
      { id: 'false', name: '假分支', kind: 'control' },
    ],
  },
  {
    kind: 'branch_switch',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：interpreter
    execution: 'interpreter',
    label: '多分支选择',
    group: '判断',
    icon: '🔀',
    description: 'switch/case 多分支，支持精确匹配/数值比较/通配/多值',
    summary: '根据值匹配分支，支持 ==, >=, <=, >, <, !=, 通配*, 逗号多值，适用于指令路由、状态判断',
    sideEffects: [],
    tags: ['分支', 'switch', 'case', '路由'],
    handler: { source: 'builtin', module: 'branch_switch' },
    exposedAsTool: false,
    defaultConfig: { cases: '[]', default: 'default' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'value',
        name: '匹配值',
        kind: 'data',
        dataType: 'any',
        required: true,
        description: '要匹配的值',
      },
      {
        id: 'cases',
        name: '分支列表',
        kind: 'data',
        dataType: 'string',
        required: true,
        description:
          'JSON 数组，每项写「匹配值」和「分支名」，如 [{"match":"a","label":"分支A"}, {"match":">=10","label":"高等级"}]',
      },
      {
        id: 'default',
        name: '默认分支',
        kind: 'data',
        dataType: 'string',
        default: 'default',
        description: '无匹配时的分支名',
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'matched',
        name: '匹配标签',
        kind: 'data',
        dataType: 'string',
        description: '匹配到的分支 label（用于显示或路由）',
      },
      {
        id: 'matched_value',
        name: '匹配原值',
        kind: 'data',
        dataType: 'string',
        description: '匹配到的 match 字段（用于「条件分支」精确路由）',
      },
      {
        id: 'index',
        name: '匹配索引',
        kind: 'data',
        dataType: 'number',
        description: '匹配到的分支序号（-1 表示走了默认分支）',
      },
      {
        id: 'is_default',
        name: '是否默认',
        kind: 'data',
        dataType: 'boolean',
        description: '是否走了默认分支',
      },
    ],
  },
  {
    kind: 'check_permission',
    type: 'action',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    label: '权限检查',
    group: '判断',
    icon: '🔐',
    description: '检查当前用户是否具有指定权限级别',
    summary: '按「超级管理员 > 群主 > 管理员 > 成员 > 游客」的层级判断权限，私聊只有超级管理员生效',
    sideEffects: ['call_api:get_group_member_info'],
    tags: ['QQ', '权限', '检查', '动作', 'composite'],
    handler: { source: 'builtin', module: 'check_permission' },
    exposedAsTool: false,
    defaultConfig: { role: 'admin' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'role',
        name: '权限级别',
        kind: 'data',
        dataType: 'string',
        default: 'admin',
        description:
          '可选：超级管理员 / 群主 / 管理员 / 成员 / 游客。超级管理员 = 机器人主人（环境变量 SUPER_ADMIN_IDS，逗号分隔）',
        options: CHECK_PERMISSION_ROLE_OPTIONS,
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'passed',
        name: '通过',
        kind: 'data',
        dataType: 'boolean',
        description: '是否具有权限',
      },
      {
        id: 'user_role',
        name: '用户角色',
        kind: 'data',
        dataType: 'string',
        description: '实际角色',
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
