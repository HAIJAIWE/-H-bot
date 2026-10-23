// src/renderer/src/lib/commandWizard.ts
//
// ⚠️ 2026-10-06：纯逻辑**搬到了 `@shared/nodes/commandChain`**。
//
// 原因：智能体新增了 `new_command` 工具，它要在**主进程**算出**同一条链**
// （预览图/提案校验都要看见它提的改动），而 `tsconfig.node` 不含 `src/renderer`。
// 本文件保留为**再导出** —— 原有 import（BlockEditor / NewCommandWizard / configQueryChain…）
// 一行都不用改，而实现仍然只有一份。
export * from '@shared/nodes/commandChain';
