// src/main/services/official/intents.ts
//
// 官方 WebSocket 的 intents 订阅位。
//
// 为什么单独成文件：ws.ts 是 10/18 打包产物还原（@ts-nocheck、依赖 ./client 与
// electron 配置），在纯 Node 的 vitest 里 import 不稳；而"订哪些位、4014 时丢哪一位"
// 恰恰是最容易写错、也最需要单测钉住的纯函数，所以抽到这里。

/** 基础 intents：GUILDS(1<<0) | GROUP_AND_C2C_EVENT(1<<25) | PUBLIC_GUILD_MESSAGES(1<<30)。 */
export const BASE_INTENTS = (1 << 0) | (1 << 25) | (1 << 30)

/**
 * 可选 intents，**按优先级从高到低**排列：互动回调(1<<26) > 群成员/入群申请(1<<24) > 消息审核(1<<27)。
 *
 * 为什么不做成开关：官方对没有权限的位直接用 4014 关掉整个连接 —— 所以只能
 * 「先全订，被拒就丢掉优先级最低的一位再重连」，收敛到这个机器人真有的权限集合。
 * 丢位顺序 = 数组末尾 → 开头：先丢审核，再丢群成员，最后才丢互动。
 */
export const OPTIONAL_INTENTS: readonly number[] = [1 << 26, 1 << 24, 1 << 27]

/** 可选位的中文名（日志/提示用） */
export const INTENT_LABELS: Readonly<Record<number, string>> = {
  24: '群成员变动 / 入群申请',
  26: '按钮与菜单互动回调',
  27: '主动消息审核结果',
}

/** 把一组可选位合成为 identify 用的 intents 数值 */
export function intentsOf(optionalBits: readonly number[]): number {
  let value = BASE_INTENTS
  for (const bit of optionalBits) value |= bit
  return value
}

/** 位 → 中文名（未知位退化成 1<<n） */
export function intentLabel(bit: number): string {
  const n = Math.round(Math.log2(bit))
  return INTENT_LABELS[n] || '1<<' + n
}

/**
 * 连接时订阅的 intents。
 *
 * 兼容旧调用：传布尔值时**等价于旧行为**（只多订 1<<24 群成员位），这样历史测试与
 * 外部调用（若还有）不会因为签名变化而静默变成「什么都不订」。
 */
export function officialIntents(optionalBits?: boolean | readonly number[] | null): number {
  if (typeof optionalBits === 'boolean') return intentsOf(optionalBits ? [1 << 24] : [])
  return intentsOf(Array.isArray(optionalBits) ? optionalBits : [])
}

/** 4014（无权限）时丢掉优先级最低的一位，返回丢掉的位与剩下的位 */
export function dropLowestOptionalIntent(optionalBits: readonly number[]): {
  dropped: number
  remaining: number[]
} {
  if (optionalBits.length === 0) return { dropped: 0, remaining: [] }
  return { dropped: optionalBits[optionalBits.length - 1], remaining: optionalBits.slice(0, -1) }
}
