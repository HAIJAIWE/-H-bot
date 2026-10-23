// src/main/services/plugins/scoping.ts
//
// **按插件集限定工具**（2026-10-19，会话预设）：预设的 plugins 是"会话级允许的插件"，
// 只读作用域 —— 不改全局启停，只决定这一轮模型能看到哪些工具。
//
// 语义：内置工具（不属于任何插件）**不受**插件集影响；插件贡献的工具只有其所属插件
// 在集合里才保留。集合为空/缺省 = 不限定。
export function scopeToolsByPlugins<T extends { name: string }>(
  all: readonly T[],
  owned: ReadonlyMap<string, string>,
  pluginIds: readonly string[] | undefined,
): T[] {
  if (!pluginIds || pluginIds.length === 0) return [...all];
  const allowed = new Set(pluginIds);
  return all.filter((tool) => {
    const owner = owned.get(tool.name);
    return owner === undefined || allowed.has(owner);
  });
}
