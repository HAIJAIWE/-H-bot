// src/main/services/official/validation.ts
//
// 官方能力参数校验（纯函数）。
//
// 为什么单独一层：这些校验以前散在 monolithic 的 `services/official.ts` 里，
// 而它们的调用方是**节点/翻译器**（joinApproval、misc），不是官方适配器本身。
// 统一到 `official/` 之后仍然保持纯函数 —— 不碰网络、不碰会话，能直接单测。

/** 入群自动审批策略：单策略最多关联的群数（官方契约） */
const STRATEGY_MAX_GROUPS = 100
/** 策略白名单：单次最多提交的号码数（官方契约） */
const WHITELIST_BATCH_MAX = 10_000
/** 分享链接的 callback_data 最长字符数（官方契约） */
const CALLBACK_DATA_MAX = 32

/**
 * 群号归一化：`group_ids` 官方是 uint64 数组。
 *
 * 群号在 2^53 以内，用 number 传最稳；但用户可能从表格里粘进来带空格的字符串，
 * 这里统一 trim + 转数字，非数字原样保留（让官方报"参数异常"而不是我们悄悄改成 0）。
 */
function toGroupIdValue(raw: unknown): number | string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : s
}

/**
 * 入群自动审批策略的创建/修改参数校验（纯函数）。
 *
 * 官方有两条**容易踩的硬约束**：
 *   1. `group_openids` 与 `group_ids` **二选一**，"同时传入或均未传入均返回错误"；
 *   2. PATCH 的 `group_action` 里，**群标识形式必须与创建时一致** ——
 *      创建用的 openid，修改时也得用 openid。
 *
 * 本地先把这两条拦住，比让用户对着 `10001 请求参数异常` 猜要好。
 */
export function validateStrategyGroups(input: {
  groupOpenids?: unknown
  groupIds?: unknown
}):
  | { ok: true; value: { group_openids?: string[]; group_ids?: Array<number | string> } }
  | { ok: false; error: string } {
  const openids = (Array.isArray(input.groupOpenids) ? input.groupOpenids : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  const ids = (Array.isArray(input.groupIds) ? input.groupIds : [])
    .map(toGroupIdValue)
    .filter((v) => v !== '')
  if (openids.length && ids.length) {
    return { ok: false, error: 'group_openids 与 group_ids 只能填一个（官方同时传入会报错）' }
  }
  if (!openids.length && !ids.length) {
    return { ok: false, error: 'group_openids 与 group_ids 必须填一个（关联到哪些群）' }
  }
  if (openids.length > STRATEGY_MAX_GROUPS) {
    return {
      ok: false,
      error: `单个策略最多关联 ${STRATEGY_MAX_GROUPS} 个群，收到 ${openids.length} 个`,
    }
  }
  if (ids.length > STRATEGY_MAX_GROUPS) {
    return {
      ok: false,
      error: `单个策略最多关联 ${STRATEGY_MAX_GROUPS} 个群，收到 ${ids.length} 个`,
    }
  }
  return openids.length
    ? { ok: true, value: { group_openids: openids } }
    : { ok: true, value: { group_ids: ids } }
}

/** 策略白名单参数校验（纯函数）：op 只能是 add/del，单次 ≤10000，且号码必须是数字串 */
export function validateWhitelistUsers(
  op: unknown,
  users: unknown,
):
  | { ok: true; value: { op: 'add' | 'del'; whitelist_users: string[] } }
  | { ok: false; error: string } {
  const opStr = String(op ?? '').trim()
  if (opStr !== 'add' && opStr !== 'del') {
    return { ok: false, error: `op 只能是 add 或 del，收到 ${opStr || '(空)'}` }
  }
  const list = (Array.isArray(users) ? users : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  if (!list.length) return { ok: false, error: 'whitelist_users 不能为空' }
  if (list.length > WHITELIST_BATCH_MAX) {
    return {
      ok: false,
      error: `单次最多 ${WHITELIST_BATCH_MAX} 个号码，收到 ${list.length} 个`,
    }
  }
  const bad = list.filter((u) => !/^\d+$/.test(u))
  if (bad.length) {
    return {
      ok: false,
      error: `白名单必须是纯数字 QQ 号，这些不合法：${bad.slice(0, 5).join(', ')}`,
    }
  }
  return { ok: true, value: { op: opStr, whitelist_users: list } }
}

/** 分享链接的 callback_data 校验（纯函数）：官方限 32 字符，超了直接报 10001 */
export function validateCallbackData(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(raw ?? '').trim()
  if (s.length > CALLBACK_DATA_MAX) {
    return {
      ok: false,
      error: `callback_data 最长 ${CALLBACK_DATA_MAX} 个字符，收到 ${s.length} 个`,
    }
  }
  return { ok: true, value: s }
}
