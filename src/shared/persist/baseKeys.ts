// 基础数据的 key（string 字面量，便于在日志/测试里直接断言）
//
// 由 10/18 打包产物 region 还原（chunk: registration-B3DiGKnT.js）。
// 注意：这里只放纯数据/纯函数 —— 它是 shared 层，主进程与渲染进程都会 import，
// 不能依赖 zustand / toast / i18n 这些渲染层模块。
export const BASE_DATA_KEYS = {
  /** 首次见到该玩家的时间（ISO 8601 UTC，只写一次） */
  registeredAt: '__sys_registered_at',
  /** 最近一次事件时间（ISO 8601 UTC，每条事件覆盖） */
  lastActive: '__sys_last_active',
  /** 最近一次事件日期（`YYYY-MM-DD`，便于流程做"今天来过吗"判定） */
  lastActiveDate: '__sys_last_active_date',
  /** 事件计数（每条事件 +1） */
  msgCount: '__sys_msg_count',
  /** 昵称缓存（仅当事件带昵称时写；官方渠道事件不带，见文档） */
  nickname: '__sys_nickname',
} as const;

/** 全部基础数据 key（顺序即面板上的展示顺序） */
export const BASE_DATA_KEY_LIST: string[] = [
  BASE_DATA_KEYS.registeredAt,
  BASE_DATA_KEYS.lastActive,
  BASE_DATA_KEYS.lastActiveDate,
  BASE_DATA_KEYS.msgCount,
  BASE_DATA_KEYS.nickname,
];

/** 保留前缀（`variable_persist` 会拒绝用户写这个前缀） */
export const BASE_DATA_PREFIX = '__sys_';

/** 这个 key 是不是引擎基础数据 */
export function isBaseDataKey(key: string): boolean {
  return key.startsWith(BASE_DATA_PREFIX);
}

/**
 * 把 ISO 时间戳取成 `YYYY-MM-DD`（**本地时区**）。
 *
 * ## 这里修过一个 bug：注释说"要一致"，实现却取了 UTC
 *
 * 原来的注释写着"与 `time_op(now)` 必须一致，否则会差一天"，但实现是 `iso.slice(0, 10)`
 * —— 那是**UTC 日期**，而 `time_op` / `is_today` 用的是**本地时区**（`timeZone || undefined`）。
 * 于是每天有 **8 小时**（UTC 16:00–24:00 = 本地 00:00–08:00）两者相差一天。
 *
 * 实测（2026-10-03，用户清空数据后测试）：本地时间 01:59（10-03），
 * 存档里写的却是 `__sys_last_active_date = "2026-10-02"` —— 流程里凡是
 * "今天活跃过吗"的判断在凌晨都会错。
 *
 * 结论：**日期一律按本地时区**（用户感知的"今天"就是本地的今天）。
 * `__sys_last_active` 仍存 ISO 瞬时（带 Z），那是时刻、不是日期，不受影响。
 */
export function isoDatePart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const g = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
