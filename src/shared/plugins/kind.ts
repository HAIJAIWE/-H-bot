// src/shared/plugins/kind.ts
//
// **插件包类型判别**（2026-10-19）：同一个 `plugins/<name>/` 目录下，可能是
//   · 节点插件（现有）：清单声明 `nodes`，入口导出 handler 集合（`entry` 是**两类包共有**的字段，不作判别）；
//   · AI 插件（新）：清单声明 `ai: true`，入口导出 `activate(api)`。
//
// 判别单独抽出来，是为了让装配器（pluginScanner）只问"这是什么包"，不用自己猜字段；
// 同时把**互斥规则**钉死：一个包不能既是节点插件又是 AI 插件（同时声明按无效处理）。
export type PluginPackageKind = 'node' | 'ai';

export type PluginKindResult =
  | { kind: PluginPackageKind }
  | { kind: 'invalid'; error: string };

export function detectPluginKind(manifest: unknown): PluginKindResult {
  if (!manifest || typeof manifest !== 'object') {
    return { kind: 'invalid', error: 'manifest must be an object' };
  }
  const m = manifest as Record<string, unknown>;
  const isAi = m.ai === true;
  // 只有 `nodes` 才是节点插件身份。`entry` **不能**算 —— 装载器对两类包都强制它
  // （见 pluginScanner.validateManifest:47），把它当身份标记会让每个 AI 插件都被判成
  // "身份冲突"，AI 那支永远走不到。
  const declaresNodes = Array.isArray(m.nodes);
  if (isAi && declaresNodes) {
    return { kind: 'invalid', error: 'manifest cannot be both an AI plugin and a node plugin' };
  }
  if (isAi) return { kind: 'ai' };
  return { kind: 'node' };
}
