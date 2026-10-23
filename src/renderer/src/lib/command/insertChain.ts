// src/renderer/src/lib/command/insertChain.ts
//
// 「把一条现成的链铺到画布上」的**唯一入口**。
//
// ## 为什么必须有它（2026-10-06）
//
// 同一条"批量建节点 + 连线"现在有**两条触发路径**：
//   · 人来点：片段库的「插入」/「新建指令」向导
//   · 智能体来提：提案里的 `apply_template` / `new_command`（用户点确认后执行）
// 两边各写一份 `insertTemplate` 参数拼装的话，迟早出现"AI 铺出来的链和向导铺出来的不一样"
// （本项目为这类分裂栽过好几次：同一件事两份实现 → 改漏一处）。都从这里走。
import {
  useFlowStore,
  beginHistoryBatch,
  endHistoryBatch,
  pushHistoryPoint,
} from '../../stores/flowStore';
import { t } from '../../i18n';
import { SUBFLOW_TEMPLATES } from './subflowTemplates';
import { buildCommandChain, type CommandWizardInput } from './commandWizard';
import { buildConfigQueryChain, type ConfigQueryInput } from './configQueryChain';

/**
 * 铺一条「新建指令」的链（与界面向导**同一实现**）。
 *
 * @returns 新节点 id（顺序与链里的节点索引一致，调用方靠它定位/聚焦）
 */
export function insertCommandChain(input: CommandWizardInput): string[] {
  const chain = buildCommandChain(input);
  return useFlowStore.getState().insertTemplate({
    id: 'new-command',
    name: t('blocks.editor.wizard.command'),
    description: t('blocks.editor.wizard.commandChainDesc'),
    // category 是 SubflowTemplate['category'] 的**数据值**（中文常量联合类型），
    // 参与片段库过滤，不能翻译（TemplateLibrary 用数据值比对）。
    category: '消息回复',
    nodes: chain.nodes,
    edges: chain.edges,
    usageHint: '',
  });
}

/**
 * 铺一条「新建查询」的链（查表 → 回复），含那条**伪源边**配置绑定。
 *
 * ⚠️ 配置绑定必须"插入后按索引翻译成真实 id"（`__config_api__` 是伪源，引用的是目标节点的真实 id），
 * 所以这里分两步，并用 `beginHistoryBatch` 包住 —— 否则"插节点"和"建绑定边"会各压一次历史，
 * 用户要按两次 Ctrl+Z 才撤得掉一条指令（一次操作 = 一次撤销）。
 */
export function insertConfigQueryChain(input: ConfigQueryInput): string[] {
  const chain = buildConfigQueryChain(input);
  const before = useFlowStore.getState();
  pushHistoryPoint(before.nodes, before.edges);
  beginHistoryBatch();
  try {
    const ids = useFlowStore.getState().insertTemplate({
      id: 'config-query',
      name: t('blocks.editor.wizard.lookup'),
      description: t('blocks.editor.wizard.lookupChainDesc'),
      category: '数据读写',
      nodes: chain.nodes,
      edges: chain.edges,
      usageHint: '',
    });
    for (const def of chain.configApiEdges) {
      const targetId = ids[def.target];
      if (!targetId) continue;
      const paramNodeId = def.paramRef ? ids[def.paramRef.node] : undefined;
      useFlowStore.getState().addEdge({
        id: `e-cfgapi-${targetId}-${def.targetPort}`,
        source: '__config_api__',
        sourcePort: '__api__',
        target: targetId,
        targetPort: def.targetPort,
        configApi: {
          table: def.table,
          field: def.field,
          dbPath: def.dbPath,
          ...(def.where ? { where: def.where } : {}),
          ...(def.paramRef && paramNodeId
            ? { whereParamRef: { nodeId: paramNodeId, portId: def.paramRef.port } }
            : {}),
        },
      });
    }
    return ids;
  } finally {
    endHistoryBatch();
  }
}

/**
 * 铺一条**预置玩法片段**（片段库那 21 条；智能体的 `apply_template` 走的也是这里）。
 *
 * @returns 新节点 id；`templateId` 不存在时返回 `null`（由调用方给用户/模型一句可读的话）
 */
export function insertPresetTemplate(templateId: string): string[] | null {
  const tpl = SUBFLOW_TEMPLATES.find((x) => x.id === templateId);
  if (!tpl) return null;
  return useFlowStore.getState().insertTemplate(tpl);
}
