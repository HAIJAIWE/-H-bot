/**
 * 触发器匹配 —— 从 qqbat_nodes/runtime/trigger_matcher.py 移植，现状以本文件为准
 *
 * matchTrigger(triggerNode, event) 返回触发输出端口字典或 null。
 */

import type { RuntimeEvent } from '../services/builtinNodes/builtinNodes';

/** ReDoS 防护常量 */
const MAX_TEXT_LEN = 100_000;
const MAX_PATTERN_LEN = 1_000;

/** 事件扩展类型（运行时事件可能带更多字段） */
export interface TriggerEvent extends RuntimeEvent {
  request_type?: string;
  notice_type?: string;
  sub_type?: string;
  operator_id?: string | number;
  comment?: string;
  flag?: string;
  button_id?: string;
  button_data?: string;
  self_id?: string | number;
  post_type?: string;
  [key: string]: unknown;
}

/** 触发节点结构 */
export interface TriggerNode {
  id: string;
  type?: string;
  data: {
    nodeKind: string;
    label?: string;
    config?: Record<string, unknown>;
    outputs?: Array<{ id: string; kind: string }>;
  };
}

/** 触发匹配结果 */
export type TriggerOutputs = Record<string, unknown>;

/** 获取事件原始消息文本 */
function getRawMessage(event: TriggerEvent | null): string {
  if (!event) return '';
  try {
    if (typeof event.get_message === 'function') return String(event.get_message());
    if (typeof event.message === 'string') return event.message;
    if (Array.isArray(event.message)) {
      return event.message.map((seg) => seg?.data?.text ?? '').join('');
    }
    return String(event.message ?? '');
  } catch {
    return '';
  }
}

/** shlex.split 兼容实现（posix=False 语义：保留引号内容，不处理转义） */
export function splitArgs(text: string): string[] {
  if (!text || !text.trim()) return [];
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const ch of text.trim()) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** 安全的正则匹配（带 ReDoS 防护） */
export function safeRegexSearch(pattern: string, text: string, flags: string = ''): RegExpMatchArray | null {
  if (!pattern || !text) return null;
  if (pattern.length > MAX_PATTERN_LEN) return null;

  const limited = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;

  try {
    let jsFlags = '';
    if (flags.includes('i')) jsFlags += 'i';
    if (flags.includes('m')) jsFlags += 'm';
    if (flags.includes('s')) jsFlags += 's';
    const re = new RegExp(pattern, jsFlags);
    return limited.match(re);
  } catch {
    return null;
  }
}

/** 检查 CQ 码是否 @ 机器人自己 */
function isCqAtSelf(rawMessage: string, event: TriggerEvent): boolean {
  const selfId = String(event.self_id ?? '');
  if (!selfId) return rawMessage.includes('[CQ:at,');
  // 匹配 [CQ:at,qq=<selfId>]
  return rawMessage.includes(`[CQ:at,qq=${selfId}]`) || rawMessage.includes(`[CQ:at,qq=${selfId},`);
}

/**
 * 判断事件是否匹配触发节点。
 * 匹配成功返回触发输出端口字典，失败返回 null。
 */
export function matchTrigger(trigger: TriggerNode, event: TriggerEvent | null): TriggerOutputs | null {
  const kind = trigger?.data?.nodeKind ?? '';
  const config = trigger?.data?.config ?? {};

  // ---- 生命周期触发（定时 / 启动）----
  //
  // 这类触发器**不看消息内容**，靠运行时派发时打在事件上的 `__lifecycle__` 标记选中：
  // 调度器触发时写入 `__lifecycle__ = 'scheduled'`，只有 scheduled 触发器命中；
  // 反过来，普通消息事件不会命中它们，生命周期事件也不会误触发消息流程。
  const lifecycle = (event as { __lifecycle__?: unknown } | null)?.__lifecycle__;
  if (lifecycle !== undefined && lifecycle !== null && lifecycle !== '') {
    // 调度器可以点名"只触发这一个"（同一项目里可能有多个定时流程）
    const target = (event as { __lifecycle_trigger__?: unknown } | null)?.__lifecycle_trigger__;
    if (target !== undefined && target !== null && target !== '' && trigger?.id !== target) return null;
    // 注意：**不要**把 on_startup 映射成 on_ready —— 它们是两个不同的时机
    // （机器人进程启动 vs 连上网关就绪），映射会让两者互相顶替。
    const lifecycleAlias: Record<string, string> = {
      on_schedule: 'scheduled',
    };
    const want = lifecycleAlias[String(lifecycle)] ?? String(lifecycle);
    if (kind !== want) return null;

    // 输出端口必须按**节点目录声明的端口**给全，否则下游连线拿到的是空值
    // （解释器只把这里返回的键写进变量表）。三个生命周期触发器的目录契约：
    //   scheduled    → next / time（触发时间）
    //   on_ready     → next / event / ready_at
    //   on_startup   → next / event / started_at（由调用方打标记，见 onStartup）
    const outputs: TriggerOutputs = {
      event,
      raw_message: '',
      args: [],
      matched: String(config.cron ?? config.interval_seconds ?? kind),
      groups: [],
    };
    if (want === 'scheduled') {
      // 下游拿到的是**数字**时间戳（秒）。给 Date 对象会被序列化成字符串，
      // 下游做数值比较就是 NaN（测试里抓到的）。
      const firedAt = (event as { __fired_at__?: unknown } | null)?.__fired_at__;
      outputs.time =
        typeof firedAt === 'number' ? firedAt : Math.floor(Number(firedAt ?? Date.now()) / 1000) || Math.floor(Date.now() / 1000);
    } else if (want === 'on_ready') {
      outputs.ready_at = Math.floor(Date.now() / 1000);
    } else if (want === 'on_startup') {
      outputs.started_at =
        Number((event as { __fired_at_ms__?: unknown } | null)?.__fired_at_ms__ ?? Date.now()) / 1000;
    }
    return outputs;
  }

  // ---- message_received ----
  if (kind === 'message_received') {
    const match = config.match ?? 'any';
    const messageType = config.message_type ?? 'any';

    // 1. message_type 过滤
    const eventType = String(event?.message_type ?? '');
    if (!(messageType === 'any' || messageType === 'both' || messageType === eventType)) {
      return null;
    }

    const rawMessage = getRawMessage(event);

    // 2. match 模式
    if (match === 'any') {
      return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
    }

    if (match === 'at_me') {
      try {
        const isTome = event?.is_tome;
        if (typeof isTome === 'function') {
          if (isTome()) {
            return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
          }
        } else if (typeof isTome === 'boolean') {
          if (isTome) {
            return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
          }
        } else if (isCqAtSelf(rawMessage, event ?? ({} as TriggerEvent))) {
          return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
        }
      } catch {
        // ignore
      }
      return null;
    }

    if (match === 'command') {
      const command = String(config.command ?? '').trim();
      const prefix = String(config.prefix ?? '/');
      if (!command) return null;
      const rawStripped = rawMessage.trim();
      const fullCmd = `${prefix}${command}`;
      if (
        rawStripped === fullCmd ||
        rawStripped.startsWith(fullCmd + ' ') ||
        rawStripped.startsWith(fullCmd + '\t')
      ) {
        const args = splitArgs(rawStripped.slice(fullCmd.length));
        return { event, raw_message: rawMessage, args, matched: '', groups: [] };
      }
      if (rawStripped === command || rawStripped.startsWith(command + ' ')) {
        const args = splitArgs(rawStripped.slice(command.length));
        return { event, raw_message: rawMessage, args, matched: '', groups: [] };
      }
      return null;
    }

    if (match === 'keyword') {
      let keywords: unknown = config.keywords ?? [];
      if (typeof keywords === 'string') {
        try {
          keywords = JSON.parse(keywords);
        } catch {
          keywords = keywords ? [keywords] : [];
        }
      }
      const keywordList: unknown[] = Array.isArray(keywords) ? keywords : [];
      for (const kw of keywordList) {
        if (typeof kw === 'string' && kw && rawMessage.includes(kw)) {
          return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
        }
      }
      return null;
    }

    if (match === 'regex') {
      const patternStr = String(config.pattern ?? '');
      const flagsStr = String(config.flags ?? '');
      if (!patternStr) return null;
      const m = safeRegexSearch(patternStr, rawMessage, flagsStr);
      if (m) {
        return {
          event,
          raw_message: rawMessage,
          args: [],
          matched: m[0] ?? '',
          groups: m.slice(1).map((g) => g ?? ''),
        };
      }
      return null;
    }

    return null;
  }

  // ---- request_received ----
  if (kind === 'request_received') {
    const requestType = config.request_type ?? 'friend';
    const eventType = String(event?.request_type ?? event?.sub_type ?? '');
    if (requestType === 'any' || requestType === eventType) {
      return {
        event,
        user_id: String(event?.user_id ?? ''),
        group_id: String(event?.group_id ?? ''),
        request_type: event?.request_type ?? '',
        comment: event?.comment ?? '',
        flag: event?.flag ?? '',
      };
    }
    return null;
  }

  // ---- notice_received ----
  if (kind === 'notice_received') {
    const noticeType = config.notice_type ?? 'any';
    const eventType = String(event?.notice_type ?? event?.sub_type ?? '');
    if (noticeType === 'any' || noticeType === eventType) {
      return {
        event,
        user_id: String(event?.user_id ?? ''),
        group_id: String(event?.group_id ?? ''),
        operator_id: String(event?.operator_id ?? ''),
        notice_type: event?.notice_type ?? '',
        sub_type: event?.sub_type ?? '',
      };
    }
    return null;
  }

  // ---- button_clicked ----
  if (kind === 'button_clicked') {
    const targetData = config.button_data ?? '';
    const btnId = String(event?.button_id ?? '');
    const btnData = String(event?.button_data ?? '');
    if (btnId || btnData) {
      if (!targetData || btnData === targetData || btnId === targetData) {
        return {
          event,
          button_id: btnId,
          button_data: btnData,
          user_id: String(event?.user_id ?? ''),
          group_id: String(event?.group_id ?? ''),
        };
      }
      return null;
    }
    // 事件未携带 button_id/button_data 时的降级路径：用消息文本精确匹配 button_data
    const raw = getRawMessage(event);
    if (raw && targetData && raw.trim() === String(targetData).trim()) {
      return {
        event,
        button_id: '',
        button_data: String(targetData),
        user_id: String(event?.user_id ?? ''),
        group_id: String(event?.group_id ?? ''),
      };
    }
    return null;
  }

  // scheduled / on_ready / on_startup **已在函数开头**按 `__lifecycle__` 标记处理；
  // 走到这里说明事件没有生命周期标记，自然不该命中它们（这正是想要的隔离）。
  return null;
}
