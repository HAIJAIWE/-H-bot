// src/shared/persist/value.ts
//
// 玩家存档值的**读写编解码**（单一真相层）。
//
// ## 为什么要有这个模块
//
// `_persistent.value` 列存的**不是**用户值本身，而是一个带 TTL 的包装：
//
//     {"value": 55, "expire_at": null}          ← 无过期时间
//     {"value": "很多", "expire_at": 1790000000} ← 到点算过期
//
// 运行时读它是有解包的（`persistentStore.extractStoredValue` 返回 `data.value`），
// 所以机器人跑起来没问题。但**数据浏览面板是直接读表的**：
//
//   `CharacterProfileCard` → `extractCharacterFields` → `formatValue(raw)` → 直接 JSON.stringify
//
// 于是玩家卡上写着 `经验值 {"value":55,"expire_at":null}`、`金币 {"value":30,"expire_at":null}` ——
// 用户看到的是**存储格式**，不是他的数据。同一个包装还会在「其他数据」区、`PersistentGroupEditor`、
// `DataBrowserPanel` 的普通表格里各露一次。
//
// 这个模块把编解码收在一处：渲染层展示前 `decodePersistentValue`，写回时 `encodePersistentValue`。
//
// ## 为什么判据要「严格」
//
// 旧版本的库里存的是**裸值**（`JSON.stringify(55)`、`"很多"`、甚至没经过 JSON 的纯文本），
// 所以解包必须只在"确实是包装对象"时才动手：
// 普通对象（如背包 `{"name":"金创药","count":1}`、装备 `{}`）**不能**被误判成包装。
// 这里用「必须有 `expire_at` 键 + 必须有 `value` 键」做判据，与运行时 `extractStoredValue`
// 的「有 `expire_at` 视为新格式」保持一致（多要求一个 `value`，是为了不让
// `{"expire_at": null}` 这种残缺对象把整行数据吃掉）。

/** `_persistent.value` 的包装结构 */
export interface PersistentEnvelope {
  value: unknown;
  expire_at: number | null;
}

/** 解包结果：`expired` 为 true 时 `value` 已被置为 null（与运行时语义一致） */
export interface DecodedPersistentValue {
  value: unknown;
  expired: boolean;
}

/**
 * 判断一个已解析的 JSON 值是否是 `_persistent` 包装对象。
 *
 * 条件收紧到三条：是普通对象、有 `value` 键、有 `expire_at` 键。
 */
/**
 * ⚠️ **导出是为了单一真源**（2026-10-15）：运行时 `persistentStore.extractStoredValue` 以前自己判了一遍
 * （「有 expire_at 就当信封」），与这里不一致 —— 结果是同一行两侧读值不同、用户数据被静默读成 undefined。
 * 现在两边**共用这一个函数**；再改判据只会改一处。
 */
export function isEnvelope(data: unknown): data is PersistentEnvelope {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  if (!('value' in data) || !('expire_at' in data)) return false;
  const expireAt = (data as { expire_at: unknown }).expire_at;
  return expireAt === null || typeof expireAt === 'number';
}

/**
 * 解包 `_persistent.value` 的原始文本。
 *
 * - 包装格式 → 取内层值；已过期 → `{ value: null, expired: true }`
 * - 裸 JSON（`55` / `"很多"` / `{"name":"金创药"}`）→ 原样返回
 * - 非 JSON 纯文本（历史数据）→ 原样返回字符串
 * - 传进来的**已经是解包后的值**（测试/内存对象）→ 原样返回
 *
 * @param raw 数据库里的原始值（通常是 string，也可能是已经解好的任意类型）
 * @param nowSec 当前时间（秒）。仅测试注入用；缺省取 `Date.now()/1000`
 */
export function decodePersistentValue(raw: unknown, nowSec?: number): DecodedPersistentValue {
  // 已经是对象：只有当它长得像包装时才解（渲染层有时直接拿到内存里的对象）
  if (typeof raw === 'object' && raw !== null) {
    if (!isEnvelope(raw)) return { value: raw, expired: false };
    return checkExpiry(raw, nowSec);
  }

  if (typeof raw !== 'string') return { value: raw, expired: false };

  const trimmed = raw.trim();
  // 快速排除：包装必然是 `{` 开头。数字/布尔/裸字符串直接原样返回，
  // 连 JSON.parse 都不必试（历史数据里 `"很多"` 这种纯文本 parse 会抛，走 catch 也一样结果）
  if (!trimmed.startsWith('{')) return { value: raw, expired: false };

  try {
    const data: unknown = JSON.parse(trimmed);
    if (!isEnvelope(data)) return { value: raw, expired: false };
    return checkExpiry(data, nowSec);
  } catch {
    return { value: raw, expired: false };
  }
}

/** 只取内层值（大多数展示场景只需要这个） */
export function unwrapPersistentValue(raw: unknown, nowSec?: number): unknown {
  return decodePersistentValue(raw, nowSec).value;
}

/**
 * 取出包装里的剩余 TTL（秒）。不是包装 / 无过期时间 → `0`（= 永久）。
 *
 * 编辑面板保存时必须用它把 TTL 带回去：`persistentStore.saveValue` 每次写入都会
 * 按传入的 `ttl` 重算 `expire_at`，编辑器如果不知道原来的 TTL，一次"改个数值"的编辑
 * 就会把带过期的条目变成永久。
 */
export function persistentTtlSeconds(raw: unknown, nowSec?: number): number {
  const envelope = parseEnvelope(raw);
  if (!envelope || envelope.expire_at === null) return 0;
  const now = nowSec ?? Date.now() / 1000;
  const remain = envelope.expire_at - now;
  return remain > 0 ? remain : 0;
}

/**
 * 从原始值里解析出包装对象（不是包装则返回 null）。
 *
 * 给「读原始值、写包装」这类需要保留 `expire_at` 的场景用。
 */
export function parseEnvelope(raw: unknown): PersistentEnvelope | null {
  if (typeof raw === 'object' && raw !== null && isEnvelope(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const data: unknown = JSON.parse(trimmed);
    return isEnvelope(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * 把编辑器产出的新值写回成 `_persistent.value` 的包装文本，**保留原有的 TTL**。
 *
 * 为什么必须有：数据浏览面板是**直接改表**的，绕过了 `persistentStore.saveValue`。
 * 如果它把解包后的值直接写进去，那一行就从 `{"value":55,"expire_at":null}` 变成 `55` ——
 * 运行时 `extractStoredValue` 读裸 JSON 会走「旧格式」分支返回 `{value: 55}`（数字本身），
 * 看着像没事，但**只要以后给它设了 TTL 就再也读不出来了**：`JSON.parse('55')` 得数字，
 * `'expire_at' in 55` 直接抛 → catch 分支把整串当字符串返回。
 *
 * @param originalRaw 编辑前该行的原始值（用于继承 TTL）
 * @param newValue 编辑器产出的新值
 */
export function reencodePreservingTtl(originalRaw: unknown, newValue: unknown): string {
  return encodePersistentValue(newValue, persistentTtlSeconds(originalRaw));
}

/**
 * 这一行的存储值是否需要「升级成规范包装」。
 *
 * 需要的情况只有一种：**它是旧的裸值**（没经过 `{"value":…,"expire_at":…}` 包装）。
 * 已过期的规范包装**不算**需要修 —— 那是正常状态，不是坏数据。
 *
 * 用途：数据浏览面板在 `_persistent` 分组头部据此显示「修复 N 行旧格式」按钮。
 * 历史上之所以会有这种行，是因为写入端曾经会把值写坏（见 `reencodePreservingTtl`）。
 */
export function needsEnvelopeUpgrade(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  // 包装必然以 `{` 开头；数字/布尔/数组/裸字符串都算旧格式
  if (!trimmed.startsWith('{')) return true;
  try {
    return !isEnvelope(JSON.parse(trimmed));
  } catch {
    // 不是 JSON 的纯文本：也属于旧格式（升级成包装里的字符串）
    return true;
  }
}

/**
 * 把旧的裸值升级成规范包装（**迁移用**：只补格式，不改值、不设 TTL）。
 *
 * 与 `reencodePreservingTtl` 的区别：那个是「用户改了值」，这个是「值没变、只补格式」。
 */
export function migrateToEnvelope(raw: unknown): string {
  if (!needsEnvelopeUpgrade(raw)) {
    return typeof raw === 'string' ? raw : encodePersistentValue(raw);
  }
  // 旧值可能本身是 JSON（数字/对象/数组），也可能是纯文本。
  // 能 parse 就按原类型存，否则当字符串 —— 两种都不丢内容。
  let inner: unknown = raw;
  if (typeof raw === 'string') {
    try {
      inner = JSON.parse(raw.trim());
    } catch {
      inner = raw;
    }
  }
  return encodePersistentValue(inner, 0);
}

function checkExpiry(env: PersistentEnvelope, nowSec?: number): DecodedPersistentValue {
  const expireAt = env.expire_at;
  if (expireAt === null) return { value: env.value, expired: false };
  const now = nowSec ?? Date.now() / 1000;
  if (now > expireAt) return { value: null, expired: true };
  return { value: env.value, expired: false };
}

/**
 * 编码成 `_persistent.value` 的包装文本。
 *
 * 与 `persistentStore` 的写入端保持一致（`ttl > 0` 才有 `expire_at`）。
 *
 * @param value 用户值
 * @param ttlSeconds 存活秒数；`<= 0` 或省略表示永久
 */
export function encodePersistentValue(value: unknown, ttlSeconds = 0): string {
  const envelope: PersistentEnvelope = {
    value,
    expire_at: ttlSeconds > 0 ? Date.now() / 1000 + ttlSeconds : null,
  };
  return JSON.stringify(envelope);
}

/**
 * 已过期包装的展示文案（界面用）。返回 null 表示未过期/不是包装。
 *
 * 单独给一个函数是因为"该值已过期"和"该值是 null"在界面上必须能分开 ——
 * 运行时把过期读成 null，面板如果也显示 `—`，用户会以为是数据丢了。
 */
export function describeExpiry(
  raw: unknown,
  nowSec?: number,
): { expired: boolean; at: Date | null } {
  let envelope: PersistentEnvelope | null = null;
  if (typeof raw === 'object' && raw !== null && isEnvelope(raw)) {
    envelope = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const data: unknown = JSON.parse(trimmed);
        if (isEnvelope(data)) envelope = data;
      } catch {
        /* 非 JSON：当作没有过期信息 */
      }
    }
  }
  if (!envelope || envelope.expire_at === null) return { expired: false, at: null };
  const now = nowSec ?? Date.now() / 1000;
  return { expired: now > envelope.expire_at, at: new Date(envelope.expire_at * 1000) };
}
