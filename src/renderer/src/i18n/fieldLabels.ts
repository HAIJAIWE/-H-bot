// src/renderer/src/i18n/fieldLabels.ts
//
// 配置字段的**显示名与说明**的查询入口 —— 单一真相。
//
// ## 为什么要收敛（事故背景）
//
// 同一份字段中文名原本有 3 处副本：`propertyDrawerConstants.ts` 的 `CONFIG_LABELS`、
// `flowStore.ts` 的 `CONFIG_LABELS`（用于「xxx」为必填 这类校验提示）、以及
// `labels.yaml`（经死代码 `nodeMetadata.ts`）。审计脚本实测发现同一字段在两处叫法不同：
// `target_type` 在属性面板叫「推送目标」、在校验报错里叫「目标类型」——
// 用户看到报错说「目标类型」为必填，却在面板里找不到叫这个名字的字段。
//
// 现在：文案在 `i18n/*.json` 的 `field.label.*` / `field.hint.*`，
// 中文源在 `scripts/i18n/field-zh.json`，英文在 `scripts/i18n/field-en.json`，
// 由 `scripts/i18n-field-inject.mjs` 注入（改文案改那两个文件再跑脚本）。
import zhCN from './zh-CN.json';
import enUS from './en-US.json';
import { hasKey, t } from './index';

/** 字段显示名；查不到时回退为字段 key 本身（与旧 `CONFIG_LABELS[key] || key` 语义一致） */
export function fieldLabel(key: string): string {
  return hasKey(`field.label.${key}`) ? t(`field.label.${key}`) : key;
}

/** 字段说明；查不到时返回 undefined（**不要**回退成假文案，见 i18n/index.ts 的 hasKey 注释） */
export function fieldHint(key: string): string | undefined {
  return hasKey(`field.hint.${key}`) ? t(`field.hint.${key}`) : undefined;
}

/**
 * 通用字段显示名（`data.field.*` 命名空间，两份语言包都有才算存在）。
 *
 * 与 `fieldLabel`（`field.label.*`，配置字段专用）分开：`data.field.*` 是
 * "玩家数据/配置表"这一层的字段名（`hp` → 「生命值」、`exp` → 「经验值」…），
 * 已经有 190 条，玩家数据卡片与道具卡都该用它，而不是另建一份硬编码中文表。
 *
 * 不存在时返回 undefined，让调用方决定回退（通常是回退到 key 本身）。
 */
export function dataFieldLabel(key: string): string | undefined {
  // **两份都要有**：只有中文那份有的话，切英文界面会显示中文（比显示 key 更糟）。
  // 两个调用都写成内联模板：i18n 的孤儿键闸门靠 `t(`前缀${…}`)` 识别动态族。
  if (!hasKey(`data.field.${key}`)) return undefined;
  return t(`data.field.${key}`);
}

/**
 * 按命名空间查一条文案（查不到返回 undefined，由调用方决定回退）。
 *
 * 给「一批列名 → 中文标签」这类映射表用：写死中文会被
 * `noHardcodedCopy` 闸门拦下，用 `t()` 内联又会丢掉"查不到就回退"的能力。
 */
export function lookupMappedLabel(key: string): string | undefined {
  return hasKey(key) ? t(key) : undefined;
}

/** 输入端口的数据来源引导提示 */
export function portHint(key: string): string | undefined {
  return hasKey(`field.portHint.${key}`) ? t(`field.portHint.${key}`) : undefined;
}

/**
 * 反查：把错误消息里出现的**字段显示名**还原成 config key。
 *
 * ## 为什么要跨语言扫描
 * 错误消息由两层产生 —— renderer 侧（flowStore，跟随界面语言）与 shared 侧的校验器
 * （无 locale，始终中文）。若只按当前语言反查，英文界面下就认不出 shared 层产出的中文消息。
 *
 * ## 为什么要 preferKeys
 * 有几个**不同字段共用同一显示名**（实测 4 组：「条件」= condition/expression、
 * 「数据源」= dataSource/source、「文件路径」= file/file_path、「表名」= table/tableName）。
 * 光看文案无法判断该跳哪个字段 —— 例如「条件」为必填，在 database_write 上指 `condition`、
 * 在 branch_if 上指 `expression`。所以调用方应把**该节点真实拥有的字段**传进来消歧；
 * 不传时退回第一个匹配项（保证函数仍是纯函数、行为确定）。
 */
export function findFieldKeyByLabel(label: string, preferKeys?: readonly string[]): string | null {
  if (!label) return null;
  const matches: string[] = [];
  for (const pack of [zhCN, enUS]) {
    const labels = (pack as { field?: { label?: Record<string, string> } }).field?.label;
    if (!labels) continue;
    for (const [key, value] of Object.entries(labels)) {
      if (value === label && !matches.includes(key)) matches.push(`field.label.${key}`);
    }
  }
  // 其他命名空间里可能有**同值**的条目（实测 `data.fieldtype.text` 与
  // `field.label.text` 都是「文本」）。它们不是配置字段名，混进来会让反查挑错 key
  // （错误条跳转跳到不存在的字段）。这里统一用 `field.label.` 前缀标注来源，
  // 调用方拿到的仍是裸 key。
  const stripped = matches.map((m) => m.slice('field.label.'.length));
  if (stripped.length === 0) return null;
  if (stripped.length === 1 || !preferKeys) return stripped[0];
  return stripped.find((k) => preferKeys.includes(k)) ?? stripped[0];
}
