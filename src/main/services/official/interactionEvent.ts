// 互动事件（INTERACTION_CREATE）→ 运行时事件
//
// 官方文档（/wiki/develop/api-v2/autogen/event/interaction_create）：
//   · 事件名 INTERACTION_CREATE，INTENT 位 1<<26（INTERACTION）——不订这一位网关**不推**；
//   · 只有 type=11（消息按钮）与 type=12（快捷菜单）需要回应：PUT /interactions/{id}
//   · 客户端等待 3 秒，超时后 interaction_id 失效
//
// 负载形状（群/单聊场景）：
//   { id, type: 11, scene: 'group', group_openid, group_member_openid, user_openid,
//     timestamp, data: { type: 11, resolved: { button_id, button_data, user_id, message_id } } }
//
// 这里只做「负载 → 运行时事件」的纯映射，方便单测；广播与用户 UID 解析留在 eventBus。

/** 需要业务回执的互动类型：11 消息按钮 / 12 快捷菜单 */
export const ACTIONABLE_INTERACTION_TYPES: ReadonlyArray<number> = [11, 12];

export interface InteractionEventInput {
  /** 事件 id，就是回执要用的 interaction_id（**不带** INTERACTION_CREATE: 前缀） */
  id?: unknown;
  type?: unknown;
  scene?: unknown;
  guild_id?: unknown;
  channel_id?: unknown;
  group_openid?: unknown;
  group_member_openid?: unknown;
  user_openid?: unknown;
  user_id?: unknown;
  data?: unknown;
}

export interface InteractionEventMeta {
  /** 事件时间（秒） */
  time: number;
  /** 本机 bot 的 self_id */
  selfId: number;
  /** 把 openid 换成运行时 UID（拿不到时返回空串） */
  resolveUid: (openid: string) => string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** 从负载里取互动类型：外层 type 与 data.type 官方示例一致，二者都认 */
export function interactionTypeOf(src: InteractionEventInput): number {
  const inner = asRecord(src.data);
  const raw = inner.type ?? src.type;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** 按钮 id / data：官方放在 data.resolved，少见的旧负载放在 data 上 */
export function resolvedButtonOf(src: InteractionEventInput): { buttonId: string; buttonData: string } {
  const inner = asRecord(src.data);
  const resolved = asRecord(inner.resolved);
  return {
    buttonId: asText(resolved.button_id ?? inner.button_id),
    buttonData: asText(resolved.button_data ?? inner.button_data),
  };
}

/**
 * 映射成运行时事件；**不需要回执的类型返回 null**（13 反馈 / 14 清空会话 / 15 故事集 /
 * 16 切模型 / 18 用户授权 / 19 群授权 / 20 授权状态）。
 *
 * 形状对齐翻译器的通知事件：post_type='notice' + 顶层 button_id / button_data /
 * interaction_id，于是「按钮点击」触发器（triggerMatcher 的 button_clicked 分支）
 * 直接就能匹配，不需要新增事件类型。
 */
export function interactionEventOf(
  src: InteractionEventInput,
  meta: InteractionEventMeta,
): Record<string, unknown> | null {
  if (!src || typeof src !== 'object') return null;
  const type = interactionTypeOf(src);
  if (!ACTIONABLE_INTERACTION_TYPES.includes(type)) return null;

  const interactionId = asText(src.id);
  const { buttonId, buttonData } = resolvedButtonOf(src);
  // 缺 id 就没法回执，也没有匹配价值
  if (!interactionId) return null;

  const openid = asText(src.user_openid) || asText(src.group_member_openid) || asText(src.user_id);
  const inner = asRecord(src.data);
  const resolved = asRecord(inner.resolved);

  return {
    post_type: 'notice',
    notice_type: 'interaction',
    sub_type: String(type),
    time: meta.time,
    self_id: meta.selfId,
    user_id: openid ? meta.resolveUid(openid) : '',
    group_id: asText(src.group_openid),
    guild_id: asText(src.guild_id),
    channel_id: asText(src.channel_id),
    message_id: asText(resolved.message_id),
    interaction_id: interactionId,
    interaction_type: type,
    button_id: buttonId,
    button_data: buttonData,
    _openid: openid,
    _scene: asText(src.scene),
  };
}
