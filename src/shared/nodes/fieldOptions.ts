// src/shared/nodes/fieldOptions.ts
//
// 枚举型配置字段的**选项清单单一真相**。
//
// 事故背景：同一份模式清单曾在 5 处各写一份（目录描述 / config/selectOptions.yaml /
// propertyDrawerConstants / canvasConstants / handler 的 switch），漂移的后果是
// "用户选到没实现的模式，节点静默返回空"（list_op 的 remove/contains/size/get/merge/
// insert/index_of、random 的 weighted、time_op 的 is_today/date_diff 都这么坏过）。
//
// 现在的分工：
//   - **有对应端口的字段**：目录端口引用这里的常量（`options: XXX_OPTIONS`）；属性面板、
//     画布内联卡片一律从目录端口读（getPortOptions），不再各自维护清单；
//   - **无端口的字段**（触发器这类节点没有输入端口，如 message_received:match）：
//     面板/画布直接引用这里的常量。
// 增删一个模式只需改这里 + handler：目录、面板、画布、测试闸门（modeCoverage）同时一致。
//
// 改这个文件时的注意事项：
//   1. `value` 是**契约**（handler 按它分支），不要为了措辞好看改动；
//   2. `label` 是给用户看的文案，可以改；
//   3. `group` 只影响下拉框的分组显示。
import type { FieldOption } from '../types/nodeV2';
import { CHANNEL_REST_MODE_OPTIONS } from './channelRestModes';

// ===== 触发器（无输入端口，面板直接引用）=====

/** message_received:match —— 消息匹配方式 */
export const MESSAGE_RECEIVED_MATCH_OPTIONS = [
  { value: 'any', label: '任意消息' },
  { value: 'at_me', label: '@机器人' },
  { value: 'command', label: '指令匹配' },
  { value: 'keyword', label: '关键词' },
  { value: 'regex', label: '正则匹配' },
] as const satisfies readonly FieldOption[];

/** message_received:message_type —— 消息类型过滤 */
export const MESSAGE_RECEIVED_MESSAGE_TYPE_OPTIONS = [
  { value: 'any', label: '全部' },
  { value: 'group', label: '群消息' },
  { value: 'private', label: '私聊' },
  // 频道@机器人（PUBLIC_GUILD_MESSAGES，intent 1<<30 —— 默认有权限）
  // 注：10/18 客户端这里有两行完全相同的 guild 选项，属上游笔误；去重后语义不变。
  { value: 'guild', label: '频道消息' },
] as const satisfies readonly FieldOption[];

/** start_node:trigger_type —— 流程起点类型 */
export const START_NODE_TRIGGER_TYPE_OPTIONS = [
  { value: 'message_received', label: '收到消息' },
  { value: 'scheduled', label: '定时触发' },
  { value: 'request_received', label: '收到请求' },
  { value: 'notice_received', label: '收到通知' },
  { value: 'subflow_defined', label: '子流程定义' },
] as const satisfies readonly FieldOption[];

// ===== 动作 =====

/**
 * message_send:mode
 *
 * 顺序 = 推荐度：前几个是官方 `msg_type` 直接支持的能力（文本 0 / Markdown 2 /
 * 富媒体 7），`stream` 是官方单聊的流式接口（独立端点，不走 `msg_type`），
 * `input_notify` 是官方 `msg_type=6`（**仅单聊**），`segment` 是兼容项。
 *
 * ⚠️ `keyboard`（按钮UI）**已并入 `markdown`**：两者是同一段代码路径
 * （`sendKeyboard`），差别只是前者多一句「keyboard 不能为空」的校验；
 * 而目录默认值里 keyboard 是 `{rows: []}`（真值），那句校验实际上从不触发 ——
 * 也就是说两个模式**行为完全一致**。留着只会让人选错。
 * 存量 flow.json 里的 `mode='keyboard'` 由 `graphPreprocess` 自动迁移为 `markdown`，
 * handler 里也保留了同名分支作为兜底。
 *
 * ⚠️ `ark` / `embed` **不是"又两个 msg_type"**：官方发送侧的 `msg_type` 只有
 * 0/2/6/7，而结构化卡片与 Embed 只存在于**频道的发送接口**（`POST /channels/{id}/messages`
 * 的 `ark` / `embed` 字段，那个接口根本没有 `msg_type`）。官方支持矩阵里这两者
 * **单聊与群聊都发不出去**，所以标签里直接写「仅频道」—— 选错了会在节点层被明确拒绝
 * 并告诉用户改用频道或 Markdown，而不是发出去换一个看不懂的错误码。
 */
export const MESSAGE_SEND_MODE_OPTIONS = [
  { value: 'text', label: '纯文本' },
  { value: 'markdown', label: 'Markdown / 按钮' },
  { value: 'media', label: '富媒体' },
  { value: 'stream', label: '流式消息' },
  { value: 'input_notify', label: '输入中状态（仅单聊）' },
  { value: 'ark', label: '结构化卡片（仅频道）' },
  { value: 'embed', label: 'Embed 卡片（仅频道）' },
  { value: 'segment', label: '消息段' },
] as const satisfies readonly FieldOption[];

/** message_send 的遗留模式（下拉里没有，handler 仍认，graphPreprocess 会迁移走） */
export const MESSAGE_SEND_LEGACY_MODES = ['keyboard', 'forward'] as const;

/** message_send:stream_content_type（官方流式接口的 content_type） */
export const MESSAGE_SEND_STREAM_CONTENT_TYPE_OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'markdown', label: 'Markdown' },
] as const satisfies readonly FieldOption[];

/** message_send:media_type（官方 file_type：1 图片 / 2 视频 / 3 语音 / 4 文件） */
export const MESSAGE_SEND_MEDIA_TYPE_OPTIONS = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'record', label: '语音' },
  { value: 'file', label: '文件' },
] as const satisfies readonly FieldOption[];

/** message_send:target_type */
export const MESSAGE_SEND_TARGET_TYPE_OPTIONS = [
  { value: '', label: '回复当前会话' },
  { value: 'user', label: '私聊推送' },
  { value: 'group', label: '群推送' },
  { value: 'channel', label: '频道推送' },
] as const satisfies readonly FieldOption[];

/**
 * message_compose:layout
 *
 * 卡片与列表的差别不是"好不好看"，而是**有没有空态语义**：
 * 卡片是"某件事发生了"的结果（不需要空态），列表是"一组东西"（没有时要给提示）。
 */
export const MESSAGE_COMPOSE_LAYOUT_OPTIONS = [
  { value: 'card', label: '卡片（标题+属性+引用）' },
  { value: 'list', label: '列表（条目+空态提示）' },
] as const satisfies readonly FieldOption[];

/**
 * config_query:mode
 *
 * `row` 与 `all` 的区别是**下游怎么用**：只要一行时用 row（输出 `first`），
 * 要遍历/筛选时用 all（输出 `rows`）。不提供 `count` 之类的单独模式 ——
 * 行数已经在 `count` 端口上了，模式越少越不容易选错。
 */
export const CONFIG_QUERY_MODE_OPTIONS = [
  { value: 'all', label: '所有行（遍历/筛选）' },
  { value: 'row', label: '只取一行（按条件取单条）' },
] as const satisfies readonly FieldOption[];

/**
 * message_op:segment_type
 *
 * ⚠️ 官方接入下的**可发/不可发**必须写在标签里：
 * 官方发送侧只有「文本 / Markdown / 富媒体 / 引用」这几种表达方式，
 * 表情 / 音乐 / 戳一戳 / 合并转发**官方根本没有发送接口**。
 * 这些取值是从旧协议时代留下的（存量 flow.json 里还有），保留但不该让用户以为能用 ——
 * 以前只有运行到那一步才报错，等于让用户在画布上白搭一遍。
 */
export const MESSAGE_OP_SEGMENT_TYPE_OPTIONS = [
  { value: 'at', label: '@某人' },
  { value: 'image', label: '图片' },
  { value: 'face', label: 'QQ表情（官方不支持发送）' },
  { value: 'record', label: '语音' },
  { value: 'share', label: '链接分享（官方会降级为纯文本）' },
  { value: 'music', label: '音乐分享（官方不支持发送）' },
  { value: 'poke', label: '戳一戳（官方不支持发送）' },
  { value: 'reply', label: '引用回复' },
  { value: 'forward', label: '合并转发（官方不支持发送）' },
] as const satisfies readonly FieldOption[];

/** message_op:music_type */
export const MESSAGE_OP_MUSIC_TYPE_OPTIONS = [
  { value: '163', label: '网易云' },
  { value: 'qq', label: 'QQ音乐' },
  { value: 'custom', label: '自定义' },
] as const satisfies readonly FieldOption[];

/** group_op:mode */
/**
 * group_op:mode —— 群管理操作。
 *
 * ⚠️ **这里只放官方真正支持的写法**。从旧协议时代继承下来、而官方根本没有的能力
 * （设置名片/头衔、主动退群、群公告、上传群文件、审批好友请求、设全员禁言、群精华）
 * 已**从下拉里移除** —— 它们以前挂在列表里，用户选中后必然失败，等于在画布上白搭一遍。
 *
 * 这些取值在 handler 里**仍然保留分支**并给出可操作的中文说明（见 `GROUP_OP_LEGACY_MODES`）：
 * 存量 flow.json 里还有它们，直接删分支会退化成一句笼统的「未知 mode」。
 */
export const GROUP_OP_MODE_OPTIONS = [
  { value: 'ban', label: '禁言', group: '禁言' },
  { value: 'kick', label: '踢出', group: '成员管理' },
  { value: 'kick_batch', label: '批量踢出', group: '成员管理' },
  { value: 'blacklist_add', label: '加入黑名单', group: '成员管理' },
  { value: 'blacklist_del', label: '移出黑名单', group: '成员管理' },
  { value: 'approve_group', label: '审批加群请求', group: '请求审批' },
] as const satisfies readonly FieldOption[];

/**
 * group_op 的**遗留模式**（不在下拉里，但 handler 仍认得并明确报错）。
 *
 * 单列出来的用处：
 *   1. `modeCoverage` / 契约闸门按目录选项跑，这些模式不会进那条路径 ——
 *      需要一份显式清单才能**持续断言它们仍被明确拒绝**，而不是掉进「未知 mode」；
 *   2. 说明它们为什么留着（存量 flow.json 兼容）。
 */
export const GROUP_OP_LEGACY_MODES = [
  'mute_all',
  'set_card',
  'set_title',
  'approve_friend',
  'join_requests',
  'leave',
  'notice',
  'upload_file',
  'essence',
] as const;

/** 遗留模式 → 为什么不能用（一次性真相层，测试直接读它） */
export const GROUP_OP_LEGACY_REASONS: Readonly<Record<string, string>> = {
  mute_all: '官方没有设置全员禁言的接口，只能查询（用「获取上下文 → 群禁言状态」）',
  set_card: '官方 API 没有「设置群名片」能力',
  set_title: '官方 API 没有「设置群头衔」能力',
  approve_friend: '官方 API 没有「好友请求审批」能力（好友添加是通知事件，不是请求）',
  join_requests: '读取操作已移到「获取上下文 → 入群申请列表」（那边才有数据出口）',
  leave: '官方 API 没有「主动退群」能力',
  notice: '官方 API 没有「QQ 群公告」能力',
  upload_file: '官方 API 没有「上传群文件」能力',
  essence: '官方「精华消息」仅频道支持，QQ 群没有该能力',
};

/**
 * notice_received:notice_type —— 通知事件类型。
 *
 * 取值必须与翻译器**真正广播出来的** notice_type 一致（见 eventBus.ts）。
 * 这里曾经只在节点描述里写了 'group_increase'/'group_decrease'/'group_recall'/'group_admin'
 * 这类协议标准名 —— 而官方适配器根本不发这些名字（发的是 group_member_add /
 * group_member_remove / message_audit / interaction）。照着描述配流程的人会永远等不到事件。
 */
export const NOTICE_TYPE_OPTIONS = [
  { value: 'any', label: '任意通知' },
  { value: 'group_member_add', label: '有人入群', group: '群成员' },
  { value: 'group_member_remove', label: '有人退群', group: '群成员' },
  { value: 'group_join_request', label: '有人申请加群', group: '群成员' },
  { value: 'group_add_robot', label: '机器人被拉进群', group: '机器人' },
  { value: 'group_del_robot', label: '机器人被移出群', group: '机器人' },
  { value: 'group_msg_receive', label: '机器人群消息被开启', group: '机器人' },
  { value: 'group_msg_reject', label: '机器人群消息被关闭', group: '机器人' },
  { value: 'friend_add', label: '用户添加机器人', group: '好友' },
  { value: 'friend_del', label: '用户删除机器人', group: '好友' },
  { value: 'c2c_msg_receive', label: '单聊消息被开启', group: '好友' },
  { value: 'c2c_msg_reject', label: '单聊消息被关闭', group: '好友' },
  { value: 'subscribe_message_status', label: '订阅消息状态变更', group: '订阅' },
  { value: 'message_audit', label: '消息审核结果（频道）', group: '审核' },
  { value: 'interaction', label: '互动事件（按钮回调等）', group: '互动' },
  // ── 频道管理事件（intent 1<<0 GUILDS，默认有权限；2026-10-04 补）──
  { value: 'guild_create', label: '频道被创建', group: '频道' },
  { value: 'guild_update', label: '频道信息更新', group: '频道' },
  { value: 'guild_delete', label: '频道被解散', group: '频道' },
  { value: 'channel_create', label: '子频道被创建', group: '频道' },
  { value: 'channel_update', label: '子频道被更新', group: '频道' },
  { value: 'channel_delete', label: '子频道被删除', group: '频道' },
] as const satisfies readonly FieldOption[];

/** join_approval:mode —— 入群自动审批策略（配置类，一次配置长期生效） */
export const JOIN_APPROVAL_MODE_OPTIONS = [
  { value: 'list', label: '查询策略列表', group: '读取' },
  { value: 'create', label: '创建策略', group: '写入' },
  { value: 'update', label: '修改策略', group: '写入' },
  { value: 'whitelist', label: '修改白名单', group: '写入' },
  { value: 'execute', label: '执行策略', group: '执行' },
  { value: 'delete', label: '删除策略', group: '删除' },
] as const satisfies readonly FieldOption[];

/** join_approval:is_enable —— 官方用 on/off 字符串，不是布尔 */
export const JOIN_APPROVAL_ENABLE_OPTIONS = [
  { value: 'on', label: '启用' },
  { value: 'off', label: '停用' },
] as const satisfies readonly FieldOption[];

/** join_approval:group_op —— 关联群增删（群标识形式必须与创建时一致） */
export const JOIN_APPROVAL_GROUP_OP_OPTIONS = [
  { value: 'add', label: '新增关联群' },
  { value: 'del', label: '移除关联群' },
] as const satisfies readonly FieldOption[];

/** join_approval:whitelist_op */
export const JOIN_APPROVAL_WHITELIST_OP_OPTIONS = [
  { value: 'add', label: '新增号码' },
  { value: 'del', label: '删除号码' },
] as const satisfies readonly FieldOption[];

/** bot_info:mode —— 机器人自身信息与邀请链接 */
export const BOT_INFO_MODE_OPTIONS = [
  { value: 'self', label: '机器人自身信息' },
  { value: 'url_link', label: '生成邀请链接' },
] as const satisfies readonly FieldOption[];

/** request_received:request_type —— 请求事件类型 */
export const REQUEST_TYPE_OPTIONS = [
  { value: 'any', label: '任意请求' },
  { value: 'group', label: '加群请求 / 邀请' },
] as const satisfies readonly FieldOption[];

/** group_op:sub_type —— 审批类模式的子类型 */
export const GROUP_OP_SUB_TYPE_OPTIONS = [
  { value: 'add', label: '加群邀请' },
  { value: 'approve', label: '他人申请' },
] as const satisfies readonly FieldOption[];

/** http_request:method */
export const HTTP_REQUEST_METHOD_OPTIONS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'DELETE', label: 'DELETE' },
] as const satisfies readonly FieldOption[];

/** http_request:response_format */
export const HTTP_REQUEST_RESPONSE_FORMAT_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: '文本' },
  { value: 'binary', label: '二进制' },
] as const satisfies readonly FieldOption[];

/** agent_chat:mode */
export const AGENT_CHAT_MODE_OPTIONS = [
  { value: 'chat', label: '单次对话' },
  { value: 'agent', label: '多轮工具调用' },
] as const satisfies readonly FieldOption[];

// ===== 逻辑 / 控制流 =====

/** loop:mode */
export const LOOP_MODE_OPTIONS = [
  { value: 'times', label: '按次数循环' },
  { value: 'iterate', label: '遍历列表/字典' },
  { value: 'while', label: '条件循环' },
] as const satisfies readonly FieldOption[];

/** loop_control:mode */
export const LOOP_CONTROL_MODE_OPTIONS = [
  { value: 'break', label: '跳出循环' },
  { value: 'return', label: '提前返回' },
] as const satisfies readonly FieldOption[];

/** error_op:mode（无输入端口） */
export const ERROR_OP_MODE_OPTIONS = [
  { value: 'throw', label: '抛出异常' },
  { value: 'assert', label: '断言检查' },
] as const satisfies readonly FieldOption[];

/** timer:mode */
export const TIMER_MODE_OPTIONS = [
  { value: 'start', label: '开始计时' },
  { value: 'stop', label: '停止计时' },
  { value: 'elapsed', label: '获取累计耗时' },
] as const satisfies readonly FieldOption[];

// ===== 数据 =====

/** json_op:mode */
export const JSON_OP_MODE_OPTIONS = [
  { value: 'get', label: '提取字段' },
  { value: 'set', label: '设置字段' },
  { value: 'delete', label: '删除字段' },
  { value: 'merge', label: '合并 JSON' },
] as const satisfies readonly FieldOption[];

/**
 * json_op: 源 JSON 从哪来。
 *
 * 加这个是因为"字典 + 命名变量"这条最常用的路原来是**绕的**：
 * `source` 只能从端口进来，而**唯一能读命名变量的地方是表达式**
 * （命名变量会被并进表达式的变量表）—— 想"把这个变量里某个字段改掉"得
 * `表达式读出来 → json_op 设值 → 变量赋值写回去`，三个节点 + 一次容易写错的手抄。
 * 详见 docs/game/rpg-node-gap-audit.md §13
 */
export const JSON_SOURCE_OPTIONS = [
  { value: 'port', label: '上游连线' },
  { value: 'variable', label: '命名变量' },
] as const satisfies readonly FieldOption[];

/** list_op:mode */
export const LIST_OP_MODE_OPTIONS = [
  { value: 'append', label: '追加', group: '增删改' },
  { value: 'remove', label: '删除', group: '增删改' },
  { value: 'insert', label: '插入', group: '增删改' },
  // 背包加物品：按字段找同款，找到就累加计数，没找到就新增
  { value: 'upsert', label: '按字段累加（背包加物品）', group: '增删改' },
  { value: 'contains', label: '包含', group: '查询' },
  { value: 'size', label: '长度', group: '查询' },
  { value: 'get', label: '取元素', group: '查询' },
  { value: 'index_of', label: '查找索引', group: '查询' },
  { value: 'sort', label: '排序', group: '排序变换' },
  { value: 'reverse', label: '反转', group: '排序变换' },
  { value: 'unique', label: '去重', group: '排序变换' },
  { value: 'merge', label: '合并', group: '合并切片' },
  { value: 'slice', label: '切片', group: '合并切片' },
  { value: 'pop', label: '弹出末尾', group: '合并切片' },
] as const satisfies readonly FieldOption[];

/** variable_persist:mode */
export const VARIABLE_PERSIST_MODE_OPTIONS = [
  { value: 'save', label: '保存' },
  { value: 'load', label: '读取' },
  { value: 'delete', label: '删除' },
  { value: 'exists', label: '检查存在' },
  { value: 'load_or_default', label: '读取或默认值' },
  { value: 'increment', label: '自增' },
  { value: 'batch_load', label: '批量读取' },
  { value: 'batch_save', label: '批量保存' },
  { value: 'list_append', label: '列表追加' },
  // compare_update 此前只写在目录描述与实现里，面板清单漏了它（用户选不到）——
  // 它已实现且有测试（persistCompare / persistCompareRouting），清单迁移时一并补上。
  { value: 'compare_update', label: '条件更新（防超卖）' },
  // 多键原子更新：batch_save 只能"把这批值写下去"，判定必须由上游节点做，
  // 那个读—判—写之间的窗口就是并发丢更新的入口。这个模式把三步收进一次事务。
  { value: 'batch_update', label: '批量更新（多键原子）' },
] as const satisfies readonly FieldOption[];

/** variable_persist:scope（写入必须落到一个具体范围，没有"写到所有人"这种语义） */
export const SCOPE_OPTIONS = [
  { value: 'user', label: '按用户' },
  { value: 'group', label: '按群' },
  { value: 'global', label: '全局' },
] as const satisfies readonly FieldOption[];

/**
 * query:scope —— 比写入多一个「所有用户」。
 *
 * 为什么必须多这一个：排行榜/全服统计要跨**所有玩家**读，
 * 而 `user` 会把查询限定在当前事件的那个用户（`handler` 里是 `user_<uid>:` 前缀）。
 * 于是"等级榜"这个最普通的玩法，在只有三个范围时**根本表达不出来**
 * （实测：`scope=global` 查不到任何玩家数据 —— 玩家数据在 user 组里）。
 */
export const QUERY_SCOPE_OPTIONS = [
  { value: 'user', label: '按用户' },
  { value: 'group', label: '按群' },
  { value: 'global', label: '全局' },
  { value: 'all', label: '所有用户（排行榜）' },
] as const satisfies readonly FieldOption[];

/** variable_merge:mode */
export const VARIABLE_MERGE_MODE_OPTIONS = [
  { value: 'dict', label: '合并为字典' },
  { value: 'list', label: '合并为列表' },
  { value: 'concat', label: '拼接列表' },
] as const satisfies readonly FieldOption[];

/** database_write:mode */
export const DATABASE_WRITE_MODE_OPTIONS = [
  { value: 'select', label: '查询' },
  { value: 'insert', label: '插入' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
] as const satisfies readonly FieldOption[];

/** query:mode */
export const QUERY_MODE_OPTIONS = [
  { value: 'list', label: '列出所有' },
  { value: 'sort', label: '按值排序' },
  { value: 'filter', label: '条件过滤' },
  { value: 'aggregate', label: '聚合统计' },
] as const satisfies readonly FieldOption[];

/** query:order（无输入端口） */
export const QUERY_ORDER_OPTIONS = [
  { value: 'asc', label: '升序' },
  { value: 'desc', label: '降序' },
] as const satisfies readonly FieldOption[];

/** query:sort_by（无输入端口） */
export const QUERY_SORT_BY_OPTIONS = [
  { value: 'key', label: '按键名' },
  { value: 'value', label: '按值' },
] as const satisfies readonly FieldOption[];

/** file_operate:mode */
export const FILE_OPERATE_MODE_OPTIONS = [
  { value: 'read', label: '读取文件' },
  { value: 'write', label: '写入文件' },
  { value: 'copy', label: '复制文件' },
  { value: 'move', label: '移动/重命名' },
  { value: 'delete', label: '删除文件' },
  { value: 'exists', label: '检查存在' },
  { value: 'list_dir', label: '列出目录' },
  { value: 'mkdir', label: '创建目录' },
] as const satisfies readonly FieldOption[];

// file_operate 拆分（2026-10-03）：按用户**真正在乎的边界** —— 会不会改磁盘
/** 读文件：读取 / 检查存在 / 列出目录（只读） */
export const FILE_READ_MODE_OPTIONS = subsetOf(FILE_OPERATE_MODE_OPTIONS, [
  'read',
  'exists',
  'list_dir',
]);
/** 写文件：写入 / 复制 / 移动 / 删除 / 创建目录（会改磁盘） */
export const FILE_WRITE_MODE_OPTIONS = subsetOf(FILE_OPERATE_MODE_OPTIONS, [
  'write',
  'copy',
  'move',
  'delete',
  'mkdir',
]);

/** file_operate:write_mode */
export const FILE_OPERATE_WRITE_MODE_OPTIONS = [
  { value: 'json', label: 'JSON' },
  { value: 'text', label: '文本' },
] as const satisfies readonly FieldOption[];

/** random:mode */
export const RANDOM_MODE_OPTIONS = [
  { value: 'int', label: '范围随机' },
  { value: 'choice', label: '均匀选择' },
  { value: 'weighted', label: '加权选择' },
] as const satisfies readonly FieldOption[];

/** expression_eval:mode */
export const EXPRESSION_EVAL_MODE_OPTIONS = [
  { value: 'single', label: '单表达式求值' },
  { value: 'formulas', label: '多公式批量计算' },
] as const satisfies readonly FieldOption[];

/** get_context:mode */
export const GET_CONTEXT_MODE_OPTIONS = [
  { value: 'user_id', label: '用户ID', group: '身份标识' },
  { value: 'group_id', label: '群ID', group: '身份标识' },
  { value: 'self_id', label: '机器人QQ', group: '身份标识' },
  { value: 'operator_id', label: '操作者ID', group: '身份标识' },
  { value: 'user_name', label: '用户名', group: '身份标识' },
  { value: 'group_name', label: '群名称', group: '身份标识' },
  { value: 'message_text', label: '消息文本', group: '消息内容' },
  { value: 'message_id', label: '消息ID', group: '消息内容' },
  { value: 'raw_message', label: '原始消息', group: '消息内容' },
  { value: 'message_part', label: '消息片段', group: '消息内容' },
  { value: 'message_ref', label: '引用标识', group: '消息内容' },
  { value: 'sub_type', label: '子类型', group: '消息内容' },
  { value: 'command_args', label: '指令参数', group: '消息内容' },
  { value: 'group_members', label: '群成员列表', group: '群信息' },
  { value: 'member_info', label: '群成员信息（QQ 官方）', group: '群信息' },
  { value: 'bot_state', label: '机器人群内状态（QQ 官方）', group: '群信息' },
  { value: 'join_requests', label: '入群申请列表（需群管理员）', group: '群信息' },
  { value: 'blacklist_list', label: '群黑名单（QQ 官方）', group: '群信息' },
  // QQ 官方接入专属：需要机器人为群管理员，且只有官方 API 有该接口
  { value: 'group_mute_state', label: '群禁言状态（QQ 官方）', group: '群信息' },
] as const satisfies readonly FieldOption[];

/**
 * 拆分后的模式子集（2026-10-03）：`get_context` 拆成 6 个节点，每个只留自己的模式。
 *
 * ⚠️ 全部从下面的总表**派生** —— 标签与分组继承，模式名只有一处真相
 * （`tests/main/nodes/modeListConsistency.test.ts` 会守着"不许出现第二份清单"）。
 */
function subsetOf(master: readonly FieldOption[], values: readonly string[]): FieldOption[] {
  return values.map((v) => {
    const o = master.find((x) => x.value === v);
    if (!o) throw new Error(`未知的模式名: ${v}（总表里没有）`);
    return { value: o.value, label: o.label, group: o.group };
  });
}

function contextModeSubset(values: readonly string[]): FieldOption[] {
  return subsetOf(GET_CONTEXT_MODE_OPTIONS, values);
}

/** 取身份 ID：事件自带，零开销 */
export const GET_IDS_MODE_OPTIONS = contextModeSubset([
  'user_id',
  'group_id',
  'self_id',
  'operator_id',
]);
/** 取消息内容：当前消息的文本/ID/引用/片段/指令参数 */
export const GET_MESSAGE_MODE_OPTIONS = contextModeSubset([
  'message_text',
  'raw_message',
  'message_id',
  'message_ref',
  'message_part',
  'sub_type',
  'command_args',
]);
/** 查资料（需调接口）：成员 / 群 / 群列表 / 机器人自身状态 —— 都是"要调接口"的那一类 */
export const GET_PROFILE_MODE_OPTIONS = contextModeSubset([
  'user_name',
  'member_info',
  'group_name',
  'group_members',
  'group_mute_state',
  'join_requests',
  'blacklist_list',
  'bot_state',
]);
/** 读玩家数据：读 / 带默认值读 / 批量读 —— 都是"读"，接线方式相同 */
export const LOAD_VARIABLE_MODE_OPTIONS = subsetOf(VARIABLE_PERSIST_MODE_OPTIONS, [
  'load',
  'load_or_default',
  'batch_load',
]);

/** 写玩家数据：存 / 批量存 / 多键原子更新 —— 都是"写" */
export const SAVE_VARIABLE_MODE_OPTIONS = subsetOf(VARIABLE_PERSIST_MODE_OPTIONS, [
  'save',
  'batch_save',
  'batch_update',
]);
// 列表操作拆分（2026-10-03）：按目录里**早已分好的 4 组**（增删改 / 查询 / 排序变换 / 合并切片）
/** 列表增删改：append / remove / insert / upsert */
export const LIST_EDIT_MODE_OPTIONS = subsetOf(LIST_OP_MODE_OPTIONS, [
  'append',
  'remove',
  'insert',
  'upsert',
]);
/** 列表查询：contains / size / get / index_of */
export const LIST_QUERY_MODE_OPTIONS = subsetOf(LIST_OP_MODE_OPTIONS, [
  'contains',
  'size',
  'get',
  'index_of',
]);
/** 列表排序变换：sort / reverse / unique */
export const LIST_TRANSFORM_MODE_OPTIONS = subsetOf(LIST_OP_MODE_OPTIONS, [
  'sort',
  'reverse',
  'unique',
]);
/** 列表合并切片：merge / slice / pop */
export const LIST_COMBINE_MODE_OPTIONS = subsetOf(LIST_OP_MODE_OPTIONS, ['merge', 'slice', 'pop']);
/** get_context:part_mode */
export const GET_CONTEXT_PART_MODE_OPTIONS = [
  { value: 'at', label: '@某人' },
  { value: 'image', label: '图片' },
  { value: 'file', label: '文件' },
  { value: 'reply', label: '引用回复' },
  { value: 'record', label: '语音' },
  { value: 'video', label: '视频' },
  { value: 'json', label: 'JSON' },
] as const satisfies readonly FieldOption[];

/** time_op:mode */
/**
 * time_op:mode
 *
 * ⚠️ 这张表必须与 `timeOp()` 的 mode 联合类型**双向一致**：
 * 只声明一部分 → 用户选不到已经实现的能力（`timestamp`/`format`/`parse`/`add`/`sub`
 * 就这么在实现里躺了很久，真实项目里甚至已经用上了 `format`，而界面上没这个选项）；
 * 声明了没实现 → 选中后报「未知模式」。
 * `tests/main/nodes/modeCoverage.test.ts` 里有编译期双向校验兜着。
 */
export const TIME_OP_MODE_OPTIONS = [
  { value: 'now', label: '当前时间', group: '读取' },
  { value: 'timestamp', label: '时间戳转换', group: '读取' },
  { value: 'format', label: '格式化时间', group: '读取' },
  { value: 'parse', label: '解析为时间戳', group: '读取' },
  { value: 'is_today', label: '是否今天', group: '判断' },
  { value: 'date_diff', label: '时间差', group: '计算' },
  { value: 'add', label: '时间相加', group: '计算' },
  { value: 'sub', label: '时间相减', group: '计算' },
] as const satisfies readonly FieldOption[];

// time_op 拆分（2026-10-03）：按目录里**早已分好的 3 组**（读取 / 判断 / 计算）
/** 读时间：当前时间 / 时间戳转换 / 格式化 / 解析 */
export const TIME_READ_MODE_OPTIONS = subsetOf(TIME_OP_MODE_OPTIONS, [
  'now',
  'timestamp',
  'format',
  'parse',
]);
/** 算时间：时间差 / 相加 / 相减 */
export const TIME_CALC_MODE_OPTIONS = subsetOf(TIME_OP_MODE_OPTIONS, ['date_diff', 'add', 'sub']);

/** time_op:unit */
export const TIME_OP_UNIT_OPTIONS = [
  { value: 'seconds', label: '秒' },
  { value: 'minutes', label: '分' },
  { value: 'hours', label: '时' },
  { value: 'days', label: '天' },
] as const satisfies readonly FieldOption[];

/** wait_input:scope —— 等待谁的回复 */
export const WAIT_INPUT_SCOPE_OPTIONS = [
  { value: 'trigger_user', label: '只等触发者' },
  { value: 'any_in_group', label: '本群任何人' },
  // ⚠️ 这个选项**当前与「只等触发者」完全等价**：解释器登记等待时永远填触发者
  // （FlowInterpreter 的 `userId: fp?.userId`），全流程没有任何端口让用户填那个人的 QQ。
  // 先如实改名（不假装支持），要真支持得加一个「目标用户」端口并在登记时用它。
  { value: 'specific_user', label: '指定的人（当前等同「只等触发者」，见注释）' },
] as const satisfies readonly FieldOption[];

// ===== 权限 / 日志 =====

/** check_permission:role */
export const CHECK_PERMISSION_ROLE_OPTIONS = [
  { value: 'super_admin', label: '超级管理员' },
  { value: 'owner', label: '群主' },
  { value: 'admin', label: '管理员' },
  { value: 'member', label: '成员' },
  { value: 'guest', label: '游客' },
] as const satisfies readonly FieldOption[];

/** system_log:level */
export const SYSTEM_LOG_LEVEL_OPTIONS = [
  { value: 'info', label: '信息' },
  { value: 'warning', label: '警告' },
  { value: 'error', label: '错误' },
  { value: 'debug', label: '调试' },
] as const satisfies readonly FieldOption[];

/** menu_config:mode —— 自定义菜单（官方仅支持 C2C 单聊场景） */
export const MENU_CONFIG_MODE_OPTIONS = [
  { value: 'get', label: '查询菜单', group: '读取' },
  { value: 'set', label: '设置菜单', group: '写入' },
] as const satisfies readonly FieldOption[];

/**
 * panel_config:mode —— 指令面板。
 * 面板是「一次配置、长期生效」的，增删改查都在这一个节点里切换。
 */
export const PANEL_CONFIG_MODE_OPTIONS = [
  { value: 'list', label: '查询面板列表', group: '读取' },
  { value: 'get', label: '查询面板详情', group: '读取' },
  { value: 'create', label: '创建面板', group: '写入' },
  { value: 'update', label: '修改面板内容', group: '写入' },
  { value: 'set_target', label: '修改生效对象', group: '写入' },
  { value: 'delete', label: '删除面板', group: '删除' },
] as const satisfies readonly FieldOption[];

/** panel_config:scope —— 面板生效场景（官方四种） */
export const PANEL_SCOPE_OPTIONS = [
  { value: 'c2c', label: '单聊' },
  { value: 'group', label: '群聊' },
  { value: 'channel', label: '文字子频道' },
  { value: 'dm', label: '频道私信' },
] as const satisfies readonly FieldOption[];

/** panel_config:target_type —— 作用范围 */
export const PANEL_TARGET_TYPE_OPTIONS = [
  { value: 'all', label: '全部用户/群' },
  { value: 'specific', label: '仅指定对象' },
] as const satisfies readonly FieldOption[];

/**
 * channel_op:mode —— QQ 频道专属操作。
 *
 * 这些能力**只在频道（Guild）场景存在**，群聊与单聊没有对应概念，
 * 所以单独收成一个节点，而不是硬塞进 group_op。
 */
export const CHANNEL_OP_MODE_OPTIONS = [
  { value: 'channel_list', label: '获取子频道列表', group: '子频道' },
  { value: 'channel_get', label: '获取子频道详情', group: '子频道' },
  { value: 'channel_create', label: '创建子频道', group: '子频道' },
  { value: 'channel_update', label: '修改子频道', group: '子频道' },
  { value: 'channel_delete', label: '删除子频道', group: '子频道' },
  { value: 'announce_create', label: '创建频道公告', group: '公告' },
  { value: 'announce_delete', label: '删除频道公告', group: '公告' },
  { value: 'pin_add', label: '添加精华消息', group: '精华消息' },
  { value: 'pin_list', label: '获取精华消息', group: '精华消息' },
  { value: 'pin_remove', label: '删除精华消息', group: '精华消息' },
  { value: 'reaction_add', label: '发表表情表态', group: '表情表态' },
  { value: 'reaction_remove', label: '删除表情表态', group: '表情表态' },
  { value: 'reaction_users', label: '表态用户列表', group: '表情表态' },
  // 身份组 / 成员 / 禁言 / 子频道权限 / 私信 / 日程 / 论坛 / 消息这一族在 ./channelRestModes.ts
  // （34 条，单独成文件是为了不让本文件越过 fileGrowth 的 800 行硬线）
  ...CHANNEL_REST_MODE_OPTIONS,
] as const satisfies readonly FieldOption[];

/** channel_op:type —— 子频道类型（官方整数枚举的界面名） */
export const CHANNEL_TYPE_OPTIONS = [
  { value: 'text', label: '文字' },
  { value: 'voice', label: '语音' },
  { value: 'category', label: '分组' },
  { value: 'live', label: '直播' },
  { value: 'application', label: '应用' },
  { value: 'forum', label: '论坛' },
] as const satisfies readonly FieldOption[];

/** channel_op:emoji_type —— 表情表态的 emoji 类型 */
export const CHANNEL_EMOJI_TYPE_OPTIONS = [
  { value: 'system', label: '系统表情' },
  // 值刻意用 unicode 而不是 emoji：官方把该类型叫「emoji 表情」，但作为**选项值**
  // 它会和文案里的日常用词 "emoji" 撞车（目录契约规则⑤ 会把本节点的选项值
  // 出现在描述里视为"内部标识泄漏"）。用 unicode 既避开冲突，语义也更准。
  { value: 'unicode', label: 'emoji 表情' },
] as const satisfies readonly FieldOption[];
