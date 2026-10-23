// src/renderer/src/components/launch/playerFieldsModel.ts
//
// 玩家数据卡片的**字段推导模型**。
//
// ## 为什么要有这个模块
//
// 原来的角色卡靠两份"猜"的东西决定显示什么：
//
//   1. `dataTemplateService.getDefaultTemplate()` —— 一份与项目**无关**的通用示例模板
//      （`registered_at` / `last_active` / `title` / `permission` / `signin_count` …）；
//   2. 硬编码的 `FIELD_ALIASES`（`rawKey → {label, category}`）。
//
// 后果实测（RPG 项目）：**项目自己声明了 8 个持久化 key，玩家存档里 8 个全在**，
// 而面板一个都没认出来 —— 反而把通用模板里那些**项目里从不存在**的字段画成「（未初始化）」。
// 用户的话：「这些为啥没出现呀？」（问的是 `bag`/`equip`/`lv` 为什么没出现）。
//
// ## 现在的规则（见 docs/game/player-data-cards-design.md）
//
//   **面板只展示项目存在的字段，并优先用项目自己的配置表来描述它。**
//
// 字段清单 = 并集：
//   (1) `{项目}/.qqbat/flow.json` 里 `variable_persist` 节点声明的 `config.key`（权威：项目真的在读写）
//   (2) `_persistent` 里真实存在的、属于该玩家的行
//
// 通用模板**不再决定"字段存不存在"**，只在最后一步帮"叫什么名"。
import type { FlowGraph } from '@shared/types/flow';
import type { FieldCategory } from '@shared/types/launch';
import { isBaseDataKey } from '@shared/persist/baseKeys';
import {
  canonicalFieldName,
  isEngineStateField,
  semanticLabel,
  semanticOf,
  toFieldCategory,
} from '@shared/persist/fieldSemantics';
import { t, hasKey } from '../../i18n';
import { dataFieldLabel } from '../../i18n/fieldLabels';
// 字段"存在性"的唯一来源：主进程推导玩家 schema 用的是同一个函数（见 shared/persist/fieldUsages.ts）
import { collectFieldUsages, fieldKeyOf, type FieldUsage } from '@shared/persist/fieldUsages';

export { collectFieldUsages, fieldKeyOf };
export type { FieldUsage };

/**
 * 字段的显示分类（决定进哪个卡片）。
 *
 * 直接复用 shared 的 `FieldCategory` —— 这里曾经是**第四个**同义联合类型，
 * 与 `shared/types/launch.FieldCategory`、`dataBrowserConstants.FieldCategory` 各写一份，
 * 是"同一个概念多处定义"的典型漂移源。
 */
export type PlayerFieldCategory = FieldCategory;

/** 一个待显示的字段（已合并"流程声明"与"存档实际值"） */
export interface PlayerField {
  /** 原始 key（如 `hp` / `bag`） */
  key: string;
  /** 面板上显示的名字 */
  label: string;
  /** 显示分类 */
  category: PlayerFieldCategory;
  /** 解包后的用户值；`hasValue === false` 时忽略 */
  value: unknown;
  /** 玩家存档里是否真的有这条（false = 流程声明了但玩家还没触发过） */
  hasValue: boolean;
  /** 流程里怎么用它（有则显示在卡片上，说明这是可增减的还是只读的） */
  usage?: FieldUsage;
  /**
   * 是不是**引擎基础数据**（`__sys_*`：注册时间/最后在线/消息计数/昵称）。
   *
   * 卡片据此把它单独成块：它既不该混进数值网格（`__sys_msg_count` 混在金币里很怪），
   * 也不受 `categoryFor` 的业务分类影响。
   */
  isBaseData: boolean;
  /**
   * 是不是**项目自己的运行状态**（`battle`/`monster_hp`/`actions`/`footer`/`log`）。
   *
   * 这些是战斗系统在运行时写的内部数据（当前怪血量、可行动作、日志文本），
   * **不是玩家属性**。卡片把它们收进一个默认折叠的「引擎状态」区 ——
   * 留在数值网格里会让 `你使用【普攻】…` 这种长文本占掉一格（还被截断），
   * 用户从卡片上读不出"玩家有什么"。
   */
  isEngineState: boolean;
}

/**
 * 名称推导。
 *
 * 优先级：
 *   1. `data.field.*` 语言包（`dataFieldLabel`：**两份语言包都有才算存在**，
 *      否则英文界面会显示中文）；
 *   2. 共享语义表的规范名映射（`fieldSemantics.semanticLabel`，与主进程推导模板时同一套）；
 *   3. 流程节点的 label（作者自己起的中文名，最准）—— 但节点名往往是句子（「读取当前HP」），
 *      所以只在"短且不含动词"时采用；
 *   4. key 本身。
 *
 * **注意**：这里只决定"叫什么"，不决定"存不存在"。存不存在由
 * `collectFieldUsages` + 存档决定。文案一律走 i18n —— 硬编码中文会被
 * `tests/renderer/i18n/noHardcodedCopy.test.ts` 拦下（这条闸门是对的）。
 */
export function labelFor(key: string, usage?: FieldUsage): string {
  const fromPack = dataFieldLabel(canonicalFieldName(key));
  if (fromPack) return fromPack;
  const fromSemantics = semanticLabel(key);
  if (fromSemantics) return fromSemantics;
  // 流程节点名：只接受短名（≤6 字且不含"读取/保存/初始化/计算"这类动词），否则会得到
  // 「读取当前HP」这种不像字段名的东西
  const nodeLabel = usage?.label;
  if (nodeLabel && nodeLabel.length <= 6 && !/[读取保存初始化计算设更]/.test(nodeLabel)) {
    return nodeLabel;
  }
  return key;
}

export function categoryFor(key: string, value: unknown, hasValue: boolean): PlayerFieldCategory {
  // 分类与主进程推导模板时**共用同一套语义**（`shared/persist/fieldSemantics`），
  // 否则会出现"模板说这是战斗属性、卡片把它归到统计"这种漂移。
  const mapped = toFieldCategory(semanticOf(key, value));
  // `semanticOf` 永远有返回值（未命中按值形状兜底），但「未命中 + 没有值」时
  // 它给的是 status，而没数据的字段放"统计"区更合适
  if (!hasValue && mapped === 'status' && !isKnownField(key)) return 'stats';
  return mapped;
}

/** 这个名字是否在共享语义表里有明确分类（用于区分"推断"与"兜底"） */
function isKnownField(key: string): boolean {
  return semanticLabel(key) !== undefined;
}

/**
 * 把「流程声明的字段」与「存档里实际存在的字段」合并成要显示的列表。
 *
 * @param usages `collectFieldUsages` 的结果
 * @param storedRows `_persistent` 的行（已按玩家过滤、scope != global）
 * @param unwrap 值解包函数（`@shared/persist/value` 的 `unwrapPersistentValue`）——
 *               传进来是为了让这个模块不依赖运行时，便于单测
 */
export function buildPlayerFields(
  usages: Map<string, FieldUsage>,
  storedRows: { key: string; value: unknown }[],
  unwrap: (raw: unknown) => unknown,
  /**
   * **玩家字段契约**（主进程 `playerSchemaService` 派生：流程声明 ∪ 存档实际值，
   * 项目可在 `data/players/player.schema.json` 覆盖中文名/类型/分类）。
   *
   * 有契约就用它的 label/category —— 这是"项目自己说了算"，比任何别名表都准；
   * 没有就退回原来的推导（契约是**增强**，不是必需依赖）。
   */
  schemaFields?: Map<string, { label: string; category: FieldCategory }>,
): PlayerField[] {
  const stored = new Map<string, unknown>();
  for (const row of storedRows) {
    const k = fieldKeyOf(String(row.key ?? ''));
    if (k && !stored.has(k)) stored.set(k, unwrap(row.value));
  }

  const keys = new Set<string>([...usages.keys(), ...stored.keys()]);
  const fields: PlayerField[] = [];
  for (const key of keys) {
    const hasValue = stored.has(key);
    const value = hasValue ? stored.get(key) : undefined;
    const base = isBaseDataKey(key);
    const fromSchema = schemaFields?.get(key);
    fields.push({
      key,
      label: fromSchema?.label ?? labelFor(key, usages.get(key)),
      // 基础数据不按业务语义分类：它的归属由 `isBaseData` 决定（卡片单独成块）
      category: base ? 'status' : (fromSchema?.category ?? categoryFor(key, value, hasValue)),
      value,
      hasValue,
      usage: usages.get(key),
      isBaseData: base,
      // 基础数据本身就是引擎维护的，不再重复标"运行状态"
      isEngineState: !base && isEngineStateField(key),
    });
  }
  return fields;
}

/** 字段用法的可读描述（卡片上标注"这个字段在流程里是怎么用的"） */
export function describeUsage(usage?: FieldUsage): string {
  if (!usage) return '';
  const modes = [...usage.modes];
  // `increment` 说明它是可增减的计数器；`load_or_default` 说明有首次默认值。
  // 文案走 `data.usage.*`（i18n），不硬编码 —— 硬编码中文会被 noHardcodedCopy 拦下。
  // 查不到就不显示（旧流程可能有本版没有的 mode）。
  // 内联模板是有意为之：i18n 的孤儿键闸门靠 `t(`data.usage.${…}`)` 认动态族。
  const labelOf = (mode: string): string =>
    hasKey(`data.usage.${mode}`) ? t(`data.usage.${mode}`) : '';
  const parts: string[] = [];
  if (modes.includes('increment')) parts.push(labelOf('increment'));
  if (modes.includes('load_or_default')) parts.push(labelOf('load_or_default'));
  if (modes.includes('save')) parts.push(labelOf('save'));
  if (modes.length === 1 && modes[0] === 'load') parts.push(labelOf('load'));
  return parts.filter(Boolean).join(' · ');
}
