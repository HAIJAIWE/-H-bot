// src/shared/nodes/groups/dataConfig.ts
//
// # 目录分片：数据 / 配置表（1 个节点）
//
// 从 `builtinCatalog.ts` 按 group 拆出（2026-10-03）；配置表查询单独成片。
// **条目原文搬运**；等价性由「按 kind 排序后的哈希」证明。
import { whenFieldIn } from '../catalogHelpers';
import { CONFIG_QUERY_MODE_OPTIONS } from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const dataConfigNodes: NodeSpecV2[] = [
  {
    kind: 'config_query',
    type: 'data',
    execution: 'handler',
    resource: 'config_table',
    label: '查配置表',
    group: '数据',
    icon: '📖',
    description:
      '读项目里的配置表（只读），把整行交给公式 —— 商品/怪物/等级这类数据不必再写死在公式里',
    summary:
      '从 data/config 的配置表读数据（可按条件筛选、排序、取单行）。配置表是唯一真相：改表即改玩法，不用动公式',
    sideEffects: ['read_db'],
    tags: ['配置表', '数据', '只读', '查表'],
    handler: { source: 'builtin', module: 'config_query' },
    exposedAsTool: true,
    toolName: '查询配置表',
    toolArgs: ['table', 'where', 'where_params', 'order', 'limit', 'field'],
    defaultConfig: {
      mode: 'all',
      table: '',
      db_path: '',
      where: '',
      where_params: '[]',
      order: '',
      limit: 1000,
      field: '',
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'all',
        options: CONFIG_QUERY_MODE_OPTIONS,
        description: '所有行=遍历/筛选用；只取一行=按条件取单条（输出 first）',
      },
      {
        id: 'table',
        name: '表名',
        kind: 'data',
        dataType: 'string',
        required: true,
        description:
          '配置表名（如 items / monsters / levels / drops / skills），对应 data/config/<表名>.db',
      },
      {
        id: 'db_path',
        name: '库路径',
        kind: 'data',
        dataType: 'string',
        description: '留空按表名推导为 data/config/<表名>.db；表不在默认位置时才填',
      },
      {
        id: 'where',
        name: '筛选条件',
        kind: 'data',
        dataType: 'string',
        description:
          'SQL 片段，用 ? 占位（如 `type = ? AND price > 0`）。**不要写引号字面量**，值走「条件参数」；写操作关键字会被拒',
      },
      {
        id: 'where_params',
        name: '条件参数',
        kind: 'data',
        dataType: 'any',
        description: '与筛选条件里的 ? 一一对应（数组），如 ["weapon"]',
      },
      {
        id: 'order',
        name: '排序',
        kind: 'data',
        dataType: 'string',
        description: '不含 ORDER BY 的片段，如 `price DESC`、`id`。写 `RANDOM()` 可随机取一行',
      },
      {
        id: 'limit',
        name: '取几行',
        kind: 'data',
        dataType: 'number',
        default: 1000,
        description: '最多取几行（默认 1000）',
      },
      {
        id: 'field',
        showWhen: whenFieldIn('mode', 'row'),
        name: '取值字段',
        kind: 'data',
        dataType: 'string',
        description: '填了就把它作为 value 输出（如 `price`）；留空时 value = 第一行',
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'rows',
        name: '所有行',
        kind: 'data',
        dataType: 'list',
        description: '行数组（每行是一个对象）—— 公式里 list(rows).forEach(...) 遍历',
      },
      {
        id: 'count',
        name: '行数',
        kind: 'data',
        dataType: 'number',
        description: '取到几行',
      },
      {
        id: 'first',
        name: '第一行',
        kind: 'data',
        dataType: 'object',
        description: '第一行对象（没有行时为 null）—— 取单条时用它，比 rows[0] 好写',
      },
      {
        id: 'value',
        name: '值',
        kind: 'data',
        dataType: 'any',
        description: '填了「取值字段」时是该字段的值，否则等于「第一行」',
      },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '是否查到了（**表不存在/条件非法时为 false 并报错**，不是"空结果"）',
      },
      {
        id: 'error',
        name: '错误',
        kind: 'data',
        dataType: 'string',
        description: '错误信息（空=成功）。表名拼错时会列出项目里可用的表',
      },
    ],
  },
];
