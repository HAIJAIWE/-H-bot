// src/shared/types/keyboard.ts
import type { Port } from './flow';

/** QQ 官方按钮消息 InlineKeyboard 数据结构 */
export interface InlineKeyboard {
  rows: InlineKeyboardRow[];
}

export interface InlineKeyboardRow {
  buttons: Button[];
}

export interface Button {
  id: string;
  render_data: {
    label: string;
    visited_label?: string;
    style?: 0 | 1; // 0=灰色线框, 1=蓝色线框
  };
  action: {
    type: 0 | 1 | 2; // 0=链接跳转, 1=回调后台, 2=@机器人
    permission: {
      type: 0 | 1 | 2 | 3; // 0=指定用户, 1=管理者, 2=所有人, 3=指定身份组
      specify_role_ids?: string[];
      specify_user_ids?: string[];
    };
    click_limit?: number;
    data: string;
    at_bot_show_channel_list?: boolean;
  };
}

/** 发送给翻译器的 keyboard 消息参数 */
export interface SendKeyboardParams {
  message_type: 'private' | 'group';
  user_id?: string;
  group_id?: string;
  markdown: string;
  keyboard: InlineKeyboard;
  msg_id?: string;
}

/** 创建空按钮的工厂函数 */
export function createEmptyButton(): Button {
  return {
    id: `btn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    render_data: { label: '新按钮', style: 1 },
    action: {
      type: 2,
      permission: { type: 2 },
      data: '',
    },
  };
}

/** 创建空行的工厂函数 */
export function createEmptyRow(): InlineKeyboardRow {
  return { buttons: [createEmptyButton()] };
}

/** 创建空 keyboard 的工厂函数 */
export function createEmptyKeyboard(): InlineKeyboard {
  return { rows: [createEmptyRow()] };
}

/**
 * 从 keyboard 配置生成动态按钮输出端口。
 *
 * 每个按钮生成一个 control 类型的输出端口：
 * - 端口 id: `btn_${button.id}`（带 btn_ 前缀避免与基础端口冲突）
 * - 端口 name: 按钮的 render_data.label
 * - 端口 kind: 'control'（按钮点击触发流程执行）
 * - 端口 description: 包含 action.data 的说明
 *
 * 用于 message_send 节点（mode='keyboard'）在流程中可视化连接按钮到下游步骤。
 */
export function getButtonOutputPorts(keyboard: InlineKeyboard | null | undefined): Port[] {
  if (!keyboard?.rows) return [];
  const ports: Port[] = [];
  for (const row of keyboard.rows) {
    if (!row?.buttons) continue;
    for (const btn of row.buttons) {
      if (!btn?.id) continue;
      ports.push({
        id: `btn_${btn.id}`,
        name: btn.render_data?.label || '按钮',
        kind: 'control',
        description: `点击"${btn.render_data?.label || ''}"后执行（命令: ${btn.action?.data || ''}）`,
      });
    }
  }
  return ports;
}

/**
 * message_send 节点的完整输出端口列表（基础 + 动态按钮）。
 *
 * 基础端口：out（出口）、success、message_id、error
 * 动态端口：当 mode='keyboard' 或 'markdown'（后者按钮可选）时，为每个按钮生成一个 control 端口
 */
export function getSendMessageOutputs(config: Record<string, unknown>): Port[] {
  const baseOutputs: Port[] = [
    { id: 'out', name: '出口', kind: 'control' },
    { id: 'success', name: '成功', kind: 'data', dataType: 'boolean', description: '是否发送成功' },
    {
      id: 'message_id',
      name: '消息 ID',
      kind: 'data',
      dataType: 'string',
      description: '发送成功的消息 ID',
    },
    {
      id: 'error',
      name: '错误',
      kind: 'data',
      dataType: 'string',
      description: '错误信息（空=成功）',
    },
  ];

  // 「Markdown 文本」模式同样可以带按钮，按钮端口一并生成
  if (config.mode !== 'keyboard' && config.mode !== 'markdown') return baseOutputs;

  const keyboard = config.keyboard as InlineKeyboard | null | undefined;
  const btnPorts = getButtonOutputPorts(keyboard);
  return [...baseOutputs, ...btnPorts];
}

/**
 * expression_eval 节点的完整输出端口列表（基础 + 动态公式端口）。
 *
 * single 模式（默认）：基础端口 out（出口）、result（结果）、error
 * formulas 模式：基础端口 + 每个公式生成一个 data 端口，端口 id/name = 公式 name
 */
export function getExpressionEvalOutputs(config: Record<string, unknown>): Port[] {
  const baseOutputs: Port[] = [
    { id: 'out', name: '出口', kind: 'control' },
    { id: 'result', name: '结果', kind: 'data', dataType: 'any', description: '表达式求值结果' },
    {
      id: 'error',
      name: '错误',
      kind: 'data',
      dataType: 'string',
      description: '错误信息（空=成功）',
    },
  ];

  const mode = config.mode as string | undefined;
  if (mode !== 'formulas') return baseOutputs;

  const formulas = config.formulas as Array<{ name: string; expression: string }> | undefined;
  if (!formulas || !Array.isArray(formulas)) return baseOutputs;

  const formulaPorts: Port[] = formulas
    .filter((f) => f && f.name && f.expression)
    .map((f) => ({
      id: f.name,
      name: f.name,
      kind: 'data' as const,
      dataType: 'any',
      description: `公式: ${f.expression}`,
    }));
  return [...baseOutputs, ...formulaPorts];
}
