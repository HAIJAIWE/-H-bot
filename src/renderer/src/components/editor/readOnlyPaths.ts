// src/renderer/src/components/editor/readOnlyPaths.ts
//
// ⚠️ 2026-10-06：规则**搬到了 `@shared/files/readOnlyPaths`** —— 同一条口径现在有两个使用者：
//   · 代码编辑器（哪些文件锁成只读）
//   · 智能体的写文件工具（**不许绕过画布直接改 `.qqbat/flow.json`**）
// 两处各写一份的话，迟早出现"界面锁着、助手却能写"的裂缝。本文件保留为再导出。
export * from '@shared/files/readOnlyPaths';
