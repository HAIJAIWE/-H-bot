// src/renderer/src/stores/flow/nodeErrorCore.ts
//
// 节点配置校验的**纯逻辑**与运行时错误账本。
// 搬出 flowStore.ts 的原因：校验逻辑被 validationSlice 使用；而 `_runtimeErrorMessages`
// 这个模块级 Map 被"加载/重置图"、"清错误"、"写/清运行时错误"三处共享 ——
// 它是**单例**，只能存在一份（见下方注释）。
import type { FlowNode, FlowEdge } from '@shared/types/flow';
import { fieldLabel } from '../../i18n/fieldLabels';
import { t } from '../../i18n';
import { findSpec } from '../../lib/node/nodeCatalog';

/**
 * 当前 `nodeErrors` 里**来自运行时**的节点 id → 错误文案。
 *
 * 同一个 `nodeErrors` 记录既装配置校验错误（静态、改配置才变）也装运行时错误
 * （节点跑挂了）。分开记账是为了让"节点再次开始执行"能清掉上一次的运行时报错，
 * 而不会顺手抹掉用户还没修的配置错误。
 *
 * 导出为单例 Map：拆分后 validationSlice 与 persistenceSlice 都必须操作**同一份**账本。
 */
export const _runtimeErrorMessages = new Map<string, string>();

/** 计算单个节点的校验错误（纯函数，不触发 set） */
export function _computeNodeErrors(
  node: FlowNode,
  spec: ReturnType<typeof findSpec>,
  edges: FlowEdge[],
): string[] {
  if (!spec) return [];
  const errors: string[] = [];
  const config = node.data.config;

  // 通用必填校验：只有 defaultConfig 中不存在该 key（值为 undefined）时才标记必填。
  // 空字符串 / null / 0 / false 等都是"有默认值 = 可选"，
  // 与 PropertyDrawer.tsx 的 isRequired = defaultValue === undefined 保持一致。
  for (const [key, defaultValue] of Object.entries(spec.defaultConfig)) {
    if (defaultValue !== undefined) continue;
    const val = config[key];
    if (val === undefined || val === null || val === '') {
      errors.push(t('validation.fieldRequired', { field: fieldLabel(key) }));
    }
  }

  // JSON 格式校验
  for (const [key, val] of Object.entries(config)) {
    if (
      typeof val === 'string' &&
      (key === 'cases' || key === 'transitions' || key === 'conditions' || key === 'rewards')
    ) {
      try {
        JSON.parse(val);
      } catch {
        errors.push(t('validation.fieldInvalidJson', { field: fieldLabel(key) }));
      }
    }
  }

  // ── message_send 基于模式的条件校验（考虑数据绑定） ──────────────────
  // 各模式运行时真正需要的字段（见 builtinNodes.ts 的 messageSend）：
  //   text     → text（可绑定上游）
  //   keyboard → markdown + keyboard（markdown 可绑定上游）
  //   segment  → segments（可绑定上游）
  //   forward  → messages（可绑定上游）
  // 推送目标：target_type 非空时，target_id 必填（可绑定上游）
  if (node.data.nodeKind === 'message_send') {
    const mode = String(config.mode ?? 'text');
    const target_type = String(config.target_type ?? '');
    const target_id = String(config.target_id ?? '');
    /** 检查指定数据端口是否已绑定上游输出 */
    const isBound = (portId: string): boolean =>
      edges.some((e) => e.target === node.id && e.targetPort === portId);

    // 推送目标校验
    // 注意：下面每条消息里的**字段名一律用 fieldLabel(key) 生成**（而不是写死中文），
    // 因为 `parseErrorFieldKey` 要从文案里反解出 config key 来做「点错误跳字段」。
    // 写死中文在英文界面下会反查不到 → 跳转/内联红框静默失效。
    // 该不变量由 tests/renderer/i18n/validationFieldParse.test.ts 在两个语言下逐一断言。
    if (target_type && !target_id && !isBound('target_id')) {
      errors.push(t('validation.proactiveTargetRequired', { field: fieldLabel('target_id') }));
    }

    // 按模式校验内容字段：config 为空且未绑定数据时才提示
    if (mode === 'text' && !config.text && !isBound('text')) {
      errors.push(t('validation.modeTextRequired', { field: fieldLabel('text') }));
    }
    // 「Markdown / 按钮」是目录里的**正式**模式（keyboard 是遗留名，见 fieldOptions）。
    // 这里曾只校验 keyboard，于是选了 markdown 却没填正文的节点**不报错**，跑起来才失败。
    if (
      mode === 'markdown' &&
      !config.markdown &&
      !config.text &&
      !isBound('markdown') &&
      !isBound('text')
    ) {
      errors.push(t('validation.modeMarkdownRequired', { field: fieldLabel('markdown') }));
    }
    // 富媒体：官方由服务端拉 url，没有地址就发不出去
    if (mode === 'media' && !config.media_url && !isBound('media_url')) {
      errors.push(t('validation.modeMediaRequired', { field: fieldLabel('media_url') }));
    }
    // 流式：正文必填，且**仅单聊**（官方只有单聊流式端点，见能力清单的 stream_messages）
    if (mode === 'stream') {
      if (!config.text && !isBound('text')) {
        errors.push(t('validation.modeStreamRequired', { field: fieldLabel('text') }));
      }
      if (config.target_type === 'group' || config.target_type === 'channel') {
        errors.push(t('validation.modeStreamPrivateOnly', { field: fieldLabel('target_type') }));
      }
    }
    if (mode === 'keyboard') {
      if (!config.markdown && !isBound('markdown')) {
        errors.push(t('validation.modeKeyboardRequired', { field: fieldLabel('markdown') }));
      }
      const kb = config.keyboard;
      const hasKeyboard =
        kb != null &&
        typeof kb === 'object' &&
        Array.isArray((kb as { rows?: unknown[] }).rows) &&
        (kb as { rows: unknown[] }).rows.length > 0;
      // keyboard 与 text / markdown / segments / messages 一样可以绑上游：
      // `message_compose` 的 keyboard 输出常直接连到本节点的 keyboard 端口，
      // 此时 config.keyboard 是空的占位对象。原来这里漏了 isBound，
      // 导致这种（合法且是主流）的接法被永久标红 —— 真实项目里 13 个节点因此常亮。
      if (!hasKeyboard && !isBound('keyboard')) {
        errors.push(t('validation.modeKeyboardButtonsRequired', { field: fieldLabel('keyboard') }));
      }
    }
    if (mode === 'segment' && !config.segments && !isBound('segments')) {
      errors.push(t('validation.modeSegmentRequired', { field: fieldLabel('segments') }));
    }
    if (mode === 'forward' && !config.messages && !isBound('messages')) {
      errors.push(t('validation.modeForwardRequired', { field: fieldLabel('messages') }));
    }
  }

  return errors;
}
