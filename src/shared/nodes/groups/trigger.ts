// src/shared/nodes/groups/trigger.ts
//
// # 目录分片：触发器（7 个节点）
//
// 从 `builtinCatalog.ts` 按 `group` 拆出来（2026-10-03）。**条目原文搬运，未做任何改写**；
// 等价性由「按 kind 排序后的哈希」证明（见提交说明）。加新节点请加在本文件里。
import {
  MESSAGE_RECEIVED_MATCH_OPTIONS,
  MESSAGE_RECEIVED_MESSAGE_TYPE_OPTIONS,
  NOTICE_TYPE_OPTIONS,
  REQUEST_TYPE_OPTIONS,
} from '../fieldOptions';
import type { NodeSpecV2 } from '../../types/nodeV2';

export const triggerNodes: NodeSpecV2[] = [
  {
    kind: 'message_received',
    type: 'trigger',
    // 执行路径（闸门会校验"声明 == 证据"）：trigger
    execution: 'trigger',
    label: '收到消息',
    group: '触发器',
    icon: '💬',
    description: '消息触发（匹配方式：任意消息 / @机器人 / 指令匹配 / 关键词 / 正则匹配）',
    summary:
      '当收到聊天消息时触发。匹配方式可选：任意消息 / @机器人 / 指令匹配 / 关键词 / 正则匹配（支持捕获组提取）',
    sideEffects: [],
    tags: ['QQ', '消息', '触发器', '监听'],
    handler: { source: 'builtin', module: 'message_received' },
    exposedAsTool: false,
    defaultConfig: {
      match: 'any',
      message_type: 'any',
      command: '',
      prefix: '/',
      keywords: [],
      pattern: '',
      flags: '',
    },
    // 触发器没有输入端口（上游概念对它不成立），字段选项只能写在节点级
    configFieldOptions: {
      match: MESSAGE_RECEIVED_MATCH_OPTIONS,
      message_type: MESSAGE_RECEIVED_MESSAGE_TYPE_OPTIONS,
    },
    inputs: [],
    outputs: [
      { id: 'next', name: '下一步', kind: 'control' },
      { id: 'event', name: '事件对象', kind: 'data', dataType: 'event', description: '事件对象' },
      {
        id: 'raw_message',
        name: '原始消息',
        kind: 'data',
        dataType: 'string',
        description: '原始消息文本',
      },
      {
        id: 'args',
        name: '指令参数',
        kind: 'data',
        dataType: 'list',
        description: '指令参数（仅「指令匹配」时有值，其他模式为空列表）',
      },
      {
        id: 'ark_type',
        name: '卡片类型',
        kind: 'data',
        dataType: 'string',
        description:
          '官方 ark 消息的类型（如 picture 图片卡片）；普通文本消息为空串。2026-09-16 官方新增 picture 取值',
      },
      {
        id: 'matched',
        name: '匹配文本',
        kind: 'data',
        dataType: 'string',
        description: '整个正则匹配的文本（仅「正则匹配」时有值，其他模式为空字符串）',
      },
      {
        id: 'groups',
        name: '捕获组',
        kind: 'data',
        dataType: 'list',
        description: '正则捕获组列表（仅「正则匹配」时有值，其他模式为空列表）',
      },
    ],
  },
  {
    kind: 'scheduled',
    type: 'trigger',
    // 执行路径（闸门会校验"声明 == 证据"）：trigger
    execution: 'trigger',
    label: '定时触发',
    group: '触发器',
    icon: '⏰',
    description: 'Cron 定时任务或间隔执行',
    summary: '按 Cron 表达式或固定间隔自动触发，适用于定时推送、轮询任务',
    sideEffects: [],
    tags: ['定时', '触发器', 'Cron'],
    handler: { source: 'builtin', module: 'scheduled' },
    exposedAsTool: false,
    defaultConfig: { cron: '0 * * * *', interval_seconds: 0 },
    inputs: [],
    outputs: [
      { id: 'next', name: '下一步', kind: 'control' },
      { id: 'time', name: '触发时间', kind: 'data', dataType: 'datetime', description: '触发时间' },
    ],
  },
  {
    kind: 'request_received',
    type: 'trigger',
    // 执行路径（闸门会校验"声明 == 证据"）：trigger
    execution: 'trigger',
    label: '请求事件',
    group: '触发器',
    icon: '📥',
    description:
      '监听加群请求 / 邀请（官方 API 唯一存在的「请求」事件；**加好友不是请求事件**，' +
      '它走「通知事件 → 用户添加机器人」）',
    summary:
      '监听加群请求 / 邀请，常用于自动审批入群。**没有「好友请求」这回事**：' +
      '官方的好友添加是通知事件、不是可审批的请求 —— 别在这个节点上等它',
    sideEffects: [],
    tags: ['QQ', '请求', '审批', '入群'],
    handler: { source: 'builtin', module: 'request_received' },
    exposedAsTool: false,
    /**
     * 「请求类型」过滤 —— **这里以前是个空洞**。
     *
     * `matchTrigger` 一直在读 `config.request_type`（缺省写死 `'friend'`），而目录里
     * 既没有这个 `defaultConfig` 键、也没有 `configFieldOptions` ⇒ 面板列不出这个字段、
     * 用户根本填不了。两个后果叠在一起：
     *   · **群请求永远不触发**（缺省是 friend，`request_type==='group'` 的事件匹配不上）——
     *     而节点描述明明写着「监听加好友请求、加群邀请/请求」；
     *   · 「只监听加群请求」这个能力用户配不出来（`fieldOptions.ts` 的
     *     `REQUEST_TYPE_OPTIONS` 早就写好了，**全仓无人引用**）。
     *
     * 现在按目录契约把它声明出来：**默认「任意请求」**（不偏科，与描述一致），
     * 想只收加群请求再自己选。触发器没有输入端口（上游概念对它不成立），
     * 所以与 `message_received` / `button_clicked` 一样走「defaultConfig 键 + 节点级字段选项」。
     */
    defaultConfig: { request_type: 'any' },
    configFieldOptions: {
      request_type: REQUEST_TYPE_OPTIONS,
    },
    inputs: [],
    outputs: [
      { id: 'next', name: '出口', kind: 'control' },
      {
        id: 'event',
        name: '事件对象',
        kind: 'data',
        dataType: 'event',
        description: '原始请求事件对象',
      },
      {
        id: 'request_type',
        name: '请求类型',
        kind: 'data',
        dataType: 'string',
        description: '实际收到的请求类型：官方 API 下只有「加群请求 / 邀请」（值是 group）',
      },
      {
        id: 'user_id',
        name: '用户QQ',
        kind: 'data',
        dataType: 'string',
        description: '发起请求的 QQ 号',
      },
      {
        id: 'group_id',
        name: '群号',
        kind: 'data',
        dataType: 'string',
        description: '请求加群的群号（仅群消息）',
      },
      {
        id: 'comment',
        name: '附言',
        kind: 'data',
        dataType: 'string',
        description: '请求附言内容',
      },
      {
        id: 'flag',
        name: '请求标识',
        kind: 'data',
        dataType: 'string',
        description: '请求标识，用于同意 / 拒绝时回传',
      },
    ],
  },
  {
    kind: 'notice_received',
    type: 'trigger',
    // 执行路径（闸门会校验"声明 == 证据"）：trigger
    execution: 'trigger',
    label: '通知事件',
    group: '触发器',
    icon: '🔔',
    description: '监听通知事件：入群、退群、消息审核结果、互动事件等',
    summary:
      '监听通知事件（可按类型过滤），适用于入群欢迎、退群提醒、审核结果处理。' +
      '可收到的类型就是「通知类型」下拉里那些（官方适配器发什么、这里就列什么）',
    sideEffects: [],
    tags: ['QQ', '通知', '入群', '退群', '审核', '监听'],
    handler: { source: 'builtin', module: 'notice_received' },
    exposedAsTool: false,
    /**
     * 「通知类型」过滤 —— **这里以前是个空洞**（与 `request_received.request_type` 同一处缺陷）。
     *
     * `matchTrigger` 一直在读 `config.notice_type`（缺省 `'any'`），而目录里既没有这个
     * `defaultConfig` 键、也没有 `configFieldOptions` ⇒ 面板列不出这个字段、用户填不了：
     * 「只监听入群」「只监听退群」这类能力**配不出来**（`fieldOptions.ts` 的
     * `NOTICE_TYPE_OPTIONS` 早就写好了，全仓无人引用）。缺省是 `any` 所以不会误触发，
     * 丢的是"筛掉不需要的通知"。
     *
     * 触发器没有输入端口（上游概念对它不成立），所以与 `message_received` /
     * `request_received` 一样走「defaultConfig 键 + 节点级字段选项」。
     */
    defaultConfig: { notice_type: 'any' },
    configFieldOptions: {
      notice_type: NOTICE_TYPE_OPTIONS,
    },
    inputs: [],
    outputs: [
      { id: 'next', name: '出口', kind: 'control' },
      {
        id: 'event',
        name: '事件对象',
        kind: 'data',
        dataType: 'event',
        description: '原始通知事件对象',
      },
      {
        id: 'notice_type',
        name: '通知类型',
        kind: 'data',
        dataType: 'string',
        description:
          '实际收到的类型（官方适配器发的是 group_member_add / group_member_remove / ' +
          'message_audit / interaction 等，见「通知类型」下拉里的取值）',
      },
      {
        id: 'user_id',
        name: '目标QQ',
        kind: 'data',
        dataType: 'string',
        description: '被操作的用户 QQ 号',
      },
      {
        id: 'group_id',
        name: '群号',
        kind: 'data',
        dataType: 'string',
        description: '事件发生的群号',
      },
      {
        id: 'sub_type',
        name: '子类型',
        kind: 'data',
        dataType: 'string',
        description: '通知子类型：approve / invite / leave / kick 等',
      },
      {
        id: 'operator_id',
        name: '操作者QQ',
        kind: 'data',
        dataType: 'string',
        description:
          '执行该操作的管理员 QQ 号（审核、踢人、禁言等场景用；与「目标QQ」不同）。matchTrigger 一直在给这个值，此前目录没声明',
      },
    ],
  },
  {
    kind: 'button_clicked',
    type: 'trigger',
    // 执行路径（闸门会校验"声明 == 证据"）：trigger
    execution: 'trigger',
    label: '按钮点击',
    group: '触发器',
    icon: '🔘',
    description: '监听用户点击 InlineKeyboard 按钮的事件',
    summary:
      '点击「发消息」（按钮UI）里的按钮时触发。QQ 官方把指令按钮点击表现为一条内容等于按钮 action.data 的消息，需用「收到消息」触发器接住',
    sideEffects: [],
    tags: ['QQ', '按钮', '点击', '回调', '触发器'],
    handler: { source: 'builtin', module: 'button_clicked' },
    exposedAsTool: false,
    defaultConfig: { button_data: '' },
    inputs: [],
    outputs: [
      { id: 'next', name: '出口', kind: 'control' },
      {
        id: 'event',
        name: '事件对象',
        kind: 'data',
        dataType: 'event',
        description: '原始事件对象',
      },
      {
        id: 'button_id',
        name: '按钮ID',
        kind: 'data',
        dataType: 'string',
        description: '被点击的按钮 ID（QQ 官方 API）',
      },
      {
        id: 'button_data',
        name: '按钮数据',
        kind: 'data',
        dataType: 'string',
        description: '按钮的 action_data（配置按钮时设置的 data 字段）',
      },
      {
        id: 'user_id',
        name: '点击者QQ',
        kind: 'data',
        dataType: 'string',
        description: '点击按钮的用户 QQ 号',
      },
      {
        id: 'group_id',
        name: '群号',
        kind: 'data',
        dataType: 'string',
        description: '按钮所在群号（私聊为空）',
      },
    ],
  },
  {
    kind: 'on_ready',
    type: 'trigger',
    // 执行路径（闸门会校验"声明 == 证据"）：trigger
    execution: 'trigger',
    label: '连接就绪',
    group: '触发器',
    icon: '🚀',
    description: '机器人连接就绪时自动触发（生命周期触发器）',
    summary:
      '在机器人成功连接到 OneBot 实现后自动触发，适用于启动通知、数据初始化、缓存预热、定时任务注册等。多个「连接就绪」触发器按顺序依次执行。每个运行时实例只触发一次（重连不重复；连上之前不会跑）',
    sideEffects: [],
    tags: ['QQ', '生命周期', '启动', '就绪', '触发器'],
    handler: { source: 'builtin', module: 'on_ready' },
    exposedAsTool: false,
    defaultConfig: {},
    inputs: [],
    outputs: [
      { id: 'next', name: '出口', kind: 'control' },
      {
        id: 'event',
        name: '事件对象',
        kind: 'data',
        dataType: 'event',
        description: '模拟事件对象（无真实用户消息，供下游节点引用）',
      },
      {
        id: 'ready_at',
        name: '就绪时间',
        kind: 'data',
        dataType: 'number',
        description: '机器人连接就绪的 Unix 时间戳（秒）',
      },
    ],
  },
  {
    kind: 'on_startup',
    type: 'trigger',
    // 执行路径（闸门会校验"声明 == 证据"）：trigger
    execution: 'trigger',
    label: '机器人启动',
    group: '触发器',
    icon: '⚡',
    description: 'TS 运行时启动时自动触发（生命周期触发器，早于连接就绪）',
    summary:
      '在运行时（FlowRuntime）启动时触发，早于「连接就绪」（尚未连接翻译器网关）。仅适合不需要发送消息的初始化操作：数据库建表、配置加载、缓存预热。需要发送消息请用「连接就绪」',
    sideEffects: [],
    tags: ['QQ', '生命周期', '启动', '初始化', '触发器'],
    handler: { source: 'builtin', module: 'on_startup' },
    exposedAsTool: false,
    defaultConfig: {},
    inputs: [],
    outputs: [
      { id: 'next', name: '出口', kind: 'control' },
      {
        id: 'event',
        name: '事件对象',
        kind: 'data',
        dataType: 'event',
        description: '模拟事件对象（无真实用户消息，供下游节点引用）',
      },
      {
        id: 'started_at',
        name: '启动时间',
        kind: 'data',
        dataType: 'number',
        description: 'driver 启动的 Unix 时间戳（秒）',
      },
    ],
  },
];
