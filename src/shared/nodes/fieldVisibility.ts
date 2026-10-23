// src/shared/nodes/fieldVisibility.ts
//
// 「这个参数在当前配置下要不要给用户看」—— **唯一判定入口**。
//
// ## 背景（真实体验问题）
//
// 节点目录里 `showWhen` 早已存在，但只写在**输出端口**上（file_operate / persistent_op /
// date_time 的 result/path/size…），**输入端口一个都没有**。后果是属性面板把
// `Object.keys(defaultConfig)` 全量渲染：`group_op` 有 15 个参数，用户选「禁言」时
// 依然要面对「名片 / 头衔 / 请求标识 / 子类型 / 文件路径…」一整屏与本次操作无关的框；
// 每个框还带一个「手动输入」绑定下拉 —— 新手直接头大（用户实测反馈）。
//
// ## 判定规则（顺序即优先级）
//
//   1. 端口没有 `showWhen`            → 显示（未声明 = 与模式无关）
//   2. `showWhen(config)` 为真        → 显示（当前模式适用）
//   3. 用户**填过值**（非空且非默认）  → 显示（绝不把用户填过的东西藏起来）
//   4. 该字段当前有校验错误           → 显示（否则报错了却找不到地方改）
//   5. 其余                           → 隐藏
//
// 规则 3/4 是这个特性的安全阀：隐藏只发生在"默认值 + 当前模式用不上"的字段上，
// 因此不会出现"参数凭空消失、用户找不到"的事故；同时面板默认只留当前模式要填的几项。
import type { NodeSpecV2, PortSpec } from '../types/nodeV2';

/** 可参与可见性判定的端口（catalog 的 PortSpec 与运行时宽松端口都可赋值给它） */
export interface VisibilityPort {
  id: string;
  showWhen?: (config: Record<string, unknown>) => boolean;
}

/** 用户是否**动过**这个字段：非空，且与目录默认值不同。导出给 codegen 大纲用（同一判据两处共用）。 */
export function hasCustomValue(value: unknown, defaultValue: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  // 与默认值相同 → 视为"没动过"
  try {
    return JSON.stringify(value) !== JSON.stringify(defaultValue);
  } catch {
    return value !== defaultValue;
  }
}

/**
 * 端口/字段在当前配置下是否**适用**（只看 showWhen，不考虑用户是否填过值）。
 *
 * showWhen 抛错时按"显示"处理：宁可多显示一个字段，也不能因为一个配置读取错误
 * 把整组参数藏起来。
 *
 * @param defaults 目录里的 `defaultConfig`。**校验场景必须传**：`showWhen` 判据读的是
 *   `config.mode` 这类开关字段，而模板风格/旧节点根本没有 config（`{}`）——
 *   不回落默认值就会得出"当前模式下用不到"，进而**整片跳过必填校验**
 *   （实测：老图里的 `message_send` 因此不再报"文本必填"）。合并时 config 优先。
 */
export function isPortApplicable(
  port: VisibilityPort | undefined,
  config: Record<string, unknown>,
  defaults?: Record<string, unknown>,
): boolean {
  if (!port?.showWhen) return true;
  try {
    const merged = defaults ? { ...defaults, ...config } : config;
    return port.showWhen(merged) !== false;
  } catch {
    return true;
  }
}

/**
 * 配置字段是否应在面板中显示。见文件头部的规则 1~5。
 *
 * @param defaultValue 目录里的默认值（用于判断"用户是否动过这个字段"）
 * @param hasError     该字段当前是否有校验错误
 */
export function isConfigFieldVisible(
  port: VisibilityPort | undefined,
  config: Record<string, unknown>,
  defaultValue?: unknown,
  hasError: boolean = false,
): boolean {
  if (isPortApplicable(port, config)) return true;
  if (hasError) return true;
  return hasCustomValue(config[port?.id ?? ''], defaultValue);
}

/** 把一个节点的数据输入端口按可见性拆开（画布/面板可据此渲染 + 提示隐藏了几项） */
export function partitionDataInputs<T extends VisibilityPort & { kind?: string }>(
  inputs: T[],
  config: Record<string, unknown>,
): { visible: T[]; hidden: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const port of inputs) {
    if (port.kind && port.kind !== 'data') {
      visible.push(port);
      continue;
    }
    (isPortApplicable(port, config) ? visible : hidden).push(port);
  }
  return { visible, hidden };
}

/** 切换字段本身（模式选择器）—— 它必须始终可见，不参与漂移检查 */
const SWITCH_PORT_IDS = new Set(['mode', 'segment_type', 'trigger_type']);

/** 目录里"描述提到某个 mode，却没写 showWhen"的字段（无人值守的漂移检查用） */
export function findVisibilityDrift(spec: NodeSpecV2): Array<{ portId: string; modeHint: string }> {
  const drift: Array<{ portId: string; modeHint: string }> = [];
  /**
   * 本节点「模式」选择器上各选项的中文 label。
   *
   * 为什么需要：这个守卫原来只认**英文**写法（`（xxx 模式）` / `xxx 模式`）。
   * 2026-09-19 把目录文案全部中文化之后（用户反馈"看不懂英文"），描述里写的是
   * 「多轮工具调用」模式、`「禁言」模式` —— 旧正则一条都匹配不到，
   * 于是 `agent_chat.max_rounds` / `tools` 这种**真实的漂移**（描述说按模式生效、
   * 却没写 showWhen）从此隐身，测试依旧全绿。守卫不能依赖文案用哪种语言。
   */
  const modePort = (spec.inputs as PortSpec[]).find((p) => p.id === 'mode');
  const modeLabels = (
    (modePort as { options?: Array<{ label?: string }> } | undefined)?.options ?? []
  )
    .map((o) => String(o.label ?? ''))
    .filter((l) => l.length >= 2);

  for (const port of spec.inputs as PortSpec[]) {
    if (port.kind !== 'data') continue;
    if (SWITCH_PORT_IDS.has(port.id)) continue;
    if ((port as VisibilityPort).showWhen) continue;
    const text = `${port.description ?? ''} ${port.name ?? ''}`;
    // 兼容三种写法：英文「（xxx 模式）」、英文「xxx 模式」、中文「「中文标签」模式」
    const english =
      text.match(/[（(]\s*([a-z_]+)\s*模式\s*[)）]/) ?? text.match(/([a-z_]+)\s*模式/);
    const chinese = modeLabels.find((label) => text.includes(label));
    const hint = english?.[1] ?? chinese;
    if (hint) drift.push({ portId: port.id, modeHint: hint });
  }
  return drift;
}
