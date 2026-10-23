// src/main/services/ai/tools/capabilityDiscovery.ts
//
// 两个**只读的发现工具**：让模型知道"这台应用能做什么、每件事归谁管"。
//
// ## 为什么不是"把 115 个能力都写成工具"
//
// MCP 官方与 Anthropic 的实测指向同一个结论：工具定义全量注入会吃掉上下文
// （5 个 server 58 个工具 ≈55K tokens），并**降低选择准确率**（Opus 4：49% → 74%）。
// 正确形态是**渐进式发现**：目录 → 检视 → 执行。本文件做前两层；
// 执行层（invoke_capability）是下一步 —— 它要先解决"有副作用的能力如何走提案"。
//
// ## 目录从哪来（关键：不是手抄）
//
// `../capabilityCatalog.generated` 由 `scripts/gen-capability-catalog.mjs` 生成，
// 权威来源是 `docs/ai/ai-capability-layering-2026-10-08.md` 的附录 A。
// 手抄会多出第三份真相源（本仓库为"两份真相源"付过多次代价）。
// `tests/guards/capabilityLayering.test.ts` 断言"生成物 == 附录 == preload"。
import type { AiToolDefinition } from '@shared/types/ai';
import type { RegisteredHandler } from './registry';
import { CAPABILITY_ACCESS, CAPABILITY_CATALOG } from '../capabilityCatalog.generated';
import {
  DIRECT_OPTIONAL,
  DIRECT_SIGNATURES,
  PROPOSABLE_OPTIONAL,
  PROPOSABLE_SIGNATURES,
} from '@shared/ai/capabilityPolicy.generated';
import type { CapabilityEntry, CapabilityLayer } from '../capabilityCatalog.generated';

/**
 * 一次最多回多少条。
 *
 * 与 `list_nodes` 收窄是**同一个理由**：目录本身也会撑爆上下文
 * （节点目录实测 13,338 字符曾把别的段全挤掉）。宁可回"共 N 条、这是前 40 条"，
 * 也不要回一整张表。
 */
const MAX_RESULTS = 40;

/** 展示顺序：模型能直接用的排前面，禁止的排最后 */
const LAYER_ORDER: CapabilityLayer[] = ['Q', 'M', 'R', 'P', 'X', 'F'];

const LAYER_RE = /^[RQMPFX]$/;

/** 调用约定里是否含 projectPath（含的话渲染层/主进程会注入当前项目，模型不用给） */
function sameProjectPathParam(signature: readonly string[]): boolean {
  return signature.includes('projectPath');
}

function formatEntry(e: CapabilityEntry): string {
  return `${e.id}  [${e.layer}]  ${CAPABILITY_ACCESS[e.layer]}`;
}

const DISCOVERY_DEFS: AiToolDefinition[] = [
  {
    name: 'search_capabilities',
    description:
      '查询**这台应用具备哪些能力**（能力目录：每个能力属于哪一层、模型能不能调）。' +
      '当你需要做一件事、而现有工具覆盖不到时，**先搜这里**，再决定要不要提方案让用户去做。' +
      '层的含义：Q = 只读、模型可直接调用；M = 有副作用、只能提出提案等用户确认；' +
      'R = 应用会自动放进上下文的数据（通常不必主动查）；P = 必须用户在界面上亲自操作；' +
      'F = 明确禁止模型调用（出现它说明这条路走不通，别再试）。' +
      '返回紧凑列表（id + 层 + 一句"该怎么用"），最多 40 条并交代总数。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '关键词，匹配能力 id（例如 launchData、queryTable、docker）。留空则按层列出。',
        },
        layer: {
          type: 'string',
          description: '只看某一层，取值 Q / M / R / P / F / X 之一。留空则返回全部层。',
        },
      },
    },
    category: 'query',
  },
  {
    name: 'describe_capability',
    description:
      '查看**某一条能力的详情**（所属层、模型能不能调用、为什么）。' +
      'id 形如「命名空间.方法」，**必须先用 search_capabilities 拿到真实 id**，不要凭印象拼。' +
      '搜不到时本工具会回一条可执行的提示，而不是沉默失败。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '能力 id，形如 launchData.queryTable（命名空间.方法）。',
        },
      },
      required: ['id'],
    },
    category: 'query',
  },
];

/** 发现工具的声明 */
export function capabilityDiscoveryDefinitions(): AiToolDefinition[] {
  return DISCOVERY_DEFS;
}

export const CAPABILITY_DISCOVERY_HANDLERS: Record<string, RegisteredHandler> = {
  /** 按关键词 / 层过滤目录。**只读**，不碰磁盘、不碰网络。 */
  search_capabilities: ({ args }) => {
    const rawQuery = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const rawLayer = typeof args.layer === 'string' ? args.layer.trim().toUpperCase() : '';

    if (rawLayer && !LAYER_RE.test(rawLayer)) {
      return {
        result:
          `layer 取值不合法：「${String(args.layer)}」。只能是 Q / M / R / P / F / X 之一；` +
          '不传则返回全部层。',
      };
    }

    const matched = CAPABILITY_CATALOG.filter((e) => {
      if (rawLayer && e.layer !== rawLayer) return false;
      if (!rawQuery) return true;
      return e.id.toLowerCase().includes(rawQuery);
    }).sort((a, b) => {
      const d = LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer);
      return d !== 0 ? d : a.id < b.id ? -1 : 1;
    });

    if (matched.length === 0) {
      const hint = rawQuery
        ? `没有匹配「${rawQuery}」的能力。换个更短的词（例如只写命名空间，如 launchData）再试。`
        : '没有匹配的能力。';
      return { result: `${hint}\n目录共 ${CAPABILITY_CATALOG.length} 条。` };
    }

    const shown = matched.slice(0, MAX_RESULTS);
    const head = `匹配 ${matched.length} 条${matched.length > shown.length ? `（只列前 ${shown.length} 条）` : ''}：`;
    const foot =
      matched.length > shown.length
        ? `\n…还有 ${matched.length - shown.length} 条。用更具体的关键词缩小范围。`
        : '';
    return { result: `${head}\n${shown.map(formatEntry).join('\n')}${foot}` };
  },

  /** 查单条。找不到时给可执行的下一步，而不是一句"未找到"。 */
  describe_capability: ({ args }) => {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) return { result: 'id 不能为空。先用 search_capabilities 查一个真实 id。' };

    const entry = CAPABILITY_CATALOG.find((e) => e.id === id);
    if (!entry) {
      // 同方法名的近似项（拼错命名空间是最常见的错法）
      const method = id.includes('.') ? id.split('.').pop()! : id;
      const near = CAPABILITY_CATALOG.filter((e) => e.method === method).slice(0, 5);
      return {
        result:
          `没有「${id}」这条能力。` +
          (near.length
            ? `\n同名的其它能力：\n${near.map((e) => `  ${e.id}  [${e.layer}]`).join('\n')}`
            : '\n用 search_capabilities 搜关键词拿到真实 id。'),
      };
    }

    const callable =
      entry.layer === 'Q'
        ? '可以：这是只读能力，模型可直接调用（执行层将在下一步接上）。'
        : entry.layer === 'M'
          ? '不能直接改：只能提出提案，等用户在界面上确认后才生效。'
          : '不能调用。';
    // 调用约定：直接调用看附录 B、提案看附录 C —— 不告诉模型参数名，它只能瞎猜
    const direct = entry.layer === 'Q' || entry.layer === 'M';
    // 显式标成 Record：生成物是两个字面量对象，联合索引签名不可用（TS7053）
    const signatures: Record<string, readonly string[]> =
      entry.layer === 'Q' ? DIRECT_SIGNATURES : PROPOSABLE_SIGNATURES;
    const optionalMap: Record<string, readonly string[]> =
      entry.layer === 'Q' ? DIRECT_OPTIONAL : PROPOSABLE_OPTIONAL;
    const signature = direct ? signatures[entry.id] : undefined;
    const optional = new Set(direct ? (optionalMap[entry.id] ?? []) : []);
    const paramLine = signature
      ? signature.length === 0
        ? '参数: 无'
        : `参数: ${signature.map((p) => (optional.has(p) ? `${p}?` : p)).join(', ')}` +
          (sameProjectPathParam(signature)
            ? '\n  （projectPath 由应用注入当前项目，不需要你提供）'
            : '')
      : '参数: 未登记调用约定（不能调用）';

    return {
      result: [
        `id: ${entry.id}`,
        `所属层: ${entry.layer}`,
        `含义: ${CAPABILITY_ACCESS[entry.layer]}`,
        `模型可调用性: ${callable}`,
        paramLine,
      ].join('\n'),
    };
  },
};
