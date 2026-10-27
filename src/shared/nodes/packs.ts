// src/shared/nodes/packs.ts
//
// 平台节点包（第 66 批 P2b）—— 把「节点目录」按**平台族**切成可枚举的包。
//
// 为什么要有包：`builtinCatalog.ts` 目前是「17 个分组文件静态拼成一个数组」，平台归属
// 只写在每个节点的 `platform` / `tags` 里。这样加一个新平台只能往数组里塞节点，没办法
// 回答「哪些节点属于 QQ 包」「飞书项目该加载哪一坨」，也没法在将来把一整个包换成外部
// 插件（P4 生态）—— 包是「交付单位」，注册表（第 64 批）是「判定口径」。
//
// 本批只做**结构 + 契约**，不改行为：`NODE_CATALOG_V2` 的顺序与内容保持原样，
// 包是它的视图；消费方（按平台收窄 / 外部包注册）留给下一批，所以这里**只导出被用到的
// 出口**（`buildNodePacks` 与类型），不预埋没人调的查询函数。
//
// 一个节点只能属于一个包：有平台标注 → 该平台族包；没有标注 → `common`。
// 「多平台同时可用」目前没有真实节点，真出现时由 `tests/guards/nodePackContract.test.ts`
// 报出来，再决定是拆节点还是扩包语义。
import type { NodeSpecV2 } from '../types/nodeV2'
import { nodePlatformTags, type PlatformFamily } from '../domain/platform/registry'

/** 包的 id：`common`（通用）或某个平台族 */
export type NodePackId = PlatformFamily | 'common'

/** 一个平台节点包：id + 它承载的平台族 + 节点清单 */
export interface NodePack {
  id: NodePackId
  /** 平台族；`common` 包为空数组（通用节点，任何平台都能用） */
  families: readonly PlatformFamily[]
  specs: readonly NodeSpecV2[]
}

/** 这个节点归哪个包 —— 有平台标注取第一个族，否则 `common`（切包唯一规则） */
function packIdOf(spec: Pick<NodeSpecV2, 'platform' | 'tags'>): NodePackId {
  const families = nodePlatformTags(spec)
  return families[0] ?? 'common'
}

/**
 * 把节点目录切成包。
 *
 * 顺序：`common` 永远排第一（它是所有平台的基线），其余按**在目录里第一次出现**的顺序，
 * 这样包的顺序跟着 `builtinCatalog.ts` 的节点顺序走，不依赖一份额外的手写清单（少一处会漂的地方）。
 */
export function buildNodePacks(specs: readonly NodeSpecV2[]): NodePack[] {
  const buckets = new Map<NodePackId, NodeSpecV2[]>()
  for (const spec of specs) {
    const id = packIdOf(spec)
    const bucket = buckets.get(id)
    if (bucket) bucket.push(spec)
    else buckets.set(id, [spec])
  }

  const out: NodePack[] = []
  const common = buckets.get('common')
  if (common) out.push({ id: 'common', families: [], specs: common })
  for (const [id, bucket] of buckets) {
    if (id === 'common') continue
    out.push({ id, families: [id], specs: bucket })
  }
  return out
}
