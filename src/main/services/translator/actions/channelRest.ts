// QQ 频道「私域 REST 家族」的统一出口：身份组、成员、禁言、子频道权限、频道私信、日程、论坛、消息详情。
//
// 为什么不给每个能力开一个节点：它们和已有的 channel_op 是**同一种东西** ——
// 一次带鉴权的 REST 调用（method + path + body），接线方式完全一样。
// 所以这里只提供「模式 → 请求」的规格表，动作表由它派生，节点仍然是 channel_op 那一个。
// 官方路由以 _recovery/sdk/botpy/botpy/api.py 为准（逐条核对过），本文件不发明接口。

export type ChannelRestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ChannelRestRequest {
  method: ChannelRestMethod
  path: string
  /** GET/HEAD 一律不带 body（undici 会直接拒绝），查询参数拼在 path 上 */
  body?: Record<string, unknown>
}

type ParamBag = Record<string, unknown>

interface ChannelRestSpec {
  method: ChannelRestMethod
  path: (p: ParamBag) => string
  body?: (p: ParamBag) => Record<string, unknown> | undefined
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 取一个必填的路径段：缺了就抛，别让 /guilds//roles 这种请求打到官方 */
function seg(p: ParamBag, key: string): string {
  const v = p[key]
  const s = v === undefined || v === null ? '' : String(v).trim()
  if (!s) throw new Error(key + ' 不能为空')
  return encodeURIComponent(s)
}

function text(p: ParamBag, key: string): string {
  const v = p[key]
  return v === undefined || v === null ? '' : String(v).trim()
}

function numberParam(p: ParamBag, key: string): number | undefined {
  const raw = p[key]
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/** 节点上的 json 端口拿到的是字符串，插件/直调可能直接给对象 —— 两种都收 */
export function parseJsonParam(value: unknown, label: string): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return undefined
    try {
      return JSON.parse(s)
    } catch {
      throw new Error(label + ' 不是合法 JSON：' + s.slice(0, 80))
    }
  }
  return value
}

/** 请求体参数（body 端口）：只接受 JSON 对象 */
export function readJsonBody(value: unknown, label = 'body'): Record<string, unknown> | undefined {
  const parsed = parseJsonParam(value, label)
  if (parsed === undefined) return undefined
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(label + ' 必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

/** body 里的零散字段（分页游标、since 之类）转成 query string */
function pickQuery(body: Record<string, unknown> | undefined, keys: readonly string[]): string {
  if (!body) return ''
  const qs = new URLSearchParams()
  for (const k of keys) {
    const v = body[k]
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? '?' + s : ''
}

/** 禁言时长：两个字段二选一；都填 0 是官方约定的「解除禁言」 */
function muteTimes(body: Record<string, unknown>): Record<string, unknown> {
  const end = body.mute_end_timestamp
  const sec = body.mute_seconds
  const hasEnd = end !== undefined && end !== null && end !== ''
  const hasSec = sec !== undefined && sec !== null && sec !== ''
  if (!hasEnd && !hasSec) {
    throw new Error(
      '禁言需要 mute_seconds（秒）或 mute_end_timestamp（毫秒时间戳）；填 0 表示解除禁言',
    )
  }
  const out: Record<string, unknown> = {}
  if (hasEnd) out.mute_end_timestamp = String(end)
  if (hasSec) out.mute_seconds = String(sec)
  return out
}

function permBody(body: Record<string, unknown>): Record<string, unknown> {
  const add = body.add
  const remove = body.remove
  const hasAdd = add !== undefined && add !== null && add !== ''
  const hasRemove = remove !== undefined && remove !== null && remove !== ''
  if (!hasAdd && !hasRemove) {
    throw new Error('子频道权限至少要给 add 或 remove（权限位字符串，例如 "1"）')
  }
  const out: Record<string, unknown> = {}
  if (hasAdd) out.add = String(add)
  if (hasRemove) out.remove = String(remove)
  return out
}

/** 官方子频道类型是整数（0 文字 / 2 语音 / 4 分组 / 10005 直播 / 10006 应用 / 10007 论坛） */
const CHANNEL_TYPE_CODES: Readonly<Record<string, number>> = {
  text: 0,
  voice: 2,
  category: 4,
  live: 10005,
  application: 10006,
  forum: 10007,
}

function channelTypeCode(value: string): number {
  const code = CHANNEL_TYPE_CODES[value || 'text']
  if (code === undefined) throw new Error('不认识的子频道类型: ' + value)
  return code
}

/** 节点上的 name/type/position… 端口 → 创建子频道的请求体（body 端口留空时用它） */
export function channelCreateBody(params: ParamBag = {}): Record<string, unknown> {
  const body: Record<string, unknown> = { type: channelTypeCode(text(params, 'type')) }
  const name = text(params, 'name')
  if (name) body.name = name
  const position = numberParam(params, 'position')
  if (position !== undefined) body.position = position
  const parentId = text(params, 'parent_id')
  if (parentId) body.parent_id = parentId
  const speak = numberParam(params, 'speak_permission')
  if (speak !== undefined) body.speak_permission = speak
  return body
}

export function channelUpdateBody(params: ParamBag = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const name = text(params, 'name')
  if (name) body.name = name
  const position = numberParam(params, 'position')
  if (position !== undefined) body.position = position
  const parentId = text(params, 'parent_id')
  if (parentId) body.parent_id = parentId
  const speak = numberParam(params, 'speak_permission')
  if (speak !== undefined) body.speak_permission = speak
  return body
}

/** 公告两种形态互斥：给了推荐子频道就是推荐类公告，否则必须给 message_id */
export function announceCreateBody(params: ParamBag = {}): Record<string, unknown> {
  const list = parseJsonParam(params.recommend_channels, 'recommend_channels')
  if (Array.isArray(list) && list.length > 0) {
    return {
      announces_type: numberParam(params, 'announces_type') ?? 0,
      recommend_channels: list,
    }
  }
  const messageId = text(params, 'message_id')
  if (!messageId) {
    throw new Error('公告需要 message_id（消息类型）或 recommend_channels（推荐子频道类型）')
  }
  const body: Record<string, unknown> = { message_id: messageId }
  const channelId = text(params, 'channel_id')
  if (channelId) body.channel_id = channelId
  return body
}

/**
 * 模式 → 请求规格。**增删模式只动这张表**：动作表（channelExtraActions）由它的键派生，
 * 因此不会出现「节点上有这个模式、网关却说不支持」的错位。
 */
export const CHANNEL_REST_SPECS: Readonly<Record<string, ChannelRestSpec>> = {
  // ── 频道信息（口令 / 机器人身份 / 接口权限） ──
  guild_get: { method: 'GET', path: p => '/guilds/' + seg(p, 'guild_id') },
  guild_me: { method: 'GET', path: () => '/users/@me' },
  guild_my_list: {
    method: 'GET',
    path: p => '/users/@me/guilds' + pickQuery(readJsonBody(p.body), ['before', 'after', 'limit']),
  },
  guild_permission: {
    method: 'GET',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/api_permission',
  },
  guild_permission_demand: {
    method: 'POST',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/api_permission/demand',
    body: p => {
      const body = readJsonBody(p.body) ?? {}
      const channelId = text(p, 'channel_id') || text(body, 'channel_id')
      const out: Record<string, unknown> = { ...body }
      if (channelId) out.channel_id = channelId
      if (out.api_identify === undefined)
        throw new Error('body 里需要 api_identify（{ path, method }）')
      return out
    },
  },

  // ── 身份组 ──
  role_list: { method: 'GET', path: p => '/guilds/' + seg(p, 'guild_id') + '/roles' },
  role_create: {
    method: 'POST',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/roles',
    body: p => readJsonBody(p.body) ?? {},
  },
  role_update: {
    method: 'PATCH',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/roles/' + seg(p, 'role_id'),
    body: p => readJsonBody(p.body) ?? {},
  },
  role_delete: {
    method: 'DELETE',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/roles/' + seg(p, 'role_id'),
  },
  role_member_add: {
    method: 'PUT',
    path: p =>
      '/guilds/' +
      seg(p, 'guild_id') +
      '/members/' +
      seg(p, 'user_id') +
      '/roles/' +
      seg(p, 'role_id'),
    // 子频道管理员（身份组 5）必须带 channel 指明是哪个子频道；其它组官方接受空对象
    body: p => {
      const channelId = text(p, 'channel_id')
      return channelId ? { channel: { id: channelId } } : {}
    },
  },
  role_member_remove: {
    method: 'DELETE',
    path: p =>
      '/guilds/' +
      seg(p, 'guild_id') +
      '/members/' +
      seg(p, 'user_id') +
      '/roles/' +
      seg(p, 'role_id'),
    body: p => {
      const channelId = text(p, 'channel_id')
      return channelId ? { channel: { id: channelId } } : {}
    },
  },
  role_members: {
    method: 'GET',
    path: p =>
      '/guilds/' +
      seg(p, 'guild_id') +
      '/roles/' +
      seg(p, 'role_id') +
      '/members' +
      pickQuery(readJsonBody(p.body), ['start_index', 'limit']),
  },

  // ── 成员 ──
  member_list: {
    method: 'GET',
    path: p =>
      '/guilds/' +
      seg(p, 'guild_id') +
      '/members' +
      pickQuery(readJsonBody(p.body), ['after', 'limit']),
  },
  member_get: {
    method: 'GET',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/members/' + seg(p, 'user_id'),
  },
  member_remove: {
    method: 'DELETE',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/members/' + seg(p, 'user_id'),
    body: p => {
      const body = readJsonBody(p.body) ?? {}
      const out: Record<string, unknown> = {}
      if (body.add_blacklist !== undefined) out.add_blacklist = Boolean(body.add_blacklist)
      const days = body.delete_history_msg_days
      if (days !== undefined && days !== '') out.delete_history_msg_days = Number(days)
      return out
    },
  },

  // ── 禁言 ──
  mute_guild: {
    method: 'PATCH',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/mute',
    body: p => muteTimes(readJsonBody(p.body) ?? {}),
  },
  mute_member: {
    method: 'PATCH',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/members/' + seg(p, 'user_id') + '/mute',
    body: p => muteTimes(readJsonBody(p.body) ?? {}),
  },
  mute_multi: {
    method: 'PATCH',
    path: p => '/guilds/' + seg(p, 'guild_id') + '/mute',
    body: p => {
      const body = readJsonBody(p.body) ?? {}
      const ids = body.user_ids
      if (!Array.isArray(ids) || ids.length === 0)
        throw new Error('body 里需要 user_ids（用户 ID 数组）')
      return { ...muteTimes(body), user_ids: ids }
    },
  },

  // ── 子频道权限 ──
  member_perm_get: {
    method: 'GET',
    path: p =>
      '/channels/' + seg(p, 'channel_id') + '/members/' + seg(p, 'user_id') + '/permissions',
  },
  member_perm_put: {
    method: 'PUT',
    path: p =>
      '/channels/' + seg(p, 'channel_id') + '/members/' + seg(p, 'user_id') + '/permissions',
    body: p => permBody(readJsonBody(p.body) ?? {}),
  },
  role_perm_get: {
    method: 'GET',
    path: p => '/channels/' + seg(p, 'channel_id') + '/roles/' + seg(p, 'role_id') + '/permissions',
  },
  role_perm_put: {
    method: 'PUT',
    path: p => '/channels/' + seg(p, 'channel_id') + '/roles/' + seg(p, 'role_id') + '/permissions',
    body: p => permBody(readJsonBody(p.body) ?? {}),
  },

  // ── 频道私信 ──
  dm_create: {
    method: 'POST',
    path: () => '/users/@me/dms',
    body: p => ({ recipient_id: text(p, 'user_id'), source_guild_id: seg(p, 'guild_id') }),
  },
  dm_send: {
    method: 'POST',
    path: p => '/dms/' + seg(p, 'guild_id') + '/messages',
    body: p => readJsonBody(p.body) ?? {},
  },

  // ── 日程 ──
  schedule_list: {
    method: 'GET',
    path: p =>
      '/channels/' +
      seg(p, 'channel_id') +
      '/schedules' +
      pickQuery(readJsonBody(p.body), ['since']),
  },
  schedule_get: {
    method: 'GET',
    path: p => '/channels/' + seg(p, 'channel_id') + '/schedules/' + seg(p, 'schedule_id'),
  },
  schedule_create: {
    method: 'POST',
    path: p => '/channels/' + seg(p, 'channel_id') + '/schedules',
    body: p => {
      const body = readJsonBody(p.body) ?? {}
      // 官方要求套一层 schedule；容忍直接给内层字段
      if (body.schedule && typeof body.schedule === 'object') return body
      if (!body.name)
        throw new Error('body 里需要 name（日程名称），也可直接给 { "schedule": { ... } }')
      return { schedule: body }
    },
  },
  schedule_update: {
    method: 'PATCH',
    path: p => '/channels/' + seg(p, 'channel_id') + '/schedules/' + seg(p, 'schedule_id'),
    body: p => {
      const body = readJsonBody(p.body) ?? {}
      if (body.schedule && typeof body.schedule === 'object') return body
      if (!body.name)
        throw new Error('body 里需要 name（日程名称），也可直接给 { "schedule": { ... } }')
      return { schedule: body }
    },
  },
  schedule_delete: {
    method: 'DELETE',
    path: p => '/channels/' + seg(p, 'channel_id') + '/schedules/' + seg(p, 'schedule_id'),
  },

  // ── 论坛帖子 ──
  thread_list: { method: 'GET', path: p => '/channels/' + seg(p, 'channel_id') + '/threads' },
  thread_get: {
    method: 'GET',
    path: p => '/channels/' + seg(p, 'channel_id') + '/threads/' + seg(p, 'thread_id'),
  },
  thread_create: {
    method: 'PUT',
    path: p => '/channels/' + seg(p, 'channel_id') + '/threads',
    body: p => {
      const body = readJsonBody(p.body) ?? {}
      if (!body.title) throw new Error('body 里需要 title（帖子标题）')
      return body
    },
  },
  thread_delete: {
    method: 'DELETE',
    path: p => '/channels/' + seg(p, 'channel_id') + '/threads/' + seg(p, 'thread_id'),
  },

  // ── 消息 ──
  message_get: {
    method: 'GET',
    path: p => '/channels/' + seg(p, 'channel_id') + '/messages/' + seg(p, 'message_id'),
  },
}

/** 规格表的键就是动作名（网关按 action 查表，节点按 mode 透传，两边同源） */
export const CHANNEL_REST_MODES: readonly string[] = Object.keys(CHANNEL_REST_SPECS)

/**
 * 把「模式 + 参数」翻译成一次官方请求。
 *
 * 缺字段/JSON 坏掉时抛错（由 handler 转成失败响应）——**不要**带着空 id 去请求：
 * 官方会回 400，用户只看到「参数错误」，根本不知道是自己漏填了。
 */
export function buildChannelRequest(mode: string, params: ParamBag = {}): ChannelRestRequest {
  const spec = CHANNEL_REST_SPECS[mode]
  if (!spec) throw new Error('未知的频道操作: ' + mode)
  try {
    const path = spec.path(params)
    const body = spec.method === 'GET' ? undefined : spec.body?.(params)
    return body === undefined ? { method: spec.method, path } : { method: spec.method, path, body }
  } catch (e) {
    throw new Error(mode + ' ' + messageOf(e))
  }
}

export interface ChannelRestHost {
  callOfficialApi(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }>
}

export interface ChannelRestContext {
  action?: string
  params?: ParamBag
  echo?: unknown
  responder: {
    respond(echo: unknown, data: unknown): void
    fail(echo: unknown, error: string): void
  }
}

export type ChannelRestHandler = (host: ChannelRestHost, ctx: ChannelRestContext) => Promise<void>

function makeChannelRestHandler(mode: string): ChannelRestHandler {
  return async (host, { params, echo, responder }) => {
    let req: ChannelRestRequest
    try {
      req = buildChannelRequest(mode, params ?? {})
    } catch (e) {
      responder.fail(echo, messageOf(e))
      return
    }
    const r = await host.callOfficialApi(req.method, req.path, req.body)
    if (r.ok) responder.respond(echo, r.data ?? null)
    else responder.fail(echo, r.error ?? '频道接口调用失败')
  }
}

/** 动作表：规格表每个模式一个 handler，展开进网关总表 */
export const channelExtraActions: Readonly<Record<string, ChannelRestHandler>> = Object.fromEntries(
  CHANNEL_REST_MODES.map(mode => [mode, makeChannelRestHandler(mode)]),
) as Record<string, ChannelRestHandler>
