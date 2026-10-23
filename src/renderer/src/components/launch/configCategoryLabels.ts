// src/renderer/src/components/launch/configCategoryLabels.ts
//
// 配置分类的**界面文案层**（中英双语）。
//
// ## 为什么需要它
//
// `displayName` 与 `description` 是**主进程**给的（`configService.listConfigCategories` 里的
// `CONFIG_DISPLAY_NAMES` / `CONFIG_DESCRIPTIONS`）。主进程没有语言概念，于是切到英文界面时，
// 配置卡片上的描述仍然是中文 —— 实测就是这个现象。
//
// 而 i18n 的「硬编码中文」闸门（`tests/renderer/i18n/noHardcodedCopy.test.ts`）只扫
// 渲染层源码里写死的中文，**扫不到"主进程传过来的中文"**，所以它一直是绿的。
//
// ## 约定
//
// - `labels` 是**已知分类的键表**，与 zh-CN.json 的取值一一对应 —— 中文文案的唯一真相在语言包里，
//   这里只列键名（否则又是"同一句话两处维护"）；
// - 查不到译文时回退主进程给的值（未知/自定义分类至少不显示空白）。
import { t } from '../../i18n';

/** 主进程给的分类对象（只用到这三个字段） */
export interface ConfigCategoryLike {
  name: string;
  displayName?: string;
  description?: string;
}

/**
 * 已知分类 → i18n 键名。
 * 键名不合法（含 `-`、空格等）的**不能**放进来：`t()` 对非法键名会走别的解析路径。
 */
const KEYS: Record<string, string> = {
  equipment: 'equipment',
  skills: 'skills',
  pets: 'pets',
  mounts: 'mounts',
  items: 'items',
  quests: 'quests',
  achievements: 'achievements',
  dungeons: 'dungeons',
  guilds: 'guilds',
  rankings: 'rankings',
  vip: 'vip',
  sign_in: 'sign_in',
  lottery: 'lottery',
  trading: 'trading',
  titles: 'titles',
  global: 'global',
};

function lastSegment(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

/** 分类显示名（本地化）：优先语言包，回退主进程给的 displayName / 分类名 */
export function categoryLabel(cat: ConfigCategoryLike): string {
  const fallback = cat.displayName || cat.name;
  const k = KEYS[cat.name];
  if (!k) return fallback;
  // 内联模板是有意为之：i18n 孤儿键闸门靠 `t(`data.configCategory.${…}`)` 认动态族。
  const localized = t(`data.configCategory.${k}`);
  return localized === lastSegment(k) ? fallback : localized;
}

/** 分类描述（本地化）：优先语言包，回退主进程给的 description */
export function categoryDescription(cat: ConfigCategoryLike): string {
  const fallback = cat.description || '';
  const k = KEYS[cat.name];
  if (!k) return fallback;
  const localized = t(`data.configCategory.${k}.desc`);
  return localized === lastSegment('desc') ? fallback : localized;
}
