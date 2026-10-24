// src/main/services/official/gatewayClose.ts
//
// 官方网关「关闭码 → 下一步动作」判定（纯函数，便于表驱动单测）。
// 语义对照腾讯 bot-node-sdk / botpy：4004 清 token 重取、4013/4014 丢 intents 位、
// 4001/4002/4007 等协议错必须重新 identify（不能 resume）、4008/4009 才 resume、
// 4914/4915 重试无意义。socket 的收尾与重连调度在 ws.ts；
// 为什么这样分流见 docs/platforms/QQ机器人官方能力清单.md §7.3。
/** 关闭后该做什么 */
export type CloseAction =
  /** 保留 session，发 op 6 恢复（网络抖动 / 4008 过速 / 4009 过期 / 4900 内部错误） */
  | 'resume'
  /** session 已不可信，清掉 session_id/seq，重新 op 2 鉴权 */
  | 'identify'
  /** 4004：token 失效，清 token 后重新取一次再鉴权 */
  | 'refresh'
  /** 4013/4014：intents 被拒，丢一个可选位再试 */
  | 'intents'
  /** 4914/4915：重试无意义，给出确定原因并停下 */
  | 'fatal'

/** 官方文档的关闭码含义（原样保留英文名，方便与官方文档/SDK 对照检索） */
export const CLOSE_REASONS: Record<number, string> = {
  4001: '无效的 opcode（INVALID_OPCODE）',
  4002: '无效的 payload（INVALID_PAYLOAD）',
  4004: '鉴权失败（TOKEN_INVALID）—— AppID/AppSecret 不正确或 token 已失效',
  4007: 'seq 错误（INVALID_SEQ）',
  4008: 'payload 发送过快（RATE_LIMITED）',
  4009: '连接已过期（SESSION_TIMEOUT）',
  4010: '无效的 shard（INVALID_SHARD）',
  4011: '需要分片的频道过多（SHARDING_REQUIRED）',
  4012: '无效的 version（INVALID_VERSION）',
  4013: '无效的 intents（INVALID_INTENTS）',
  4014: 'intents 无权限（DISALLOWED_INTENTS）',
  4900: '网关内部错误（INTERNAL_ERROR）',
  4914: '机器人已下架（只允许沙箱环境连接，OFFLINE）',
  4915: '机器人已封禁（BANNED）',
}

/** 协议参数错误：session 不可信，必须重新 identify */
const FRESH_IDENTIFY_CODES = new Set([4001, 4002, 4007, 4010, 4011, 4012, 9001, 9005])

/** 明确可以 resume 的关闭码 */
const RESUME_CODES = new Set([4008, 4009, 4900])

/**
 * 关闭码 → 下一步动作。
 *
 * @param code 浏览器/网关给的关闭码（网络中断时可能是 1006，甚至没有）
 * @param hasSession 当前是否还持有可恢复的 session_id + seq
 */
export function closeActionOf(code?: number | null, hasSession = false): CloseAction {
  if (code == null || !Number.isFinite(code)) return hasSession ? 'resume' : 'identify'
  if (code === 4004) return 'refresh'
  if (code === 4013 || code === 4014) return 'intents'
  if (code === 4914 || code === 4915) return 'fatal'
  if (FRESH_IDENTIFY_CODES.has(code)) return 'identify'
  if (RESUME_CODES.has(code)) return hasSession ? 'resume' : 'identify'
  // 1000/1001/1006/1011 等传输层关闭：有 session 就尽量恢复
  return hasSession ? 'resume' : 'identify'
}

/** 关闭码的中文说明（未知码带上原始数字，便于贴日志排查） */
export function closeReasonOf(code?: number | null): string {
  if (code == null || !Number.isFinite(code)) return '连接中断（没有关闭码，通常是网络问题）'
  return CLOSE_REASONS[code] ?? `未知关闭码 ${code}`
}

/**
 * 致命关闭码给用户的下一步动作。
 *
 * 只说「去改什么」，不重复关闭码含义 —— 含义由 closeReasonOf 拼在前半句。
 */
export function fatalAdviceOf(code: number, sandbox: boolean): string {
  if (code === 4914) {
    return sandbox
      ? '机器人已下架：官方现在不接受这个环境的连接，请到 QQ 开放平台确认机器人状态后再启动。'
      : '机器人已下架：下架状态只允许沙箱环境连接。可以先把适配器切到沙箱（QQ_SANDBOX=true）验证功能，正式上线需在 QQ 开放平台重新上架。'
  }
  if (code === 4915) {
    return '机器人已封禁：重连不会成功，请到 QQ 开放平台查看封禁原因并申请解封。'
  }
  return '网关拒绝连接，重试不会恢复，请检查机器人配置。'
}
