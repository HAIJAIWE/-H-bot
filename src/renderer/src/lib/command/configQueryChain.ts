// src/renderer/src/lib/command/configQueryChain.ts
//
// ⚠️ 2026-10-06：纯逻辑**搬到了 `@shared/nodes/configQueryChain`** —— 智能体的 `new_lookup`
// 工具要在**主进程**算出同一条链（预览图/提案校验要看得见它提的改动），
// 而 `tsconfig.node` 不含 `src/renderer`。本文件保留为**再导出**，导入方一行都不用改。
export * from '@shared/nodes/configQueryChain';
