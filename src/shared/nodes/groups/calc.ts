// src/shared/nodes/groups/calc.ts
//
// # 目录分片：计算（6 个节点）
//
// 从 `builtinCatalog.ts` 按 `group` 拆出来（2026-10-03）。**条目原文搬运，未做任何改写**；
// 等价性由「按 kind 排序后的哈希」证明（见提交说明）。加新节点请加在本文件里。
import { inModes } from '../catalogHelpers';
import {
  EXPRESSION_EVAL_MODE_OPTIONS,
  RANDOM_MODE_OPTIONS,
  TIME_CALC_MODE_OPTIONS,
  TIME_OP_MODE_OPTIONS,
  TIME_OP_UNIT_OPTIONS,
  TIME_READ_MODE_OPTIONS,
} from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const calcNodes: NodeSpecV2[] = [
  {
    kind: 'random',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'random',
    label: '随机',
    group: '计算',
    icon: '🎲',
    description: '生成随机值，支持范围随机、均匀选择、加权选择三种模式',
    summary:
      '三种取随机的方式：在范围内取一个整数、从列表里随机挑一个、按权重挑（权重大的更容易中）',
    sideEffects: [],
    tags: ['随机', '概率', 'composite'],
    handler: { source: 'builtin', module: 'random' },
    exposedAsTool: false,
    defaultConfig: { mode: 'int', min_value: 1, max_value: 100, items: '[]' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'int',
        description: '可选：范围随机 / 均匀选择 / 加权选择',
        options: RANDOM_MODE_OPTIONS,
      },
      {
        id: 'min_value',
        name: '最小值',
        kind: 'data',
        dataType: 'number',
        default: 1,
        description: '最小值（含，「范围随机」模式）',
        showWhen: inModes('int'),
      },
      {
        id: 'max_value',
        name: '最大值',
        kind: 'data',
        dataType: 'number',
        default: 100,
        description: '最大值（含，「范围随机」模式）',
        showWhen: inModes('int'),
      },
      {
        id: 'items',
        name: '选项列表',
        kind: 'data',
        dataType: 'json',
        default: '[]',
        description: '「均匀选择」填候选值列表，「加权选择」填 [{"value":x,"weight":w}]',
        showWhen: inModes('choice', 'weighted'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        name: '随机结果',
        kind: 'data',
        dataType: 'any',
        description: '生成的随机值',
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
    kind: 'time_op',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'time',
    label: '时间操作',
    /**
     * ⚠️ 已弃用（2026-10-03）：按目录里**早已分好的 3 组**拆成 3 个节点 ——
     * 读时间（当前时间 / 时间戳转换 / 格式化 / 解析）· 判断是否今天 · 算时间（时间差 / 相加 / 相减）。
     *
     * 为什么拆：8 个模式里「读」「判断」「计算」混在一个下拉里 ✗ —— 三者的输入输出完全不同
     * （判断只要一个时间、计算要两个时间 + 偏移量），选错就连错线。分组数据一直在选项里，只是没变成节点。
     * 保留在目录里是因为它仍是老 flow.json 的有效契约（迁移见 graphPreprocess）。
     */
    deprecated: {
      since: '2026-10-03',
      replacedBy: ['time_read', 'time_check', 'time_calc'],
      reason: '8 个模式里「读取 / 判断 / 计算」的输入输出完全不同，混在一个下拉里会选错',
    },
    group: '计算',
    icon: '🕐',
    description: '统一时间节点（模式切换）：取当前时间 / 判断是否今天 / 计算时间差',
    summary:
      '三种时间操作：取当前时间（时间戳/日期时间/星期几）、判断某个时间戳是不是今天（签到去重）、算时间差（冷却/时长统计）',
    sideEffects: [],
    tags: ['时间', '日期', '当前', '判断', '运算', 'composite'],
    handler: { source: 'builtin', module: 'time_op' },
    exposedAsTool: true,
    toolName: '时间操作',
    toolArgs: ['mode', 'fmt', 'timezone', 'timestamp', 'target', 'unit'],
    defaultConfig: {
      mode: 'now',
      fmt: '%Y-%m-%d %H:%M:%S',
      timezone: '',
      timestamp: null,
      // 「目标时间」（date_diff 用）必须有默认项，否则属性面板的字段列表
      // （`buildConfigFields` 遍历 `defaultConfig` 的键）**根本不会渲染它** ——
      // 明明声明了 `showWhen: inModes('date_diff')` 的输入端口，界面上却填不了。
      target: null,
      unit: 'seconds',
      target_fmt: '%Y-%m-%d %H:%M:%S',
      // 同 `target`：「时间相加/相减」的偏移量端口也必须进 defaultConfig，
      // 否则属性面板列不出这个字段（面板按 defaultConfig 的键渲染）。
      offset: null,
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'now',
        description: '可选：当前时间 / 是否今天 / 时间差',
        options: TIME_OP_MODE_OPTIONS,
      },
      {
        id: 'fmt',
        name: '格式',
        kind: 'data',
        dataType: 'string',
        default: '%Y-%m-%d %H:%M:%S',
        description: 'strftime 格式字符串（「当前时间」模式）',
        showWhen: inModes('now'),
      },
      {
        id: 'timezone',
        name: '时区',
        kind: 'data',
        dataType: 'string',
        default: '',
        description: 'IANA 时区名（「当前时间」有效，留空表示本机时区）',
        showWhen: inModes('now'),
      },
      {
        id: 'timestamp',
        name: '时间戳',
        kind: 'data',
        dataType: 'number',
        description: 'Unix 时间戳（「是否今天 / 时间差」有效，留空表示当前时间）',
        showWhen: inModes('is_today', 'date_diff'),
      },
      {
        id: 'target',
        name: '目标时间',
        kind: 'data',
        dataType: 'string',
        description: '要比对的另一个时间（「时间差」有效，留空表示当前时间）',
        showWhen: inModes('date_diff'),
      },
      {
        id: 'unit',
        name: '单位',
        kind: 'data',
        dataType: 'string',
        default: 'seconds',
        description:
          '结果的时间单位（当前时间 / 时间戳 / 解析 / 时间差都受它影响；加减时间另有偏移量端口）',
        // 这几条模式都真的读 unit（见 timeOp 的 toUnit）；以前只写了 date_diff，
        // 于是「当前时间」模式下看不见「单位」，用户以为它不影响结果。
        showWhen: inModes('now', 'timestamp', 'parse', 'date_diff'),
        options: TIME_OP_UNIT_OPTIONS,
      },
      {
        id: 'target_fmt',
        name: '目标格式',
        kind: 'data',
        dataType: 'string',
        default: '%Y-%m-%d %H:%M:%S',
        description: '目标时间的字符串格式（「时间差」模式）',
        showWhen: inModes('date_diff'),
      },
      {
        id: 'offset',
        name: '偏移量(毫秒)',
        kind: 'data',
        dataType: 'number',
        description:
          '加/减的毫秒数（「加时间 / 减时间」有效）。**独立端口**：以前复用「目标时间」，' +
          '往里填时间戳会得到一个离谱日期且不报错；现在填非法值会明确报错',
        showWhen: inModes('add', 'sub'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'timestamp',
        name: '时间戳',
        kind: 'data',
        dataType: 'number',
        description: 'Unix 时间戳（「当前时间」模式）',
        showWhen: (c) => c.mode === 'now',
      },
      {
        id: 'datetime',
        name: '日期时间',
        kind: 'data',
        dataType: 'string',
        description: '格式化的日期时间字符串（「当前时间」模式）',
        showWhen: (c) => c.mode === 'now',
      },
      {
        id: 'date',
        name: '日期',
        kind: 'data',
        dataType: 'string',
        description: 'YYYY-MM-DD 格式日期（「当前时间」模式）',
        showWhen: (c) => c.mode === 'now',
      },
      {
        id: 'time',
        name: '时间',
        kind: 'data',
        dataType: 'string',
        description: 'HH:MM:SS 格式时间（「当前时间」模式）',
        showWhen: (c) => c.mode === 'now',
      },
      {
        id: 'weekday',
        name: '星期几',
        kind: 'data',
        dataType: 'number',
        description: '0 表示周一，6 表示周日（「当前时间」有效）',
        showWhen: (c) => c.mode === 'now',
      },
      {
        id: 'result',
        name: '结果',
        kind: 'data',
        dataType: 'any',
        /**
         * 这个端口的声明以前与实现**不一致**，而且不一致在两个方向：
         *   · 类型：声明 `boolean`，实现按模式给 number（当前时间/时间戳/时间差）、
         *     string（格式化 / 加时间 / 减时间）、boolean（是否今天）；
         *   · 可见性：`showWhen: mode==='is_today'` —— 但它在**每个模式**都会被写。
         *
         * 为什么不把它收紧成"只有是否今天才是布尔"：**三个真实项目的 flow.json** 里
         * `time_op(mode=format)` 与 `time_op(mode=is_today)` 都把 `result` 接到了下游
         * （`n4_0.result → s_4.var1`、`sg_check.result → sg_need.v1`）。收紧等于把它们的
         * 值悄悄换成 `false`。所以这里修的是**声明**（改 `dataType: 'any'` + 去掉
         * is_today 专属的 showWhen），不是实现 —— 声明与实践一致，谁也不用猜。
         */
        description:
          '各模式的主结果：是否今天→布尔；当前时间 / 时间戳 / 时间差→数字；' +
          '格式化 / 解析 / 加时间 / 减时间→字符串。下游只要一个值时用它',
      },
      {
        id: 'diff',
        name: '差值',
        kind: 'data',
        dataType: 'number',
        description: '按指定单位的时间差绝对值（「时间差」模式）',
        showWhen: (c) => c.mode === 'date_diff',
      },
      {
        id: 'seconds',
        name: '秒数',
        kind: 'data',
        dataType: 'number',
        description: '时间差绝对值秒数（「时间差」模式）',
        showWhen: (c) => c.mode === 'date_diff',
      },
      {
        id: 'is_past',
        name: '是否过去',
        kind: 'data',
        dataType: 'boolean',
        description: '目标时间是否早于源时间（「时间差」模式）',
        showWhen: (c) => c.mode === 'date_diff',
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
    kind: 'time_read',
    type: 'logic',
    execution: 'handler',
    resource: 'time',
    label: '读时间',
    group: '计算',
    icon: '🕐',
    description: '取当前时间 / 时间戳转换 / 格式化 / 解析 —— 只读，不判断也不计算',
    summary: '要「现在几点」、把时间戳变成可读时间、或反过来解析，就用它',
    sideEffects: [],
    tags: ['时间', '读取'],
    handler: { source: 'builtin', module: 'timeRead' },
    exposedAsTool: true,
    toolName: '读时间',
    defaultConfig: { mode: 'now' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'now',
        description: '可选：当前时间 / 时间戳转换 / 格式化时间 / 解析为时间戳',
        options: TIME_READ_MODE_OPTIONS,
      },
      {
        id: 'timestamp',
        showWhen: inModes('now', 'timestamp', 'format', 'parse'),
        name: '时间戳',
        kind: 'data',
        dataType: 'number',
        description: 'Unix 时间戳（「是否今天 / 时间差」有效，留空表示当前时间）',
      },
      {
        id: 'fmt',
        showWhen: inModes('now', 'format'),
        name: '格式',
        kind: 'data',
        dataType: 'string',
        default: '%Y-%m-%d %H:%M:%S',
        description: 'strftime 格式字符串（「当前时间」模式）',
      },
      {
        id: 'timezone',
        showWhen: inModes('now', 'format'),
        name: '时区',
        kind: 'data',
        dataType: 'string',
        default: '',
        description: 'IANA 时区名（「当前时间」有效，留空表示本机时区）',
      },
      {
        id: 'unit',
        showWhen: inModes('now', 'timestamp', 'parse'),
        name: '单位',
        kind: 'data',
        dataType: 'string',
        default: 'seconds',
        description:
          '结果的时间单位（当前时间 / 时间戳 / 解析 / 时间差都受它影响；加减时间另有偏移量端口）',
        // 这几条模式都真的读 unit（见 timeOp 的 toUnit）；以前只写了 date_diff，
        // 于是「当前时间」模式下看不见「单位」，用户以为它不影响结果。
        options: TIME_OP_UNIT_OPTIONS,
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        showWhen: inModes('now', 'timestamp', 'format', 'parse'),
        name: '结果',
        kind: 'data',
        dataType: 'any',
        /**
         * 这个端口的声明以前与实现**不一致**，而且不一致在两个方向：
         *   · 类型：声明 `boolean`，实现按模式给 number（当前时间/时间戳/时间差）、
         *     string（格式化 / 加时间 / 减时间）、boolean（是否今天）；
         *   · 可见性：`showWhen: mode==='is_today'` —— 但它在**每个模式**都会被写。
         *
         * 为什么不把它收紧成"只有是否今天才是布尔"：**三个真实项目的 flow.json** 里
         * `time_op(mode=format)` 与 `time_op(mode=is_today)` 都把 `result` 接到了下游
         * （`n4_0.result → s_4.var1`、`sg_check.result → sg_need.v1`）。收紧等于把它们的
         * 值悄悄换成 `false`。所以这里修的是**声明**（改 `dataType: 'any'` + 去掉
         * is_today 专属的 showWhen），不是实现 —— 声明与实践一致，谁也不用猜。
         */
        description:
          '各模式的主结果：是否今天→布尔；当前时间 / 时间戳 / 时间差→数字；' +
          '格式化 / 解析 / 加时间 / 减时间→字符串。下游只要一个值时用它',
      },
      {
        id: 'timestamp',
        showWhen: inModes('now'),
        name: '时间戳',
        kind: 'data',
        dataType: 'number',
        description: 'Unix 时间戳（「当前时间」模式）',
      },
      {
        id: 'datetime',
        showWhen: inModes('now'),
        name: '日期时间',
        kind: 'data',
        dataType: 'string',
        description: '格式化的日期时间字符串（「当前时间」模式）',
      },
      {
        id: 'date',
        showWhen: inModes('now'),
        name: '日期',
        kind: 'data',
        dataType: 'string',
        description: 'YYYY-MM-DD 格式日期（「当前时间」模式）',
      },
      {
        id: 'time',
        showWhen: inModes('now'),
        name: '时间',
        kind: 'data',
        dataType: 'string',
        description: 'HH:MM:SS 格式时间（「当前时间」模式）',
      },
      {
        id: 'weekday',
        showWhen: inModes('now'),
        name: '星期几',
        kind: 'data',
        dataType: 'number',
        description: '0 表示周一，6 表示周日（「当前时间」有效）',
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
    kind: 'time_check',
    type: 'logic',
    execution: 'handler',
    resource: 'time',
    label: '判断是否今天',
    group: '计算',
    icon: '📅',
    description: '判断某个时间是不是今天（空值一律 false，不会误判成「今天做过」）',
    summary: '签到去重、每日一次这类判断用它',
    sideEffects: [],
    tags: ['时间', '判断'],
    handler: { source: 'builtin', module: 'timeCheck' },
    exposedAsTool: true,
    toolName: '判断是否今天',
    defaultConfig: {},
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'timestamp',
        showWhen: inModes('is_today'),
        name: '时间戳',
        kind: 'data',
        dataType: 'number',
        description: 'Unix 时间戳（「是否今天 / 时间差」有效，留空表示当前时间）',
      },
      {
        id: 'timezone',
        showWhen: inModes('is_today'),
        name: '时区',
        kind: 'data',
        dataType: 'string',
        default: '',
        description: 'IANA 时区名（「当前时间」有效，留空表示本机时区）',
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        showWhen: inModes('is_today'),
        name: '结果',
        kind: 'data',
        dataType: 'any',
        /**
         * 这个端口的声明以前与实现**不一致**，而且不一致在两个方向：
         *   · 类型：声明 `boolean`，实现按模式给 number（当前时间/时间戳/时间差）、
         *     string（格式化 / 加时间 / 减时间）、boolean（是否今天）；
         *   · 可见性：`showWhen: mode==='is_today'` —— 但它在**每个模式**都会被写。
         *
         * 为什么不把它收紧成"只有是否今天才是布尔"：**三个真实项目的 flow.json** 里
         * `time_op(mode=format)` 与 `time_op(mode=is_today)` 都把 `result` 接到了下游
         * （`n4_0.result → s_4.var1`、`sg_check.result → sg_need.v1`）。收紧等于把它们的
         * 值悄悄换成 `false`。所以这里修的是**声明**（改 `dataType: 'any'` + 去掉
         * is_today 专属的 showWhen），不是实现 —— 声明与实践一致，谁也不用猜。
         */
        description:
          '各模式的主结果：是否今天→布尔；当前时间 / 时间戳 / 时间差→数字；' +
          '格式化 / 解析 / 加时间 / 减时间→字符串。下游只要一个值时用它',
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
    kind: 'time_calc',
    type: 'logic',
    execution: 'handler',
    resource: 'time',
    label: '算时间',
    group: '计算',
    icon: '🧮',
    description: '时间差 / 加一段 / 减一段 —— 会算出新时间或时长',
    summary: '算冷却还剩多久、X 天后是几号，就用它',
    sideEffects: [],
    tags: ['时间', '计算'],
    handler: { source: 'builtin', module: 'timeCalc' },
    exposedAsTool: true,
    toolName: '算时间',
    defaultConfig: { mode: 'date_diff' },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'date_diff',
        description: '可选：时间差 / 时间相加 / 时间相减',
        options: TIME_CALC_MODE_OPTIONS,
      },
      {
        id: 'timestamp',
        showWhen: inModes('date_diff', 'add', 'sub'),
        name: '时间戳',
        kind: 'data',
        dataType: 'number',
        description: 'Unix 时间戳（「是否今天 / 时间差」有效，留空表示当前时间）',
      },
      {
        id: 'target',
        showWhen: inModes('date_diff'),
        name: '目标时间',
        kind: 'data',
        dataType: 'string',
        description: '要比对的另一个时间（「时间差」有效，留空表示当前时间）',
      },
      {
        id: 'unit',
        showWhen: inModes('date_diff'),
        name: '单位',
        kind: 'data',
        dataType: 'string',
        default: 'seconds',
        description:
          '结果的时间单位（当前时间 / 时间戳 / 解析 / 时间差都受它影响；加减时间另有偏移量端口）',
        // 这几条模式都真的读 unit（见 timeOp 的 toUnit）；以前只写了 date_diff，
        // 于是「当前时间」模式下看不见「单位」，用户以为它不影响结果。
        options: TIME_OP_UNIT_OPTIONS,
      },
      {
        id: 'offset',
        showWhen: inModes('add', 'sub'),
        name: '偏移量(毫秒)',
        kind: 'data',
        dataType: 'number',
        description:
          '加/减的毫秒数（「加时间 / 减时间」有效）。**独立端口**：以前复用「目标时间」，' +
          '往里填时间戳会得到一个离谱日期且不报错；现在填非法值会明确报错',
      },
      {
        id: 'target_fmt',
        showWhen: inModes('add', 'sub'),
        name: '目标格式',
        kind: 'data',
        dataType: 'string',
        default: '%Y-%m-%d %H:%M:%S',
        description: '目标时间的字符串格式（「时间差」模式）',
      },
      {
        id: 'fmt',
        showWhen: inModes('add', 'sub'),
        name: '格式',
        kind: 'data',
        dataType: 'string',
        default: '%Y-%m-%d %H:%M:%S',
        description: 'strftime 格式字符串（「当前时间」模式）',
      },
      {
        id: 'timezone',
        showWhen: inModes('date_diff', 'add', 'sub'),
        name: '时区',
        kind: 'data',
        dataType: 'string',
        default: '',
        description: 'IANA 时区名（「当前时间」有效，留空表示本机时区）',
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      {
        id: 'result',
        showWhen: inModes('date_diff', 'add', 'sub'),
        name: '结果',
        kind: 'data',
        dataType: 'any',
        /**
         * 这个端口的声明以前与实现**不一致**，而且不一致在两个方向：
         *   · 类型：声明 `boolean`，实现按模式给 number（当前时间/时间戳/时间差）、
         *     string（格式化 / 加时间 / 减时间）、boolean（是否今天）；
         *   · 可见性：`showWhen: mode==='is_today'` —— 但它在**每个模式**都会被写。
         *
         * 为什么不把它收紧成"只有是否今天才是布尔"：**三个真实项目的 flow.json** 里
         * `time_op(mode=format)` 与 `time_op(mode=is_today)` 都把 `result` 接到了下游
         * （`n4_0.result → s_4.var1`、`sg_check.result → sg_need.v1`）。收紧等于把它们的
         * 值悄悄换成 `false`。所以这里修的是**声明**（改 `dataType: 'any'` + 去掉
         * is_today 专属的 showWhen），不是实现 —— 声明与实践一致，谁也不用猜。
         */
        description:
          '各模式的主结果：是否今天→布尔；当前时间 / 时间戳 / 时间差→数字；' +
          '格式化 / 解析 / 加时间 / 减时间→字符串。下游只要一个值时用它',
      },
      {
        id: 'diff',
        showWhen: inModes('date_diff'),
        name: '差值',
        kind: 'data',
        dataType: 'number',
        description: '按指定单位的时间差绝对值（「时间差」模式）',
      },
      {
        id: 'seconds',
        showWhen: inModes('date_diff'),
        name: '秒数',
        kind: 'data',
        dataType: 'number',
        description: '时间差绝对值秒数（「时间差」模式）',
      },
      {
        id: 'is_past',
        showWhen: inModes('date_diff'),
        name: '是否过去',
        kind: 'data',
        dataType: 'boolean',
        description: '目标时间是否早于源时间（「时间差」模式）',
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
    kind: 'expression_eval',
    type: 'logic',
    // 执行路径（闸门会校验"声明 == 证据"）：handler
    execution: 'handler',
    // 操作对象（防重复闸门：同 resource 下模式集合必须不相交）
    resource: 'expression',
    label: '表达式求值',
    group: '计算',
    icon: '🧮',
    description: '表达式求值（单公式/多公式批量计算）',
    summary:
      '两种用法：「单表达式求值」算一个值；「多公式批量计算」一次算多个值，每个公式各出一个输出端口',
    sideEffects: [],
    tags: ['表达式', '计算', '公式', '逻辑', '字符串', '数值', '格式化', '批量'],
    handler: { source: 'builtin', module: 'expression_eval' },
    exposedAsTool: true,
    toolName: '表达式求值',
    toolArgs: ['expression', 'variables_json'],
    defaultConfig: {
      expression: 'atk - defense * 0.5',
      mode: 'single',
      formulas: [{ name: 'result', expression: 'v1 + v2' }],
    },
    inputs: [
      { id: 'in', name: '入口', kind: 'control' },
      {
        id: 'expression',
        name: '表达式',
        kind: 'data',
        dataType: 'string',
        required: true,
        description:
          '表达式（Python 风格写法，运行时会翻译成 JS 求值，与「条件分支」用同一个求值器）。' +
          '注意：变量名不能是保留字（如 def/class/import/new/in/true 等）。\n' +
          '【可用函数】必须写成函数形式，不是方法：len/int/float/str/bool/abs/min/max/sum/round/clamp/' +
          'range/list/dict/json/now/time/random/randint/choice/upper/lower/strip/replace/split/join/' +
          'startswith/endswith/contains/format/sort/reverse/keys/values/items/get/to_json/from_json\n' +
          '常用示例：\n' +
          '  · 伤害计算: clamp(atk * 2 - def * 0.5, 1, 999)\n' +
          '  · 随机: randint(1, 6) / choice(["石头","剪刀","布"])\n' +
          '  · 字符串: upper(name) / len(s) / "前缀" in s / f"{v}万"\n' +
          '  · 取字典字段: get(monster, "hp", 0)\n' +
          '  · 三元: 10 if hp > 0 else 0\n' +
          '【不支持】Python 方法调用要改成函数形式（写 upper(s)，不是 s.upper()；或直接用 JS 原生 s.toUpperCase()）；' +
          '列表推导 [x for x in lst]（改用 JS 的 lst.filter(...) / lst.map(...)）；' +
          'f-string 的格式说明符（写 round(v, 2)，不是 f"{v:,.2f}"）。' +
          '底层是 JS，所以 Math.*、箭头函数、数组方法都能用；但 process/require/window/eval 等被禁止。' +
          '求值失败会把错误写到「错误」端口，不再静默返回假值。',
        // formulas 模式下运行时只读 formulas，这个字段用不到。
        // ⚠️ 两个校验器过去都**不认 showWhen**，只认"必填端口有没有值"，
        // 于是 formulas 节点会被报一条假错误「缺少必填项「表达式」」把整张图标红
        // （搭 RPG 主线时实测）。现在 `flowNormalize` 与 `connectionIssues` 都会先问
        // `isPortApplicable`（并把目录 defaultConfig 作为模式回落），这里才真的生效。
        showWhen: inModes('single'),
      },
      {
        id: 'variables_json',
        name: '命名变量',
        kind: 'data',
        dataType: 'any',
        description:
          'JSON 字典或字典对象，如 {"atk":100,"defense":50,"hp":200}。可直接连「时间操作」「持久化操作」等节点的输出。\n' +
          '【两种用法】① 单表达式：字典里的 key 直接当变量名写在表达式里（如 atk + defense）。\n' +
          '② **多公式共享上下文**（重要）：「多公式批量计算」模式下**各公式互相看不见对方的局部变量**，' +
          '所以"先做一段公共处理、再分别算几个值"时，那段公共逻辑必须只算一次放在这里 —— ' +
          '否则每条公式都要抄一遍（真机实测：不这么做时，多公式批量计算的代码里 **54% 是重复的前置逻辑**，' +
          '最多的一个节点同一段 1700 字符抄了 4 遍）。\n' +
          '写法：接一个返回字典的表达式（如 `({st: ..., row: ...})`），各公式里直接写 st / row。',
        // ⚠️ 这里**故意不写** `showWhen: inModes('single')`：运行时是模式无关地把这个字典
        // 当变量表底值用的（`handlerRegistry.mergePortVars`），而"多公式共享上下文"正是
        // formulas 模式最需要它的地方。以前写了 single-only，于是界面上连不了这个端口，
        // 用户只能靠抄前置逻辑绕过（实测 54% 的重复就是这么来的）。
      },
      {
        id: 'v1',
        name: '{var1}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v1 引用',
      },
      {
        id: 'v2',
        name: '{var2}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v2 引用',
      },
      {
        id: 'v3',
        name: '{var3}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v3 引用',
      },
      {
        id: 'v4',
        name: '{var4}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v4 引用',
      },
      {
        id: 'v5',
        name: '{var5}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v5 引用',
      },
      {
        id: 'v6',
        name: '{var6}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v6 引用（常用于配置 API 绑定：境界系数等）',
      },
      {
        id: 'v7',
        name: '{var7}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v7 引用（常用于配置 API 绑定：试炼加成等）',
      },
      {
        id: 'v8',
        name: '{var8}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v8 引用（常用于配置 API 绑定：功法加成值等）',
      },
      {
        id: 'v9',
        name: '{var9}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v9 引用（常用于配置 API 绑定：功法目标属性等）',
      },
      {
        id: 'v10',
        name: '{var10}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v10 引用（常用于配置 API 绑定：装备加成等）',
      },
      {
        id: 'v11',
        name: '{var11}',
        kind: 'data',
        dataType: 'any',
        description: '在表达式中用 v11 引用（常用于配置 API 绑定：社交属性加成等）',
      },
      {
        id: 'mode',
        name: '模式',
        kind: 'data',
        dataType: 'string',
        default: 'single',
        description: '可选：单表达式求值 / 多公式批量计算',
        options: EXPRESSION_EVAL_MODE_OPTIONS,
      },
      {
        id: 'formulas',
        name: '公式列表',
        kind: 'data',
        dataType: 'json',
        description: '「多公式批量计算」：[{name, expression}, ...]（每个公式生成一个输出端口）',
        showWhen: inModes('formulas'),
      },
    ],
    outputs: [
      { id: 'out', name: '出口', kind: 'control' },
      { id: 'result', name: '结果', kind: 'data', dataType: 'any', description: '表达式求值结果' },
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
