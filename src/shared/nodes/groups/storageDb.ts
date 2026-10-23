// src/shared/nodes/groups/storageDb.ts
//
// # 目录分片：storage / 数据库（查询 / 写入 + 默认库路径）（2 个节点）
//
// 从 `builtinCatalog.ts` 按 group 拆出（2026-10-03）；这一层是按"节点性质"再分的子片
// （第一层拆完后 action/data/storage 仍 >1200 行，被 fileSize 闸门点名）。
// **条目原文搬运**；等价性由「按 kind 排序后的哈希」证明。
import { inModes, notInModes } from '../catalogHelpers';
import {
  DATABASE_WRITE_MODE_OPTIONS,
  QUERY_MODE_OPTIONS,
  QUERY_ORDER_OPTIONS,
  QUERY_SCOPE_OPTIONS,
  QUERY_SORT_BY_OPTIONS,
} from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

/**
 * `database_write` 的默认数据库 —— **唯一真相层**。
 *
 * 为什么要有这个常量：默认路径原先在**三个地方各写一份，且互不一致** ——
 *   1. 本目录的 `defaultConfig.db_path` / `db_path` 端口默认值 = `'data.db'`；
 *   2. handler（`databaseWrite.ts`）的形参兜底 = `'data.db'`；
 *   3. 属性面板（`PropertyDrawer`）的占位回退 = `'data/player.db'`（临时拼的）。
 *
 * 三者都不是启动模式「数据管理」真正在管的东西。那个面板分两块：
 *   - **配置管理**（`ConfigPanel` → `launchConfig.listCategories` →
 *     `configService.listConfigCategories`）：扫 **`data/config/`**，
 *     每个分类一个库（`equipment.db`/`skills.db`/…），**建表也在这一块**
 *     （`CreateTableWizard` → `configService.createConfigTable`）。
 *   - **数据浏览**（`DataBrowserPanel` → `dataService.listDataSources`）：
 *     扫 **`data/players/`**，看的是玩家实例数据（`persistent.db` 等）。
 *
 * 而 `database_write` 这类 SQL 节点不可能自己建表（`doInsert` 只发 INSERT），
 * 所以它真正能干活的地方是**配置管理已经建好表**的那些库 —— 也就是
 * `data/config/`。旧默认值的 `data.db` 落在项目根，两个面板**都不会显示**，
 * 于是用户"插入成功"却在数据管理里怎么都找不到（典型的空转）。
 *
 * 所以默认指向 `data/config/`：写进去的库**会出现在配置管理的分类列表里**。
 * 用户也可以把 `db_path` 改成自己的具体分类库（`data/config/equipment.db` 等）——
 * 面板的「配置 API」选择器正是这么干的。
 */
export const DEFAULT_DB_PATH = 'data/config/data.db';

export const storageDbNodes: NodeSpecV2[] = [
  {
    kind: 'query',
    type: 'data',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'player_data',
    label: '批量查询',
    group: '存储',
    icon: '🗄️',
    description: '批量数据查询（列出所有 / 按值排序 / 条件过滤 / 聚合统计）',
    summary: '从持久化存储批量查询多条记录。可选：列出所有 / 按值排序 / 条件过滤 / 聚合统计',
    sideEffects: ['read_db'],
    tags: ['SQLite', '数据库', '查询'],
    handler: { source: 'builtin', module: 'query' },
    exposedAsTool: true,
    toolName: '查询数据库',
    toolArgs: ['query'],
    defaultConfig: {
      mode: 'list',
      key_pattern: '*',
      scope: 'global',
      sort_by: 'value',
      order: 'desc',
      limit: 10,
      filter_expr: '',
      aggregate_func: 'count',
    },
    // order/sort_by 没有输入端口，选项写在节点级
    configFieldOptions: {
      order: QUERY_ORDER_OPTIONS,
      sort_by: QUERY_SORT_BY_OPTIONS,
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'list',
        description: '可选：列出所有 / 按值排序 / 条件过滤 / 聚合统计',
        options: QUERY_MODE_OPTIONS,
      },
      {
        id: 'key_pattern',
        name: 'key 匹配模式',
        kind: 'data',
        dataType: 'string',
        description: 'key 匹配模式（如 score:*）',
      },
      {
        id: 'scope',
        name: '范围',
        kind: 'data',
        dataType: 'string',
        default: 'global',
        description: '可选：按用户 / 按群 / 全局 / 所有用户（排行榜）',
        options: QUERY_SCOPE_OPTIONS,
      },
      {
        id: 'limit',
        name: '返回条数上限',
        kind: 'data',
        dataType: 'number',
        default: 10,
        description: '返回条数上限',
        showWhen: notInModes('aggregate'),
      },
      {
        id: 'filter_expr',
        name: '过滤表达式',
        kind: 'data',
        dataType: 'string',
        default: '',
        description: '「条件过滤」的条件，如 "score > 50"（字段 操作符 值）',
        showWhen: inModes('filter'),
      },
      {
        id: 'aggregate_func',
        name: '聚合函数',
        kind: 'data',
        dataType: 'string',
        default: 'count',
        description: '「聚合统计」的聚合函数：计数 / 求和 / 平均',
        showWhen: inModes('aggregate'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'results',
        name: '结果列表',
        kind: 'data',
        dataType: 'list',
        description: '查询结果列表',
      },
      { id: 'count', name: '结果总数', kind: 'data', dataType: 'number', description: '结果总数' },
      { id: 'error', name: '错误', kind: 'data', dataType: 'string', description: '错误信息' },
    ],
  },
  {
    kind: 'database_write',
    type: 'data',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'database',
    label: '数据库操作',
    group: '存储',
    icon: '📝',
    description: '查询/插入/更新/删除数据',
    summary: '四种数据库操作：查询（返回行列表）/ 插入 / 更新 / 删除',
    sideEffects: ['write_db'],
    tags: ['SQLite', '数据库', '写入', '查询', 'composite'],
    handler: { source: 'builtin', module: 'database_write' },
    exposedAsTool: true,
    toolName: '数据库写入',
    toolArgs: ['mode', 'table', 'data', 'condition'],
    defaultConfig: {
      mode: 'insert',
      db_path: DEFAULT_DB_PATH,
      table: '',
      data: {},
      condition: '',
      where_params: '[]',
      order: '',
      result_field: '',
      limit: 1000,
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'insert',
        description: '可选：查询 / 插入 / 更新 / 删除',
        options: DATABASE_WRITE_MODE_OPTIONS,
      },
      {
        id: 'table',
        name: '表名',
        kind: 'data',
        dataType: 'string',
        required: true,
        description: '要操作的表名',
      },
      {
        id: 'data',
        name: '数据',
        kind: 'data',
        dataType: 'json',
        description: '要写进记录的字段（「插入 / 更新」模式），如 {"name":"张三","level":1}',
        showWhen: inModes('insert', 'update'),
      },
      {
        id: 'condition',
        name: '条件',
        kind: 'data',
        dataType: 'string',
        description: '筛选条件（不用写 WHERE），如 qq = ?；「更新 / 删除」必填，「查询」可选',
        showWhen: inModes('update', 'delete', 'select'),
      },
      {
        id: 'where_params',
        name: '查询参数',
        kind: 'data',
        dataType: 'any',
        default: '[]',
        description: '参数化查询值。标量自动包装为列表（5→[5]），无需手工包装',
        showWhen: inModes('update', 'delete', 'select'),
      },
      {
        id: 'order',
        name: '排序',
        kind: 'data',
        dataType: 'string',
        default: '',
        description:
          '「查询」模式的排序（不用写 ORDER BY）：列名 [ASC|DESC]，逗号分隔；' +
          '填 RANDOM() 可随机取一行（配合「返回条数上限 = 1」）',
        showWhen: inModes('select'),
      },
      {
        id: 'db_path',
        name: '数据库路径',
        kind: 'data',
        dataType: 'string',
        default: DEFAULT_DB_PATH,
        description: '数据库文件路径（默认与「数据管理」同一批库，见 data/players/）',
      },
      {
        id: 'result_field',
        name: '提取字段',
        kind: 'data',
        dataType: 'string',
        description:
          '「查询」模式：填写字段名则直接输出该字段值到「值」端口，无需再用「表达式求值」提取',
        showWhen: inModes('select'),
      },
      {
        id: 'limit',
        name: '返回条数上限',
        kind: 'data',
        dataType: 'number',
        default: 1000,
        description: '「查询」模式下最多返回多少条（默认 1000，最大 10000），防止全表扫描',
        showWhen: inModes('select'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'success',
        name: '成功',
        kind: 'data',
        dataType: 'boolean',
        description: '操作是否成功',
      },
      {
        id: 'lastrowid',
        showWhen: inModes('insert'),
        name: '行ID',
        kind: 'data',
        dataType: 'number',
        description: '插入行的 ID（「插入」模式）',
      },
      {
        id: 'rows_updated',
        showWhen: inModes('update'),
        name: '影响行数',
        kind: 'data',
        dataType: 'number',
        description: '更新的行数（「更新」模式）',
      },
      {
        id: 'rows_deleted',
        showWhen: inModes('delete'),
        name: '删除行数',
        kind: 'data',
        dataType: 'number',
        description: '删除的行数（「删除」模式）',
      },
      {
        id: 'rows',
        showWhen: inModes('query'),
        name: '查询结果',
        kind: 'data',
        dataType: 'list',
        description: '查询到的行列表（「查询」模式）',
      },
      {
        id: 'rows_count',
        showWhen: inModes('query'),
        name: '查询行数',
        kind: 'data',
        dataType: 'number',
        description: '查询到的行数（「查询」模式）',
      },
      {
        id: 'value',
        showWhen: inModes('query'),
        name: '字段值',
        kind: 'data',
        dataType: 'any',
        description: '「查询」模式 + 结果字段：直接输出第一行里指定字段的值',
      },
      {
        id: 'found',
        showWhen: inModes('query'),
        name: '找到',
        kind: 'data',
        dataType: 'boolean',
        description: '「查询」模式：是否查到至少一行',
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
