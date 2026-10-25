// src/main/services/agent-core/toolCatalog.ts
//
// **一张工具表的合并规则**（2026-10-25）。
//
// 循环的注册表（6 个通用文件工具 + 插件注册的）与领域工具那 27 个定义
// 从此是**同一张表**的两半。两半里有三条同名：read_file / write_file / validate_flow。
//
// 规则只有一条：**同名时循环版优先**。理由不是"新的更好"，而是闸门：
// 循环版认工作区相对路径、写盘要过审批；旧版直接执行、不认这套边界。
// 留错那一份，就等于同一个名字在两条路径上遵守两套规则。
//
// 合并规则写在这里，是因为有两处都得按同一条合并：
//   · `src/main/ipc/aiAgentCore.ts` —— 真正交给循环的可执行工具（走 adaptLegacyTools）
//   · `src/main/ipc/ai.ts` 的 ai:tools —— 界面上预设白名单能勾的那张表
// 两边各写一遍 `[...a, ...b.filter(not in a)]` 迟早有一边漏掉某个名字，
// 于是"界面上勾了"与"循环里拦得住"又对不上（这条已经踩过一次）。

/** 合并两半工具表：**同名时第一半（循环版）优先**，顺序保持稳定 */
export function mergeTools<T extends { name: string }>(
  loopTools: readonly T[],
  legacyTools: readonly T[],
): T[] {
  const loopNames = new Set(loopTools.map(tool => tool.name))
  return [...loopTools, ...legacyTools.filter(tool => !loopNames.has(tool.name))]
}
