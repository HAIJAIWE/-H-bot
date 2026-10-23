// src/renderer/src/lib/infra/storageKeys.ts
/**
 * 渲染层本地存储键的**唯一清单** + 历史键迁移。
 *
 * ## 为什么要有这个文件
 *
 * 2026-10-18 隔离审计（B22）：8 个 localStorage 键用了 **3 种分隔符**
 * （`qqbat_locale` / `qqbat-theme` / `qqbat:recentNodes`），还有 1 个完全没前缀的
 * sessionStorage 键（`playerSearchHistory`）。分隔符不一致本身不致命，但它让
 * 「这键是不是我们的」这件事没法一眼回答，也让 `scripts/identity` 的 R3 闸门只能靠基线兜着。
 *
 * ## 迁移策略：**双读单写，旧键不删**
 *
 * 新键（`qqbat:<区>:<项>`）是唯一写入目标；启动时把旧键的值**复制**过去，旧键保留。
 * 不删旧键的两个理由：
 *   1. 用户可能回退到旧版本 —— 旧版本只认旧键，删了就是"主题/语言全重置"；
 *   2. 万一新键迁移逻辑出错，旧键还在，用户数据没丢。
 * 下一个 minor 再从 `LEGACY_STORAGE_KEYS` 里删映射（那时才允许真删旧键）。
 *
 * ## 为什么在模块顶层就执行迁移
 *
 * zustand 的 `persist` 在**模块导入时**就 rehydrate 了。如果迁移晚于 store 导入，
 * 新键还不存在 → rehydrate 拿默认值 → 用户的布局偏好在一次启动里"丢一次"，
 * 然后被默认值覆盖写回。所以：本模块必须是渲染层**第一个**被求值的业务模块
 * （见 `main.tsx` 的第一行 import）。
 */

/** 全部存储键（新增键一律加在这里，不要再在业务代码里写字符串字面量） */
export const STORAGE_KEYS = {
  /** 界面语言 */
  locale: 'qqbat:locale',
  /** 主题 id */
  theme: 'qqbat:theme',
  /** 布局偏好（zustand persist 的 name） */
  ui: 'qqbat:ui',
  /** 最近使用的节点 */
  recentNodes: 'qqbat:recentNodes',
  /** 收藏的节点 */
  favoriteNodes: 'qqbat:favoriteNodes',
  /** 节点面板折叠状态 */
  paletteCollapsed: 'qqbat:paletteCollapsed',
  /** 新手引导是否已完成 */
  canvasGuideCompleted: 'qqbat:canvasGuideCompleted',
  /** 上次查看崩溃详情的时间 */
  crashLastViewed: 'qqbat:crashLastViewed',
  /** 数据浏览器里玩家搜索历史（sessionStorage，纯会话态） */
  playerSearchHistory: 'qqbat:playerSearchHistory',
} as const;

/**
 * 旧键 → 新键。**只复制不删除**；确认过两个 minor 没人回退后整段删掉。
 */
export const LEGACY_STORAGE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['qqbat_locale', STORAGE_KEYS.locale],
  ['qqbat-theme', STORAGE_KEYS.theme],
  ['qqbat-ui', STORAGE_KEYS.ui],
  ['qqbat_canvas_guide_completed', STORAGE_KEYS.canvasGuideCompleted],
  // 无前缀的那个键（本轮新加映射，此前提交里已经直接改成新名字了）
  ['playerSearchHistory', STORAGE_KEYS.playerSearchHistory],
];

/**
 * 把旧键的值复制到新键（新键已存在则跳过，绝不覆盖用户在 Read 之后改过的值）。
 *
 * 返回实际迁移了哪些键（给测试与调试用；生产路径不打印，避免刷日志）。
 */
export function migrateStorageKeys(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const migrated: string[] = [];
  for (const [legacy, current] of LEGACY_STORAGE_KEYS) {
    try {
      const value = localStorage.getItem(legacy);
      if (value === null) continue;
      if (localStorage.getItem(current) !== null) continue; // 新键已有值 → 不覆盖
      localStorage.setItem(current, value);
      migrated.push(legacy + ' → ' + current);
    } catch {
      // 隐私模式 / 配额满：迁移失败不该挡住应用启动
    }
  }
  return migrated;
}

// ⚠️ 模块加载即迁移：必须早于任何 zustand store 的 rehydrate（见文件头）。
migrateStorageKeys();
