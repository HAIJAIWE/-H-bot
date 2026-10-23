// src/renderer/src/components/blocks/DataBindingSelect.tsx
import React, { useMemo, useState } from 'react';
import type { FlowNode, FlowEdge, ConfigApiBinding } from '@shared/types/flow';
import { findSpec, nodeDisplayLabel } from '../../lib/node/nodeCatalog';
import { isControlEdgeByName } from '../../lib/canvas/executionOrder';
import { Dropdown } from '../ui/Dropdown';
import { ConfigApiPicker } from './ConfigApiPicker';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

interface DataBindingOption {
  nodeId: string;
  nodeLabel: string;
  portId: string;
  portName: string;
  label: string; // `${nodeLabel}.${portId}`
  /** 上游端口的 dataType，用于在 DataBindingSelect 中判断与目标端口类型是否兼容。
   *  不兼容项归入「类型不兼容」分组，但仍可强制绑定（宽松策略，运行时可能存在隐式转换）。 */
  sourceDataType?: string;
}

interface DataBindingSelectProps {
  currentNodeId: string;
  portId: string; // 当前节点的数据输入端口 ID
  edges: FlowEdge[];
  upstreamNodes: FlowNode[]; // 在当前节点之前的节点列表（由 ChainView 传入）
  onSelect: (sourceNodeId: string, sourcePortId: string) => void; // 创建数据流边
  onClear: () => void; // 清空绑定（删除数据流边）
  onConfigApiBind?: (configApi: ConfigApiBinding) => void; // 配置 API 绑定（可选）
  /** 当前端口的目标 dataType，用于在不兼容绑定选项上分组提示。
   *  不传则不做类型检查（向后兼容现有调用方）。 */
  targetDataType?: string;
}

/** 配置 API 边的 source 标识符（与 dataflow.ts 的 CONFIG_API_SOURCE 保持一致） */
const CONFIG_API_SOURCE = '__config_api__';

/** 判断边是否为配置 API 绑定边 */
export function isConfigApiEdge(edge: FlowEdge): boolean {
  return edge.source === CONFIG_API_SOURCE && edge.configApi != null;
}

/** 查找当前端口已绑定的配置 API 边 */
export function findConfigApiBinding(
  edges: FlowEdge[],
  currentNodeId: string,
  portId: string,
): ConfigApiBinding | undefined {
  const edge = edges.find(
    (e) => e.target === currentNodeId && e.targetPort === portId && isConfigApiEdge(e),
  );
  return edge?.configApi;
}

/**
 * 按模式过滤输出端口：只保留当前模式实际产出的输出，减少噪音。
 * 未在此表中定义的节点 kind，返回 null 表示不过滤（显示全部）。
 */
const MODE_OUTPUT_FILTER: Record<string, Record<string, string[]>> = {
  variable_persist: {
    save: ['success', 'error'],
    load: ['result', 'success', 'error'],
    delete: ['success', 'error'],
    exists: ['exists', 'success', 'error'],
    load_or_default: ['result', 'is_default', 'success', 'error'],
    increment: ['result', 'old_value', 'success', 'error'],
    batch_load: ['values', 'count', 'success', 'error'],
    batch_save: ['saved', 'keys_list', 'success', 'error'],
    batch_update: ['values', 'keys_list', 'reason', 'failed_key', 'success', 'error'],
    list_append: ['result', 'length', 'new', 'success', 'error'],
  },
  message_send: {
    text: ['success', 'message_id', 'error'],
    keyboard: ['success', 'message_id', 'error'],
    segment: ['success', 'message_id', 'error'],
    forward: ['success', 'message_id', 'error'],
  },
  random: {
    int: ['result'],
    choice: ['result'],
    weighted: ['result'],
  },
  time_op: {
    now: ['timestamp', 'datetime', 'date', 'time', 'weekday', 'error'],
    is_today: ['result', 'error'],
    date_diff: ['diff', 'seconds', 'is_past', 'error'],
  },
  file_operate: {
    read: ['result', 'success', 'error'],
    write: ['success', 'path', 'size', 'error'],
    copy: ['success', 'path', 'error'],
    move: ['success', 'path', 'error'],
    mkdir: ['success', 'path', 'error'],
    delete: ['success', 'error'],
    exists: ['exists', 'is_file', 'is_dir', 'success', 'error'],
    list_dir: ['result', 'count', 'success', 'error'],
  },
  get_context: {
    // 基础信息模式：只返回单一结果
    user_id: ['result', 'error'],
    group_id: ['result', 'error'],
    message_text: ['result', 'error'],
    raw_message: ['result', 'error'],
    self_id: ['result', 'error'],
    operator_id: ['result', 'error'],
    message_id: ['result', 'error'],
    sub_type: ['result', 'error'],
    group_name: ['result', 'error'],
    // 指令参数：结果 + 完整参数列表
    command_args: ['result', 'args_list', 'error'],
    // 群成员：成员列表 + 成功标志
    group_members: ['members', 'success', 'error'],
    // 消息片段：片段列表 + 数量
    message_part: ['part_list', 'part_count', 'error'],
    // 用户名称：群昵称 + 用户昵称
    user_name: ['card', 'nickname', 'error'],
  },
  message_received: {
    // match 模式过滤：args 仅 command 有值，matched/groups 仅 regex 有值
    any: ['event', 'raw_message'],
    at_me: ['event', 'raw_message'],
    keyword: ['event', 'raw_message'],
    command: ['event', 'raw_message', 'args'],
    regex: ['event', 'raw_message', 'matched', 'groups'],
  },
  memory_op: {
    add: ['result', 'success', 'error'],
    search: ['result', 'count', 'success', 'error'],
    clear: ['result', 'success', 'error'],
    list: ['result', 'count', 'success', 'error'],
  },
  database_write: {
    select: ['success', 'rows', 'rows_count', 'value', 'found', 'error'],
    insert: ['success', 'lastrowid', 'error'],
    update: ['success', 'rows_updated', 'error'],
    delete: ['success', 'rows_deleted', 'error'],
  },
  loop: {
    times: ['index', 'count'],
    iterate: ['index', 'count', 'item', 'key'],
    while: ['index', 'count', 'result'],
  },
  http_request: {
    json: ['status', 'data', 'error'],
    text: ['status', 'text', 'error'],
    binary: ['status', 'data', 'error'],
    auto: ['status', 'data', 'text', 'error'],
  },
};

/** 部分节点使用非 mode 字段作为模式选择（如 message_received 用 match） */
const MODE_FIELD_MAP: Record<string, string> = {
  message_received: 'match',
  http_request: 'response_format',
};

/** 获取节点当前模式下相关的输出端口 ID 列表，null 表示不过滤 */
export function getRelevantOutputIds(
  nodeKind: string,
  config: Record<string, unknown>,
): string[] | null {
  const modeFilter = MODE_OUTPUT_FILTER[nodeKind];
  if (!modeFilter) return null;
  const fieldName = MODE_FIELD_MAP[nodeKind] ?? 'mode';
  const mode = String(config[fieldName] ?? '');
  return modeFilter[mode] ?? null;
}

/**
 * 收集上游节点的数据输出端口，生成下拉选项。
 * 按模式过滤，只显示相关的输出端口（避免 13 个输出端口全部显示）。
 *
 * 优先使用 catalog 中 Port.showWhen（声明式，单一数据源）；
 * 若节点输出未定义 showWhen，回退到 MODE_OUTPUT_FILTER 硬编码表。
 */
export function collectBindingOptions(upstreamNodes: FlowNode[]): DataBindingOption[] {
  const options: DataBindingOption[] = [];
  for (const node of upstreamNodes) {
    const spec = findSpec(node.data.nodeKind);
    const outputs = spec?.outputs ?? node.data.outputs;
    const dataOutputs = outputs.filter((p) => p.kind === 'data');

    // 优先使用 showWhen 条件过滤
    const hasShowWhen = dataOutputs.some((p) => typeof p.showWhen === 'function');
    let filteredOutputs;
    if (hasShowWhen) {
      filteredOutputs = dataOutputs.filter((p) => {
        const visible = typeof p.showWhen === 'function' ? p.showWhen(node.data.config) : true;
        return visible;
      });
    } else {
      // 回退到 MODE_OUTPUT_FILTER
      const relevantIds = getRelevantOutputIds(node.data.nodeKind, node.data.config);
      filteredOutputs = relevantIds
        ? dataOutputs.filter((p) => relevantIds.includes(p.id))
        : dataOutputs;
    }

    for (const port of filteredOutputs) {
      const nodeLabel = nodeDisplayLabel(node);
      options.push({
        nodeId: node.id,
        nodeLabel,
        portId: port.id,
        portName: port.name,
        label: `${nodeLabel} · ${port.name}`,
        sourceDataType: port.dataType,
      });
    }
  }
  return options;
}

/**
 * 查找当前端口已绑定的数据流边。
 * 注意：配置 API 边（source === '__config_api__'）不算普通数据流边，
 * 由 findConfigApiBinding 单独处理。
 */
export function findBinding(
  edges: FlowEdge[],
  currentNodeId: string,
  portId: string,
): FlowEdge | undefined {
  return edges.find(
    (e) =>
      e.target === currentNodeId &&
      e.targetPort === portId &&
      !isControlEdgeByName(e) &&
      !isConfigApiEdge(e),
  );
}

/**
 * 类型兼容组：同组内的 dataType 互兼容。
 * 用于 DataBindingSelect 的类型过滤——不兼容的选项仍可选但标记警告。
 */
const TYPE_COMPAT_GROUPS: Record<string, Set<string>> = {
  object: new Set(['object', 'json', 'dict', 'any']),
  list: new Set(['list', 'array', 'any']),
  text: new Set(['string', 'text', 'any']),
  numeric: new Set(['number', 'int', 'float', 'any']),
  bool: new Set(['boolean', 'bool', 'any']),
};

/**
 * 判断两个 dataType 是否兼容（可用于数据绑定类型过滤）。
 *
 * 兼容规则：
 * - any 兼容所有类型
 * - 同名类型严格匹配（string↔ string）
 * - 同兼容组内互兼容（如 json ↔ object, list ↔ array）
 * - event 只匹配 event/any
 * - 未识别类型默认兼容（宽松策略，避免过度阻断）
 */
export function isTypeCompatible(sourceType: string, targetType: string): boolean {
  if (!sourceType || !targetType) return true;
  const s = sourceType.toLowerCase();
  const t = targetType.toLowerCase();
  if (s === 'any' || t === 'any') return true;
  if (s === t) return true;
  // 检查兼容组
  for (const group of Object.values(TYPE_COMPAT_GROUPS)) {
    if (group.has(s) && group.has(t)) return true;
  }
  return false;
}

export const DataBindingSelect = React.memo(function DataBindingSelect({
  currentNodeId,
  portId,
  edges,
  upstreamNodes,
  onSelect,
  onClear,
  onConfigApiBind,
  targetDataType,
}: DataBindingSelectProps) {
  useLocaleSubscription();
  const [pickerOpen, setPickerOpen] = useState(false);
  const options = useMemo(() => collectBindingOptions(upstreamNodes), [upstreamNodes]);
  const binding = useMemo(
    () => findBinding(edges, currentNodeId, portId),
    [edges, currentNodeId, portId],
  );
  const configApiBinding = useMemo(
    () => findConfigApiBinding(edges, currentNodeId, portId),
    [edges, currentNodeId, portId],
  );

  // 当前值：普通绑定用 `nodeId:portId`，配置 API 绑定用 `__config_api__`，
  // 都没有则空串（手动输入）
  const currentValue = binding
    ? `${binding.source}:${binding.sourcePort}`
    : configApiBinding
      ? '__config_api__'
      : '';

  // 类型兼容分组：当目标端口有 dataType 时，把不兼容的上游选项归入「类型不兼容」分组。
  // 兼容项不分组（默认平铺在前），不兼容项 group="类型不兼容"（Dropdown 渲染粘性组标题分隔）。
  // 宽松策略：不兼容项仍可选（运行时可能存在隐式转换，如 number → string），
  // 但视觉分组提示用户"这种绑定可能有类型问题"。
  const bindingOptions = useMemo(() => {
    if (!targetDataType) {
      return options.map((opt) => ({ value: `${opt.nodeId}:${opt.portId}`, label: opt.label }));
    }
    const compatible: { value: string; label: string }[] = [];
    const incompatible: { value: string; label: string; group: string }[] = [];
    for (const opt of options) {
      const value = `${opt.nodeId}:${opt.portId}`;
      if (isTypeCompatible(opt.sourceDataType ?? '', targetDataType)) {
        compatible.push({ value, label: opt.label });
      } else {
        incompatible.push({
          value,
          label: opt.label,
          group: t('blocks.dataBinding.typeIncompatible'),
        });
      }
    }
    return [...compatible, ...incompatible];
  }, [options, targetDataType]);

  return (
    <>
      <Dropdown
        value={currentValue}
        onChange={(v) => {
          if (v === '') {
            onClear();
          } else if (v === '__config_api__') {
            // 打开配置 API 选择器
            setPickerOpen(true);
          } else {
            const idx = v.indexOf(':');
            if (idx < 0) return;
            onSelect(v.slice(0, idx), v.slice(idx + 1));
          }
        }}
        options={[
          { value: '', label: t('blocks.dataBinding.manualInput') },
          ...bindingOptions,
          // 配置 API 选项（仅在支持配置 API 绑定时显示）
          ...(onConfigApiBind
            ? [
                {
                  value: '__config_api__',
                  label: configApiBinding
                    ? `📦 ${configApiBinding.table}.${configApiBinding.field}`
                    : t('blocks.dataBinding.configApiOption'),
                },
              ]
            : []),
        ]}
        className="max-w-40"
      />
      {pickerOpen && onConfigApiBind && (
        <ConfigApiPicker
          currentNodeId={currentNodeId}
          portId={portId}
          upstreamNodes={upstreamNodes}
          edges={edges}
          initial={configApiBinding}
          onConfirm={(api) => {
            onConfigApiBind(api);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </>
  );
});
