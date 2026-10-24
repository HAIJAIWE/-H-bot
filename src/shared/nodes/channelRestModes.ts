// src/shared/nodes/channelRestModes.ts
//
// channel_op:mode 的**私域 REST 家族**选项（身份组/成员/禁言/权限/私信/日程/论坛/消息详情）。
//
// 为什么不塞进 fieldOptions.ts：那张总表已经 768 行，再加 34 条就越过"大文件"线；
// 而这 34 条本来就是**同一族**（都走 translator/actions/channelRest.ts 的一张规格表），
// 放在一起看，比散在"全节点枚举总表"里更容易核对。
import type { FieldOption } from '../types/nodeV2'

/** 与 `src/main/services/translator/actions/channelRest.ts` 的 CHANNEL_REST_MODES 一一对应 */
export const CHANNEL_REST_MODE_OPTIONS = [
  { value: 'guild_get', label: '获取频道详情', group: '频道信息' },
  { value: 'guild_me', label: '获取机器人信息', group: '频道信息' },
  { value: 'guild_my_list', label: '获取已加入频道', group: '频道信息' },
  { value: 'guild_permission', label: '查询接口权限', group: '频道信息' },
  { value: 'guild_permission_demand', label: '申请接口权限', group: '频道信息' },
  { value: 'role_list', label: '获取身份组列表', group: '身份组' },
  { value: 'role_create', label: '创建身份组', group: '身份组' },
  { value: 'role_update', label: '修改身份组', group: '身份组' },
  { value: 'role_delete', label: '删除身份组', group: '身份组' },
  { value: 'role_member_add', label: '添加身份组成员', group: '身份组' },
  { value: 'role_member_remove', label: '移除身份组成员', group: '身份组' },
  { value: 'role_members', label: '获取身份组成员', group: '身份组' },
  { value: 'member_list', label: '获取成员列表', group: '成员' },
  { value: 'member_get', label: '获取成员详情', group: '成员' },
  { value: 'member_remove', label: '移除频道成员', group: '成员' },
  { value: 'mute_guild', label: '全员禁言', group: '禁言' },
  { value: 'mute_member', label: '成员禁言', group: '禁言' },
  { value: 'mute_multi', label: '批量禁言', group: '禁言' },
  { value: 'member_perm_get', label: '查询成员权限', group: '子频道权限' },
  { value: 'member_perm_put', label: '修改成员权限', group: '子频道权限' },
  { value: 'role_perm_get', label: '查询身份组权限', group: '子频道权限' },
  { value: 'role_perm_put', label: '修改身份组权限', group: '子频道权限' },
  { value: 'dm_create', label: '创建私信会话', group: '频道私信' },
  { value: 'dm_send', label: '发送私信消息', group: '频道私信' },
  { value: 'schedule_list', label: '获取日程列表', group: '日程' },
  { value: 'schedule_get', label: '获取日程详情', group: '日程' },
  { value: 'schedule_create', label: '创建日程', group: '日程' },
  { value: 'schedule_update', label: '修改日程', group: '日程' },
  { value: 'schedule_delete', label: '删除日程', group: '日程' },
  { value: 'thread_list', label: '获取帖子列表', group: '论坛' },
  { value: 'thread_get', label: '获取帖子详情', group: '论坛' },
  { value: 'thread_create', label: '发表帖子', group: '论坛' },
  { value: 'thread_delete', label: '删除帖子', group: '论坛' },
  { value: 'message_get', label: '获取消息详情', group: '消息' },
] as const satisfies readonly FieldOption[]

/**
 * 这些模式要从「请求体」端口取值：写操作当请求体发，查询/分页类（after、limit、
 * start_index、since）由 channelRest 拼成查询参数 —— 端口只有一个，语义写在描述里。
 */
export const CHANNEL_REST_BODY_MODES = [
  'channel_create',
  'channel_update',
  'announce_create',
  'guild_my_list',
  'guild_permission_demand',
  'role_create',
  'role_update',
  'role_members',
  'member_list',
  'member_remove',
  'mute_guild',
  'mute_member',
  'mute_multi',
  'member_perm_put',
  'role_perm_put',
  'dm_send',
  'schedule_list',
  'schedule_create',
  'schedule_update',
  'thread_create',
] as const

/** 需要「用户 ID」端口的模式 */
export const CHANNEL_REST_USER_MODES = [
  'member_get',
  'member_remove',
  'mute_member',
  'role_member_add',
  'role_member_remove',
  'member_perm_get',
  'member_perm_put',
  'dm_create',
] as const

/** 需要「身份组 ID」端口的模式 */
export const CHANNEL_REST_ROLE_MODES = [
  'role_update',
  'role_delete',
  'role_member_add',
  'role_member_remove',
  'role_members',
  'role_perm_get',
  'role_perm_put',
] as const
