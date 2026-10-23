// src/renderer/src/lib/canvas/canvasConstants.ts
//
// 画布常量与节点卡片摘要。
//
// 双语：`formatSummary` 的文案全部走 i18n（`canvas.summary.*`）。它是**纯函数**，
// 调用方（CanvasNode）已订阅 locale，切语言后会重新调用它取到新语言的摘要。
import { t } from '../../i18n';
//
// 画布节点共享常量与摘要函数（从 BlockView.tsx 迁移）。
// 阶段 3：BlockView.tsx 已删除，这些常量由 CanvasNode / FlowOutline 等组件复用。

import type { FlowNode } from '@shared/types/flow';

/**
 * 节点尺寸常量（C1 修复：统一来源，避免 autoLayout/focusNode/RegionLayer 与 CanvasNode 不一致）。
 * - NODE_WIDTH = 320：扣子式卡片固定宽度，与 CanvasNode.style.width 一致
 * - NODE_HEIGHT_COLLAPSED = 80：估算平均高度（HEADER 30 + Inline 48 + Footer 20 ≈ 98，
 *   端口少时取 80 折中），供 ELK 布局/区域包围盒/focusNode 兜底用
 *   真实高度由 CanvasNode 按端口数+内联字段数自适应，这里只是估算
 */
export const NODE_WIDTH = 320;
export const NODE_HEIGHT_COLLAPSED = 80;

/**
 * 节点边框/背景配色：按节点 type 区分。
 * 底色保持深色中性（设计文档「深色中性、可见边框」偏好），
 * 左边界色条用类型色（trigger 蓝 / action 绿 / logic 橙 / data 紫 / ai 粉），
 * 与 Header 类型标签色一致，便于长流程中快速识别节点类别。
 */
export const BLOCK_COLORS: Record<string, string> = {
  trigger: 'border-l-blue-400 bg-zinc-800/40',
  action: 'border-l-emerald-400 bg-zinc-800/40',
  logic: 'border-l-amber-400 bg-zinc-800/40',
  data: 'border-l-purple-400 bg-zinc-800/40',
  ai: 'border-l-pink-400 bg-zinc-800/40',
  custom: 'border-l-zinc-400 bg-zinc-800/40',
};

/** 节点序号背景色：按节点 type 区分，便于在长流程中快速识别节点类别 */
export const STEP_NUMBER_COLORS: Record<string, string> = {
  trigger: 'bg-blue-600 text-blue-50',
  action: 'bg-emerald-600 text-emerald-50',
  logic: 'bg-amber-600 text-amber-50',
  data: 'bg-purple-600 text-purple-50',
  ai: 'bg-pink-600 text-pink-50',
  custom: 'bg-zinc-700 text-zinc-200',
};

/** 折叠态的核心参数摘要：覆盖所有节点类型。
 *  CanvasNode 用此生成节点底部摘要行。 */
export function formatSummary(node: FlowNode): string {
  const cfg = node.data.config;
  switch (node.data.nodeKind) {
    // 触发器
    case 'message_received': {
      const match = cfg.match ?? 'any';
      if (match === 'command') return `/${cfg.command ?? ''}`;
      if (match === 'at_me') return t('canvas.summary.atMe');
      if (match === 'regex') {
        return cfg.pattern
          ? `/${cfg.pattern}/${cfg.flags ?? ''}`
          : t('canvas.summary.notConfigured');
      }
      return t('canvas.summary.match', { value: String(match) });
    }
    case 'request_received':
      return t('canvas.summary.requestEvent');
    case 'notice_received':
      return t('canvas.summary.noticeEvent');
    case 'button_clicked':
      return cfg.button_data
        ? t('canvas.summary.button', { value: String(cfg.button_data) })
        : t('canvas.summary.anyButton');
    case 'scheduled':
      return cfg.cron
        ? t('canvas.summary.scheduledCron', { cron: String(cfg.cron) })
        : cfg.interval_seconds != null
          ? t('canvas.summary.scheduledInterval', { seconds: String(cfg.interval_seconds) })
          : t('canvas.summary.scheduledNotConfigured');

    // 动作
    case 'message_send': {
      const m = cfg.mode ?? 'text';
      if (m === 'keyboard') {
        return t('canvas.summary.keyboard', { text: String(cfg.markdown || '').slice(0, 20) });
      }
      if (m === 'segment') {
        return t(
          cfg.segments ? 'canvas.summary.segmentConfigured' : 'canvas.summary.segmentNotConfigured',
        );
      }
      if (m === 'forward') {
        return t(
          cfg.messages ? 'canvas.summary.forwardConfigured' : 'canvas.summary.forwardNotConfigured',
        );
      }
      return `"${String(cfg.text || cfg.message || '').slice(0, 25)}"`;
    }
    case 'message_recall':
      return t('canvas.summary.recallMessage');
    case 'message_edit':
      return `"${String(cfg.new_text || '').slice(0, 25)}"`;

    // 逻辑
    case 'branch_if':
      return String(cfg.expression || t('canvas.summary.condition'));
    case 'delay':
      return `${cfg.seconds ?? 0}s`;
    case 'variable_set':
      return t('canvas.summary.assign', {
        name: String(cfg.var_name ?? t('canvas.summary.unnamed')),
      });
    case 'loop': {
      const mode = cfg.mode ?? 'times';
      if (mode === 'iterate') return t('canvas.summary.iterate');
      if (mode === 'while') {
        return t('canvas.summary.whileLoop', { max: String(cfg.max_iterations ?? 1000) });
      }
      return t('canvas.summary.loopTimes', { count: String(cfg.count ?? 0) });
    }

    // 数学/表达式
    case 'expression_eval': {
      if (cfg.mode === 'formulas') {
        const formulas = cfg.formulas as Array<{ name: string }> | undefined;
        const names = (formulas ?? []).map((f) => f.name).filter(Boolean);
        return names.length > 0
          ? t('canvas.summary.multiFormula', { items: names.join(', ') })
          : t('canvas.summary.multiFormulaShort');
      }
      return `"${String(cfg.expression || '').slice(0, 30)}"`;
    }
    case 'random':
      return cfg.mode === 'int'
        ? `[${cfg.min}, ${cfg.max}]`
        : cfg.mode === 'weighted'
          ? t('canvas.summary.weightedRandom')
          : t('canvas.summary.randomChoice');

    // 文本
    case 'format_text':
      return `"${String(cfg.template || '').slice(0, 30)}"`;
    case 'list_op':
    case 'list_edit':
    case 'list_query':
    case 'list_transform':
    case 'list_combine':
      return t('canvas.summary.listMode', { mode: String(cfg.mode) });

    // 持久化
    case 'variable_persist':
    case 'load_variable':
    case 'save_variable':
    case 'incr_variable':
    case 'update_if_variable':
    case 'append_variable':
    case 'delete_variable':
    case 'exists_variable':
      return t('canvas.summary.persist', {
        mode: String(cfg.mode ?? 'save'),
        key: String(cfg.key),
      });

    // 时间
    case 'time_op':
    case 'time_read':
    case 'time_check':
    case 'time_calc':
      return t('canvas.summary.time', { mode: String(cfg.mode ?? 'now') });

    // JSON 操作（统一节点）
    case 'json_op':
      return `JSON: ${cfg.mode ?? 'get'}`;

    // 上下文
    case 'get_context':
    case 'get_ids':
    case 'get_message':
    case 'get_profile':
      return t('canvas.summary.context', { mode: String(cfg.mode ?? 'user_id') });

    // 逻辑
    case 'branch_switch':
      return t('canvas.summary.multiBranch', { value: String(cfg.default ?? 'default') });

    // 网络
    case 'http_request':
      return `${cfg.method} ${String(cfg.url || '').slice(0, 20)}`;

    // AI
    case 'agent_chat':
      return String(cfg.mode ?? '') === 'agent'
        ? t('canvas.summary.aiAgent')
        : t('canvas.summary.aiChat');
    case 'embedding':
      return t('canvas.summary.embedding', { text: String(cfg.text || '').slice(0, 20) });
    case 'memory_add':
      return t('canvas.summary.memoryAdd');
    case 'memory_search':
      return t('canvas.summary.memorySearch', { text: String(cfg.text ?? '').slice(0, 12) });
    case 'memory_clear':
      return t('canvas.summary.memoryClear');
    case 'memory_list':
      return t('canvas.summary.memoryList');

    // 群管（统一节点）
    case 'group_op':
      return t('canvas.summary.groupAdmin', { mode: String(cfg.mode ?? 'ban') });

    // 构造消息段（不发送）
    case 'message_op':
      return t('canvas.summary.messageSegment', { type: String(cfg.segment_type ?? 'at') });

    // 文件操作（统一节点）
    case 'file_operate':
    case 'file_read':
    case 'file_write':
      return t('canvas.summary.file', { mode: String(cfg.mode ?? 'read') });

    // 数据库
    case 'query':
      return t('canvas.summary.query', { mode: String(cfg.mode ?? 'list') });
    case 'database_write':
      return `DB: ${cfg.mode ?? 'insert'} → ${cfg.table || '?'}`;

    // API 调用
    case 'api_call':
      return `API: ${cfg.action || '?'}`;

    // 数据表/面板（声明性）
    case 'table_define':
      return t('canvas.summary.table', {
        name: String(cfg.tableName || t('canvas.summary.unnamed')),
      });
    case 'panel_register':
      return t('canvas.summary.panel', {
        name: String(cfg.label || cfg.panelId || t('canvas.summary.unnamed')),
      });

    // 控制流
    case 'loop_control':
      return cfg.mode === 'return'
        ? t('canvas.summary.earlyReturn')
        : t('canvas.summary.breakLoop');
    case 'error_op':
      return cfg.mode === 'throw'
        ? t('canvas.summary.throwError', { text: String(cfg.message || '').slice(0, 20) })
        : t('canvas.summary.assertError', {
            text: String(cfg.message ?? t('canvas.summary.assertFailed')),
          });
    case 'parallel_exec':
      return t('canvas.summary.parallelExec');
    case 'try_catch':
      return t('canvas.summary.tryCatch');
    case 'wait_input':
      return cfg.expected_pattern
        ? t('canvas.summary.waitInputChecked', { timeout: String(cfg.timeout ?? 60) })
        : t('canvas.summary.waitInput', { timeout: String(cfg.timeout ?? 60) });

    // 边界节点（Start/End）— 对标扣子工作流的显式数据边界
    case 'start_node': {
      const tt = cfg.trigger_type ?? 'message_received';
      const labelKeyMap: Record<string, string> = {
        message_received: 'canvas.summary.triggerMessageReceived',
        scheduled: 'canvas.summary.triggerScheduled',
        request_received: 'canvas.summary.triggerRequestReceived',
        notice_received: 'canvas.summary.triggerNoticeReceived',
        subflow_defined: 'canvas.summary.triggerSubflowDefined',
      };
      const label = labelKeyMap[tt as string] ? t(labelKeyMap[tt as string]) : String(tt);
      if (tt === 'subflow_defined') {
        let paramCount = 0;
        try {
          const params = cfg.params ? JSON.parse(cfg.params as string) : [];
          paramCount = Array.isArray(params) ? params.length : 0;
        } catch {
          paramCount = 0;
        }
        return t('canvas.summary.subflowEntry', { count: String(paramCount) });
      }
      return t('canvas.summary.startPoint', { label });
    }
    case 'end_node': {
      let returnCount = 0;
      try {
        const returns = cfg.returns ? JSON.parse(cfg.returns as string) : [];
        returnCount = Array.isArray(returns) ? returns.length : 0;
      } catch {
        returnCount = 0;
      }
      return returnCount > 0
        ? t('canvas.summary.endPointWithReturns', { count: String(returnCount) })
        : t('canvas.summary.endPoint');
    }

    // 权限
    case 'check_permission':
      return t('canvas.summary.permission', { role: String(cfg.role ?? 'admin') });

    // 子流程
    case 'subflow_defined':
      return t('canvas.summary.subflowDefine', {
        name: String(cfg.subflow_name || t('canvas.summary.unnamed')),
      });
    case 'subflow_call':
      return t('canvas.summary.callSubflow');

    // 正则提取
    case 'regex_extract':
      return cfg.pattern
        ? t('canvas.summary.pattern', { pattern: String(cfg.pattern) })
        : t('canvas.summary.notConfigured');

    // 控制流/工具
    case 'retry_exec':
      return t('canvas.summary.retry', { count: String(cfg.max_retries ?? 3) });
    case 'timer':
      return t('canvas.summary.timer', { mode: String(cfg.mode ?? 'start') });
    case 'system_log':
      return `[${cfg.level ?? 'info'}] ${String(cfg.message || '').slice(0, 20)}`;

    default:
      return '';
  }
}

// 枚举型字段的选项已统一到目录（src/shared/nodes/fieldOptions.ts → 目录端口 options /
// 节点级 configFieldOptions），内联卡片通过 getFieldOptions 读取；本文件不再维护第二份清单。
/** 内联字段定义：卡片上直接显示的配置字段 */
export interface InlineFieldDef {
  key: string;
  /** select 的选项来自目录（getFieldOptions），本表只声明"用下拉渲染" */
  type: 'select' | 'text' | 'number';
  /**
   * 字段名对应的**配置字段 key**（经 fieldLabel() 查当前语言的显示名）。
   * 与属性抽屉共用 field.label.* 这一份文案，杜绝画布/抽屉叫法漂移。
   * 缺省用 key 本身当字段名。
   */
  labelKey?: string;
  /** placeholder 的 i18n 键（简短格式示例）。缺省显示字段名。 */
  placeholderKey?: string;
  /** 条件显示：返回 false 时隐藏此字段 */
  showWhen?: (config: Record<string, unknown>) => boolean;
}

/**
 * 每节点内联显示 1-2 个最常用字段。
 * 复杂字段（cases JSON、keyboard、expression、IfBranchBuilder 等）仍走 PropertyDrawer。
 * 空数组 = 不内联（走专属编辑器或无常用字段）。
 */
export const INLINE_FIELDS_MAP: Record<string, InlineFieldDef[]> = {
  // 边界
  start_node: [{ key: 'trigger_type', type: 'select', labelKey: 'trigger_type' }],
  // 动作
  message_send: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'text',
      type: 'text',
      labelKey: 'text',
      placeholderKey: 'inline.placeholder.replyText',
      showWhen: (c) => String(c.mode ?? 'text') === 'text',
    },
  ],
  message_edit: [
    {
      key: 'new_text',
      type: 'text',
      labelKey: 'new_text',
      placeholderKey: 'inline.placeholder.editedContent',
    },
  ],
  api_call: [
    {
      key: 'action',
      type: 'text',
      labelKey: 'action',
      placeholderKey: 'inline.placeholder.apiName',
    },
  ],
  // 逻辑/控制流
  branch_if: [
    {
      key: 'expression',
      type: 'text',
      labelKey: 'expression',
      placeholderKey: 'inline.placeholder.conditionExpr',
    },
  ],
  loop: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'count',
      type: 'number',
      labelKey: 'count',
      showWhen: (c) => String(c.mode) === 'times',
    },
  ],
  delay: [{ key: 'seconds', type: 'number', labelKey: 'seconds' }],
  loop_control: [{ key: 'mode', type: 'select', labelKey: 'mode' }],
  error_op: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'message', type: 'text', labelKey: 'message' },
  ],
  variable_set: [
    {
      key: 'var_name',
      type: 'text',
      labelKey: 'var_name',
      placeholderKey: 'inline.placeholder.varName',
    },
  ],
  // 多分支选择（cases JSON 走抽屉，default 分支名内联）
  branch_switch: [{ key: 'default', type: 'text', labelKey: 'default' }],
  // 等待回复（expected_pattern 校验正则走抽屉，timeout 内联）
  wait_input: [{ key: 'timeout', type: 'number', labelKey: 'timeout' }],
  // 数据
  database_write: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'table', type: 'text', labelKey: 'table' },
  ],
  variable_persist: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'key', type: 'text', labelKey: 'var_name' },
  ],
  // 2026-10-03 拆分出来的持久化节点（老 variable_persist 的 7 个形态）——
  // 没补之前它们在画布上**一个字段都不显示** ✗（审查发现的同一类回归）。
  load_variable: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'key', type: 'text', labelKey: 'var_name' },
  ],
  save_variable: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'key', type: 'text', labelKey: 'var_name' },
  ],
  incr_variable: [{ key: 'key', type: 'text', labelKey: 'var_name' }],
  update_if_variable: [{ key: 'key', type: 'text', labelKey: 'var_name' }],
  append_variable: [{ key: 'key', type: 'text', labelKey: 'var_name' }],
  delete_variable: [{ key: 'key', type: 'text', labelKey: 'var_name' }],
  exists_variable: [{ key: 'key', type: 'text', labelKey: 'var_name' }],
  http_request: [
    { key: 'method', type: 'select', labelKey: 'method' },
    { key: 'url', type: 'text', labelKey: 'url' },
  ],
  json_op: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'key', type: 'text', labelKey: 'key', showWhen: (c) => String(c.mode) !== 'merge' },
  ],
  list_op: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'list',
      type: 'text',
      labelKey: 'source_list',
      showWhen: (c) => !['size', 'reverse', 'unique'].includes(String(c.mode)),
    },
  ],
  // 2026-10-03 拆分出来的 4 个列表节点
  list_edit: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'list', type: 'text', labelKey: 'source_list' },
  ],
  list_query: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'list', type: 'text', labelKey: 'source_list' },
  ],
  list_transform: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'list',
      type: 'text',
      labelKey: 'source_list',
      showWhen: (c) => !['size', 'reverse', 'unique'].includes(String(c.mode)),
    },
  ],
  list_combine: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'list', type: 'text', labelKey: 'source_list' },
  ],
  expression_eval: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'expression',
      type: 'text',
      labelKey: 'expression',
      showWhen: (c) => String(c.mode) === 'single',
    },
  ],
  random: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'min', type: 'number', labelKey: 'min', showWhen: (c) => String(c.mode) === 'int' },
    { key: 'max', type: 'number', labelKey: 'max', showWhen: (c) => String(c.mode) === 'int' },
  ],
  variable_merge: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'key_names',
      type: 'text',
      labelKey: 'key_names',
      showWhen: (c) => String(c.mode) === 'dict',
    },
  ],
  query: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'table', type: 'text', labelKey: 'table' },
  ],
  // 文本模板（template 内联，{var1}~{var8} 绑定上游端口；命名变量需 variables_json）
  format_text: [
    {
      key: 'template',
      type: 'text',
      labelKey: 'template',
      placeholderKey: 'inline.placeholder.template',
    },
  ],
  // 群/文件/时间/上下文/消息段
  group_op: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'duration',
      type: 'number',
      labelKey: 'duration',
      showWhen: (c) => String(c.mode) === 'ban',
    },
  ],
  file_operate: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    {
      key: 'path',
      type: 'text',
      labelKey: 'file_path',
      showWhen: (c) => !['list_dir', 'mkdir'].includes(String(c.mode)),
    },
  ],
  // 2026-10-03 拆分出来的文件 / 时间 / 上下文节点（新节点用 file_path 端口名）
  file_read: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'file_path', type: 'text', labelKey: 'file_path' },
  ],
  file_write: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'file_path', type: 'text', labelKey: 'file_path' },
  ],
  time_op: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'format', type: 'text', labelKey: 'fmt', showWhen: (c) => String(c.mode) === 'now' },
  ],
  time_read: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'fmt', type: 'text', labelKey: 'fmt' },
  ],
  time_check: [{ key: 'timestamp', type: 'text', labelKey: 'timestamp' }],
  time_calc: [
    { key: 'mode', type: 'select', labelKey: 'mode' },
    { key: 'offset', type: 'text', labelKey: 'offset' },
  ],
  get_context: [{ key: 'mode', type: 'select', labelKey: 'mode' }],
  get_ids: [{ key: 'mode', type: 'select', labelKey: 'mode' }],
  get_message: [{ key: 'mode', type: 'select', labelKey: 'mode' }],
  get_profile: [{ key: 'mode', type: 'select', labelKey: 'mode' }],
  message_op: [{ key: 'segment_type', type: 'select', labelKey: 'segment_type' }],
  // AI
  agent_chat: [
    { key: 'temperature', type: 'number', labelKey: 'temperature' },
    { key: 'max_rounds', type: 'number', labelKey: 'max_rounds' },
  ],
  // 权限/日志/计时/重试
  check_permission: [{ key: 'role', type: 'select', labelKey: 'role' }],
  system_log: [
    { key: 'level', type: 'select', labelKey: 'level' },
    { key: 'message', type: 'text', labelKey: 'content' },
  ],
  timer: [{ key: 'mode', type: 'select', labelKey: 'mode' }],
  retry_exec: [
    { key: 'max_retries', type: 'number', labelKey: 'max_retries' },
    { key: 'delay', type: 'number', labelKey: 'delay' },
  ],
};
