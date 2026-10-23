// src/renderer/src/lib/node/platformEntries.ts
//
// **UI 入口的平台标签** —— 与节点库同一套规则（`shared/domain/project/botTypeConfig` 的
// `isPlatformVisible`）：不带平台标签的（通用）任何项目都显示；带了标签的只有"本平台"项目才显示。
//
// 为什么单独一个文件：这样测试能**便宜地** import 它（BlockEditor 太大，拉进来不值得），
// 而且以后加"微信/飞书专属入口"时，改这里一处就行 ✓
//
// 判定口径与节点一致：**只挡别的平台的**专属入口 —— QQ 项目里不出现飞书/微信的，反之亦然 ✓

/** 工具栏（低代码编辑器）上的平台专属入口 */
export const TOOLBAR_PLATFORM_TAGS = {
  /** 挑哪些指令进 QQ 的 `/` 快捷面板 —— QQ 平台专有 */
  commandPanel: ['QQ'],
  /** QQ 机器人上线前的出厂配置（凭据 / 菜单 / 面板 / 服务范围 / 自检）—— QQ 平台专有 */
  factoryConfig: ['QQ'],
} as const satisfies Record<string, readonly string[]>;

/** 顶层（开发模式）标签页上的平台专属入口 */
export const TOP_TAB_PLATFORM_TAGS = {
  /** 「面板」= 按钮面板（inline keyboard），面向 QQ/OneBot —— QQ 平台专有 */
  panels: ['QQ'],
} as const satisfies Record<string, readonly string[]>;

/** 所有已登记的平台专属 UI 入口（测试遍历用） */
export const PLATFORM_ENTRIES: readonly { id: string; tags: readonly string[] }[] = [
  ...Object.entries(TOOLBAR_PLATFORM_TAGS).map(([id, tags]) => ({ id: `toolbar.${id}`, tags })),
  ...Object.entries(TOP_TAB_PLATFORM_TAGS).map(([id, tags]) => ({ id: `topTab.${id}`, tags })),
];
