// 从 PropertyDrawer.tsx 拆分而来（P0-D1 重构）
// 集中存放 PropertyDrawer 使用的常量字典、配置映射表与节点参数描述查询函数。
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'
import { t } from '../../i18n'

/** 从 catalog 获取节点参数的描述信息 */
export function getNodeInputDescriptions(nodeKind: string): Record<string, string> {
  const entry = NODE_CATALOG_V2.find(e => e.kind === nodeKind)
  if (!entry) return {}
  const descs: Record<string, string> = {}
  for (const input of entry.inputs) {
    descs[input.id] = input.description || ''
  }
  return descs
}

/** 配置字段中文名映射 */
export const CONFIG_LABELS: Record<string, string> = {
  key: '键名',
  value: '值',
  scope: '范围',
  command: '命令',
  message: '消息',
  message_type: '消息类型',
  model: '模型',
  temperature: '温度',
  expression: '条件',
  op: '运算',
  seconds: '秒数',
  method: '方法',
  url: '地址',
  cron: '定时',
  prompt: '提示词',
  mode: '模式',
  template: '模板',
  text: '文本',
  min: '最小值',
  max: '最大值',
  index: '索引',
  cases: '分支列表',
  default: '默认分支',
  state_key: '状态键',
  action: '动作',
  transitions: '转移规则',
  initial_state: '初始状态',
  segments: '消息段',
  timezone: '时区',
  role: '所需权限',
  // 文件操作
  file_path: '文件路径',
  dest_path: '目标路径',
  content: '内容',
  write_mode: '写入格式',
  encoding: '编码',
  append: '追加',
  file_name: '文件名',
  // 触发器
  pattern: '正则表达式',
  flags: '标志位',
  prefix: '前缀',
  button_data: '按钮数据',
  match: '匹配方式',
  keywords: '关键词',
  // 变量
  var_name: '变量名',
  variables_json: '命名变量',
  // 列表操作
  source_list: '输入列表',
  item: '操作元素',
  start: '起始索引',
  end: '结束索引',
  // 群管
  group_id: '群号',
  user_id: 'QQ号',
  duration: '时长(秒)',
  enable: '开启',
  card: '名片',
  title: '头衔',
  flag: '请求标识',
  approve: '同意',
  sub_type: '子类型',
  remark: '备注',
  // 数据库
  db_path: '数据库路径',
  query: 'SQL 语句',
  params: '参数',
  table: '表名',
  data: '数据',
  condition: '条件',
  where_params: '查询参数',
  // AI
  system_prompt: '系统提示词',
  history: '历史记录',
  // HTTP
  headers: '请求头',
  body: '请求体',
  timeout: '超时(秒)',
  response_format: '返回格式',
  source: '数据源',
  // 等待回复
  expected_pattern: '校验正则',
  invalid_message: '格式错误提示',
  timeout_message: '超时提示',
  max_retries: '最大重试',
  // 循环
  count: '次数',
  max_iterations: '最大迭代',
  // 消息段
  face_id: '表情ID',
  image_url: '图片URL',
  music_type: '音乐类型',
  audio_url: '音频URL',
  singer: '歌手',
  message_id: '消息ID',
  forward_id: '转发资源ID',
  segment_type: '消息段类型',
  file: '文件路径',
  // 时间
  fmt: '格式',
  timestamp: '时间戳',
  target: '目标时间',
  unit: '单位',
  target_fmt: '目标格式',
  // 持久化
  ttl: '过期秒数',
  amount: '自增量',
  auto_save: '自动保存',
  keys: '键列表',
  max_length: '最大长度',
  key_pattern: '键匹配',
  sort_by: '排序字段',
  order: '排序方向',
  limit: '数量限制',
  top_k: '返回数量',
  min_score: '最低分数',
  part_mode: '片段模式',
  // 数据表
  tableName: '表名',
  fields: '字段列表',
  result_field: '提取字段',
  panelId: '面板ID',
  label: '面板名称',
  description: '描述',
  dataSource: '数据源',
  outputSchema: '输出 Schema',
  // 子流程
  subflow_name: '子流程名',
  subflow_id: '子流程ID',
  args: '参数JSON',
  // 控制流/工具
  error_message: '错误信息',
  delay: '重试间隔(秒)',
  timer_id: '计时器ID',
  level: '日志级别',
  // 消息
  markdown: 'Markdown',
  keyboard: '按钮配置',
  messages: '消息列表',
  target_type: '推送目标',
  target_id: '目标ID',
  new_text: '新文本',
  // 表达式
  formulas: '公式列表',
  group: '分组',
  as_list: '返回列表',
  // 调度
  interval_seconds: '间隔秒数',
}

/** 配置字段说明 */
export const CONFIG_HINTS: Record<string, string> = {
  key: '持久化键名，如 hp、qi、realm（读取/保存的都是这个 key）',
  value: '固定值。如需用上游节点的输出，请到"数据来源"区绑定',
  command: '触发指令，如 创建角色、修炼（不含前缀 /）',
  message: '发送的文本，可用 {var} 占位符引用 format_text 的输出',
  expression: '条件表达式，用 value 表示上游数据。如 value != None、value >= 100、value == "筑基期"。\nPython 语法：True/False/None 首字母大写',
  op: '数学运算符：+ - * / %',
  seconds: '延迟秒数',
  cron: 'Cron 表达式，如 0 9 * * *（每天9点）',
  text: '回复文本。留空则使用"数据来源"绑定的上游输出',
  template: '文本模板，用 {变量名} 引用上游变量。如：境界：{realm}，灵气：{qi}',
  min: '随机数最小值（含）',
  max: '随机数最大值（含）',
  index: '参数位置，0=第一个参数',
  mode: '模式切换：通过下拉选择不同操作类型',
  cases: 'JSON 数组，每项 {"match":"值","label":"标签"}。支持通配 *、比较 >=10、多值 a,b,c',
  state_key: '持久化存储的 key，如 dungeon_state',
  action: '触发动作名，如 enter/attack/flee',
  transitions: 'JSON：{"states":{"idle":{"enter":"exploring"}},"default_state":"idle"}',
  segments: 'JSON 格式：[{"type":"at","data":{"qq":"123"}}] 或 {"type":"text","data":{"text":"hello"}}',
  timezone: 'IANA 时区名，如 Asia/Shanghai、UTC、America/New_York',
  role: 'super_admin > owner > admin > member > guest',
  // 文件操作
  file_path: '文件/目录路径（相对项目根目录，自动沙箱校验）',
  dest_path: '目标路径（copy/move 模式使用）',
  content: '写入内容（write 模式）',
  write_mode: 'json 或 text（write 模式）',
  encoding: '文件编码，默认 utf-8',
  append: '是否追加到文件末尾（write 模式）',
  // 触发器
  pattern: '正则表达式，如 "签到\\s*(\\d+)"',
  flags: '标志位：i=忽略大小写, m=多行, s=点号匹配换行',
  prefix: '指令前缀，如 / 或 !',
  button_data: '按钮的 action_data（配置按钮时设置的 data 字段）',
  // 变量
  var_name: '变量名称（在 if_branch / expression_eval 等节点中用此名引用）',
  variables_json: 'JSON字典或dict对象，如 {"atk":100,"defense":50}',
  // 列表
  source_list: '要操作的列表',
  item: 'append/remove/contains/insert 用；merge 时为第二个列表',
  start: '切片起始索引（含，slice 模式）',
  end: '切片结束索引（不含，slice 模式）',
  // 群管
  group_id: '目标群号（为空取当前群）',
  user_id: '目标 QQ 号',
  duration: '禁言时长（秒，ban 模式）',
  enable: '是否启用全员禁言（mute_all 模式）',
  card: '群名片（set_card 模式）',
  title: '群头衔（set_title 模式）',
  flag: '请求 flag（approve_friend/approve_group 模式）',
  approve: '是否同意请求',
  sub_type: 'add=加群邀请, approve=他人申请（approve_group 模式）',
  remark: '好友备注（approve_friend 模式）',
  // 数据库
  db_path: '数据库文件路径',
  query: 'SQL 查询语句',
  params: '参数化查询的参数列表',
  table: '要操作的表名',
  data: '列值字典（insert/update），如 {"name":"张三","level":1}',
  condition: 'WHERE 条件（不含 WHERE），如 qq = ?',
  where_params: '查询参数值，标量自动包装（5→[5]），可直接绑定上游输出',
  result_field: 'select 模式专用：填字段名则直接输出该字段值，无需 expression_eval 提取',
  // AI
  system_prompt: 'LLM 系统提示词（角色设定）',
  history: '对话历史 JSON',
  // HTTP
  headers: '请求头 JSON',
  body: '请求体',
  timeout: '超时秒数',
  // 等待回复
  expected_pattern: '正则表达式（为空不校验）。如 ^[ynYN]$',
  invalid_message: '校验失败时发送的提示',
  timeout_message: '超时后返回的文本',
  max_retries: '校验失败最大重试次数',
  // 循环
  count: '循环次数',
  max_iterations: '防死循环最大次数',
  // 时间
  fmt: 'strftime 格式字符串',
  timestamp: 'Unix 时间戳',
  target: '目标时间字符串',
  unit: 'seconds/minutes/hours/days',
  target_fmt: '目标时间字符串格式',
  // 持久化
  ttl: '0=永不过期',
  amount: '自增量，可为负',
  auto_save: '是否自动保存默认值',
  keys: 'JSON 数组（batch_load）',
  max_length: '0=不限制（list_append 模式）',
  // 控制流/工具
  error_message: '要抛出的错误信息（可绑定上游节点输出）',
  delay: '每次重试前的等待秒数',
  timer_id: '计时器标识，支持多个独立计时器（如 combat/query）',
  level: 'info/warning/error/debug',
}

/** 数据输入端口的引导提示 */
export const PORT_HINTS: Record<string, string> = {
  value: '绑定上游节点的输出（如 persistent_op.result）',
  a: '运算的第一个值',
  b: '运算的第二个值（如不绑定，用 config.b）',
  text: '发送的文本。建议绑定 format_text.result 实现动态消息',
  args: '指令参数列表，来自 on_message(match=command) 触发器',
  variables_json: '命名变量字典。可直连 time_op 等节点输出',
  expression: '表达式字符串，如 "atk - def * 0.5"',
  template: '文本模板，如 "你好,{name}！"',
  attacker_atk: '攻击者攻击力，建议绑定 persistent_op.result',
  defender_hp: '防御者当前HP，建议绑定 persistent_op.result',
  defender_def: '防御者防御力',
  attacker_hp: '攻击者当前HP（反击计算用）',
  cases: '分支列表 JSON，如 [{"match":"attack","label":"攻击"}]',
}

/** 多行文本字段（用 textarea） */
export const MULTILINE_FIELDS = new Set([
  'expression', 'template', 'text', 'message', 'prompt',
])

/** JSON 编辑字段（用大 textarea + 格式提示）。
 *  扩展包含 http_request/api_call/send_message forward 等场景的 JSON 字段，
 *  让它们也用 JSON_EXAMPLES 提供格式示例（避免空白 textarea 无从下手）。 */
export const JSON_FIELDS = new Set([
  'cases', 'transitions', 'segments',     // 分支/状态机/消息段
  'headers', 'body', 'params',           // http_request / api_call
  'messages',                             // send_message forward 模式
  'variables_json',                       // format_text 命名变量
])

/** JSON 字段格式示例 placeholder：给新手提供格式参考。
 *  - 优先级：JSON_EXAMPLES[field.key] > CONFIG_HINTS[field.key] > '输入 JSON...'
 *  - 与 hint（说明性文字）互补：示例更直观，hint 更详细，二者择优 */
export const JSON_EXAMPLES: Record<string, string> = {
  // 用 getter 而不是字面量：语言切换后 placeholder 要跟着变（常量在模块加载时只求值一次）。
  get cases() { return t('blocks.placeholders.cases') },
  get transitions() { return t('blocks.placeholders.transitions') },
  get segments() { return t('blocks.placeholders.segments') },
  get headers() { return t('blocks.placeholders.headers') },
  get body() { return t('blocks.placeholders.body') },
  get params() { return t('blocks.placeholders.params') },
  get messages() { return t('blocks.placeholders.messages') },
  get variables_json() { return t('blocks.placeholders.variablesJson') },
}

/** 选择型字段选项（按 nodeKind:fieldKey 索引） */
export const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  'expression_eval:mode': [
    { value: 'single', label: '单表达式求值' },
    { value: 'formulas', label: '多公式批量计算' },
  ],
  'list_op:mode': [
    { value: 'append', label: '追加' },
    { value: 'remove', label: '删除' },
    { value: 'contains', label: '包含' },
    { value: 'size', label: '长度' },
    { value: 'get', label: '取元素' },
    { value: 'sort', label: '排序' },
    { value: 'reverse', label: '反转' },
    { value: 'unique', label: '去重' },
    { value: 'merge', label: '合并' },
    { value: 'slice', label: '切片' },
    { value: 'insert', label: '插入' },
    { value: 'index_of', label: '查找索引' },
    { value: 'pop', label: '弹出末尾' },
  ],
  'random:mode': [
    { value: 'int', label: '范围随机' },
    { value: 'choice', label: '均匀选择' },
    { value: 'weighted', label: '加权选择' },
  ],
  'send_message:mode': [
    { value: 'text', label: '纯文本' },
    { value: 'keyboard', label: '按钮UI' },
    { value: 'segment', label: '消息段' },
    { value: 'forward', label: '合并转发' },
  ],
  'on_message:message_type': [
    { value: 'any', label: '全部' },
    { value: 'group', label: '群消息' },
    { value: 'private', label: '私聊' },
  ],
  'http_request:method': [
    { value: 'GET', label: 'GET' },
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'DELETE', label: 'DELETE' },
  ],
  'persistent_op:scope': [
    { value: 'user', label: '按用户' },
    { value: 'group', label: '按群' },
    { value: 'global', label: '全局' },
  ],
  'db_write:mode': [
    { value: 'select', label: '查询' },
    { value: 'insert', label: '插入' },
    { value: 'update', label: '更新' },
    { value: 'delete', label: '删除' },
  ],
  'time_op:mode': [
    { value: 'now', label: '当前时间' },
    { value: 'is_today', label: '是否今天' },
    { value: 'date_diff', label: '时间差' },
  ],
  'json_op:mode': [
    { value: 'get', label: '提取字段' },
    { value: 'set', label: '设置字段' },
    { value: 'delete', label: '删除字段' },
    { value: 'merge', label: '合并 JSON' },
  ],
  'get_context:mode': [
    { value: 'user_id', label: '用户ID' },
    { value: 'group_id', label: '群ID' },
    { value: 'message_text', label: '消息文本' },
    { value: 'self_id', label: '机器人QQ' },
    { value: 'operator_id', label: '操作者ID' },
    { value: 'message_id', label: '消息ID' },
    { value: 'raw_message', label: '原始消息' },
    { value: 'sub_type', label: '子类型' },
    { value: 'command_args', label: '指令参数' },
    { value: 'group_members', label: '群成员列表' },
    { value: 'message_part', label: '消息片段' },
    { value: 'user_name', label: '用户名' },
    { value: 'group_name', label: '群名称' },
  ],
  'persistent_op:mode': [
    { value: 'save', label: '保存' },
    { value: 'load', label: '读取' },
    { value: 'delete', label: '删除' },
    { value: 'exists', label: '检查存在' },
    { value: 'load_or_default', label: '读取或默认值' },
    { value: 'increment', label: '自增' },
    { value: 'batch_load', label: '批量读取' },
    { value: 'batch_save', label: '批量保存' },
    { value: 'list_append', label: '列表追加' },
  ],
  'message_op:segment_type': [
    { value: 'at', label: '@某人' },
    { value: 'image', label: '图片' },
    { value: 'face', label: 'QQ表情' },
    { value: 'record', label: '语音' },
    { value: 'share', label: '链接分享' },
    { value: 'music', label: '音乐分享' },
    { value: 'poke', label: '戳一戳' },
    { value: 'reply', label: '引用回复' },
    { value: 'forward', label: '合并转发' },
  ],
  'file_op:mode': [
    { value: 'read', label: '读取文件' },
    { value: 'write', label: '写入文件' },
    { value: 'copy', label: '复制文件' },
    { value: 'move', label: '移动/重命名' },
    { value: 'delete', label: '删除文件' },
    { value: 'exists', label: '检查存在' },
    { value: 'list_dir', label: '列出目录' },
    { value: 'mkdir', label: '创建目录' },
  ],
  'group_op:mode': [
    { value: 'ban', label: '禁言' },
    { value: 'kick', label: '踢出' },
    { value: 'mute_all', label: '全员禁言' },
    { value: 'set_card', label: '设置名片' },
    { value: 'set_title', label: '设置头衔' },
    { value: 'leave', label: '退出群聊' },
    { value: 'approve_friend', label: '审批好友请求' },
    { value: 'approve_group', label: '审批加群请求' },
    { value: 'notice', label: '群公告' },
    { value: 'upload_file', label: '上传文件' },
    { value: 'essence', label: '设精华消息' },
  ],
  'check_permission:role': [
    { value: 'super_admin', label: '超级管理员' },
    { value: 'owner', label: '群主' },
    { value: 'admin', label: '管理员' },
    { value: 'member', label: '成员' },
    { value: 'guest', label: '游客' },
  ],
  'memory_op:mode': [
    { value: 'add', label: '添加记忆' },
    { value: 'search', label: '语义搜索' },
    { value: 'clear', label: '清空记忆' },
    { value: 'list', label: '列出全部' },
  ],
  'memory_op:scope': [
    { value: 'user', label: '按用户' },
    { value: 'group', label: '按群' },
    { value: 'global', label: '全局' },
  ],
  'timer:mode': [
    { value: 'start', label: '开始计时' },
    { value: 'stop', label: '停止计时' },
    { value: 'elapsed', label: '获取累计耗时' },
  ],
  'system_log:level': [
    { value: 'info', label: '信息' },
    { value: 'warning', label: '警告' },
    { value: 'error', label: '错误' },
    { value: 'debug', label: '调试' },
  ],
  'start_node:trigger_type': [
    { value: 'on_message', label: '收到消息' },
    { value: 'schedule', label: '定时触发' },
    { value: 'on_request', label: '收到请求' },
    { value: 'on_notice', label: '收到通知' },
    { value: 'subflow_define', label: '子流程定义' },
  ],
  'loop:mode': [
    { value: 'times', label: '按次数循环' },
    { value: 'iterate', label: '遍历列表/字典' },
    { value: 'while', label: '条件循环' },
  ],
  'flow_control:mode': [
    { value: 'break', label: '跳出循环' },
    { value: 'return', label: '提前返回' },
  ],
  'error_op:mode': [
    { value: 'throw', label: '抛出异常' },
    { value: 'assert', label: '断言检查' },
  ],
  // ===== 本轮补充：剩余枚举字段 =====
  'on_message:match': [
    { value: 'any', label: '任意消息' },
    { value: 'at_me', label: '@机器人' },
    { value: 'command', label: '指令匹配' },
    { value: 'keyword', label: '关键词' },
    { value: 'regex', label: '正则匹配' },
  ],
  'http_request:response_format': [
    { value: 'auto', label: '自动' },
    { value: 'json', label: 'JSON' },
    { value: 'text', label: '文本' },
    { value: 'binary', label: '二进制' },
  ],
  'file_op:write_mode': [
    { value: 'json', label: 'JSON' },
    { value: 'text', label: '文本' },
  ],
  'time_op:unit': [
    { value: 'seconds', label: '秒' },
    { value: 'minutes', label: '分' },
    { value: 'hours', label: '时' },
    { value: 'days', label: '天' },
  ],
  'get_context:part_mode': [
    { value: 'at', label: '@某人' },
    { value: 'image', label: '图片' },
    { value: 'file', label: '文件' },
    { value: 'reply', label: '引用回复' },
    { value: 'record', label: '语音' },
    { value: 'video', label: '视频' },
    { value: 'json', label: 'JSON' },
  ],
  'message_op:music_type': [
    { value: '163', label: '网易云' },
    { value: 'qq', label: 'QQ音乐' },
    { value: 'custom', label: '自定义' },
  ],
  'variable_merge:mode': [
    { value: 'dict', label: '合并为字典' },
    { value: 'list', label: '合并为列表' },
    { value: 'concat', label: '拼接列表' },
  ],
  'query:mode': [
    { value: 'list', label: '列出所有' },
    { value: 'sort', label: '按值排序' },
    { value: 'filter', label: '条件过滤' },
    { value: 'aggregate', label: '聚合统计' },
  ],
  'query:scope': [
    { value: 'user', label: '按用户' },
    { value: 'group', label: '按群' },
    { value: 'global', label: '全局' },
  ],
  'query:order': [
    { value: 'asc', label: '升序' },
    { value: 'desc', label: '降序' },
  ],
  'query:sort_by': [
    { value: 'key', label: '按键名' },
    { value: 'value', label: '按值' },
  ],
  'group_op:sub_type': [
    { value: 'add', label: '加群邀请' },
    { value: 'approve', label: '他人申请' },
  ],
  'send_message:target_type': [
    { value: '', label: '回复当前会话' },
    { value: 'user', label: '私聊推送' },
    { value: 'group', label: '群推送' },
  ],
}
