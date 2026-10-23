// src/shared/nodes/subflowTemplateTypes.ts
//
// 片段（subflow template）的结构类型 —— 单一真相。
//
// 为什么单独一个文件：结构数据在 `subflowTemplateDefs.ts`（主进程侧运行时回归要跑），
// 文案在 renderer 的 `lib/command/subflowTemplates.ts`；两边都要引用同一份结构类型，
// 而 `tsconfig.node` 不含 `src/renderer`，所以类型必须落在 shared。
//
// 恢复说明：10/18 打包产物里类型已被擦除，本文件按**消费面**重建
// （`commandChain.ts` / `configQueryChain.ts` / renderer 的 `subflowTemplates.ts` 的实际用法）。

/** 片段里的一个节点：kind + 配置；label 可选，只用于画布上的显示名 */
export interface TemplateNodeDef {
  kind: string;
  config: Record<string, unknown>;
  /** 画布显示名（缺省用目录里的 label） */
  label?: string;
}

/** 片段里的一条连线：按**索引**引用节点（0 起），与 SubflowTemplate 的约定一致 */
export interface TemplateEdgeDef {
  /** 起点节点下标 */
  from: number;
  /** 起点端口 id（控制流是 next/out，数据流是端口 id） */
  fromPort: string;
  /** 终点节点下标 */
  to: number;
  /** 终点端口 id（控制流是 in，数据流是 var1/var2…） */
  toPort: string;
}

/** 片段结构定义（数据在 `subflowTemplateDefs.ts`，文案在 renderer） */
export interface SubflowTemplateDef {
  id: string;
  category: '数据读写' | '消息回复' | '流程控制' | '游戏逻辑' | '时间工具';
  nodes: TemplateNodeDef[];
  edges: TemplateEdgeDef[];
}
