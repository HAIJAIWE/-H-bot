// src/shared/nodes/catalog/build.ts
//
// 把「契约层」（builtinCatalog.ts，单一真相）+「文案层」（i18n/catalog.<locale>.ts）
// 组装成一份**带指定语言的完整节点目录**（NodeSpecV2[]）。
//
// 设计要点：
//   1. **zh-CN 是恒等映射**：直接返回 `NODE_CATALOG_V2` 本身，不做任何克隆。
//      这保证改造前后中文用户看到的目录逐字段一致（零行为变化），也让既有测试继续有效；
//   2. **其他语言按需克隆**：只克隆节点与端口这两层（浅层展开），`defaultConfig` 与
//      `showWhen` 保持引用共享 —— 前者被 `nodeFactory` 自己深拷贝，后者是函数，
//      用 `structuredClone` 会直接抛 DataCloneError（本项目踩过这个坑）；
//   3. **缺译文回退中文并登记**：绝不静默变成空串。缺失项由 `collectMissingCopy`
//      报出，供闸门测试与 `scripts/check-catalog.mjs` 断言为 0。
import type { FieldOption, NodeSpecV2, PortSpec } from '../../types/nodeV2';
import { NODE_CATALOG_V2 } from '../builtinCatalog';
import { CATALOG_EN_US } from '../i18n/catalog.en-US';
import type { CatalogCopy, NodeCopy } from '../i18n/copy.types';

/** 支持的语言 */
export type CatalogLocale = 'zh-CN' | 'en-US';

/** 各语言的文案表。新增语言只需在这里加一项 + 一份 i18n/catalog.<locale>.ts */
const COPY_BY_LOCALE: Record<CatalogLocale, CatalogCopy | null> = {
  // zh-CN 的文案就内联在 builtinCatalog.ts 里，没有独立文案表（恒等映射）
  'zh-CN': null,
  'en-US': CATALOG_EN_US,
};

export function isCatalogLocale(locale: string): locale is CatalogLocale {
  return locale === 'zh-CN' || locale === 'en-US';
}

/** 文案表里查不到的项，用于闸门断言（形如 `message_send.inputs.mode.name`） */
const missingCopy = new Set<string>();

/** 取节点级文案字段（label / description / summary 这些平铺字段）；查不到时回退中文并登记 */
function pick(copy: NodeCopy | undefined, field: 'label' | 'description' | 'summary', fallback: string, kind: string): string {
  if (copy) {
    const v = copy[field];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  missingCopy.add(`${kind}.${field}`);
  return fallback;
}

/** 把选项清单按文案表本地化（value 是契约，原样保留） */
function localizeOptions(
  options: readonly FieldOption[] | undefined,
  copy: NodeCopy | undefined,
  kind: string,
  fieldKey: string,
): readonly FieldOption[] | undefined {
  if (!options) return undefined;
  return options.map((o) => {
    const entry = copy?.options?.[fieldKey]?.[o.value];
    if (!entry) {
      missingCopy.add(`${kind}.options.${fieldKey}=${o.value}`);
      return o;
    }
    const next: FieldOption = { value: o.value, label: entry.label };
    if (entry.group !== undefined) next.group = entry.group;
    return next;
  });
}

/** 本地化单个端口（id / dataType / required / default / showWhen / 选项 value 全部不动） */
function localizePort(
  port: PortSpec,
  dir: 'inputs' | 'outputs',
  kind: string,
  copy: NodeCopy | undefined,
): PortSpec {
  // 端口文案挂在 copy.ports 下，键是 `${dir}.${portId}`（见 copy.types.ts 的说明）
  const pc = copy?.ports?.[`${dir}.${port.id}`];
  if (!pc) {
    missingCopy.add(`${kind}.${dir}.${port.id}`);
    return port;
  }

  const next: PortSpec = { ...port, name: pc.name };

  if (port.description !== undefined) {
    if (pc.description !== undefined) {
      next.description = pc.description;
    } else {
      // 中文端口有说明而英文没有：回退中文并登记，不静默留空
      missingCopy.add(`${kind}.${dir}.${port.id}.description`);
    }
  }

  const localized = localizeOptions(port.options, copy, kind, port.id);
  if (localized) next.options = localized;

  return next;
}

/**
 * 组装指定语言的完整目录。
 *
 * @param locale 语言；未知语言按 zh-CN 处理（宁可显示中文，也不要空白界面）
 */
export function buildCatalog(locale: string): NodeSpecV2[] {
  if (!isCatalogLocale(locale)) return NODE_CATALOG_V2;
  const copy = COPY_BY_LOCALE[locale];
  // zh-CN 恒等返回：不克隆、不重建，保证与改造前逐字段一致
  if (copy === null) return NODE_CATALOG_V2;

  return NODE_CATALOG_V2.map((spec) => {
    const nc = copy[spec.kind];
    if (!nc) {
      missingCopy.add(spec.kind);
      return spec;
    }
    return {
      ...spec,
      label: pick(nc, 'label', spec.label, spec.kind),
      description: pick(nc, 'description', spec.description, spec.kind),
      summary: pick(nc, 'summary', spec.summary, spec.kind),
      tags: (nc.tags ?? []).length > 0 ? [...(nc.tags ?? [])] : spec.tags,
      inputs: spec.inputs.map((p) => localizePort(p, 'inputs', spec.kind, nc)),
      outputs: spec.outputs.map((p) => localizePort(p, 'outputs', spec.kind, nc)),
      configFieldOptions: spec.configFieldOptions
        ? Object.fromEntries(
            Object.entries(spec.configFieldOptions).map(([k, v]) => [
              k,
              localizeOptions(v, nc, spec.kind, k) ?? v,
            ]),
          )
        : undefined,
    };
  });
}

/**
 * 当前累计的缺译文条目（去重）。
 * 供 `scripts/check-catalog.mjs` 与闸门测试断言为 0 —— 缺译文会静默回退中文，
 * 不报出来就等于"英文界面里夹着中文"没人发现。
 */
export function collectMissingCopy(): string[] {
  return [...missingCopy].sort();
}

/** 清空缺译文登记（测试用，避免用例之间互相污染） */
export function resetMissingCopy(): void {
  missingCopy.clear();
}
