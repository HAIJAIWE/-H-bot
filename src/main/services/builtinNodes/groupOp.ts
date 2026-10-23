/**
 * 群管理操作纯 TS 实现
 * 历史：由已移除的 qqbat_nodes/builtin/group_op.py 移植而来，现状以本文件为准
 */

import { GROUP_OP_LEGACY_REASONS } from '../../../shared/nodes/fieldOptions';
import { BotInterface, OneBotEvent } from './builtinNodes';

interface ExtendedOneBotEvent extends OneBotEvent {
  flag?: string;
  sub_type?: string;
}

// ============================================================
// 常量与类型定义
// ============================================================

const ADAPTER_FEATURE: Record<string, string> = {
  ban: 'group_punish',
  kick: 'group_punish',
  mute_all: 'set_group_whole_ban',
  set_card: 'set_member_attr',
  set_title: 'set_member_attr',
  leave: 'set_group_leave',
  essence: 'essence_msg',
  approve_friend: 'set_friend_add_request',
  approve_group: 'set_group_add_request',
  notice: '_send_group_notice',
  upload_file: 'upload_group_file',
};

/**
 * 「加入黑名单」用多长的禁言近似。
 *
 * 官方**没有真正的黑名单接口**，最接近的是长期禁言，而禁言上限就是 30 天。
 * 所以这里取 30 天，并在返回信息里**说清它会自动到期** ——
 * 让用户以为"永久"是最危险的那种沉默差异。
 */
const BLACKLIST_DURATION_SEC = 30 * 24 * 3600;

/**
 * 解析批量模式的目标 QQ 号。
 *
 * 接受数组或"逗号/空格/换行分隔的字符串"（画布里用户常直接黏一行进来）。
 * 只保留纯数字，其余丢弃 —— 调用方按返回长度就能知道"有几个没被处理"。
 */
export function parseUserIds(raw: string | Array<string | number> | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  const list = Array.isArray(raw) ? raw.map((x) => String(x)) : String(raw).split(/[\s,，、]+/);
  return [...new Set(list.map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))];
}

interface GroupOpOptions {
  mode: 'ban' | 'kick' | 'kick_batch' | 'blacklist_add' | 'blacklist_del' | 'mute_all' | 'set_card' |
        'set_title' | 'leave' | 'approve_friend' | 'approve_group' | 'notice' | 'upload_file' | 'essence';
  group_id?: string;
  user_id?: string;
  /** 批量模式（批量踢出 / 加入黑名单 / 移出黑名单）的目标 QQ 号，数组或逗号/空格分隔的字符串 */
  user_ids?: string | string[];
  duration?: number;
  enable?: boolean;
  card?: string;
  title?: string;
  flag?: string;
  approve?: boolean;
  sub_type?: string;
  remark?: string;
  content?: string;
  file_path?: string;
  file_name?: string;
  message_id?: string;
  reject_add_request?: boolean;
  reason?: string;
  title_duration?: number;
  folder_id?: string;
  image?: string;
}

interface GroupOpResult {
  success: boolean;
  error: string;
  /** 批量模式的回执（已处理几个、黑名单多久到期）；失败时不给 */
  message?: string;
}

// ============================================================
// 核心群操作函数
// ============================================================

export async function groupOp(
  bot: BotInterface | null = null,
  event: ExtendedOneBotEvent | null = null,
  options: GroupOpOptions
): Promise<GroupOpResult> {
  const {
    mode = 'ban',
    group_id = '',
    user_id = '',
    user_ids = '',
    duration = 600,
    enable = true,
    card = '',
    title = '',
    flag = '',
    approve = true,
    sub_type = 'add',
    remark = '',
    content = '',
    message_id = '',
    title_duration = -1,
  } = options;

  // 适配器能力检测
  const feature = ADAPTER_FEATURE[mode];

  if (feature) {
    // 这里需要适配器检测逻辑，暂时跳过
    // const unsupported = checkAdapterSupport(bot, event, feature);
    // if (unsupported) return unsupported;
  }

  // 遗留模式（官方根本没有对应能力）：明确拒绝并说清原因。
  // 以前它们会走各自的分支去调用一个必失败的接口，用户只看到一句笼统的报错；
  // 现在统一返回「模式不可用 + 原因」，原因表在 shared/nodes/fieldOptions.ts（单一真相）。
  const legacyReason = GROUP_OP_LEGACY_REASONS[mode];
  if (legacyReason) {
    return { success: false, error: `「${mode}」不可用：${legacyReason}` };
  }

  try {
    // ==== ban 模式（禁言成员）====
    if (mode === 'ban') {
      const uid = String(user_id || event?.user_id || '');
      const gid = String(group_id || event?.group_id || '');
      if (!uid || !gid) return { success: false, error: 'user_id 或 group_id 为空' };

      let durationInt = 0;
      try {
        durationInt = Math.floor(Number(duration));
      } catch {
        return { success: false, error: `duration 不是有效数字: ${duration}` };
      }
      if (durationInt < 0) durationInt = 0;
      if (durationInt > BLACKLIST_DURATION_SEC) durationInt = BLACKLIST_DURATION_SEC;

      if (!bot) return { success: false, error: 'bot 不可用' };
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('set_group_ban', {
        group_id: parseInt(gid),
        user_id: parseInt(uid),
        duration: durationInt,
      });
      return { success: true, error: '' };
    }

    // ==== kick 模式（踢出成员）====
    if (mode === 'kick') {
      const uid = String(user_id || event?.user_id || '');
      const gid = String(group_id || event?.group_id || '');
      if (!uid || !gid) return { success: false, error: 'user_id 或 group_id 为空' };

      if (!bot) return { success: false, error: 'bot 不可用' };
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('set_group_kick', {
        group_id: parseInt(gid),
        user_id: parseInt(uid),
        reject_add_request: false,
      });
      return { success: true, error: '' };
    }

    // ==== kick_batch / blacklist_add / blacklist_del（按 QQ 号列表批量操作）====
    if (mode === 'kick_batch' || mode === 'blacklist_add' || mode === 'blacklist_del') {
      const gid = String(group_id || event?.group_id || '');
      if (!gid) return { success: false, error: 'group_id 不能为空（当前非群聊场景）' };

      const targets = parseUserIds(user_ids);
      if (!targets.length) {
        return { success: false, error: 'user_ids 不能为空（多个 QQ 号用逗号或空格分隔）' };
      }

      if (!bot) return { success: false, error: 'bot 不可用' };

      // 逐个下发：一个号码失败（不在群里 / 权限不够）不该让整批停住 ——
      // 记下失败的，全部跑完后一次说清"几个成功、几个失败、失败的是谁"。
      const failed: string[] = [];
      for (const uid of targets) {
        try {
          if (mode === 'kick_batch') {
            await bot.callApi('set_group_kick', {
              group_id: parseInt(gid),
              user_id: parseInt(uid),
              reject_add_request: false,
            });
          } else {
            await bot.callApi('set_group_ban', {
              group_id: parseInt(gid),
              user_id: parseInt(uid),
              // 加入黑名单 = 30 天禁言（官方上限）；移出黑名单 = 解除禁言（duration 0）
              duration: mode === 'blacklist_add' ? BLACKLIST_DURATION_SEC : 0,
            });
          }
        } catch (e) {
          failed.push(uid);
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[group_op] ${mode} 处理 ${uid} 失败: ${msg}`);
        }
      }
      if (failed.length) {
        return {
          success: false,
          error: `${targets.length} 个目标里有 ${failed.length} 个失败: ${failed.join(', ')}`,
        };
      }
      const note =
        mode === 'blacklist_add'
          ? `（官方禁言上限 ${BLACKLIST_DURATION_SEC / 86400} 天，到期会自动解除）`
          : '';
      return { success: true, error: '', message: `已处理 ${targets.length} 个目标${note}` };
    }

    // ==== mute_all 模式（全员禁言/解除）====
    if (mode === 'mute_all') {
      const gid = String(group_id || event?.group_id || '');
      if (!gid) return { success: false, error: 'group_id 不能为空（当前非群聊场景）' };
      
      if (!bot) return { success: false, error: 'bot 不可用' };
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('set_group_whole_ban', {
        group_id: parseInt(gid),
        enable: Boolean(enable),
      });
      const action = enable ? '开启全体禁言' : '解除全体禁言';
      console.info(`[group_op] ${action}成功: 群 ${gid}`);
      return { success: true, error: '' };
    }

    // ==== set_card 模式（设置群名片）====
    if (mode === 'set_card') {
      const uid = String(user_id || event?.user_id || '');
      const gid = String(group_id || event?.group_id || '');
      if (!gid) return { success: false, error: '当前为私聊场景，无法执行群操作' };
      if (!uid) return { success: false, error: 'user_id 不能为空' };

      if (!bot) return { success: false, error: 'bot 不可用' };
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('set_group_card', {
        group_id: parseInt(gid),
        user_id: parseInt(uid),
        card: String(card),
      });
      return { success: true, error: '' };
    }

    // ==== set_title 模式（设置群头衔）====
    if (mode === 'set_title') {
      const uid = String(user_id || event?.user_id || '');
      const gid = String(group_id || event?.group_id || '');
      if (!gid) return { success: false, error: '当前为私聊场景，无法执行群操作' };
      if (!uid) return { success: false, error: 'user_id 不能为空' };

      let titleDurationInt = -1;
      try {
        titleDurationInt = Math.floor(Number(title_duration));
      } catch {
        return { success: false, error: `title_duration 不是有效数字: ${title_duration}` };
      }

      if (!bot) return { success: false, error: 'bot 不可用' };
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('set_group_special_title', {
        group_id: parseInt(gid),
        user_id: parseInt(uid),
        special_title: String(title),
        duration: titleDurationInt,
      });
      return { success: true, error: '' };
    }

    // ==== leave 模式（退群）====
    if (mode === 'leave') {
      const gid = String(group_id || event?.group_id || '');
      if (!gid) return { success: false, error: '当前为私聊场景，无法执行群操作' };
      
      if (!bot) return { success: false, error: 'bot 不可用' };
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('set_group_leave', { group_id: parseInt(gid) });
      return { success: true, error: '' };
    }

    // ==== approve_friend 模式（同意/拒绝好友请求）====
    if (mode === 'approve_friend') {
      const flagStr = String(flag || (event as ExtendedOneBotEvent)?.flag || '');
      if (!flag) return { success: false, error: 'flag 不能为空' };

      if (!bot) return { success: false, error: 'bot 不可用' };
      // 修复：approve 此前被硬编码为 true —— 面板上有「同意」开关，关掉却仍然同意，
      // 属于"参数看着生效、实际不影响行为"的隐性 bug。
      const approved = approve !== false;
      await bot.callApi('set_friend_add_request', {
        flag: flagStr,
        approve: approved,
        remark: String(remark || ''),
      });
      console.info(`[group_op] ${approved ? '同意' : '拒绝'}加好友请求成功: flag=${flag}`);
      return { success: true, error: '' };
    }

    // ==== approve_group 模式（同意/拒绝加群请求/邀请）====
    if (mode === 'approve_group') {
      const reason = ''; // kwargs.get('reason', '')
      const flagStr = String(flag || (event as ExtendedOneBotEvent)?.flag || '');
      if (!flag) return { success: false, error: 'flag 不能为空' };

      const subType = String(sub_type || (event as ExtendedOneBotEvent)?.sub_type || '');
      if (!subType) return { success: false, error: "sub_type 不能为空（需为 'add' 或 'invite'）" };
      if (!['add', 'invite'].includes(subType)) {
        return { success: false, error: `sub_type 非法: ${subType}（需为 'add' 或 'invite'）` };
      }

      if (!bot) return { success: false, error: 'bot 不可用' };
      // 同上：approve 此前被硬编码为 true
      const approved = approve !== false;
      await bot.callApi('set_group_add_request', {
        flag: flagStr,
        sub_type: subType,
        approve: approved,
        reason: String(reason || ''),
      });
      const action = approved ? '同意' : '拒绝';
      console.info(`[group_op] ${action}加群${sub_type === 'add' ? '请求' : '邀请'}成功: flag=${flag}`);
      return { success: true, error: '' };
    }

    // ==== notice 模式（发布群公告）====
    if (mode === 'notice') {
      if (!String(content || '').trim()) {
        return { success: false, error: 'content 不能为空' };
      }

      const gid = String(group_id || event?.group_id || '');
      if (!gid) return { success: false, error: 'group_id 不能为空（当前非群聊场景）' };

      if (!bot) return { success: false, error: 'bot 不可用' };
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('_send_group_notice', {
        group_id: parseInt(gid),
        content: String(content),
        image: null,
      });
      console.info(`[group_op] 发布群公告成功: 群 ${gid}`);
      return { success: true, error: '' };
    }

    // ==== upload_file 模式（上传群文件）====
    if (mode === 'upload_file') {
      // 原实现直接 `return { success: true }` —— 流程里显示成功，实际什么都没上传。
      // QQ 官方 API 没有「上传群文件」接口，因此明确报错，别让用户以为传上去了。
      return {
        success: false,
        error: '当前接入（QQ 官方 API）不支持上传群文件，请改用其他方式分享文件',
      };
    }

    // ==== essence 模式（设置精华消息）====
    if (mode === 'essence') {
      const mid = String(message_id || event?.message_id || '');
      if (!mid) return { success: false, error: 'message_id 不能为空' };
      
      if (!bot) return { success: false, error: 'bot 不可用' };
      await bot.callApi('set_essence_msg', { message_id: parseInt(mid) });
      return { success: true, error: '' };
    }

    return {
      success: false,
      error: `未知 mode: ${mode}（支持 ban/kick/mute_all/set_card/set_title/leave/approve_friend/approve_group/notice/upload_file/essence）`
    };

  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    const errorMsg = err.message;
    if (errorMsg.includes('1300') || errorMsg.includes('权限')) {
      return { success: false, error: '机器人权限不足（需要管理员/群主权限）' };
    }
    return { success: false, error: errorMsg };
  }
}

export type { GroupOpOptions, GroupOpResult };