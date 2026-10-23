import React from 'react';
import type { BotType } from '@shared/types/project';
import { describeUsage, type PlayerField, type PlayerFieldCategory } from './playerFieldsModel';
import {
  buildItemCards,
  looksLikeItemList,
  type ConfigTable,
  type ItemCardModel,
} from './playerItemsModel';
import { BASE_DATA_KEYS } from '@shared/persist/baseKeys';
import {
  Swords,
  TrendingUp,
  Wallet,
  Tag,
  Sparkles,
  Backpack,
  Pencil,
  ChevronDown,
  IdCard,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

/**
 * 玩家数据卡片。
 *
 * ## 显示模型（见 docs/game/player-data-cards-design.md）
 *
 * **只展示项目存在的字段**，来源是并集：
 *   1. `{项目}/.qqbat/flow.json` 里 `variable_persist` 声明的 key（项目真的在读写）；
 *   2. 玩家存档（`_persistent`，`scope != 'global'`）里实际存在的 key。
 *
 * 通用默认模板（`dataTemplateService.getDefaultTemplate()`）**不再参与显示** ——
 * 它正是"画出一堆项目里不存在的字段（注册时间/称号/权限…）"的根因。
 *
 * 值的渲染按类型：
 *   - 标量 → 数值网格（**不做血条/进度条**，用户明确不要）；
 *   - 数组且每项有 `name` → **道具卡片**（名称 ×数量 + 从项目配置表查到的属性）；
 *   - 其余数组/对象 → 可读 JSON（原始内容放 `title`，便于开发者核对）。
 */

interface CharacterProfileCardProps {
  /** 已由取数层组装好的字段（见 playerViewData.loadPlayerView） */
  fields: PlayerField[];
  foundPlayerQQ: string | null;
  botType?: BotType;
  /** 编辑玩家信息回调（打开 players 表编辑弹窗） */
  onEditPlayer?: () => void;
  /** 项目的道具配置表（没找到时为 null → 道具卡只显示名称+数量） */
  itemConfig?: ConfigTable | null;
}

/** 分类 → 图标（`FieldCategory` 里没有 `growth`，成长类落在 `level`） */
const CATEGORY_ICONS: Partial<Record<PlayerFieldCategory, React.ReactNode>> = {
  level: <TrendingUp className="w-3.5 h-3.5" />,
  combat: <Swords className="w-3.5 h-3.5" />,
  economy: <Wallet className="w-3.5 h-3.5" />,
  stats: <Sparkles className="w-3.5 h-3.5" />,
  status: <Tag className="w-3.5 h-3.5" />,
  collection: <Backpack className="w-3.5 h-3.5" />,
};

/** 基础属性网格的顺序（等级排最前，其余按出现顺序） */
const GRID_ORDER: PlayerFieldCategory[] = ['level', 'combat', 'economy', 'stats', 'status'];

/** 值是「标本量」→ 进网格；是集合/对象 → 进卡片区 */
function isScalarLike(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value !== 'object';
}

/** 标量 → 显示文本 */
function formatScalar(value: unknown): string {
  if (value === null || value === undefined || value === '') return t('data.card.emptyValue');
  if (typeof value === 'boolean') return value ? t('data.yes') : t('data.no');
  if (typeof value === 'number') return String(value);
  return String(value);
}

/** 对象/数组 → 可读 JSON（绝不出现 `[object Object]`） */
function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 值是空集合（`[]` / `{}`）—— 卡片上显示"（空）"而不是空白 */
function isEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0;
  return false;
}

/** 计算属性条目数量（等价 `Array.isArray ? length : Object.keys().length`，避免三元里写两次） */
function collectionCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length;
  return 0;
}

export const CharacterProfileCard = React.memo(function CharacterProfileCard({
  fields,
  foundPlayerQQ,
  onEditPlayer,
  itemConfig,
}: CharacterProfileCardProps) {
  useLocaleSubscription();
  const [showRaw, setShowRaw] = React.useState<string | null>(null);

  const uid = foundPlayerQQ || '';

  // 昵称：优先引擎基础数据缓存的昵称，其次业务字段里的 nickname / name
  const engineNickname = fields.find((f) => f.key === BASE_DATA_KEYS.nickname && f.hasValue);
  const nicknameField = fields.find(
    (f) => (f.key === 'nickname' || f.key === 'name') && f.hasValue,
  );
  const nickname = engineNickname
    ? formatScalar(engineNickname.value)
    : nicknameField
      ? formatScalar(nicknameField.value)
      : '';
  const avatarChar = nickname ? nickname.charAt(0).toUpperCase() : uid ? uid.charAt(0) : '?';

  const present = fields.filter((f) => f.hasValue);
  // 基础数据单独成块：不进数值网格、不进物品区（`__sys_msg_count` 混在金币堆里很怪）
  const baseFields = present.filter((f) => f.isBaseData && f.key !== BASE_DATA_KEYS.nickname);
  // 运行状态也单独成块（默认折叠）：`log` 这种长文本留在网格里会占掉一格还被截断
  const engineStateFields = present.filter((f) => f.isEngineState);
  const businessPresent = present.filter((f) => !f.isBaseData && !f.isEngineState);
  const scalarFields = businessPresent.filter(
    (f) => f.category !== 'collection' && isScalarLike(f.value),
  );
  const collectionFields = businessPresent.filter(
    (f) => f.category === 'collection' || !isScalarLike(f.value),
  );
  const missingFields = fields.filter((f) => !f.hasValue);

  // 网格：按 GRID_ORDER 排，同级内保持出现顺序
  const gridFields = [...scalarFields].sort((a, b) => {
    const ai = GRID_ORDER.indexOf(a.category);
    const bi = GRID_ORDER.indexOf(b.category);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  // 列数自适应：字段多时最多 4 列（原来固定 6 列，长标签「最大生命值」会被截成「最大生命…」）
  const gridCols = gridFields.length <= 3 ? 3 : gridFields.length <= 8 ? 4 : 4;
  const gridClass = { 3: 'grid-cols-3', 4: 'grid-cols-4' }[gridCols] ?? 'grid-cols-4';

  // 全空：没有真实数据
  if (present.length === 0 && missingFields.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 text-center">
        <div className="text-sm text-zinc-500">{t('data.card.noCharacter')}</div>
        <div className="text-xs text-zinc-600 mt-1">{t('data.card.noCharacterHint')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── 头部：UID + 昵称 + 编辑 ── */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-lg font-semibold text-zinc-200 shrink-0">
          {avatarChar}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-100 truncate">
            {nickname || t('data.card.playerFallback')}
          </div>
          <div className="text-xs text-zinc-500">UID: {uid || '—'}</div>
        </div>
        {onEditPlayer && (
          <Button
            variant="secondary"
            size="sm"
            className="text-xs px-2 py-0.5 rounded bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 inline-flex items-center gap-1 shrink-0"
            onClick={onEditPlayer}
          >
            <Pencil className="w-3 h-3" />
            {t('data.card.edit')}
          </Button>
        )}
      </div>

      {/* ── 基础数据（引擎自动维护：注册时间/最后在线/消息计数） ── */}
      {baseFields.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500 mb-2 inline-flex items-center gap-1.5">
            <IdCard className="w-3.5 h-3.5" />
            {t('data.card.baseData')}
            <span className="text-zinc-600">{t('data.base.engineMaintained')}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {baseFields.map((f) => (
              <div key={f.key} className="bg-zinc-800/40 rounded px-2.5 py-1.5">
                <div className="text-xs text-zinc-500 truncate" title={f.key}>
                  {f.label}
                </div>
                <div className="text-sm font-mono text-zinc-300 truncate">
                  {formatScalar(f.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 基础属性（标量网格，不做血条） ── */}
      {gridFields.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
          <div className="text-xs text-zinc-500 mb-2 inline-flex items-center gap-1.5">
            {CATEGORY_ICONS.stats}
            {t('data.card.stats')}
          </div>
          <div className={'grid gap-1.5 ' + gridClass}>
            {gridFields.map((f) => (
              <div key={f.key} className="bg-zinc-800/60 rounded px-2.5 py-1.5 text-center">
                <div className="text-xs text-zinc-500 truncate" title={f.key}>
                  {f.label}
                </div>
                <div className="text-sm font-mono font-semibold text-zinc-100 truncate">
                  {formatScalar(f.value)}
                </div>
                {f.usage && (
                  <div className="text-[10px] text-zinc-600 truncate">{describeUsage(f.usage)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 集合类字段：道具卡 / JSON ── */}
      {collectionFields.map((f) => (
        <CollectionCard
          key={f.key}
          field={f}
          itemConfig={itemConfig ?? null}
          showRaw={showRaw === f.key}
          onToggleRaw={() => setShowRaw(showRaw === f.key ? null : f.key)}
        />
      ))}

      {/* ── 项目自己的运行状态（默认折叠，展开可查原始 JSON） ── */}
      {engineStateFields.length > 0 && <EngineStateSection fields={engineStateFields} />}

      {/* ── 流程声明了但玩家还没有的字段（弱化展示，可折叠） ── */}
      {missingFields.length > 0 && <MissingFieldsSection fields={missingFields} />}
    </div>
  );
});

/**
 * 「引擎状态」：项目自己的运行状态（战斗进行态 / 当前怪血量 / 可行动作 / 日志…）。
 *
 * **默认折叠**。为什么要收起来：这些是长文本与内部状态，
 * 留在数值网格里会让 `你使用【普攻】，对 野狼 造成 24 点伤害…` 占掉一整格（还被截断），
 * 而卡片本来只该回答"玩家有什么、等级多少、金币多少"。
 * 但**不能删掉** —— 开发者要能查（"有没有开挂"看得到），所以给一个可展开的入口。
 */
function EngineStateSection({ fields }: { fields: PlayerField[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-lg p-3">
      <button
        type="button"
        className="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1"
        onClick={() => setOpen(!open)}
      >
        <ChevronDown className={'w-3 h-3 transition-transform ' + (open ? '' : '-rotate-90')} />
        {t('data.card.engineState', { count: fields.length })}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {fields.map((f) => (
            <div key={f.key} className="bg-zinc-800/40 rounded px-2.5 py-1.5">
              <div className="text-xs text-zinc-500 truncate" title={f.key}>
                {f.label}
              </div>
              <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-all">
                {isScalarLike(f.value) ? formatScalar(f.value) : formatJson(f.value)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 一个集合类字段的卡片（道具列表 / 装备 / 其它对象） */
function CollectionCard({
  field,
  itemConfig,
  showRaw,
  onToggleRaw,
}: {
  field: PlayerField;
  itemConfig: ConfigTable | null;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const items: ItemCardModel[] = looksLikeItemList(field.value)
    ? buildItemCards(field.value as unknown[], itemConfig)
    : [];
  const isItemList = items.length > 0;
  const empty = isEmptyCollection(field.value);
  const totalCount = items.reduce((sum, it) => sum + it.count, 0);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-xs text-zinc-500 inline-flex items-center gap-1.5 min-w-0">
          {CATEGORY_ICONS[field.category] ?? CATEGORY_ICONS.collection}
          <span className="truncate">{field.label}</span>
          {isItemList && (
            <span className="text-zinc-600">
              {t('data.card.itemKinds', { kinds: items.length, total: totalCount })}
            </span>
          )}
          {!isItemList && !empty && (
            <span className="text-zinc-600">{collectionCount(field.value)}</span>
          )}
        </div>
        <button
          type="button"
          className="text-[11px] text-zinc-500 hover:text-zinc-300 shrink-0 inline-flex items-center gap-0.5"
          onClick={onToggleRaw}
        >
          <ChevronDown
            className={'w-3 h-3 transition-transform ' + (showRaw ? '' : '-rotate-90')}
          />
          {t('data.card.rawJson')}
        </button>
      </div>

      {showRaw && (
        <pre className="text-[11px] font-mono text-zinc-400 bg-zinc-950/60 rounded p-2 overflow-x-auto mb-2 whitespace-pre-wrap break-all">
          {formatJson(field.value)}
        </pre>
      )}

      {empty ? (
        <div className="text-xs text-zinc-600">{t('data.card.emptyCollection')}</div>
      ) : isItemList ? (
        <div className="space-y-1">
          {items.map((it) => (
            <ItemRow key={it.name} item={it} />
          ))}
        </div>
      ) : (
        <div className="text-xs font-mono text-zinc-300 truncate" title={formatJson(field.value)}>
          {formatJson(field.value)}
        </div>
      )}
    </div>
  );
}

/** 一行道具：{图标} 名称 ×数量 · 属性 · 说明 */
function ItemRow({ item }: { item: ItemCardModel }) {
  return (
    <div className="flex items-baseline gap-2 bg-zinc-800/50 rounded px-2.5 py-1.5">
      <span className="shrink-0" aria-hidden="true">
        {item.icon}
      </span>
      <span className="text-sm text-zinc-100 shrink-0">{item.name}</span>
      <span className="text-xs font-mono text-amber-300 shrink-0">×{item.count}</span>
      {item.foundInConfig ? (
        <span
          className="text-xs text-zinc-400 truncate"
          title={item.attributes.map((a) => `${a.label} ${a.value}`).join(' · ')}
        >
          {item.attributes.map((a) => `${a.label} ${a.value}`).join(' · ')}
        </span>
      ) : (
        <span className="text-xs text-zinc-600 shrink-0">{t('data.card.notInConfig')}</span>
      )}
      {item.description && (
        <span className="text-xs text-zinc-500 truncate hidden sm:inline">
          — {item.description}
        </span>
      )}
    </div>
  );
}

/** 「流程声明了、玩家还没有」的字段：默认折叠，避免把不存在的东西画成一堆空格 */
function MissingFieldsSection({ fields }: { fields: PlayerField[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-lg p-3">
      <button
        type="button"
        className="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1"
        onClick={() => setOpen(!open)}
      >
        <ChevronDown className={'w-3 h-3 transition-transform ' + (open ? '' : '-rotate-90')} />
        {t('data.card.missingFields', { count: fields.length })}
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {fields.map((f) => (
            <span
              key={f.key}
              className="text-[11px] text-zinc-500 bg-zinc-800/50 rounded px-2 py-0.5"
              title={f.key}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
