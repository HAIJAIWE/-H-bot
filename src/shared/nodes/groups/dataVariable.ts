// src/shared/nodes/groups/dataVariable.ts
//
// # 目录分片：data / 变量与 JSON（3 个节点）
//
// 从 `builtinCatalog.ts` 按 group 拆出（2026-10-03）；这一层是按"节点性质"再分的子片
// （第一层拆完后 action/data/storage 仍 >1200 行，被 fileSize 闸门点名）。
// **条目原文搬运**；等价性由「按 kind 排序后的哈希」证明。
import { inModes } from '../catalogHelpers';
import {
  JSON_OP_MODE_OPTIONS,
  JSON_SOURCE_OPTIONS,
  VARIABLE_MERGE_MODE_OPTIONS,
} from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const dataVariableNodes: NodeSpecV2[] = [
  {
    kind: 'variable_set',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    label: '变量赋值',
    group: '数据',
    icon: '📝',
    description: '设置一个临时变量，供后续节点引用',
    summary:
      '在单次链执行内设置一个临时变量供后续节点引用。变量不跨链共享，也无「按用户 / 按群 / 全局」作用域隔离——若需持久化或按用户/群隔离，请改用「持久化操作」。',
    sideEffects: [],
    tags: ['变量', '状态', '逻辑'],
    handler: { source: 'builtin', module: 'variable_set' },
    exposedAsTool: false,
    defaultConfig: { var_name: 'x' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'var_name',
        name: '变量名',
        kind: 'data',
        dataType: 'string',
        description: '变量名称（在「条件分支」「表达式求值」等节点中用此名引用）',
      },
      { id: 'value', name: '值', kind: 'data', dataType: 'any', description: '要赋的值' },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        name: '值',
        kind: 'data',
        dataType: 'any',
        description: '被赋的值（供 interpreter 注入到 var_name 变量）',
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
    kind: 'variable_merge',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'variables',
    label: '变量聚合',
    group: '数据',
    icon: '🔀',
    description: '将多个上游输出聚合成字典或列表',
    summary: '三种合并方式：按键名合并成字典、按顺序合并成列表（跳过空值）、把多个列表首尾拼成一个',
    sideEffects: [],
    tags: ['变量', '聚合', '合并', '数据'],
    handler: { source: 'builtin', module: 'variable_merge' },
    exposedAsTool: false,
    defaultConfig: { mode: 'dict', key_names: '[]' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'dict',
        description: '可选：合并为字典 / 合并为列表 / 拼接列表',
        options: VARIABLE_MERGE_MODE_OPTIONS,
      },
      { id: 'v1', name: '值1', kind: 'data', dataType: 'any', description: '第一个输入值' },
      { id: 'v2', name: '值2', kind: 'data', dataType: 'any', description: '第二个输入值' },
      { id: 'v3', name: '值3', kind: 'data', dataType: 'any', description: '第三个输入值' },
      { id: 'v4', name: '值4', kind: 'data', dataType: 'any', description: '第四个输入值' },
      { id: 'v5', name: '值5', kind: 'data', dataType: 'any', description: '第五个输入值' },
      { id: 'v6', name: '值6', kind: 'data', dataType: 'any', description: '第六个输入值' },
      {
        id: 'key_names',
        name: '键名列表',
        kind: 'data',
        dataType: 'json',
        description:
          '「合并为字典」专用：键名数组如 ["name","age","level"]，v1-v6 按顺序对应到这些键名',
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        name: '聚合结果',
        kind: 'data',
        dataType: 'any',
        description: '「合并为字典」填字典；「合并为列表 / 拼接列表」填列表',
      },
      {
        id: 'count',
        name: '元素数量',
        kind: 'data',
        dataType: 'number',
        description: '聚合后的元素数量',
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
    kind: 'json_op',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'json',
    label: 'JSON 操作',
    group: '数据',
    icon: '📋',
    description: '统一 JSON 节点（模式切换）：提取字段 / 设置字段 / 删除字段 / 合并 JSON',
    summary:
      '四种 JSON 操作：按点号路径提取字段、按路径设值、按路径删除、把一段 JSON 合并进来。' +
      '源可以来自上游连线，也可以直接读写一个命名变量（后者能原地改写，不用再接「变量赋值」）',
    sideEffects: [],
    tags: ['JSON', '解析', '修改', '提取', '合并', 'composite'],
    handler: { source: 'builtin', module: 'json_op' },
    exposedAsTool: false,
    defaultConfig: {
      mode: 'get',
      source: '{}',
      key: '$.key',
      value: '',
      source_from: 'port',
      // 放进 defaultConfig 是有意的：面板按「配置字段 = defaultConfig 的键」分区，
      // 不在这里的话它会掉到「数据来源」区，跟同组的几个设置分开 —— 这几个是同一件事的选项。
      var_name: '',
      write_back: false,
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'get',
        description: '可选：提取字段 / 设置字段 / 删除字段 / 合并 JSON',
        options: JSON_OP_MODE_OPTIONS,
      },
      {
        id: 'source_from',
        name: '源从哪来',
        kind: 'data',
        dataType: 'string',
        default: 'port',
        description:
          '可选：上游连线 / 命名变量。选「命名变量」时源就是那个变量当前的值 —— ' +
          '不必先绕一个「表达式求值」把它读出来',
        options: JSON_SOURCE_OPTIONS,
      },
      {
        id: 'source',
        name: '源 JSON',
        kind: 'data',
        dataType: 'any',
        description: 'JSON 字符串或已解析对象',
        showWhen: (c) => String(c.source_from ?? 'port') !== 'variable',
      },
      {
        id: 'var_name',
        name: '变量名',
        kind: 'data',
        dataType: 'string',
        description:
          '要读写的命名变量名（与「变量赋值」「变量面板」里填的是同一个名字）。' +
          '变量还不存在时：提取字段得到空值，设置/合并会以空字典为底新建它',
        showWhen: (c) => String(c.source_from ?? 'port') === 'variable',
      },
      {
        id: 'write_back',
        name: '结果写回该变量',
        kind: 'data',
        dataType: 'boolean',
        default: false,
        description:
          '开启后本节点的结果直接写回那个命名变量（原地改写）—— 设置/删除/合并就不用再接一个' +
          '「变量赋值」。「提取字段」不写回（那会把字段值变成整个变量）',
        showWhen: (c) =>
          String(c.source_from ?? 'port') === 'variable' &&
          ['set', 'delete', 'merge'].includes(String(c.mode)),
      },
      {
        id: 'key',
        name: '字段路径',
        kind: 'data',
        dataType: 'string',
        description:
          '「提取字段」填 JSONPath 或点号路径（**留空 = 取整个值**，用来把变量里的字典整个交给下一个节点）；' +
          '「设置字段 / 删除字段」填点号路径，如 user.name',
        showWhen: inModes('get', 'set', 'delete'),
      },
      {
        id: 'value',
        name: '值',
        kind: 'data',
        dataType: 'string',
        description:
          '「设置字段」填要设置的值；「合并 JSON」填要合并进来的 JSON（浅合并，同名键覆盖）',
        showWhen: inModes('set', 'merge'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        name: '结果',
        kind: 'data',
        dataType: 'any',
        description: '「提取字段」给出取到的值；其余模式给出修改后的 JSON 字符串',
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
