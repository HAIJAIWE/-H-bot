// src/renderer/src/components/canvas/InlineNodeFields.tsx
//
// 节点卡片上的内联配置字段渲染组件。
// 根据 INLINE_FIELDS_MAP[nodeKind] 在卡片上直接显示 1-2 个最常用字段（下拉/输入）。
//
// 设计要点：
// - onClick stopPropagation：防止点击内联字段时冒泡触发节点选中/开抽屉
// - message_send:mode 切换时复用 PropertyDrawer 的迁移逻辑（text↔keyboard）
// - start_node:trigger_type 切换时重置 trigger_config（避免旧字段残留）
// - W8 修复：text/number 输入加本地 draft + 350ms 防抖
//   原实现每个按键都调 updateNodeConfig（pushHistory + structuredClone 深拷贝整图），
//   输入 5 字符 = 5 次深拷贝 + 5 个撤销记录，撤销栈被字符级碎片污染。
//   现在改为：输入时更新本地 draft，停顿 350ms 或 blur 时才提交一次（1 个历史记录）。
//   select 仍立即提交（下拉选择是离散动作，1 次 = 1 个历史符合预期）。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown } from '../ui/Dropdown';
import { useFlowStore, parseErrorFieldKey } from '../../stores/flowStore';
import { INLINE_FIELDS_MAP, type InlineFieldDef } from '../../lib/canvas/canvasConstants';
import { fieldLabel } from '../../i18n/fieldLabels';
import { t } from '../../i18n';
// 枚举型字段的选项来自目录（单一真相，见 docs/nodes/nodes-audit-handoff.md 闸 1）
import { getFieldOptions } from '@shared/nodes/portOptions';
import { createEmptyKeyboard } from '@shared/types/keyboard';
import { useLocaleSubscription } from '../../stores/i18nStore';

/** 防抖延迟：用户停止输入 350ms 后才提交到 store（产生 1 个撤销记录） */
const DEBOUNCE_MS = 350;

/** 空错误数组常量：selector 返回引用稳定，避免无错误时每次 set 触发重渲染 */
const EMPTY_ERRORS: string[] = [];

/** 内容型文本字段（可能多行）：用 textarea 渲染，2 行可滚动查看。
 *  与 PropertyDrawer 的 MULTILINE_FIELDS 对齐，但卡片只取 2 行（完整编辑走抽屉）。
 *  expression/var_name 等短文本保持单行 input。 */
const MULTILINE_KEYS = new Set(['text', 'new_text', 'template']);

/** start_node 切换 trigger_type 时重置 trigger_config 的默认值（与 StartNodeConfigEditor 一致） */
const TRIGGER_TYPE_DEFAULTS: Record<string, Record<string, unknown>> = {
  message_received: {
    match: 'any',
    message_type: 'any',
    command: '',
    prefix: '/',
    keywords: [],
    pattern: '',
    flags: '',
  },
  scheduled: { cron: '0 * * * *', interval_seconds: 0 },
  request_received: {},
  notice_received: {},
  subflow_defined: {},
};

interface InlineNodeFieldsProps {
  nodeId: string;
  nodeKind: string;
  config: Record<string, unknown>;
}

/**
 * 处理内联字段变更（提交到 store，带 history）。
 * message_send:mode 和 start_node:trigger_type 有特殊迁移逻辑，其余直接单字段更新。
 */
function useInlineChange(nodeId: string, nodeKind: string, config: Record<string, unknown>) {
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);

  return (field: InlineFieldDef, value: string | number) => {
    // message_send:mode 切换 — 迁移 text/markdown（与 PropertyDrawer 逻辑一致）
    if (nodeKind === 'message_send' && field.key === 'mode') {
      const oldMode = String(config.mode ?? 'text');
      const newMode = String(value);
      const patch: Record<string, unknown> = { mode: newMode };
      if (newMode === 'keyboard' && oldMode === 'text') {
        // text → keyboard：将 text 迁移到 markdown（若 markdown 为空）
        const currentText = String(config.text ?? '');
        const currentMd = String(config.markdown ?? '');
        if (currentText && !currentMd) patch.markdown = currentText;
        // 确保 keyboard 有初始结构
        if (!config.keyboard) patch.keyboard = createEmptyKeyboard();
      } else if (newMode === 'text' && oldMode === 'keyboard') {
        // keyboard → text：将 markdown 迁移到 text（若 text 为空）
        const currentMd = String(config.markdown ?? '');
        const currentText = String(config.text ?? '');
        if (currentMd && !currentText) patch.text = currentMd;
      }
      updateNodeConfig(nodeId, patch);
      return;
    }

    // start_node:trigger_type 切换 — 重置 trigger_config 为对应默认值
    if (nodeKind === 'start_node' && field.key === 'trigger_type') {
      updateNodeConfig(nodeId, {
        trigger_type: String(value),
        trigger_config: { ...(TRIGGER_TYPE_DEFAULTS[String(value)] ?? {}) },
      });
      return;
    }

    // 默认：单字段更新
    updateNodeConfig(nodeId, { [field.key]: value });
  };
}

export function InlineNodeFields({ nodeId, nodeKind, config }: InlineNodeFieldsProps) {
  useLocaleSubscription();
  const fields = INLINE_FIELDS_MAP[nodeKind] ?? [];
  const handleChange = useInlineChange(nodeId, nodeKind, config);

  // 字段级错误高亮：订阅本节点的错误列表，解析出每条错误对应的 config 字段 key。
  // 卡片上直接给出错字段加红框，用户无需点底部错误条跳抽屉即可定位问题字段。
  // CanvasNode 底部已显示整体错误消息（errorMsg），这里补充字段粒度的视觉反馈。
  const nodeErrors = useFlowStore((s) => s.nodeErrors[nodeId] ?? EMPTY_ERRORS);
  const fieldErrors = useMemo(() => {
    const map = new Map<string, string>();
    // 用该节点真实拥有的字段消歧：有几个不同字段共用同一显示名
    // （「条件」= condition/expression、「表名」= table/tableName 等）
    const preferKeys = [...new Set([...fields.map((f) => f.key), ...Object.keys(config ?? {})])];
    for (const msg of nodeErrors) {
      const key = parseErrorFieldKey(msg, preferKeys);
      if (key) map.set(key, msg);
    }
    return map;
    // fields 由 INLINE_FIELDS_MAP 静态提供，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeErrors, config]);

  // W8：text/number 字段的本地 draft（输入时显示本地值，防抖后才提交到 store）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 每字段独立的防抖定时器
  const debounceTimers = useRef<Record<string, number>>({});
  // drafts 的 ref 镜像：commitDraft 与卸载 cleanup 需读最新 draft，避免空依赖闭包读到过期值
  const draftsRef = useRef<Record<string, string>>({});
  draftsRef.current = drafts;

  /** 提交单个字段的 draft 到 store（带 history），并清空本地 draft */
  const commitDraft = (field: InlineFieldDef) => {
    const draft = draftsRef.current[field.key];
    if (draft === undefined) return;
    // 清掉定时器（blur 时调用，避免重复提交）
    if (debounceTimers.current[field.key]) {
      clearTimeout(debounceTimers.current[field.key]);
      delete debounceTimers.current[field.key];
    }
    // 按字段类型转换：number 字段转 number，空串转 0
    let value: string | number = draft;
    if (field.type === 'number') {
      value = draft === '' ? 0 : Number(draft);
    }
    handleChange(field, value);
    // 清空 draft（提交后回到受控于 store 的值）
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[field.key];
      return next;
    });
  };

  // 卸载 cleanup 是空依赖 effect，直接引用会命中过期闭包，故用 ref 持有最新 commitDraft / fields
  const commitDraftRef = useRef(commitDraft);
  commitDraftRef.current = commitDraft;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  // 卸载时提交所有仍 pending 的 draft（与 DebouncedInputs.useDebouncedField 卸载行为一致），
  // 避免用户在防抖期内切换流程/视图导致输入丢失；同时清理定时器
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const key of Object.keys(timers)) {
        if (timers[key]) {
          clearTimeout(timers[key]);
          delete timers[key];
          const field = fieldsRef.current.find((f) => f.key === key);
          if (field) commitDraftRef.current(field);
        }
      }
    };
  }, []);

  /** text/number 输入变更：更新本地 draft + 防抖 350ms 后提交 */
  const onInputChange = (field: InlineFieldDef, raw: string) => {
    setDrafts((prev) => ({ ...prev, [field.key]: raw }));
    // 重置已有定时器
    if (debounceTimers.current[field.key]) {
      clearTimeout(debounceTimers.current[field.key]);
    }
    // 350ms 后提交（一次输入会话只产生 1 个历史记录）
    debounceTimers.current[field.key] = window.setTimeout(() => {
      commitDraft(field);
    }, DEBOUNCE_MS);
  };

  // 按 showWhen 过滤可见字段
  const visibleFields = fields.filter((f) => !f.showWhen || f.showWhen(config));
  if (visibleFields.length === 0) return null;

  return (
    // stopPropagation：防止点击内联字段时冒泡触发节点选中/开抽屉
    <div
      className="space-y-1 px-2 py-1"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {visibleFields.map((field) => {
        // 字段名与抽屉共用同一份文案（field.label.*），避免画布与面板叫法漂移
        const labelText = fieldLabel(field.labelKey ?? field.key);
        const placeholderText = field.placeholderKey ? t(field.placeholderKey) : labelText;
        const fieldValue = config[field.key];
        // 下拉选项从目录取（端口 options / 节点级 configFieldOptions）；取不到则退化为文本输入
        const opts = field.type === 'select' ? getFieldOptions(nodeKind, field.key) : undefined;
        // W8：有 draft 时显示 draft（输入中），否则显示 store 值
        const draftValue = drafts[field.key];
        // 字段级错误：命中时红框 + hover 显示错误消息（CanvasNode 底部已有整体错误条，这里补字段粒度）
        const fieldErr = fieldErrors.get(field.key);
        const inputBorder = fieldErr
          ? 'border-red-500 focus:border-red-500'
          : 'border-zinc-700 focus:border-blue-500';
        return (
          <div key={field.key} className="flex items-center gap-1.5">
            <label className="text-[10px] text-zinc-500 min-w-12 shrink-0 text-right whitespace-nowrap">
              {labelText}
            </label>
            {field.type === 'select' && opts ? (
              <Dropdown
                value={String(fieldValue ?? '')}
                ariaLabel={labelText}
                onChange={(v) => handleChange(field, v)}
                options={opts}
                className="flex-1 text-[11px]"
              />
            ) : field.type === 'number' ? (
              <input
                type="number"
                step="any"
                value={
                  draftValue !== undefined
                    ? draftValue
                    : fieldValue !== undefined && fieldValue !== null
                      ? Number(fieldValue)
                      : ''
                }
                onChange={(e) => onInputChange(field, e.target.value)}
                onBlur={() => commitDraft(field)}
                aria-label={labelText}
                title={fieldErr ?? undefined}
                className={`flex-1 min-w-0 bg-zinc-900 border rounded px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none ${inputBorder}`}
              />
            ) : MULTILINE_KEYS.has(field.key) ? (
              <textarea
                rows={2}
                value={draftValue !== undefined ? draftValue : String(fieldValue ?? '')}
                onChange={(e) => onInputChange(field, e.target.value)}
                onBlur={() => commitDraft(field)}
                placeholder={placeholderText}
                aria-label={labelText}
                title={fieldErr ?? undefined}
                className={`flex-1 min-w-0 bg-zinc-900 border rounded px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none resize-none overflow-y-auto ${inputBorder}`}
              />
            ) : (
              <input
                type="text"
                value={draftValue !== undefined ? draftValue : String(fieldValue ?? '')}
                onChange={(e) => onInputChange(field, e.target.value)}
                onBlur={() => commitDraft(field)}
                placeholder={placeholderText}
                aria-label={labelText}
                title={fieldErr ?? undefined}
                className={`flex-1 min-w-0 bg-zinc-900 border rounded px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none ${inputBorder}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
