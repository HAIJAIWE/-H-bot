// src/main/services/officialExtras.ts
//
// QQ 官方机器人「OneBot 适配层」的扩展能力集合：
//   · 群管理 / 入群审批策略 / 菜单面板 / 频道操作 —— OneBot action 名 → official.ts helper
//   · 群成员、入群申请、消息审核、互动回调、频道消息 —— 官方推送事件 → OneBot 事件
//
// 为什么单独成文件：这些能力的「翻译规则」（UID↔openid、界面名→官方整数枚举、
// 官方字段名→OneBot 键名）与 onebot-translator.ts 的 WebSocket 生命周期无关，
// 放在一起会让那个文件既管连接又管业务，改一个 action 也要碰网络那部分。
//
// 约定：本模块**不直接建连接**，只通过 host 读写翻译器实例的映射表；
// 失败一律交给 reply.fail（由翻译器转成 status:'failed' + retcode:100）。
//
// 规模说明：本文件约 1000 行，是因为它装的全是「官方字段 ↔ OneBot 键名」的清单
// （action 拒绝表、事件类型表、频道/表情枚举、成员字段换算、菜单面板参数）。
// 这类代码的复杂度随平台能力**线性**增长，拆成多个文件只会让「加一个能力要改几处」
// 变多；真正的逻辑仍然薄 —— 每个 case 只做「取 openid → 调 official helper → 回包」。
// 将来若出现非映射类的计算（重试、限流、分页聚合），那部分应当单独成文件。
import {
  addChannelReaction,
  approveGroupJoinRequest,
  createChannelAnnounce,
  createGuildChannel,
  createJoinApprovalStrategy,
  createPanel,
  deletePanel,
  generateUrlLink,
  getBotSelf,
  getGroupBotState,
  getGroupInfo,
  getGroupMemberInfo,
  getGroupMembers,
  getGroupMuteState,
  getMenu,
  isGroupMutedNow,
  listGuildChannels,
  listGroupBlacklist,
  listGroupJoinRequests,
  listJoinApprovalStrategies,
  listPanels,
  removeChannelPin,
  removeGroupMembers,
  sendOfficialMessage,
  setGroupMemberMute,
  setMenu,
  setPanelTarget,
  updateGroupBlacklist,
  updatePanel,
  updateStrategyWhitelist,
  type SendMessageOptions,
} from './official';

/** 翻译器提供给本模块的最小能力面（实例状态仍由翻译器持有） */
export interface OfficialActionHost {
  projectPath: string;
  /** 机器人 self_id 的整数表示（OneBot 习惯；超过 2^53 会丢精度，精确值见 botUserId） */
  selfId: number;
  /** 机器人精确 id 字符串（来自 READY 的 user.id） */
  botUserId: string;
  /** UID → openid（未登记返回 undefined，调用方必须当成「找不到」处理） */
  openidOfUid(uid: number): string | undefined;
  /** openid → UID（没有就登记一个） */
  uidOf(openid: string): number;
}

/** 事件翻译只需要这三样 */
export interface OfficialEventHost {
  selfId: number;
  uidOf(openid: string): number;
  hashToInt(raw: string): number;
}

export interface ActionReply {
  ok(data?: unknown): void;
  fail(msg: string): void;
}

/**
 * 「官方根本没有」的能力 → 明确说明原因。
 *
 * 这张表只能装平台层面就不存在的能力：一旦把「官方有、我们没接」写进来，
 * 用户会一直等一个永远不会来的能力。
 */
export const UNSUPPORTED_ACTIONS: Record<string, string> = {
  set_group_card:
    '当前接入（QQ 官方 API）没有「设置群名片」接口：官方群管理只开放 禁言 / 踢人 / 黑名单 / 入群审批 / 群信息查询。',
  set_group_whole_ban:
    '当前接入（QQ 官方 API）没有设置全员禁言的能力，只能查询：请改用 get_group_mute_state 读取 mute_mode / global_rule。',
  set_group_anonymous_ban:
    '当前接入（QQ 官方 API）没有匿名用户/匿名禁言的概念（群聊消息只有 member_openid 身份）。',
  get_group_honor_info: '当前接入（QQ 官方 API）没有群荣誉（龙王/群聊火焰）信息接口。',
  send_group_notice:
    '当前接入（QQ 官方 API）没有群公告/群打卡接口；频道公告请用 announce_create。',
  set_essence_msg:
    '「群精华消息」当前接入（QQ 官方 API）没有：精华消息只在 QQ 频道场景存在，频道请用 pin_add。',
  delete_essence_msg:
    '「群精华消息」当前接入（QQ 官方 API）没有：精华消息只在 QQ 频道场景存在，频道请用 pin_remove。',
  send_group_forward_msg:
    '当前接入（QQ 官方 API）没有合并转发：官方发送侧只有「文本 / Markdown / 富媒体」三种，请改用多条发消息逐条发送。',
  send_forward_msg:
    '当前接入（QQ 官方 API）没有合并转发：官方发送侧只有「文本 / Markdown / 富媒体」三种，请改用多条发消息逐条发送。',
  get_stranger_info:
    '当前接入（QQ 官方 API）没有「按 QQ 号查资料」的接口：官方是 openid 体系，只有在共同会话里出现过的用户才有 openid。',
  set_friend_add_request:
    '当前接入（QQ 官方 API）没有主动加好友的接口：好友关系由用户在 QQ 客户端发起（FRIEND_ADD 事件可监听）。',
};

/** 完全未知 action 时给用户看的可用集合（必须包含 answer_interaction —— 它是常用回执入口） */
export const ACTION_NAMES: readonly string[] = [
  'send_private_msg',
  'send_group_msg',
  'send_msg',
  'send_channel_msg',
  'send_keyboard_msg',
  'send_media',
  'send_stream_msg',
  'send_input_notify',
  'delete_msg',
  'get_login_info',
  'answer_interaction',
  'get_group_info',
  'get_group_member_info',
  'get_group_member_list',
  'set_group_ban',
  'set_group_kick',
  'set_group_add_request',
  'get_group_mute_state',
  'get_group_bot_state',
  'get_group_join_requests',
  'list_group_blacklist',
  'update_group_blacklist',
  'list_join_approval_strategies',
  'create_join_approval_strategy',
  'update_strategy_whitelist',
  'generate_url_link',
  'get_menu',
  'set_menu',
  'list_panels',
  'create_panel',
  'update_panel',
  'delete_panel',
  'set_panel_target',
  'channel_list',
  'channel_create',
  'reaction_add',
  'pin_remove',
  'announce_create',
];

/** 一行文本 → 去重后的数组。兼容「a,b」「a、b」「a b」「a;b」与已是数组的入参 */
export function splitTokens(raw: unknown): string[] {
  const parts: string[] = [];
  const push = (v: string): void => {
    const t = v.trim();
    if (t && !parts.includes(t)) parts.push(t);
  };
  if (Array.isArray(raw)) {
    for (const it of raw) push(String(it ?? ''));
  } else if (raw !== undefined && raw !== null) {
    for (const it of String(raw).split(/[,，、;；\s]+/)) push(it);
  }
  return parts;
}

/** 频道子频道类型：界面名 → 官方整数枚举（官方文档：0 文字 / 2 语音 / 4 分类 / 10005 直播） */
const GUILD_CHANNEL_TYPES: Record<string, number> = {
  text: 0,
  voice: 2,
  category: 4,
  live: 10005,
  application: 10006,
  forum: 10007,
};

/** 表情表态类型：界面名 → 官方整数（1 系统表情 / 2 emoji） */
const REACTION_EMOJI_TYPES: Record<string, number> = { system: 1, unicode: 2 };

function channelTypeOf(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const key = String(raw ?? 'text').trim().toLowerCase();
  return GUILD_CHANNEL_TYPES[key] ?? 0;
}

function emojiTypeOf(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const key = String(raw ?? 'system').trim().toLowerCase();
  return REACTION_EMOJI_TYPES[key] ?? 1;
}

function groupOpenidOf(host: OfficialActionHost, params: Record<string, unknown>): string | null {
  const explicit = String(params.group_openid ?? '').trim();
  if (explicit) return explicit;
  const uid = Number(params.group_id || 0);
  const mapped = uid ? host.openidOfUid(uid) : undefined;
  return mapped ? String(mapped) : null;
}

function memberOpenidOf(host: OfficialActionHost, params: Record<string, unknown>): string | null {
  for (const key of ['member_openid', 'user_openid', 'openid']) {
    const v = String(params[key] ?? '').trim();
    if (v) return v;
  }
  const uid = Number(params.user_id || 0);
  const mapped = uid ? host.openidOfUid(uid) : undefined;
  return mapped ? String(mapped) : null;
}

function channelOpenidOf(host: OfficialActionHost, params: Record<string, unknown>): string | null {
  const explicit = String(params.channel_openid ?? '').trim();
  if (explicit) return explicit;
  const raw = params.channel_id;
  const uid = Number(raw || 0);
  if (uid) {
    const mapped = host.openidOfUid(uid);
    if (mapped) return String(mapped);
  }
  // 已经是字符串 id（有的调用方直接填 _channel_openid）
  if (typeof raw === 'string' && raw.trim() && !/^\d+$/.test(raw.trim())) return raw.trim();
  return null;
}

function guildIdOf(host: OfficialActionHost, params: Record<string, unknown>): string | null {
  const explicit = String(params.guild_openid ?? '').trim();
  if (explicit) return explicit;
  const raw = params.guild_id;
  const uid = Number(raw || 0);
  if (uid) {
    const mapped = host.openidOfUid(uid);
    if (mapped) return String(mapped);
  }
  if (typeof raw === 'string' && raw.trim() && !/^\d+$/.test(raw.trim())) return raw.trim();
  return null;
}

/** 官方回包里的列表可能是数组，也可能包一层 {list} / {members} —— 统一取数组 */
function arrayOf(raw: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = (raw ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[];
  }
  return [];
}

/** 把成员条目的 member_openid 换成整数 UID（下游流程只认 UID） */
function memberEntry(host: OfficialActionHost, raw: Record<string, unknown>): Record<string, unknown> {
  const openid = String(raw.member_openid ?? raw.user_openid ?? '').trim();
  return {
    ...raw,
    ...(openid ? { user_id: host.uidOf(openid) } : {}),
    nickname: raw.username ?? raw.nickname ?? raw.card ?? '',
    role: raw.member_role ?? raw.role ?? 'member',
  };
}

/** 频道消息的正文/markdown 拆分（频道没有 msg_type，靠字段表达形态） */
function channelContentOf(params: Record<string, unknown>): {
  content: string;
  options: SendMessageOptions;
} {
  let content = typeof params.content === 'string' ? params.content : '';
  let markdown: { content: string } | undefined;
  const rawMarkdown = params.markdown;
  if (typeof rawMarkdown === 'string' && rawMarkdown.trim()) markdown = { content: rawMarkdown };
  else if (rawMarkdown && typeof rawMarkdown === 'object') markdown = rawMarkdown as { content: string };

  const message = params.message;
  if (Array.isArray(message)) {
    const texts: string[] = [];
    for (const seg of message as Record<string, unknown>[]) {
      const data = (seg?.data ?? {}) as Record<string, unknown>;
      if (seg?.type === 'markdown' && String(data.content ?? '').trim()) {
        markdown = { content: String(data.content) };
      } else if (seg?.type === 'text') {
        texts.push(String(data.text ?? ''));
      }
    }
    if (!content && texts.length) content = texts.join('');
  } else if (typeof message === 'string' && !content) {
    content = message;
  }

  const options: SendMessageOptions = {};
  if (markdown) options.markdown = markdown;
  if (params.ark && typeof params.ark === 'object') {
    (options as Record<string, unknown>).ark = params.ark;
  }
  if (params.embed && typeof params.embed === 'object') {
    (options as Record<string, unknown>).embed = params.embed;
  }
  const image = typeof params.image === 'string' ? params.image.trim() : '';
  if (image) options.media = { fileInfo: '', url: image };
  return { content, options };
}

/** 频道发消息（发送侧与 action 名无关，统一走 official 的 channel 场景） */
async function sendChannelMessage(
  host: OfficialActionHost,
  params: Record<string, unknown>,
  reply: ActionReply,
): Promise<void> {
  const cid = channelOpenidOf(host, params);
  if (!cid) {
    reply.fail('send_channel_msg 缺少 channel_id（频道消息必须指明子频道）');
    return;
  }
  const { content, options } = channelContentOf(params);
  if (!content.trim() && !options.markdown && !options.media) {
    reply.fail(
      '频道消息至少要有一个内容字段（content / markdown / ark / embed / image）—— 官方是「至少需要有一个字段，否则无法下发消息」',
    );
    return;
  }
  const res = await sendOfficialMessage(host.projectPath, 'channel', cid, content, options);
  if (!res.ok) {
    reply.fail('发送频道消息失败：官方 API 返回失败（详见日志）');
    return;
  }
  reply.ok({ message_id: res.data?.id || '' });
}

/** 输入中状态（官方 msg_type=6，仅单聊） */
async function sendInputNotify(
  host: OfficialActionHost,
  params: Record<string, unknown>,
  reply: ActionReply,
): Promise<void> {
  if (String(params.message_type ?? '') === 'group' || params.group_id !== undefined) {
    reply.fail('输入中状态只有单聊支持：官方群聊发消息接口没有 msg_type=6（input_notify）能力');
    return;
  }
  const openid = memberOpenidOf(host, params);
  if (!openid) {
    reply.fail(
      '找不到用户（openid 未登记）：send_input_notify 需要 user_openid，或一个已经出现过（有 UID 映射）的 user_id',
    );
    return;
  }
  const raw = Number(params.input_second);
  const inputSecond = Math.min(60, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 60));
  const res = await sendOfficialMessage(host.projectPath, 'c2c', openid, '', {
    msgType: 6,
    inputNotify: { inputSecond },
  });
  if (!res.ok) {
    reply.fail('发送「输入中」状态失败：官方 API 返回失败（详见日志）');
    return;
  }
  reply.ok({ message_id: res.data?.id || '' });
}

/**
 * 把 OneBot action 名派发到官方 helper。
 *
 * @returns true 表示已处理（成功或已明确报错）；false 表示这个 action 不属于本模块
 */
export async function runOfficialAction(
  host: OfficialActionHost,
  action: string,
  params: Record<string, unknown>,
  reply: ActionReply,
): Promise<boolean> {
  const path = host.projectPath;

  switch (action) {
    case 'send_input_notify':
      await sendInputNotify(host, params, reply);
      return true;
    case 'send_channel_msg':
      await sendChannelMessage(host, params, reply);
      return true;

    case 'get_login_info': {
      const self = await getBotSelf(path);
      const selfData = (self.data ?? {}) as Record<string, unknown>;
      reply.ok({
        user_id: host.selfId,
        nickname: self.ok ? String(selfData.username ?? 'QQBot') : 'QQBot',
        avatar: String(selfData.avatar ?? ''),
        self_id: host.botUserId || String(selfData.id ?? ''),
      });
      return true;
    }

    // ── 群管理 ────────────────────────────────────────────────
    case 'set_group_ban': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）：请先让这个群产生一条消息事件`);
        return true;
      }
      const mid = memberOpenidOf(host, params);
      if (!mid) {
        reply.fail(`找不到用户（user_id=${String(params.user_id ?? '')} 还没有 openid 映射）：官方接口只认 openid`);
        return true;
      }
      const res = await setGroupMemberMute(path, gid, mid, Number(params.duration) || 0);
      if (res.ok) reply.ok({});
      else reply.fail(res.error || '禁言失败');
      return true;
    }
    case 'set_group_kick': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const mid = memberOpenidOf(host, params);
      if (!mid) {
        reply.fail(`找不到用户（user_id=${String(params.user_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const res = await removeGroupMembers(path, gid, [mid], params.reject_add_request === true);
      if (res.ok) reply.ok({});
      else reply.fail(res.error || '踢人失败');
      return true;
    }
    case 'get_group_info': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const res = await getGroupInfo(path, gid);
      if (!res.ok) {
        reply.fail(res.error || '查询群信息失败');
        return true;
      }
      const d = (res.data ?? {}) as Record<string, unknown>;
      reply.ok({
        group_id: params.group_id,
        group_name: d.group_name ?? '',
        group_memo: d.group_finger_memo ?? d.group_memo ?? '',
        member_count: d.group_member_num ?? d.member_count ?? 0,
      });
      return true;
    }
    case 'get_group_member_list': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const res = await getGroupMembers(path, gid, String(params.cursor ?? ''));
      if (!res.ok) {
        reply.fail(res.error || '查询群成员失败');
        return true;
      }
      const d = (res.data ?? {}) as Record<string, unknown>;
      reply.ok({
        members: arrayOf(d.members, 'members').map((m) => memberEntry(host, m)),
        next_cursor: d.next_cursor ?? '',
      });
      return true;
    }
    case 'set_group_add_request': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const mid = memberOpenidOf(host, params);
      if (!mid) {
        reply.fail(`找不到申请人（user_id=${String(params.user_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const flag = String(params.flag ?? params.join_request_id ?? '').trim();
      const reason = String(params.reason ?? '').trim();
      const options: { joinRequestId?: string; rejectReason?: string } = {};
      if (flag) options.joinRequestId = flag;
      if (reason) options.rejectReason = reason;
      const approve = params.approve !== false;
      const res = await approveGroupJoinRequest(path, gid, mid, approve, options);
      if (res.ok) reply.ok({});
      else reply.fail(res.error || '入群审批失败');
      return true;
    }
    case 'get_group_join_requests': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const limit = params.limit === undefined ? undefined : Number(params.limit);
      const res = await listGroupJoinRequests(path, gid, String(params.cursor ?? ''), limit);
      if (!res.ok) {
        reply.fail(res.error || '查询入群申请失败');
        return true;
      }
      const d = (res.data ?? {}) as Record<string, unknown>;
      // 官方真实字段名是 list（写成 join_requests 会恒为空 —— 踩过）
      const list = arrayOf(d.list, 'list');
      reply.ok({
        requests: list.map((it) => {
          const openid = String(it.member_openid ?? it.user_openid ?? '');
          const verify = (it.verify_info ?? {}) as Record<string, unknown>;
          return {
            flag: String(it.join_request_id ?? ''),
            nickname: it.username ?? '',
            verify_message: verify.verify_message ?? '',
            apply_source: it.apply_source ?? '',
            apply_at: it.apply_at ?? '',
            ...(openid ? { user_id: host.uidOf(openid) } : {}),
          };
        }),
        next_cursor: d.next_cursor ?? '',
      });
      return true;
    }
    case 'get_group_mute_state': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const res = await getGroupMuteState(path, gid);
      if (!res.ok) {
        reply.fail(res.error || '查询群禁言状态失败');
        return true;
      }
      const d = (res.data ?? {}) as Record<string, unknown>;
      const rule = (d.global_rule ?? {}) as Record<string, unknown>;
      reply.ok({
        group_id: params.group_id,
        mute_all: isGroupMutedNow(rule),
        mute_mode: String(rule.mode ?? 'none'),
        global_rule: rule,
        members: arrayOf(d.members, 'members').map((m) => memberEntry(host, m)),
      });
      return true;
    }
    case 'get_group_member_info': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const mid = memberOpenidOf(host, params);
      if (!mid) {
        reply.fail(`找不到用户（user_id=${String(params.user_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const res = await getGroupMemberInfo(path, gid, mid);
      if (!res.ok) {
        reply.fail(res.error || '查询群成员信息失败');
        return true;
      }
      reply.ok(memberEntry(host, (res.data ?? {}) as Record<string, unknown>));
      return true;
    }
    case 'get_group_bot_state': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const res = await getGroupBotState(path, gid);
      if (!res.ok) {
        reply.fail(res.error || '查询机器人群内状态失败');
        return true;
      }
      const d = (res.data ?? {}) as Record<string, unknown>;
      const role = String(d.member_role ?? '');
      reply.ok({
        ...d,
        is_admin: role === 'admin' || role === 'owner',
        recv_msg_setting: d.recv_msg_setting ?? '',
      });
      return true;
    }
    case 'list_group_blacklist': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const limit = params.limit === undefined ? undefined : Number(params.limit);
      const res = await listGroupBlacklist(path, gid, String(params.cursor ?? ''), limit);
      if (!res.ok) {
        reply.fail(res.error || '查询黑名单失败');
        return true;
      }
      const d = (res.data ?? {}) as Record<string, unknown>;
      reply.ok({
        users: arrayOf(d.users, 'users').map((u) => memberEntry(host, u)),
        next_cursor: d.next_cursor ?? '',
      });
      return true;
    }
    case 'update_group_blacklist': {
      const gid = groupOpenidOf(host, params);
      if (!gid) {
        reply.fail(`找不到群（group_id=${String(params.group_id ?? '')} 还没有 openid 映射）`);
        return true;
      }
      const ids = splitTokens(params.member_openids ?? params.openids);
      if (!ids.length) {
        reply.fail('update_group_blacklist 缺少目标：member_openids 不能为空（传逗号/顿号分隔的 openid）');
        return true;
      }
      const op = String(params.op ?? 'add') === 'del' ? 'del' : 'add';
      const res = await updateGroupBlacklist(path, gid, ids, op);
      if (!res.ok) {
        reply.fail(res.error || '更新黑名单失败');
        return true;
      }
      reply.ok({
        op,
        count: ids.length,
        fail_openids: ((res.data ?? {}) as Record<string, unknown>).fail_openids ?? [],
        hint: op === 'add' ? '已拉黑：对方仍在群里，但不会再收到机器人消息' : '已移出黑名单',
      });
      return true;
    }

    // ── 入群审批策略 / 分享链接 ────────────────────────────────
    case 'list_join_approval_strategies': {
      const limit = params.limit === undefined ? undefined : Number(params.limit);
      const res = await listJoinApprovalStrategies(path, String(params.cursor ?? ''), limit);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '查询审批策略失败');
      return true;
    }
    case 'create_join_approval_strategy': {
      const groupIds = splitTokens(params.group_ids);
      const groupOpenids = splitTokens(params.group_openids);
      const input: Record<string, unknown> = {
        ...(groupIds.length ? { groupIds } : {}),
        ...(groupOpenids.length ? { groupOpenids } : {}),
        ...(params.is_enable === undefined ? {} : { isEnable: params.is_enable }),
        ...(params.expire_at === undefined ? {} : { expireAt: params.expire_at }),
        ...(params.remark === undefined ? {} : { remark: params.remark }),
      };
      const res = await createJoinApprovalStrategy(path, input);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '创建审批策略失败');
      return true;
    }
    case 'update_strategy_whitelist': {
      const strategyId = String(params.strategy_id ?? '').trim();
      if (!strategyId) {
        reply.fail('update_strategy_whitelist 缺少 strategy_id');
        return true;
      }
      const users = splitTokens(params.whitelist_users ?? params.users);
      const res = await updateStrategyWhitelist(path, strategyId, params.op ?? 'add', users);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '更新策略白名单失败');
      return true;
    }
    case 'generate_url_link': {
      const res = await generateUrlLink(path, params.callback_data);
      if (!res.ok) {
        reply.fail(res.error || '生成分享链接失败');
        return true;
      }
      // 官方回包把真正的链接又套了一层 data
      const d = (res.data ?? {}) as Record<string, unknown>;
      const inner = (d.data ?? {}) as Record<string, unknown>;
      reply.ok({ url: inner.url ?? d.url ?? '', callback_data: params.callback_data });
      return true;
    }

    // ── 自定义菜单 / 指令面板 ─────────────────────────────────
    case 'get_menu': {
      const res = await getMenu(path);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '查询菜单失败');
      return true;
    }
    case 'set_menu': {
      if (params.menu === undefined || params.menu === null) {
        reply.fail('set_menu 需要 menu 参数（菜单结构对象）');
        return true;
      }
      const res = await setMenu(path, params.menu);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '设置菜单失败');
      return true;
    }
    case 'list_panels': {
      const scope = String(params.scope ?? 'c2c');
      const limit = params.limit === undefined ? undefined : Number(params.limit);
      const res = await listPanels(path, scope, limit);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '查询指令面板失败');
      return true;
    }
    case 'create_panel': {
      const panel = (params.panel ?? {}) as Record<string, unknown>;
      const payload = {
        ...panel,
        scope: String(params.scope ?? 'c2c'),
        target_type: String(params.target_type ?? 'all'),
      };
      const res = await createPanel(path, payload);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '创建指令面板失败');
      return true;
    }
    case 'update_panel': {
      const panelId = String(params.panel_id ?? '').trim();
      if (!panelId) {
        reply.fail('update_panel 缺少 panel_id');
        return true;
      }
      if (params.panel === undefined) {
        reply.fail('update_panel 需要 panel 参数（面板结构对象）');
        return true;
      }
      const res = await updatePanel(path, panelId, params.panel);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '更新指令面板失败');
      return true;
    }
    case 'delete_panel': {
      const panelId = String(params.panel_id ?? '').trim();
      if (!panelId) {
        reply.fail('delete_panel 缺少 panel_id');
        return true;
      }
      const res = await deletePanel(path, panelId);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '删除指令面板失败');
      return true;
    }
    case 'set_panel_target': {
      const panelId = String(params.panel_id ?? '').trim();
      if (!panelId) {
        reply.fail('set_panel_target 缺少 panel_id');
        return true;
      }
      const res = await setPanelTarget(path, panelId, {
        userOpenids: splitTokens(params.user_openids),
        groupOpenids: splitTokens(params.group_openids),
      });
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '设置面板目标失败');
      return true;
    }

    // ── QQ 频道（Guild）──────────────────────────────────────
    case 'channel_list': {
      const gid = guildIdOf(host, params);
      if (!gid) {
        reply.fail('channel_list 缺少 guild_id（或该 UID 还没有 openid 映射）');
        return true;
      }
      const res = await listGuildChannels(path, gid);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '获取子频道列表失败');
      return true;
    }
    case 'channel_create': {
      const gid = guildIdOf(host, params);
      if (!gid) {
        reply.fail('channel_create 缺少 guild_id（或该 UID 还没有 openid 映射）');
        return true;
      }
      const name = String(params.name ?? '').trim();
      if (!name) {
        reply.fail('channel_create 缺少 name');
        return true;
      }
      const body = {
        name,
        type: channelTypeOf(params.type),
        position: Number(params.position) || 0,
      };
      const res = await createGuildChannel(path, gid, body);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '创建子频道失败');
      return true;
    }
    case 'reaction_add': {
      const cid = channelOpenidOf(host, params);
      const mid = String(params.message_id ?? '').trim();
      const emojiId = String(params.emoji_id ?? '').trim();
      if (!cid || !mid || !emojiId) {
        reply.fail('reaction_add 需要 channel_id、message_id、emoji_id（缺 emoji_id 的请求官方必然失败）');
        return true;
      }
      const res = await addChannelReaction(path, cid, mid, emojiTypeOf(params.emoji_type), emojiId);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '添加表情表态失败');
      return true;
    }
    case 'pin_remove': {
      const cid = channelOpenidOf(host, params);
      if (!cid) {
        reply.fail('pin_remove 缺少 channel_id');
        return true;
      }
      // 不传 message_id = 清空该子频道全部精华（官方用 'all' 表示）
      const mid = String(params.message_id ?? '').trim() || 'all';
      const res = await removeChannelPin(path, cid, mid);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '删除精华消息失败');
      return true;
    }
    case 'announce_create': {
      const gid = guildIdOf(host, params);
      if (!gid) {
        reply.fail('announce_create 缺少 guild_id（或该 UID 还没有 openid 映射）');
        return true;
      }
      const body: Record<string, unknown> = {};
      const messageId = String(params.message_id ?? '').trim();
      if (messageId) body.message_id = messageId;
      if (params.channel_id !== undefined) {
        const cid = channelOpenidOf(host, params);
        if (cid) body.channel_id = cid;
      }
      if (params.announces_type !== undefined) body.announces_type = Number(params.announces_type) || 0;
      const rawRecommend = params.recommend_channels;
      if (rawRecommend !== undefined) {
        if (typeof rawRecommend === 'string') {
          try {
            body.recommend_channels = JSON.parse(rawRecommend);
          } catch {
            reply.fail(`recommend_channels 不是合法 JSON：${rawRecommend.slice(0, 80)}`);
            return true;
          }
        } else {
          body.recommend_channels = rawRecommend;
        }
      }
      const res = await createChannelAnnounce(path, gid, body);
      if (res.ok) reply.ok(res.data ?? {});
      else reply.fail(res.error || '创建频道公告失败');
      return true;
    }

    default:
      return false;
  }
}

// ── 官方推送事件 → OneBot 事件 ───────────────────────────────

const GROUP_NOTICE_TYPES: Record<string, string> = {
  GROUP_ADD_ROBOT: 'group_add_robot',
  GROUP_DEL_ROBOT: 'group_del_robot',
  GROUP_MSG_RECEIVE: 'group_msg_receive',
  GROUP_MSG_REJECT: 'group_msg_reject',
};

const USER_NOTICE_TYPES: Record<string, string> = {
  FRIEND_ADD: 'friend_add',
  FRIEND_DEL: 'friend_del',
  C2C_MSG_RECEIVE: 'c2c_msg_receive',
  C2C_MSG_REJECT: 'c2c_msg_reject',
  SUBSCRIBE_MESSAGE_STATUS: 'subscribe_message_status',
};

/** 群机器人在位 / 好友 / 订阅状态 / 成员进出 / 消息审核 → notice 事件；不认识返回 null */
export function buildNoticeEvent(
  host: OfficialEventHost,
  type: string,
  data: Record<string, unknown>,
  ts: number,
): Record<string, unknown> | null {
  const groupNotice = GROUP_NOTICE_TYPES[type];
  if (groupNotice) {
    const groupOpenid = String(data.group_openid ?? '');
    if (!groupOpenid) return null;
    const opOpenid = String(data.op_member_openid ?? '');
    return {
      post_type: 'notice',
      notice_type: groupNotice,
      time: ts,
      self_id: host.selfId,
      group_id: host.uidOf(groupOpenid),
      ...(opOpenid ? { operator_id: host.uidOf(opOpenid) } : {}),
      _group_openid: groupOpenid,
    };
  }

  const userNotice = USER_NOTICE_TYPES[type];
  if (userNotice) {
    const openid = String(data.openid ?? '');
    if (!openid) return null;
    const payload: Record<string, unknown> = {
      post_type: 'notice',
      notice_type: userNotice,
      time: ts,
      self_id: host.selfId,
      user_id: host.uidOf(openid),
      _openid: openid,
    };
    // 好友来源：渠道统计只认 scene / scene_param / short_code
    if (type === 'FRIEND_ADD') {
      if (data.scene !== undefined) payload.scene = String(data.scene);
      if (data.scene_param !== undefined) payload.scene_param = String(data.scene_param);
      if (data.short_code !== undefined) payload.short_code = String(data.short_code);
    }
    return payload;
  }

  if (type === 'GROUP_MEMBER_ADD' || type === 'GROUP_MEMBER_REMOVE') {
    const groupOpenid = String(data.group_openid ?? '');
    const memberOpenid = String(data.member_openid ?? '');
    if (!groupOpenid || !memberOpenid) return null;
    const opOpenid = String(data.op_member_openid ?? '');
    return {
      post_type: 'notice',
      notice_type: type === 'GROUP_MEMBER_ADD' ? 'group_member_add' : 'group_member_remove',
      sub_type: type === 'GROUP_MEMBER_ADD' ? 'approve' : 'leave',
      time: ts,
      self_id: host.selfId,
      group_id: host.uidOf(groupOpenid),
      user_id: host.uidOf(memberOpenid),
      ...(opOpenid ? { operator_id: host.uidOf(opOpenid) } : {}),
      _group_openid: groupOpenid,
      _member_openid: memberOpenid,
    };
  }

  if (type === 'MESSAGE_AUDIT_PASS' || type === 'MESSAGE_AUDIT_REJECT') {
    return {
      post_type: 'notice',
      notice_type: 'message_audit',
      sub_type: type === 'MESSAGE_AUDIT_PASS' ? 'pass' : 'reject',
      time: ts,
      self_id: host.selfId,
      audit_id: String(data.audit_id ?? ''),
      ...(data.message_id === undefined ? {} : { message_id: data.message_id }),
      ...(data.channel_id === undefined ? {} : { channel_id: data.channel_id }),
    };
  }

  return null;
}

/** 入群申请 → request 事件（flag 就是审批要回传的 join_request_id） */
export function buildJoinRequestEvent(
  host: OfficialEventHost,
  data: Record<string, unknown>,
  ts: number,
): Record<string, unknown> | null {
  const groupOpenid = String(data.group_openid ?? '');
  const memberOpenid = String(data.member_openid ?? '');
  // 缺申请人就定位不到人：宁可不发，也不发半成品（下游会拿 user_id=0 去审批）
  if (!groupOpenid || !memberOpenid) return null;
  const verify = (data.verify_info ?? {}) as Record<string, unknown>;
  return {
    post_type: 'request',
    request_type: 'group',
    sub_type: 'add',
    time: ts,
    self_id: host.selfId,
    group_id: host.uidOf(groupOpenid),
    user_id: host.uidOf(memberOpenid),
    comment: String(verify.verify_message ?? ''),
    flag: String(data.join_request_id ?? ''),
    _group_openid: groupOpenid,
    _member_openid: memberOpenid,
  };
}

/** 频道消息（AT_MESSAGE_CREATE / MESSAGE_CREATE）→ message 事件 */
export function buildGuildMessageEvent(
  host: OfficialEventHost,
  type: string,
  data: Record<string, unknown>,
  ts: number,
): Record<string, unknown> | null {
  const guildOpenid = String(data.guild_id ?? '');
  const channelOpenid = String(data.channel_id ?? '');
  const author = (data.author ?? {}) as Record<string, unknown>;
  const authorId = String(author.id ?? '');
  if (!guildOpenid || !channelOpenid || !authorId) return null;
  const content = String(data.content ?? '').replace(/<@[^>]+>\s*/g, '').trim();
  const uid = host.uidOf(authorId);
  const at = type === 'AT_MESSAGE_CREATE';
  return {
    post_type: 'message',
    message_type: 'guild',
    sub_type: at ? 'at' : 'channel_all',
    to_me: at,
    time: ts,
    self_id: host.selfId,
    guild_id: host.uidOf(guildOpenid),
    channel_id: host.uidOf(channelOpenid),
    user_id: uid,
    message_id: host.hashToInt(String(data.id ?? '')),
    message: [{ type: 'text', data: { text: content } }],
    raw_message: content,
    font: 0,
    sender: { user_id: uid, nickname: String(author.username ?? ''), sex: 'unknown', age: 0 },
    _channel_openid: channelOpenid,
    _guild_openid: guildOpenid,
  };
}

/** 按钮/消息互动回调 → notice（顶层带 button_id / button_data / interaction_id） */
export function buildInteractionEvent(
  host: OfficialEventHost,
  data: Record<string, unknown>,
  ts: number,
): { payload: Record<string, unknown>; interactionId: string; needAck: boolean } | null {
  const id = String(data.id ?? '');
  if (!id) return null;
  const interactionType = Number(data.type) || 0;
  const chatType = Number(data.chat_type) || 0; // 1 = 群聊
  const resolved = ((data.data ?? {}) as Record<string, unknown>).resolved as
    | Record<string, unknown>
    | undefined;
  const groupOpenid = String(data.group_openid ?? '');
  const memberOpenid = String(data.group_member_openid ?? '');
  const userOpenid = String(data.user_openid ?? '');

  // 顺序有意义：先登记人，再登记群（下游看到的是「人 10000 / 群 10001」这种稳定号段）
  const userId = chatType === 1 ? memberOpenid || userOpenid : userOpenid || memberOpenid;
  const userUid = userId ? host.uidOf(userId) : 0;

  const payload: Record<string, unknown> = {
    post_type: 'notice',
    notice_type: 'interaction',
    time: ts,
    self_id: host.selfId,
    interaction_id: id,
    type: interactionType,
    ...(resolved?.button_id === undefined ? {} : { button_id: resolved.button_id }),
    ...(resolved?.button_data === undefined ? {} : { button_data: resolved.button_data }),
    user_id: userUid,
    ...(groupOpenid ? { group_id: host.uidOf(groupOpenid), _group_openid: groupOpenid } : {}),
    ...(memberOpenid ? { _member_openid: memberOpenid } : {}),
    ...(userOpenid ? { _openid: userOpenid } : {}),
    data,
  };

  // type=13 是消息反馈，官方不要求回应；其余互动必须回执，否则客户端一直转圈
  return { payload, interactionId: id, needAck: interactionType !== 13 };
}
