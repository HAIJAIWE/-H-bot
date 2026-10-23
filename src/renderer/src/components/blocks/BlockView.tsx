// src/renderer/src/components/blocks/BlockView.tsx
import { useMemo, useState, useEffect, useRef, memo } from 'react'
import type { FlowNode, FlowEdge } from '@shared/types/flow'
import { findSpec } from '../../lib/nodeCatalog'
import { isControlPortName, isSubflowDefine } from '../../lib/executionOrder'
import { findBinding, collectBindingOptions, getRelevantOutputIds } from './DataBindingSelect'
import { createEdge } from '../../lib/nodeFactory'
import { useFlowStore } from '../../stores/flowStore'
import { useProjectStore } from '../../stores/projectStore'
import { getNodeIcon } from './iconMap'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button'
import { Dropdown } from '../ui/Dropdown'
import { inputSm } from '../ui/inputStyles'

// ---------------------------------------------------------------
// 内联编辑字段定义 — 选中节点时直接在积木块上编辑最常用参数
// ---------------------------------------------------------------

interface InlineField {
  key: string
  label: string
  type: 'text' | 'select' | 'number' | 'textarea' | 'subflow_select'
  options?: Array<{ value: string; label: string }>
  placeholder?: string
  step?: number
  showWhen?: (config: Record<string, unknown>) => boolean
}

const INLINE_FIELDS: Record<string, InlineField[]> = {
  on_message: [
    { key: 'match', label: '匹配', type: 'select', options: [
      { value: 'any', label: '任意' }, { value: 'at_me', label: '@我' },
      { value: 'command', label: '指令' }, { value: 'keyword', label: '关键词' },
    ]},
    { key: 'command', label: '指令', type: 'text', placeholder: '签到',
      showWhen: (c) => c.match === 'command' },
    { key: 'prefix', label: '前缀', type: 'text', placeholder: '/',
      showWhen: (c) => c.match === 'command' },
    { key: 'message_type', label: '范围', type: 'select', options: [
      { value: 'any', label: '全部' }, { value: 'group', label: '群' }, { value: 'private', label: '私聊' },
    ]},
  ],
  schedule: [
    { key: 'cron', label: 'Cron', type: 'text', placeholder: '0 * * * *' },
  ],
  send_message: [
    { key: 'mode', label: '格式', type: 'select', options: [
      { value: 'text', label: '文本' }, { value: 'keyboard', label: '按钮' },
      { value: 'segment', label: '消息段' }, { value: 'forward', label: '转发' },
    ]},
    { key: 'text', label: '内容', type: 'textarea', placeholder: '回复内容...',
      showWhen: (c) => !c.mode || c.mode === 'text' },
    { key: 'markdown', label: 'MD', type: 'textarea', placeholder: '# 标题\n正文...',
      showWhen: (c) => c.mode === 'keyboard' },
  ],
  get_context: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'user_id', label: '用户ID' }, { value: 'group_id', label: '群ID' },
      { value: 'message_text', label: '消息文本' }, { value: 'raw_message', label: '原始消息' },
    ]},
  ],
  persistent_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'save', label: '保存' }, { value: 'load', label: '读取' },
      { value: 'delete', label: '删除' }, { value: 'exists', label: '检查' },
      { value: 'load_or_default', label: '读/默认' }, { value: 'increment', label: '自增' },
      { value: 'list_append', label: '追加' },
    ]},
    { key: 'key', label: '键名', type: 'text', placeholder: '金币' },
    { key: 'scope', label: '范围', type: 'select', options: [
      { value: 'user', label: '按用户' }, { value: 'group', label: '按群' }, { value: 'global', label: '全局' },
    ]},
  ],
  if_branch: [
    { key: 'expression', label: '条件', type: 'text', placeholder: '值 >= 100' },
  ],
  format_text: [
    { key: 'template', label: '模板', type: 'textarea', placeholder: '你好，{var1}！' },
  ],
  expression_eval: [
    { key: 'expression', label: '表达式', type: 'text', placeholder: '变量1 + 变量2' },
  ],
  random: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'int', label: '整数' }, { value: 'choice', label: '抽取' },
      { value: 'weighted', label: '加权' },
    ]},
    { key: 'min', label: '最小', type: 'number', placeholder: '1',
      showWhen: (c) => c.mode === 'int' },
    { key: 'max', label: '最大', type: 'number', placeholder: '100',
      showWhen: (c) => c.mode === 'int' },
  ],
  delay: [
    { key: 'seconds', label: '秒', type: 'number', placeholder: '1' },
  ],
  time_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'now', label: '当前时间' }, { value: 'is_today', label: '是否今天' },
      { value: 'date_diff', label: '日期差' },
    ]},
  ],
  http_request: [
    { key: 'method', label: '方法', type: 'select', options: [
      { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' },
    ]},
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
  ],
  llm_chat: [
    { key: 'model', label: '模型', type: 'text', placeholder: 'gpt-4o-mini' },
    { key: 'system_prompt', label: '提示', type: 'textarea', placeholder: '你是一个助手...' },
    { key: 'temperature', label: '温度', type: 'number', placeholder: '0.7', step: 0.1 },
  ],
  set_variable: [
    { key: 'var_name', label: '变量名', type: 'text', placeholder: '变量' },
  ],
  json_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'get', label: '提取' }, { value: 'set', label: '设置' },
      { value: 'delete', label: '删除' }, { value: 'merge', label: '合并' },
    ]},
  ],
  // —— 扩展节点内联字段 ——
  on_button_click: [
    { key: 'button_id', label: '按钮ID', type: 'text', placeholder: '留空=所有按钮' },
  ],
  query: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'list', label: '列表' }, { value: 'get', label: '单条' },
      { value: 'count', label: '计数' },
    ]},
    { key: 'table', label: '表名', type: 'text', placeholder: '玩家' },
  ],
  wait_input: [
    { key: 'timeout', label: '超时', type: 'number', placeholder: '60' },
  ],
  loop: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'times', label: '次数' }, { value: 'iterate', label: '遍历' },
      { value: 'while', label: '条件' },
    ]},
    { key: 'count', label: '次数', type: 'number', placeholder: '3',
      showWhen: (c) => c.mode === 'times' },
  ],
  switch_case: [
    { key: 'default', label: '默认', type: 'text', placeholder: '默认值' },
  ],
  system_log: [
    { key: 'level', label: '级别', type: 'select', options: [
      { value: 'info', label: 'info' }, { value: 'warning', label: 'warning' },
      { value: 'error', label: 'error' }, { value: 'debug', label: 'debug' },
    ]},
    { key: 'message', label: '内容', type: 'text', placeholder: '日志内容...' },
  ],
  error_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'throw', label: '抛出' }, { value: 'assert', label: '断言' },
    ]},
    { key: 'message', label: '信息', type: 'text', placeholder: '错误信息...' },
  ],
  regex_extract: [
    { key: 'pattern', label: '正则', type: 'text', placeholder: '提取数字 (\\d+)' },
  ],
  timer: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'start', label: '开始' }, { value: 'stop', label: '停止' },
      { value: 'elapsed', label: '用时' },
    ]},
    { key: 'timer_id', label: 'ID', type: 'text', placeholder: '战斗计时' },
  ],
  check_permission: [
    { key: 'role', label: '权限', type: 'select', options: [
      { value: 'admin', label: '管理员' }, { value: 'owner', label: '群主' },
      { value: 'super_admin', label: '超级管理员' }, { value: 'member', label: '成员' },
    ]},
  ],
  db_write: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'select', label: '查询' }, { value: 'insert', label: '插入' },
      { value: 'update', label: '更新' }, { value: 'delete', label: '删除' },
    ]},
    { key: 'table', label: '表名', type: 'text', placeholder: '玩家' },
  ],
  api_call: [
    { key: 'action', label: '动作', type: 'text', placeholder: '发送消息' },
  ],
  group_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'ban', label: '禁言' }, { value: 'kick', label: '踢出' },
      { value: 'set_card', label: '名片' }, { value: 'set_title', label: '头衔' },
      { value: 'mute_all', label: '全员禁言' },
    ]},
  ],
  file_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'read', label: '读取' }, { value: 'write', label: '写入' },
      { value: 'delete', label: '删除' }, { value: 'exists', label: '检查' },
      { value: 'copy', label: '复制' }, { value: 'move', label: '移动' },
    ]},
    { key: 'file_path', label: '路径', type: 'text', placeholder: '数据/配置.json' },
  ],
  message_op: [
    { key: 'segment_type', label: '类型', type: 'select', options: [
      { value: 'at', label: '@某人' }, { value: 'image', label: '图片' },
      { value: 'face', label: '表情' }, { value: 'record', label: '语音' },
      { value: 'reply', label: '回复' },
    ]},
  ],
  data_table: [
    { key: 'tableName', label: '表名', type: 'text', placeholder: '玩家' },
  ],
  admin_panel: [
    { key: 'label', label: '名称', type: 'text', placeholder: '玩家管理' },
  ],
  list_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'append', label: '追加' }, { value: 'remove', label: '删除' },
      { value: 'size', label: '长度' }, { value: 'get', label: '取元素' },
      { value: 'sort', label: '排序' }, { value: 'reverse', label: '反转' },
      { value: 'unique', label: '去重' }, { value: 'merge', label: '合并' },
    ]},
  ],
  flow_control: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'return', label: '返回' }, { value: 'break', label: '跳出' },
    ]},
  ],
  retry_exec: [
    { key: 'max_retries', label: '次数', type: 'number', placeholder: '3' },
    { key: 'delay', label: '间隔', type: 'number', placeholder: '1' },
  ],
  edit_msg: [
    { key: 'new_text', label: '新文本', type: 'text', placeholder: '编辑后的内容' },
  ],
  memory_op: [
    { key: 'mode', label: '模式', type: 'select', options: [
      { value: 'add', label: '添加' }, { value: 'search', label: '搜索' },
      { value: 'clear', label: '清空' },
    ]},
  ],
  embedding: [
    { key: 'text', label: '文本', type: 'textarea', placeholder: '要向量化的文本' },
  ],
  subflow_define: [
    { key: 'subflow_name', label: '名称', type: 'text', placeholder: '战斗子流程' },
  ],
  subflow_call: [
    { key: 'subflow_id', label: '子流程', type: 'subflow_select' },
  ],
}

/** 自动增高 textarea：内容多时自动扩展高度，最大 5 行 */
function AutoTextarea({ value, onChange, placeholder, onClick, onKeyDown }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onClick?: (e: React.MouseEvent) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value])
  const cls = `w-full ${inputSm} placeholder:text-zinc-600 resize-none`
  return (
    <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      aria-label={placeholder} rows={2} className={cls} onClick={onClick} onKeyDown={onKeyDown} />
  )
}

/** 子流程选择：从 store 动态获取所有 subflow_define 节点 */
function SubflowSelect({ value, onChange }: {
  value: string
  onChange: (v: string) => void
}) {
  const options = useFlowStore((s) =>
    s.nodes
      .filter((n) => isSubflowDefine(n))
      .map((n) => ({
        value: n.id,
        label: String(n.data.config.subflow_name || n.id),
      }))
  )
  const cls = `w-full ${inputSm} cursor-pointer`
  return (
    <Dropdown
      value={value}
      onChange={(v) => onChange(v)}
      ariaLabel="子流程选择"
      options={[
        { value: '', label: '— 选择子流程 —' },
        ...options,
      ]}
      placeholder={options.length === 0 ? '（无可用子流程，请先创建）' : '选择子流程'}
      className={cls}
    />
  )
}

function InlineFieldEditor({ field, value, onChange }: {
  field: InlineField
  value: unknown
  onChange: (v: string | number) => void
}) {
  const strValue = value !== undefined && value !== null ? String(value) : ''
  const cls = `w-full ${inputSm} placeholder:text-zinc-600`

  if (field.type === 'subflow_select') {
    return <SubflowSelect value={strValue} onChange={(v) => onChange(v)} />
  }
  if (field.type === 'select') {
    return (
      <Dropdown
        value={strValue}
        onChange={(v) => onChange(v)}
        ariaLabel={field.label}
        options={field.options ?? []}
        className="cursor-pointer"
      />
    )
  }
  if (field.type === 'textarea') {
    return (
      <AutoTextarea
        value={strValue}
        onChange={(v) => onChange(v)}
        placeholder={field.placeholder}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      />
    )
  }
  if (field.type === 'number') {
    return (
      <input type="number" value={strValue} onChange={(e) => onChange(Number(e.target.value) || 0)}
        placeholder={field.placeholder} step={field.step} className={cls}
        aria-label={field.label}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()} />
    )
  }
  return (
    <input type="text" value={strValue} onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder} className={cls}
      aria-label={field.label}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()} />
  )
}

export const BLOCK_COLORS: Record<string, string> = {
  trigger: 'border-l-zinc-400 bg-zinc-800/40',
  action: 'border-l-zinc-400 bg-zinc-800/40',
  logic: 'border-l-zinc-400 bg-zinc-800/40',
  data: 'border-l-zinc-400 bg-zinc-800/40',
  ai: 'border-l-zinc-400 bg-zinc-800/40',
  custom: 'border-l-zinc-400 bg-zinc-800/40',
}

/**
 * 按模式过滤输出端口：只显示当前模式实际产出的输出，减少视觉噪音。
 * 已连接的端口即使不在过滤列表中也会保留（避免丢失连线信息）。
 *
 * 优先使用 catalog 中 Port.showWhen（声明式，单一数据源）；
 * 若节点输出未定义 showWhen，回退到 MODE_OUTPUT_FILTER 硬编码表。
 */
function filterOutputsByMode<T extends { id: string; showWhen?: (config: Record<string, unknown>) => boolean }>(
  nodeKind: string,
  config: Record<string, unknown>,
  allOutputs: T[],
  edges: FlowEdge[],
  nodeId: string
): T[] {
  // 已连接的端口即使不在过滤列表中也保留
  const connectedIds = new Set(
    edges.filter((e) => e.source === nodeId).map((e) => e.sourcePort)
  )

  // 优先使用 spec 中的 showWhen 条件（声明式，单一数据源）
  const hasShowWhen = allOutputs.some((p) => typeof p.showWhen === 'function')
  if (hasShowWhen) {
    return allOutputs.filter((p) => {
      const visible = typeof p.showWhen === 'function' ? p.showWhen(config) : true
      return visible || connectedIds.has(p.id)
    })
  }

  // 回退到 MODE_OUTPUT_FILTER（兼容未定义 showWhen 的节点）
  const relevantIds = getRelevantOutputIds(nodeKind, config)
  if (!relevantIds) return allOutputs
  return allOutputs.filter((p) => relevantIds.includes(p.id) || connectedIds.has(p.id))
}

/** 节点序号背景色：按节点 type 区分，便于在长链中快速识别节点类别 */
export const STEP_NUMBER_COLORS: Record<string, string> = {
  trigger: 'bg-blue-600 text-blue-50',
  action: 'bg-emerald-600 text-emerald-50',
  logic: 'bg-amber-600 text-amber-50',
  data: 'bg-purple-600 text-purple-50',
  ai: 'bg-pink-600 text-pink-50',
  custom: 'bg-zinc-700 text-zinc-200',
}

/** 数据类型颜色映射：端口标签着色，一眼看出数据类型兼容性 */
const DATA_TYPE_COLORS: Record<string, string> = {
  string: 'text-blue-400',
  number: 'text-emerald-400',
  boolean: 'text-amber-400',
  list: 'text-purple-400',
  object: 'text-pink-400',
  json: 'text-pink-400',
  event: 'text-cyan-400',
  any: 'text-zinc-400',
  datetime: 'text-orange-400',
}

function dataTypeColor(dataType?: string): string {
  return DATA_TYPE_COLORS[dataType ?? 'any'] ?? 'text-zinc-400'
}

/** 数据类型中文标签：比英文更直观 */
const DATA_TYPE_LABELS: Record<string, string> = {
  string: '文本',
  number: '数字',
  boolean: '布尔',
  list: '列表',
  object: '对象',
  json: 'JSON',
  event: '事件',
  any: '任意',
  datetime: '时间',
}

function dataTypeLabel(dataType?: string): string {
  return DATA_TYPE_LABELS[dataType ?? 'any'] ?? dataType ?? '任意'
}

/** 构造端口 hover 提示文本：数据类型 + 描述 */
function portTooltip(port: { name: string; dataType?: string; description?: string; required?: boolean }): string {
  const parts: string[] = [port.name]
  parts.push(`[${dataTypeLabel(port.dataType)}${port.required ? ' · 必填' : ''}]`)
  if (port.description) parts.push(port.description)
  return parts.join(' — ')
}

/** 折叠态的核心参数摘要：覆盖所有节点类型。
 *  Stage 2 起 CanvasNode 复用此函数生成节点摘要。 */
export function formatSummary(node: FlowNode): string {
  const cfg = node.data.config
  switch (node.data.nodeKind) {
    // 触发器
    case 'on_message': {
      const match = cfg.match ?? 'any'
      if (match === 'command') return `/${cfg.command ?? ''}`
      if (match === 'at_me') return '@机器人'
      if (match === 'regex') return cfg.pattern ? `/${cfg.pattern}/${cfg.flags ?? ''}` : '未配置'
      return `匹配: ${match}`
    }
    case 'on_request': return '加群/好友请求'
    case 'on_notice': return '通知事件'
    case 'on_button_click': return cfg.button_data ? `按钮: ${cfg.button_data}` : '任意按钮'
    case 'schedule': return cfg.cron ? `定时: ${cfg.cron}` : cfg.interval_seconds != null ? `定时: ${cfg.interval_seconds}s` : '定时: 未配置'

    // 动作
    case 'send_message': {
      const m = cfg.mode ?? 'text'
      if (m === 'keyboard') return `按钮UI: "${String(cfg.markdown || '').slice(0, 20)}"`
      if (m === 'segment') return `消息段: ${cfg.segments ? '已配置' : '未配置'}`
      if (m === 'forward') return `合并转发: ${cfg.messages ? '已配置' : '未配置'}`
      return `"${String(cfg.text || cfg.message || '').slice(0, 25)}"`
    }
    case 'recall': return '撤回消息'
    case 'edit_msg': return `"${String(cfg.new_text || '').slice(0, 25)}"`

    // 逻辑
    case 'if_branch': return String(cfg.expression || '条件判断')
    case 'delay': return `${cfg.seconds ?? 0}s`
    case 'set_variable': return `${cfg.var_name ?? '未命名'} = ?`
    case 'loop': {
      const mode = cfg.mode ?? 'times'
      if (mode === 'iterate') return '遍历列表'
      if (mode === 'while') return `条件循环 (max=${cfg.max_iterations ?? 1000})`
      return `循环 ${cfg.count ?? 0}次`
    }

    // 数学/表达式
    case 'expression_eval': {
      if (cfg.mode === 'formulas') {
        const formulas = cfg.formulas as Array<{ name: string }> | undefined
        return formulas && formulas.length > 0 ? `多公式: ${formulas.map((f) => f.name).filter(Boolean).join(', ')}` : '多公式批量'
      }
      return `"${String(cfg.expression || '').slice(0, 30)}"`
    }
    case 'random': return cfg.mode === 'int' ? `[${cfg.min}, ${cfg.max}]` : cfg.mode === 'weighted' ? '权重随机' : '随机选择'

    // 文本
    case 'format_text': return `"${String(cfg.template || '').slice(0, 30)}"`
    case 'list_op': return `列表: ${cfg.mode}`

    // 持久化
    case 'persistent_op': return `持久化: ${cfg.mode ?? 'save'} · ${cfg.key}`

    // 时间
    case 'time_op': return `时间: ${cfg.mode ?? 'now'}`

    // JSON 操作（统一节点）
    case 'json_op': return `JSON: ${cfg.mode ?? 'get'}`

    // 上下文
    case 'get_context': return `上下文: ${cfg.mode ?? 'user_id'}`

    // 逻辑
    case 'switch_case': return `多分支: ${cfg.default ?? 'default'}`

    // 网络
    case 'http_request': return `${cfg.method} ${String(cfg.url || '').slice(0, 20)}`

    // AI
    case 'llm_chat': return `${cfg.model ?? 'LLM'} 温度=${cfg.temperature ?? 0.7}`
    case 'ai_tool_call': return 'AI工具调用'
    case 'embedding': return `"${String(cfg.text || '').slice(0, 20)}" → 向量`
    case 'memory_op': return `记忆: ${cfg.mode ?? 'add'}`

    // 群管（统一节点）
    case 'group_op': return `群管: ${cfg.mode ?? 'ban'}`

    // 构造消息段（不发送）
    case 'message_op': return `消息段: ${cfg.segment_type ?? 'at'}`

    // 文件操作（统一节点）
    case 'file_op': return `文件: ${cfg.mode ?? 'read'}`

    // 数据库
    case 'query': return `查询: ${cfg.mode ?? 'list'}`
    case 'db_write': return `DB: ${cfg.mode ?? 'insert'} → ${cfg.table || '?'}`

    // API 调用
    case 'api_call': return `API: ${cfg.action || '?'}`

    // 数据表/面板（声明性）
    case 'data_table': return `表: ${cfg.tableName || '未命名'}`
    case 'admin_panel': return `面板: ${cfg.label || cfg.panelId || '未命名'}`

    // 控制流
    case 'flow_control': return cfg.mode === 'return' ? '返回' : '跳出循环'
    case 'error_op': return cfg.mode === 'throw' ? `抛出: ${String(cfg.message || '').slice(0, 20)}` : `断言: ${cfg.message ?? '断言失败'}`
    case 'parallel_exec': return '并行执行'
    case 'try_catch': return '异常捕获'
    case 'wait_input': return cfg.expected_pattern ? `等待回复 (校验, timeout=${cfg.timeout ?? 60}s)` : `等待回复 (timeout=${cfg.timeout ?? 60}s)`

    // 权限
    case 'check_permission': return `权限: ${cfg.role ?? 'admin'}`

    // 子流程
    case 'subflow_define': return `定义: ${cfg.subflow_name || '未命名'}`
    case 'subflow_call': return '调用子流程'

    // 正则提取
    case 'regex_extract': return cfg.pattern ? `/${cfg.pattern}/` : '未配置'

    // 控制流/工具
    case 'retry_exec': return `重试 ×${cfg.max_retries ?? 3}`
    case 'timer': return `计时: ${cfg.mode ?? 'start'}`
    case 'system_log': return `[${cfg.level ?? 'info'}] ${String(cfg.message || '').slice(0, 20)}`

    default: return ''
  }
}

interface BlockViewProps {
  node: FlowNode
  edges: FlowEdge[]
  upstreamNodes: FlowNode[]
  isSelected: boolean
  isExpanded: boolean  // 保留接口兼容，但不再渲染内联展开态
  canMoveUp: boolean
  canMoveDown: boolean
  stepNumber?: number
  onSelect: () => void
  onToggleExpand: () => void  // 改为打开抽屉
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  /** 当前被悬停高亮的上游节点 ID（来自数据来源预览的悬停） */
  highlightedNodeId?: string | null
  /** 悬停数据来源预览行时通知父组件高亮对应上游节点 */
  onHoverSource?: (nodeId: string | null) => void
  /** 当前被输出端口悬停高亮的下游节点 ID 列表（来自输出端口标签悬停） */
  highlightedTargetIds?: string[] | null
  /** 悬停输出端口标签时通知父组件高亮对应下游节点 */
  onHoverTarget?: (nodeIds: string[] | null) => void
  /** 右键节点：打开上下文菜单 */
  onContextMenu?: (node: FlowNode, x: number, y: number) => void
  /** Ctrl+点击多选切换 */
  onMultiSelect?: (id: string) => void
  /** 是否处于多选集合中 */
  isMultiSelected?: boolean
  /** 跳转高亮：匹配的节点会闪烁高亮并滚动到可见区域 */
  focusNodeId?: string | null
  /** subflow_call 节点点击跳转按钮：跳转到对应的 subflow_define */
  onJumpToSubflow?: (defineId: string) => void
}

export const BlockView = memo(function BlockView({
  node,
  edges,
  upstreamNodes,
  isSelected,
  isExpanded: _isExpanded,
  canMoveUp,
  canMoveDown,
  stepNumber,
  onSelect,
  onToggleExpand,
  onMoveUp,
  onMoveDown,
  onDelete,
  highlightedNodeId,
  onHoverSource,
  highlightedTargetIds,
  onHoverTarget,
  onContextMenu,
  onMultiSelect,
  isMultiSelected,
  focusNodeId,
  onJumpToSubflow,
}: BlockViewProps) {
  const spec = useMemo(() => findSpec(node.data.nodeKind), [node.data.nodeKind])
  const NodeIcon = getNodeIcon(node.data.nodeKind)
  const projectPath = useProjectStore((s) => s.currentProject?.path ?? '')

  // 数据模板状态已移除：原实现 setTemplate 后从未被任何 UI 读取，每次渲染 persistent_op
  // 节点都会发起无用的 IPC 请求。如后续需要"key 字段建议"功能，应在此处补充 UI 消费逻辑。

  const colorClass = BLOCK_COLORS[node.type] ?? BLOCK_COLORS.custom
  const isTrigger = node.type === 'trigger'
  const isBranch = node.data.nodeKind === 'if_branch' || node.data.nodeKind === 'loop'
  const summary = formatSummary(node)

  // 仅订阅本节点相关的 boolean，避免 N+1 重渲染
  const isExecuting = useFlowStore((s) => s.executingNodeIds.includes(node.id))
  const hasError = useFlowStore((s) => s.errorNodeIds.includes(node.id))
  const isDone = useFlowStore((s) => s.doneNodeIds.includes(node.id))
  const nodeErrors = useFlowStore((s) => s.nodeErrors[node.id])

  // 执行状态：done 表示已成功完成（绿色），error 表示运行时出错（红色）
  const executionStatus: 'idle' | 'running' | 'done' | 'error' = hasError ? 'error' : isExecuting ? 'running' : isDone ? 'done' : 'idle'

  // 是否有 'error' 输出端口
  const hasErrorOutput = useMemo(() => {
    const outputs = spec?.outputs ?? node.data.outputs
    return outputs.some((p) => p.kind === 'data' && p.id === 'error')
  }, [spec, node.data.outputs])

  const dataInputs = useMemo(() => {
    const inputs = spec?.inputs ?? node.data.inputs
    return inputs.filter((p) => p.kind === 'data')
  }, [spec, node.data.inputs])

  const dataOutputs = useMemo(() => {
    const outputs = spec?.outputs ?? node.data.outputs
    const allDataOutputs = outputs.filter((p) => p.kind === 'data')
    const filtered = filterOutputsByMode(node.data.nodeKind, node.data.config, allDataOutputs, edges, node.id)
    // 排序：主要结果在前，error 在最后，其余按原始顺序
    const PRIORITY: Record<string, number> = { result: 0, success: 1, error: 99 }
    return [...filtered].sort((a, b) => (PRIORITY[a.id] ?? 50) - (PRIORITY[b.id] ?? 50))
  }, [spec, node.data.outputs, node.data.nodeKind, node.data.config, edges, node.id])

  // 统计已绑定的输入端口数
  const boundInputCount = useMemo(() => {
    return dataInputs.filter((p) => findBinding(edges, node.id, p.id)).length
  }, [dataInputs, edges, node.id])

  // 订阅 store 中的 nodes，确保 outputConnections 在节点标签变化时响应式更新
  const storeNodes = useFlowStore((s) => s.nodes)

  // 输出端口的连接目标信息 + 已连接数量（合并计算，避免重复遍历 edges）
  const { outputConnections, connectedOutputCount } = useMemo(() => {
    const map: Record<string, Array<{ nodeId: string; nodeLabel: string; portName: string }>> = {}
    let count = 0
    for (const edge of edges) {
      if (edge.source !== node.id) continue
      if (isControlPortName(edge.sourcePort)) continue
      count++
      const targetNode = storeNodes.find((n) => n.id === edge.target)
      if (!targetNode) continue
      const targetSpec = findSpec(targetNode.data.nodeKind)
      const targetInputs = targetSpec?.inputs ?? targetNode.data.inputs
      const targetPort = targetInputs.find((p) => p.id === edge.targetPort)
      if (!map[edge.sourcePort]) map[edge.sourcePort] = []
      map[edge.sourcePort].push({
        nodeId: targetNode.id,
        nodeLabel: targetNode.data.label,
        portName: targetPort?.name ?? edge.targetPort,
      })
    }
    return { outputConnections: map, connectedOutputCount: count }
  }, [edges, node.id, storeNodes])

  /**
   * 数据来源预览：遍历所有数据输入端口，构造预览条目。
   * - 已绑定：绿色圆点 + "端口名 ← 来源节点 · 来源端口"
   * - 未绑定且必填：琥珀色圆点 + "端口名 · 未绑定"
   * - 未绑定且可选：跳过（避免多输入节点造成噪音）
   */
  const previewBindings = useMemo(() => {
    type PreviewBinding = {
      portId: string
      portName: string
      portDataType?: string
      portDescription?: string
      bound: boolean
      required: boolean
      sourceNodeId?: string
      sourceLabel?: string
      sourcePortName?: string
    }
    const result: PreviewBinding[] = []
    for (const port of dataInputs) {
      const edge = findBinding(edges, node.id, port.id)
      if (edge) {
        const srcNode = upstreamNodes.find((n) => n.id === edge.source)
        if (srcNode) {
          const srcSpec = findSpec(srcNode.data.nodeKind)
          const srcOutputs = srcSpec?.outputs ?? srcNode.data.outputs
          const srcPort = srcOutputs.find((p) => p.id === edge.sourcePort)
          result.push({
            portId: port.id,
            portName: port.name,
            portDataType: port.dataType,
            portDescription: port.description,
            bound: true,
            required: !!port.required,
            sourceNodeId: srcNode.id,
            sourceLabel: srcNode.data.label,
            sourcePortName: srcPort?.name ?? edge.sourcePort,
          })
          continue
        }
      }
      // 未绑定：仅必填端口才显示（琥珀色提示）
      if (port.required) {
        result.push({
          portId: port.id,
          portName: port.name,
          portDataType: port.dataType,
          portDescription: port.description,
          bound: false,
          required: true,
        })
      }
    }
    return result
  }, [dataInputs, edges, node.id, upstreamNodes])

  // 是否被上游预览悬停高亮
  const isHighlighted = highlightedNodeId === node.id
  // 是否被输出端口悬停高亮（作为下游目标）—— 用 Set 提升查找性能
  const highlightedTargetSet = useMemo(() => highlightedTargetIds ? new Set(highlightedTargetIds) : null, [highlightedTargetIds])
  const isHighlightedAsTarget = highlightedTargetSet?.has(node.id) ?? false
  // 是否为跳转高亮（subflow 跳转目标）
  const isFocused = focusNodeId === node.id
  // ref 用于跳转时滚动到可见区域
  const focusRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isFocused && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isFocused])
  // subflow_call 节点：读取 subflow_id 配置，用于跳转按钮
  const isSubflowCall = node.data.nodeKind === 'subflow_call'
  const subflowDefineId = isSubflowCall ? (node.data.config.subflow_id as string | undefined) : undefined

  // subflow_call 参数提示：精准订阅被调用的 subflow_define 节点（避免订阅整个 nodes 数组导致全量重渲染）
  const subflowDefineNode = useFlowStore((s) => {
    if (node.data.nodeKind !== 'subflow_call') return null
    const subflowId = node.data.config.subflow_id as string | undefined
    if (!subflowId) return null
    return s.nodes.find((n) => n.id === subflowId) ?? null
  })
  const subflowParamsHint = useMemo(() => {
    if (!subflowDefineNode) return null
    try {
      const raw = subflowDefineNode.data.config.params
      const params = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!Array.isArray(params) || params.length === 0) return null
      return params.map((p: { name: string; type: string }) => `${p.name}:${p.type}`).join(', ')
    } catch {
      return null
    }
  }, [subflowDefineNode])

  // 快速绑定：在流程中直接绑定数据来源，无需打开抽屉
  const addEdge = useFlowStore((s) => s.addEdge)
  const removeEdge = useFlowStore((s) => s.removeEdge)
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig)

  // 内联编辑字段：当前节点类型支持的快速编辑字段
  const inlineFields = useMemo(() => INLINE_FIELDS[node.data.nodeKind] ?? [], [node.data.nodeKind])
  const [bindingPort, setBindingPort] = useState<string | null>(null)
  const bindingOptions = useMemo(
    () => collectBindingOptions(upstreamNodes),
    [upstreamNodes]
  )

  return (
    <div
      ref={focusRef}
      role="button"
      tabIndex={0}
      aria-label={node.data.label || node.data.nodeKind}
      className={`group relative rounded-lg border border-l-4 ${colorClass} ${
        isFocused ? 'ring-4 ring-purple-400 animate-pulse'
        : isHighlighted ? 'ring-2 ring-emerald-400 border-emerald-500/50'
        : isHighlightedAsTarget ? 'ring-2 ring-amber-400 border-amber-500/50'
        : isMultiSelected ? 'ring-2 ring-blue-500'
        : isSelected ? 'ring-2 ring-blue-400'
        : ''
      } ${
        nodeErrors?.length ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-zinc-700'
      } transition-all cursor-pointer hover:border-zinc-600`}
      onClick={(e) => {
        // Ctrl/Cmd+点击：切换多选，不打开抽屉
        if ((e.ctrlKey || e.metaKey) && onMultiSelect) {
          onMultiSelect(node.id)
          return
        }
        onSelect(); onToggleExpand()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(); onToggleExpand()
        }
      }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(node, e.clientX, e.clientY)
        }
      }}
    >
      {/* 折叠态（唯一态）：紧凑显示，点击打开抽屉 */}
      <div
        className="px-3 py-2.5 flex items-center gap-2.5"
        title={[
          `${node.data.label} (${node.data.nodeKind})`,
          spec?.group ? `分组: ${spec.group}` : '',
          spec?.description ? `说明: ${spec.description}` : '',
          summary ? `当前: ${summary}` : '',
          spec?.tags?.includes('composite') ? '类型: 组装节点（由原子节点组合）' : '',
          `节点ID: ${node.id}`,
        ].filter(Boolean).join('\n')}
      >
        {stepNumber !== undefined && (
          <span
            className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
              STEP_NUMBER_COLORS[node.type] ?? STEP_NUMBER_COLORS.custom
            }`}
          >
            {stepNumber}
          </span>
        )}
        <NodeIcon className="w-4 h-4 text-zinc-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-sm font-semibold text-zinc-200 truncate">{node.data.label}</div>
            {/* P1-2: 节点所属分组徽章，便于在长链中识别节点类别 */}
            {spec?.group && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 shrink-0 border border-zinc-700/60">
                {spec.group}
              </span>
            )}
            {/* P0-2: 组装节点标记，与原子节点区分 */}
            {spec?.tags?.includes('composite') && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 shrink-0 border border-violet-700/40"
                title="组装节点：由多个原子节点组合而成"
              >
                组装
              </span>
            )}
          </div>
          {summary && <div className="text-xs text-zinc-400 font-mono truncate" title={summary}>{summary}</div>}
          {/* subflow_call 参数提示：显示被调用子流程的参数名列表 */}
          {subflowParamsHint && (
            <div className="text-xs text-purple-300/70 mt-0.5">
              参数: {subflowParamsHint}
            </div>
          )}
          {/* 节点备注：用户为此节点填写的业务说明（优先于 catalog 通用描述显示） */}
          {node.data.description ? (
            <div className="text-xs text-amber-300/80 truncate" title={node.data.description}>
              📝 {node.data.description}
            </div>
          ) : spec?.description ? (
            <div className="text-xs text-zinc-500 truncate" title={spec.description}>
              {spec.description}
            </div>
          ) : null}
        </div>

        {/* 右侧状态徽章 */}
        <div className="flex items-center gap-1 shrink-0">
          {/* subflow_call 跳转按钮：点击跳转到对应的 subflow_define */}
          {isSubflowCall && subflowDefineId && onJumpToSubflow && (
            <Button
              variant="secondary"
              size="sm"
              className="bg-purple-900/50 text-purple-300 hover:bg-purple-800/60 border border-purple-700/40 px-1.5 py-0.5"
              title="跳转到子流程定义"
              onClick={(e) => {
                e.stopPropagation()
                onJumpToSubflow(subflowDefineId)
              }}
            >
              → 子流程
            </Button>
          )}
          {/* 执行状态指示点：idle(灰)/running(蓝脉动)/done(绿)/error(红) */}
          <span
            role="status"
            aria-label={
              executionStatus === 'running' ? '正在执行'
              : executionStatus === 'error' ? '执行出错'
              : executionStatus === 'done' ? '已成功完成'
              : '待执行'
            }
            className={`w-2.5 h-2.5 rounded-full ${
              executionStatus === 'running'
                ? 'bg-blue-400 animate-pulse'
                : executionStatus === 'error'
                ? 'bg-red-500'
                : executionStatus === 'done'
                ? 'bg-green-400'
                : 'bg-zinc-500'
            }`}
            title={
              executionStatus === 'running' ? '正在执行…'
              : executionStatus === 'error' ? '执行出错'
              : executionStatus === 'done' ? '已成功完成'
              : '待执行'
            }
          />

          {hasErrorOutput && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400"
              title="此节点可以输出错误信息，运行时可能失败"
            >
              ⚠️
            </span>
          )}
          {boundInputCount > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400"
              title={`${boundInputCount} 个输入已绑定上游`}
            >
              {boundInputCount}
            </span>
          )}
          {dataOutputs.length > 0 && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                connectedOutputCount > 0
                  ? 'bg-green-900/40 text-green-400'
                  : 'bg-zinc-800 text-zinc-500'
              }`}
              title={`输出端口: ${connectedOutputCount}/${dataOutputs.length} 已连接下游`}
            >
              {connectedOutputCount}/{dataOutputs.length}
            </span>
          )}
        </div>

        {/* 悬浮操作按钮 */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isTrigger && !isBranch && canMoveUp && (
            <Button
              variant="ghost"
              size="sm"
              className="w-6 h-6 p-0 hover:text-white"
              onClick={(e) => { e.stopPropagation(); onMoveUp() }}
              title="上移"
            >
              ▲
            </Button>
          )}
          {!isTrigger && !isBranch && canMoveDown && (
            <Button
              variant="ghost"
              size="sm"
              className="w-6 h-6 p-0 hover:text-white"
              onClick={(e) => { e.stopPropagation(); onMoveDown() }}
              title="下移"
            >
              ▼
            </Button>
          )}
          {!isTrigger && (
            <Button
              variant="danger"
              size="sm"
              className="w-6 h-6 p-0"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              title="删除"
            >
              ×
            </Button>
          )}
        </div>
      </div>

      {/* 内联参数编辑：选中时直接在积木块上编辑最常用参数 */}
      {isSelected && inlineFields.length > 0 && (
        <div
          className="border-t border-zinc-800 bg-blue-950/20"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 pt-1.5 pb-0.5">
            <div className="text-[10px] text-blue-400/70 uppercase tracking-wide flex items-center gap-1">
              <span>✎</span><span>快速编辑</span>
            </div>
          </div>
          <div className="px-3 pb-1.5 space-y-1.5 max-h-60 overflow-y-auto">
            {inlineFields.map((field) => {
              if (field.showWhen && !field.showWhen(node.data.config)) return null
              const value = node.data.config[field.key]
              return (
                <div key={field.key} className="flex items-start gap-2">
                  <label className="text-xs text-zinc-400 w-10 shrink-0 pt-1">{field.label}</label>
                  <div className="flex-1 min-w-0">
                    <InlineFieldEditor
                      field={field}
                      value={value}
                      onChange={(v) => updateNodeConfig(node.id, { [field.key]: v })}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full py-1 border-t border-zinc-800/50 text-zinc-500 hover:text-blue-400 hover:bg-transparent"
            onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
            leftIcon={<span>⚙</span>}
          >
            更多配置（数据绑定等）
          </Button>
        </div>
      )}

      {/* 选中态提示：无内联字段时显示节点描述 + 引导打开抽屉 */}
      {isSelected && inlineFields.length === 0 && (
        <div className="px-3 pb-1.5 pt-1 border-t border-zinc-800 bg-blue-950/20">
          {spec?.description && (
            <div className="text-[11px] text-zinc-400 leading-relaxed mb-1">{spec.description}</div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-400 hover:text-blue-300 hover:bg-transparent"
            onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
            leftIcon={<span>⚙</span>}
          >
            打开配置面板
          </Button>
        </div>
      )}

      {/* 数据来源预览：展示每个数据输入端口的绑定情况，支持流程中直接绑定 */}
      {previewBindings.length > 0 && (
        <div className="px-3 pb-1.5 -mt-0.5 space-y-1">
          <div className="text-[10px] text-zinc-600 flex items-center gap-0.5" title="◆ 蓝色菱形 = 数据输入端口（可绑定上游输出）；节点上下排列 = 控制流（执行顺序，自动连接）">
            <span className="text-blue-500">◆</span>
            <span>数据输入</span>
          </div>
          {previewBindings.map((b) =>
            b.bound ? (
              <div
                key={b.portId}
                className="text-xs text-zinc-500 flex items-center gap-1 cursor-help"
                onMouseEnter={() => b.sourceNodeId && onHoverSource?.(b.sourceNodeId)}
                onMouseLeave={() => onHoverSource?.(null)}
                title={`${portTooltip({ name: b.portName, dataType: b.portDataType, description: b.portDescription, required: b.required })} — 数据来源：${b.sourceLabel} · ${b.sourcePortName}（点击「更换」重新选择）`}
              >
                <span className="text-blue-500 text-[10px] shrink-0">◆</span>
                <span className={`shrink-0 font-medium ${dataTypeColor(b.portDataType)}`}>{b.portName}</span>
                <span className="text-zinc-600 shrink-0">←</span>
                <span className="truncate text-emerald-400">
                  {b.sourceLabel} · {b.sourcePortName}
                </span>
                {bindingOptions.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-blue-400 hover:bg-transparent px-2 py-0.5"
                    onClick={(e) => { e.stopPropagation(); setBindingPort(b.portId) }}
                    title="更换数据来源"
                  >
                    更换
                  </Button>
                )}
              </div>
            ) : (
              <div
                key={b.portId}
                className="text-xs text-amber-400 flex items-center gap-1"
                title={`${portTooltip({ name: b.portName, dataType: b.portDataType, description: b.portDescription, required: b.required })} — 尚未绑定数据来源`}
              >
                <span className="text-amber-500/70 text-[10px] shrink-0">◆</span>
                <span className={`shrink-0 font-medium ${dataTypeColor(b.portDataType)}`}>{b.portName}</span>
                <span className="text-amber-500/60 shrink-0">·</span>
                {bindingOptions.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="italic hover:underline cursor-pointer text-amber-400 hover:text-amber-300 hover:bg-transparent p-0"
                    onClick={(e) => { e.stopPropagation(); setBindingPort(b.portId) }}
                    title="点击绑定数据来源"
                  >
                    点击绑定
                  </Button>
                ) : (
                  <span className="italic text-amber-500/60">无可用来源</span>
                )}
              </div>
            )
          )}

          {/* 快速绑定下拉菜单 */}
          {bindingPort && (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              {/* 点击外部关闭的遮罩 */}
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => { e.stopPropagation(); setBindingPort(null) }}
              />
              <div className="absolute z-20 left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg max-h-40 overflow-y-auto">
                {bindingOptions.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-zinc-500">无可用上游数据</div>
                ) : (
                  bindingOptions.map((opt) => (
                    <Button
                      key={`${opt.nodeId}:${opt.portId}`}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-left px-2 py-1.5 truncate hover:bg-zinc-700 hover:text-zinc-100 text-zinc-300"
                      onClick={(e) => {
                        e.stopPropagation()
                        // 若已有旧绑定，先删除旧边
                        const oldEdge = findBinding(edges, node.id, bindingPort)
                        if (oldEdge) removeEdge(oldEdge.id)
                        // 创建新数据流边
                        addEdge(createEdge(opt.nodeId, opt.portId, node.id, bindingPort))
                        setBindingPort(null)
                      }}
                      title={opt.label}
                    >
                      {opt.label}
                    </Button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 输出端口标签：展示当前模式相关的数据输出端口，让下游知道可以接什么 */}
      {dataOutputs.length > 0 && (
        <div className="px-3 pb-1.5 -mt-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className="text-xs text-zinc-500 shrink-0 flex items-center gap-0.5"
              title="◆ 蓝色 = 数据端口（传递内容）；节点之间上下排列 = 控制流（执行顺序）"
            >
              <span className="text-blue-500">◆</span>
              <span>数据输出</span>
              <span className="text-zinc-700">→</span>
            </span>
            {dataOutputs.map((port) => {
              const conns = outputConnections[port.id]
              const isConnected = !!conns
              const tooltipSuffix = isConnected
                ? conns.length === 1
                  ? `\n→ ${conns[0].nodeLabel} · ${conns[0].portName}`
                  : `\n→ ${conns.map((c) => `${c.nodeLabel} · ${c.portName}`).join('\n→ ')}`
                : '\n到下游节点的输入端口绑定此输出'
              return (
                <span
                  key={port.id}
                  className={`text-xs font-medium px-1 rounded ${
                    isConnected
                      ? `bg-zinc-700/60 ${dataTypeColor(port.dataType)}`
                      : `bg-zinc-800/40 ${dataTypeColor(port.dataType)} opacity-70`
                  } ${isConnected ? 'cursor-pointer hover:ring-1 hover:ring-amber-400/50' : ''}`}
                  title={`${portTooltip(port)}${tooltipSuffix}`}
                  onMouseEnter={() => {
                    if (!conns) return
                    onHoverTarget?.(conns.map((c) => c.nodeId))
                  }}
                  onMouseLeave={() => onHoverTarget?.(null)}
                >
                  {port.name}
                  {isConnected && (
                    <span className="text-emerald-500 ml-0.5">
                      ✓{conns.length > 1 ? conns.length : ''}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
          {connectedOutputCount === 0 && (
            <div className="text-[10px] text-zinc-600 mt-0.5 italic">
              在下游节点的输入端口可选择这些输出
            </div>
          )}
        </div>
      )}

      {/* 错误提示区域 */}
      {nodeErrors && nodeErrors.length > 0 && (
        <div className="px-3 pb-2 -mt-0.5 space-y-1">
          {nodeErrors.map((err: string, i: number) => (
            <div key={i} className="text-xs text-red-400 flex items-start gap-1">
              <AlertTriangle aria-hidden="true" className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
