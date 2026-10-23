/**
 * 内置节点 TypeScript 纯实现
 *
 * 历史：由已移除的 Python handler（qqbat_nodes/builtin/*.py）移植而来，现状以本文件为准。
 * 纯 TypeScript 实现，零 Python 运行时依赖。
 *
 * 所有 handler 统一为 `(bot, event, ...参数)` 签名，由 FlowInterpreter 按节点 kind 调用；
 * 返回值结构：{ success: boolean, error: string, ... }
 */

// ============================================================
// 模块导入
// ============================================================

import { persistentStore as persistentStoreModule, makeKey, PersistResult, BatchUpdateOp } from './persistentStore';
import { fileOperate, FileResult } from './fileOperate';
import { databaseWrite, DBResult } from './databaseWrite';
import { groupOp, GroupOpResult } from './groupOp';
import { buildStreamChunkPlan } from '@shared/message/stream';
import { logger } from '../../services/logger';

// ============================================================
// 通用工具与类型定义
// ============================================================

/** 通用返回结构 */
export interface HandlerResult {
  success: boolean;
  error: string;
  [key: string]: unknown;
}

/** OneBot 事件接口 */
export interface OneBotEvent {
  message_type?: 'private' | 'group';
  message: OneBotMessage;
  message_id?: number;
  user_id?: number;
  group_id?: number;
  is_tome?: boolean | (() => boolean);
  get_message?: () => string;
  get_message_id?: () => number;
  type?: string;
  data?: unknown;
}

export interface OneBotMessage {
  type: string;
  data: Record<string, unknown>;
}

/** 正则相关常量（message_received 触发器的 ReDoS 防护） */
const MAX_TEXT_LEN = 100_000;
const MAX_PATTERN_LEN = 1_000;
const REGEX_TIMEOUT = 2_000; // ms

/** 变量名合法字符 */
const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Bot 接口 */
export interface BotInterface {
  callApi(api: string, params: Record<string, unknown>): Promise<unknown>;
}

// ============================================================
// 通用工具函数
// ============================================================

/** 简易 shlex.split 实现（保留引号参数） */
function splitArgs(text: string): string[] {
  if (!text?.trim()) return [];
  try {
    return shlexSplit(text);
  } catch {
    return text.trim().split(/\s+/);
  }
}

/** 简易 shlex.split 实现（保留引号参数） */
function shlexSplit(text: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === '\\' && inQuotes && i + 1 < text.length) {
      current += text[++i];
    } else if (/\s/.test(char) && !inQuotes) {
      if (current) {
        result.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) result.push(current);
  return result;
}

/** 检查消息类型是否符合过滤要求 */
function checkMessageType(event: OneBotEvent, messageType: string): boolean {
  if (messageType === 'any' || messageType === 'both' || !messageType) return true;
  try {
    const eventType = event.message_type || '';
    return messageType === eventType;
  } catch {
    return false;
  }
}

/** 判断是否@机器人 */
function matchAtMe(event: OneBotEvent): boolean {
  try {
    if (event.is_tome && typeof event.is_tome === 'function') {
      return Boolean(event.is_tome());
    }
    // 兜底检查 CQ 码
    const msgStr = String(event.get_message?.() || '');
    return msgStr.includes('[CQ:at,');
  } catch {
    return false;
  }
}

/** 匹配指令前缀+指令名 */
function matchCommand(rawMessage: string, command: string, prefix: string): string[] | null {
  if (!command) return null;
  const fullCmd = prefix + command;
  const stripped = rawMessage.trim();
  if (stripped === fullCmd || 
      stripped.startsWith(fullCmd + ' ') || 
      stripped.startsWith(fullCmd + '\t')) {
    return splitArgs(stripped.slice(fullCmd.length));
  }
  // 兼容无前缀模式
  if (stripped === command || stripped.startsWith(command + ' ')) {
    return splitArgs(stripped.slice(command.length));
  }
  return null;
}

/** 检查关键词 */
function matchKeyword(rawMessage: string, keywords: unknown): boolean {
  if (!keywords) return false;
  let kwList: string[] = [];
  if (typeof keywords === 'string') {
    try { kwList = JSON.parse(keywords); } catch { kwList = [keywords]; }
  } else if (Array.isArray(keywords)) {
    kwList = keywords;
  }
  return kwList.some(kw => typeof kw === 'string' && kw && rawMessage.includes(kw));
}

/** 正则匹配（含 ReDoS 防护） */
async function matchRegex(rawMessage: string, pattern: string, flags: string): Promise<{ matched: string; groups: string[] } | null> {
  if (!pattern) return null;
  if (pattern.length > MAX_PATTERN_LEN) { logger.warn(`regex pattern 超限: ${pattern.length}`); return null; }
  if (rawMessage.length > MAX_TEXT_LEN) { logger.warn(`regex 文本超限: ${rawMessage.length}`); return null; }

  let flagStr = '';
  if (flags.includes('i')) flagStr += 'i';
  if (flags.includes('m')) flagStr += 'm';
  if (flags.includes('s')) flagStr += 's';
  
  let compiled: RegExp;
  try { compiled = new RegExp(pattern, flagStr); } catch { logger.warn('regex 编译失败'); return null; }

  // 超时控制（使用 Promise.race 模拟 anyio.fail_after）
  return await Promise.race([
    (async () => {
      const m = compiled.exec(rawMessage);
      if (m) {
        return {
          matched: m[0],
          groups: m.slice(1).filter(g => g !== undefined)
        };
      }
      return null;
    })(),
    new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error('regex timeout')), REGEX_TIMEOUT)
    )
  ]).catch(() => null);
}

// ============================================================
// 1. message_received - 消息触发器（最复杂的节点）
// ============================================================

/** 消息触发器 handler — 统一的消息触发节点
 * 合并了 message_received / on_at_me / on_command / on_regex 四个节点的逻辑
 * match 模式：any/at_me/command/keyword/regex
 * 返回：匹配成功返回 { event, raw_message, args, matched, groups }，失败返回 null
 */
export async function messageReceived(
  bot: BotInterface,
  event: OneBotEvent,
  match: 'any' | 'at_me' | 'command' | 'keyword' | 'regex' = 'any',
  message_type: 'any' | 'group' | 'private' | 'both' = 'any',
  command: string = '',
  prefix: string = '/',
  keywords: unknown = null,
  pattern: string = '',
  flags: string = ''
): Promise<{ event: OneBotEvent, raw_message: string, args: string[], matched: string, groups: string[] } | null> {
  const matchMode = String(match || 'any').toLowerCase();
  const msgType = String(message_type || 'any').toLowerCase();

  // 1. 消息类型过滤（与 match 正交，可叠加）
  if (!checkMessageType(event, msgType)) {
    return null;
  }

  // 2. at_me 模式：优先 is_tome()，不需要提前取 raw_message
  if (matchMode === 'at_me') {
    if (!matchAtMe(event)) return null;
    try {
      const rawMessage = String(event?.get_message?.() || '');
      return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
    } catch {
      return { event, raw_message: '', args: [], matched: '', groups: [] };
    }
  }

  // 3. 其他模式需要 raw_message
  let rawMessage: string;
  try {
    rawMessage = String(event?.get_message?.() || '');
  } catch {
    return null;
  }

  // 4. any 模式
  if (matchMode === 'any') {
    return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
  }

  // 5. command 模式
  if (matchMode === 'command') {
    const cmd = String(command || '').trim();
    const pfx = String(prefix ?? '/');
    const args = matchCommand(rawMessage.trim(), cmd, pfx);
    if (args !== null) {
      return { event, raw_message: rawMessage, args, matched: '', groups: [] };
    }
    return null;
  }

  // 6. keyword 模式
  if (matchMode === 'keyword') {
    if (matchKeyword(rawMessage, keywords)) {
      return { event, raw_message: rawMessage, args: [], matched: '', groups: [] };
    }
    return null;
  }

  // 7. regex 模式（含 ReDoS 防护）
  if (matchMode === 'regex') {
    const regexResult = await matchRegex(rawMessage, pattern, flags);
    if (regexResult) {
      return { event, raw_message: rawMessage, args: [], matched: regexResult.matched, groups: regexResult.groups };
    }
    return null;
  }

  // 8. 未知模式拒绝
  logger.warn(`[message_received] 未知 match 模式: ${matchMode}，拒绝匹配`);
  return null;
}

// ============================================================
// 2. message_send - 发送消息（支持 4 模式 × 双目标）
// ============================================================

function buildTargetParams(event: OneBotEvent): Record<string, unknown> {
  if (event?.group_id) {
    return { message_type: 'group', group_id: String(event.group_id) };
  }
  if (event?.user_id) {
    return { message_type: 'private', user_id: String(event.user_id) };
  }
  return {};
}

function extractMsgId(event: OneBotEvent): string {
  try {
    const msgId = event.get_message_id?.();
    return msgId ? String(msgId) : '';
  } catch {
    return '';
  }
}

function resolveTarget(event: OneBotEvent, targetType: string, targetId: string): [Record<string, unknown>, string] {
  if (targetType === 'user' && targetId) {
    return [{ message_type: 'private', user_id: String(targetId) }, ''];
  }
  if (targetType === 'group' && targetId) {
    return [{ message_type: 'group', group_id: String(targetId) }, ''];
  }
  return [buildTargetParams(event), extractMsgId(event)];
}

/** 从 OneBot API 返回里取 message_id（返回体形状由适配器决定，故按 unknown 收窄） */
function responseMessageId(resp: unknown): string {
  if (resp && typeof resp === 'object' && 'message_id' in resp) {
    const mid = (resp as { message_id?: unknown }).message_id;
    return mid === undefined || mid === null ? '' : String(mid);
  }
  return '';
}

interface KeyboardConfig {
  rows: Array<{
    buttons: Array<{
      text: string;
      action: {
        type: string;
        data: string;
      };
    }>;
  }>;
}

function keyboardToSegments(
  markdown: string,
  keyboard: KeyboardConfig | null,
): Array<{ type: string; data: Record<string, unknown> }> {
  const segments: Array<{ type: string; data: Record<string, unknown> }> = [
    { type: 'markdown', data: { content: String(markdown) } },
  ];
  if (keyboard && keyboard.rows) {
    // content 必须是**对象**：翻译器与官方 API 都按 `{ rows: [...] }` 使用它。
    // 这里曾写成 JSON.stringify(keyboard)（字符串），下游 `'id' in keyboard` 会抛
    // TypeError，导致 send_msg + keyboard 段的降级路径整条失效（静默退回纯文本）。
    segments.push({ type: 'keyboard', data: { content: keyboard } });
  }
  return segments;
}

/**
 * 按钮是否"真的配了"。
 *
 * 「Markdown 文本」模式下按钮是可选的：空对象 / `rows: []` 都视为没有按钮，
 * 此时只发 markdown 内容（官方 `msg_type=2` 不带 keyboard），不能把空对象
 * 传给官方 API —— 那会渲染不出按钮、还可能让整条消息发送失败。
 */
function hasKeyboardRows(keyboard: KeyboardConfig | null | undefined): keyboard is KeyboardConfig {
  return (
    !!keyboard && typeof keyboard === 'object' && Array.isArray(keyboard.rows) && keyboard.rows.length > 0
  );
}

async function sendKeyboard(
  bot: BotInterface,
  event: OneBotEvent,
  markdown: unknown,
  keyboard: KeyboardConfig | null,
  targetType: string = '',
  targetId: string = '',
  /** 要引用的消息 id / REFIDX（空 = 不引用） */
  replyTo: string = '',
  /**
   * 互动召回（官方 `is_wakeup`，**仅单聊**）。
   * 与 `msg_id` / `event_id` 互斥 —— 由官方的 `buildMessageBody` 保证二选一。
   */
  isWakeup: boolean = false
): Promise<{ success: boolean; message_id: string; error: string }> {
  if (!markdown) return { success: false, message_id: '', error: 'markdown 不能为空' };
  // 按钮可选：有按钮=按钮消息，没按钮=纯 Markdown 文本（「按钮UI」模式非空由调用方保证）
  const kb = hasKeyboardRows(keyboard) ? keyboard : null;
  const modeLabel = kb ? '按钮UI' : 'Markdown文本';

  const [target, msgId] = resolveTarget(event, targetType, targetId);
  if (!target) return { success: false, message_id: '', error: '无法从事件中确定回复目标' };

  const mdStr = String(markdown);
  const errors: string[] = [];

  // 方式 1: send_keyboard_msg（官方 API 翻译器）
  try {
    const params: Record<string, unknown> = { markdown: mdStr, ...target };
    if (kb) params.keyboard = kb;
    if (msgId) params.msg_id = msgId;
    if (replyTo) params.reply_to = replyTo;
    if (isWakeup) params.is_wakeup = true;
    console.info(`[message_send] ${modeLabel}模式-方式1: send_keyboard_msg, message_type=${target.message_type}`);
    const resp = await bot.callApi('send_keyboard_msg', params);
    const mid = responseMessageId(resp);
    if (mid) {
      console.info(`[message_send] ${modeLabel}模式-方式1成功: message_id=${mid}`);
      return { success: true, message_id: mid, error: '' };
    }
    errors.push('send_keyboard_msg 返回空 message_id');
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn(`[message_send] ${modeLabel}模式-方式1不可用: ${err.name}: ${err.message}`);
    errors.push(`send_keyboard_msg: ${err.message}`);
  }

  // 方式 2: send_msg + markdown/keyboard 消息段（翻译器识别后路由到官方 keyboard API）
  try {
    const segments = keyboardToSegments(mdStr, kb);
    const params2: Record<string, unknown> = { message: segments, ...target };
    if (msgId) params2.msg_id = msgId;
    if (replyTo) params2.reply_to = replyTo;
    if (isWakeup) params2.is_wakeup = true;
    console.info(`[message_send] ${modeLabel}模式-方式2: send_msg(markdown 段), message_type=${target.message_type}`);
    const resp2 = await bot.callApi('send_msg', params2);
    const mid2 = responseMessageId(resp2);
    if (mid2) {
      console.info(`[message_send] ${modeLabel}模式-方式2成功: message_id=${mid2}`);
      return { success: true, message_id: mid2, error: '' };
    }
    errors.push('send_msg(markdown) 返回空 message_id');
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn(`[message_send] ${modeLabel}模式-方式2不可用: ${err.name}: ${err.message}`);
    errors.push(`send_msg(markdown): ${err.message}`);
  }

  // 所有 Markdown 发送方式均失败，尝试纯文本降级
  const errSummary = errors.join('；');
  console.error(`[message_send] ${modeLabel}模式-所有发送方式均失败: ${errSummary}`);
  try {
    const wakeParam = isWakeup ? { is_wakeup: true } : {};
    if (target.message_type === 'group') {
      await bot.callApi('send_group_msg', { group_id: target.group_id, message: String(markdown), ...wakeParam });
    } else if (target.message_type === 'private') {
      await bot.callApi('send_private_msg', { user_id: target.user_id, message: String(markdown), ...wakeParam });
    } else {
      await bot.callApi('send_msg', { message: String(markdown), ...target, ...wakeParam });
    }
    console.warn(`[message_send] ${modeLabel}发送失败，已降级为纯文本发送`);
    return { success: true, message_id: '', error: '' };
  } catch (fallback_e: unknown) {
    console.error(`[message_send] ${modeLabel}降级发送也失败: ${fallback_e}`);
  }
  return {
    success: false,
    message_id: '',
    error: kb
      ? `当前适配器不支持按钮消息（已尝试 send_keyboard_msg 和 send_msg+markdown/keyboard 段）: ${errSummary}`
      : `当前适配器不支持 Markdown 消息（已尝试 send_keyboard_msg 和 send_msg+markdown 段）: ${errSummary}`
  };
}

function buildForwardNodes(messages: unknown, userId: string, event: unknown): [unknown[], string] {
  const evt = (event || {}) as Record<string, unknown>;
  let uid = String(userId || evt.user_id || '');
  let msgList: unknown[] = [];
  
  if (typeof messages === 'string') {
    try { msgList = JSON.parse(messages); } catch (e) { return [[], `messages JSON 解析失败: ${e}`]; }
  } else if (Array.isArray(messages)) {
    msgList = messages;
  } else {
    return [[], 'messages 格式错误，需要 JSON 字符串或 list'];
  }

  if (!Array.isArray(msgList) || !msgList.length) return [[], 'messages 为空或格式错误'];
  if (msgList.length > 200) return [[], '合并转发消息数超过上限 200'];

  const nodes = msgList.map(msg => {
    const m = msg as Record<string, unknown>;
    const msgContent = m.content || '';
    const senderId = String(m.user_id || uid);
    const senderName = m.name || '';
    return {
      type: 'node',
      data: { name: senderName, uin: senderId, content: msgContent }
    };
  });
  return [nodes, ''];
}

async function sendSegment(bot: BotInterface, event: OneBotEvent, segments: unknown, targetType: string, targetId: string, replyTo: string = ''): Promise<{ success: boolean; message_id: string; error: string }> {
  if (!segments) return { success: false, message_id: '', error: 'segments 不能为空' };
  // 简化实现：实际需要根据 bot 类型构建消息
  try {
    // 用调用方给的目标；以前这里硬编码 `resolveTarget({...event, message_type:'group'}, 'group', '123')`，
    // 于是消息段模式**永远发到群 123**（既发不出去，也完全无视 targetType/targetId）。
    const [target] = resolveTarget(event, targetType, targetId);
    const params: Record<string, unknown> = { message: segments, ...target };
    if (replyTo) params.reply_to = replyTo;
    const resp = await bot.callApi('send_msg', params);
    const mid = responseMessageId(resp);
    return { success: true, message_id: mid, error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { success: false, message_id: '', error: err.message };
  }
}

/**
 * 富媒体模式：图片 / 视频 / 语音 / 文件（官方 `msg_type=7`）。
 *
 * QQ 官方是**服务端去拉 url** 再转存，所以只能传可公开访问的 http(s) 直链；
 * 本地路径（`C:\…`、`/tmp/…`）发不出去，这里提前拦下并给出可读错误。
 */
async function sendMedia(
  bot: BotInterface,
  event: OneBotEvent,
  url: unknown,
  mediaType: unknown,
  fileName: unknown,
  targetType: string,
  targetId: string,
  /** 要引用的消息 id / REFIDX（空 = 不引用） */
  replyTo: string = '',
  /** 互动召回（官方 is_wakeup，仅单聊；与 msg_id 互斥，由 official 层保证） */
  isWakeup: boolean = false
): Promise<{ success: boolean; message_id: string; error: string }> {
  const mediaUrl = String(url ?? '').trim();
  if (!mediaUrl) return { success: false, message_id: '', error: 'media_url 不能为空（富媒体模式必填）' };
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return {
      success: false,
      message_id: '',
      error: `media_url 必须是可公开拉取的 http(s) 直链（收到：${mediaUrl}）：QQ 官方由服务端去拉这个地址，本地路径发不出去`,
    };
  }
  try {
    const [target, msgId] = resolveTarget(event, targetType, targetId);
    const params: Record<string, unknown> = {
      url: mediaUrl,
      media_type: String(mediaType || 'image'),
      ...target,
    };
    const name = String(fileName ?? '').trim();
    if (name) params.file_name = name;
    if (msgId) params.msg_id = msgId;
    if (replyTo) params.reply_to = replyTo;
    if (isWakeup) params.is_wakeup = true;
    const resp = await bot.callApi('send_media', params);
    return { success: true, message_id: responseMessageId(resp), error: '' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, message_id: '', error: err.message };
  }
}

/**
 * 流式消息（官方 `POST /v2/users/{openid}/stream_messages`，**仅单聊**）。
 *
 * 节点内自动切片：把完整文本按「每片字数」切成若干片，逐片下发；
 * 首片**不带** `stream_msg_id`（由服务端生成并在响应里返回），后续分片带上它；
 * 末片 `input_state=10` 标记生成结束 —— 少了它对方界面会永远停在「生成中」。
 *
 * 任一片失败时 best-effort 补一片结束态：失败已经把消息留在「生成中」，
 * 不补收尾比丢掉一片内容更糟（用户只能看着一个转圈）。
 */
async function sendStream(
  bot: BotInterface,
  event: OneBotEvent,
  text: unknown,
  contentType: unknown,
  chunkSize: unknown,
  intervalMs: unknown,
  targetType: string,
  targetId: string,
): Promise<{ success: boolean; message_id: string; error: string }> {
  const content = String(text ?? '');
  if (!content.trim()) {
    return { success: false, message_id: '', error: 'text 不能为空（流式消息模式必填）' };
  }

  // 官方只有单聊有流式接口：群聊必须在这里拦下，不能发到一个不存在的端点上
  if (targetType === 'group') {
    return {
      success: false,
      message_id: '',
      error: '流式消息仅支持单聊（QQ 官方只有 /v2/users/{openid}/stream_messages）',
    };
  }
  const [target] = resolveTarget(event, targetType, targetId);
  if (target.message_type !== 'private') {
    return {
      success: false,
      message_id: '',
      error:
        '流式消息仅支持单聊：当前会话是群聊。请把「推送目标类型」设为「私聊推送」并填写 QQ 号',
    };
  }

  const plan = buildStreamChunkPlan(content, { chunkSize: Number(chunkSize) });
  if (plan.length === 0) {
    return { success: false, message_id: '', error: 'text 不能为空（流式消息模式必填）' };
  }

  const type = String(contentType || 'text').toLowerCase() === 'markdown' ? 'markdown' : 'text';
  const rawInterval = Number(intervalMs);
  const interval = Number.isFinite(rawInterval) && rawInterval >= 0 ? Math.floor(rawInterval) : 300;

  // 首片由服务端生成 stream_msg_id，之后每片都要带上它，否则会被当成新的流式消息
  let streamMsgId = '';
  let sent = 0;
  const sendChunk = async (index: number, inputState: 1 | 10, raw: string): Promise<void> => {
    const params: Record<string, unknown> = {
      user_id: target.user_id,
      content_raw: raw,
      content_type: type,
      input_state: inputState,
      index,
    };
    if (streamMsgId) params.stream_msg_id = streamMsgId;
    const resp = await bot.callApi('send_stream_msg', params);
    const id = responseMessageId(resp);
    if (id) streamMsgId = id;
    sent += 1;
  };

  for (const chunk of plan) {
    if (sent > 0 && interval > 0) await new Promise((r) => setTimeout(r, interval));
    try {
      await sendChunk(chunk.index, chunk.inputState, chunk.contentRaw);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (sent > 0) {
        // 已经开出流了：补一片结束态，别让对方界面停在「生成中」
        try {
          await sendChunk(chunk.index + 1, 10, '');
        } catch {
          /* 补收尾也失败就只能如实报错，不再递归 */
        }
      }
      return {
        success: false,
        message_id: streamMsgId,
        error: `流式消息第 ${chunk.index + 1}/${plan.length} 片发送失败：${err.message}`,
      };
    }
  }

  return { success: true, message_id: streamMsgId, error: '' };
}

async function sendForward(bot: BotInterface, event: OneBotEvent, messages: unknown, userId: string, targetType: string, targetId: string): Promise<{ success: boolean; message_id: string; error: string }> {
  try {
    const [nodes, err] = buildForwardNodes(messages, userId, event);
    if (err) return { success: false, message_id: '', error: err };
    
    let groupId = '';
    if (targetType === 'group' && targetId) groupId = targetId;
    
    if (!groupId) return { success: false, message_id: '', error: '合并转发需要群聊目标' };
    
    const resp = await bot.callApi('send_group_forward_msg', { group_id: groupId, messages: nodes });
    const mid = responseMessageId(resp);
    return { success: true, message_id: mid, error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { success: false, message_id: '', error: err.message };
  }
}

/** 发送一条消息，覆盖纯文本/Markdown文本/按钮UI/富媒体/消息段/合并转发 × 回复/推送 全部场景。 */
export async function messageSend(
  bot: BotInterface,
  event: OneBotEvent,
  text: string = '',
  mode: string = 'text',
  markdown: string = '',
  keyboard: KeyboardConfig | null = null,
  segments: (Record<string, unknown> | Record<string, unknown>[]) | null = null,
  messages: string | Record<string, unknown>[] | null = null,
  userId: string | number = '',
  targetType: string = '',
  targetId: string = '',
  /** 富媒体模式的媒体直链（必须是可公开拉取的 http(s) 地址） */
  mediaUrl: string = '',
  /** 富媒体模式的类型：image / video / record / file */
  mediaType: string = 'image',
  /** 以「文件」发送时显示的文件名（可选） */
  fileName: string = '',
  /** 流式消息的内容格式：text / markdown（官方流式接口的 content_type） */
  streamContentType: string = 'text',
  /** 流式消息每片长度（码点数，默认 50） */
  streamChunkSize: number | string = 50,
  /** 流式消息相邻分片的等待时间（毫秒，默认 300） */
  streamIntervalMs: number | string = 300,
  /**
   * 引用回复：要引用的消息 id（或官方 REFIDX_xxx）。
   * 传当前会话里的 `message_id` 或「取上下文 → 引用标识」的返回值都可以 ——
   * 翻译器负责把它换算成官方要求的 REFIDX，换算不到会明确报错（不静默丢）。
   */
  replyTo: string = '',
  /**
   * 互动召回（官方 `is_wakeup`，**仅单聊主动推送**）。
   * 官方按 30 天 4 个周期下发配额，超出由服务端拒 —— 这里不本地拦截，错误原样透出。
   * 与 `event_id` / `msg_id` 互斥（由 official 层的 `buildMessageBody` 保证二选一）。
   */
  isWakeup: boolean = false,
  /** 「回复即模板」的占位符值：端口 var1~var4 连进来的上游数据（`{var1}` → 该值） */
  vars: Record<string, unknown> = {}
): Promise<{ success: boolean; message_id: string; error: string }> {
  const modeStr = String(mode || 'text');
  const targetTypeStr = String(targetType || '').toLowerCase();
  const targetIdStr = String(targetId || '').trim();
  const replyToStr = String(replyTo ?? '').trim();
  const isWakeupFlag = isWakeup === true;
  const isPush = ['user', 'group'].includes(targetTypeStr) && targetIdStr;

  /**
   * 渲染 `{var1}~{var4}` 占位符。
   *
   * 复用「文本模板」节点的同一套规则（对象→JSON、数组→逗号连接、缺失的键原样保留），
   * 所以文案里普通的 `{}` 不会被吃掉；没连任何变量时整段原样返回。
   */
  const renderTemplate = (tpl: string): string =>
    Object.keys(vars).length > 0 ? formatText(tpl, vars).result : tpl;

  // 按钮UI模式
  if (modeStr === 'keyboard') {
    if (!keyboard) return { success: false, message_id: '', error: 'keyboard 不能为空' };
    return await sendKeyboard(
      bot,
      event,
      renderTemplate(String(markdown ?? '')),
      keyboard,
      targetTypeStr,
      targetIdStr,
      replyToStr,
      isWakeupFlag,
    );
  }

  // Markdown 文本模式：按钮可选 —— 配了按钮就发按钮消息，没配就只发 Markdown 排版文本
  if (modeStr === 'markdown') {
    return await sendKeyboard(
      bot,
      event,
      renderTemplate(String(markdown ?? '')),
      keyboard,
      targetTypeStr,
      targetIdStr,
      replyToStr,
      isWakeupFlag,
    );
  }

  // 富媒体模式
  if (modeStr === 'media') {
    return await sendMedia(
      bot,
      event,
      mediaUrl,
      mediaType,
      fileName,
      targetTypeStr,
      targetIdStr,
      replyToStr,
      isWakeupFlag,
    );
  }

  // 消息段模式
  if (modeStr === 'segment') {
    return await sendSegment(bot, event, segments, targetTypeStr, targetIdStr, replyToStr);
  }

  // 流式消息模式（仅单聊）：正文复用 text 端口，节点内按码点切片逐片下发
  if (modeStr === 'stream') {
    return await sendStream(
      bot,
      event,
      renderTemplate(String(text ?? '')),
      streamContentType,
      streamChunkSize,
      streamIntervalMs,
      targetTypeStr,
      targetIdStr,
    );
  }

  // 合并转发模式（官方发送侧不支持引用回复，忽略 reply_to）
  if (modeStr === 'forward') {
    return await sendForward(bot, event, messages, String(userId || ''), targetTypeStr, targetIdStr);
  }

  // 纯文本模式（默认）
  if (!text) return { success: false, message_id: '', error: 'text 不能为空' };

  try {
    const replyParam = replyToStr ? { reply_to: replyToStr } : {};
    // 互动召回只在单聊有意义（群聊接口没有该字段）—— 与 msg_id/event_id 的互斥由 official 层保证
    const wakeParam = isWakeupFlag && targetTypeStr !== 'group' ? { is_wakeup: true } : {};
    if (isPush) {
      // 简化实现
      const msg = renderTemplate(String(text));
      if (targetTypeStr === 'group') {
        const resp = await bot.callApi('send_group_msg', { group_id: targetId, message: msg, ...replyParam });
        return { success: true, message_id: responseMessageId(resp), error: '' };
      } else {
        const resp = await bot.callApi('send_private_msg', { user_id: targetId, message: msg, ...replyParam, ...wakeParam });
        return { success: true, message_id: responseMessageId(resp), error: '' };
      }
    }
    // 回复当前会话：必须**带上来源事件的目标**（user_id / group_id）。
    // OneBot 的 send_msg 只给 message 时，适配器无法反查 openid → 官方 API 直接
    // 400「请求的资源不存在(用户/群已注销)」（真机实测：准备发送 UID=0, openid=0）。
    await bot.callApi('send_msg', {
      message: renderTemplate(String(text)),
      ...buildTargetParams(event),
      ...replyParam,
      ...wakeParam,
    });
    return { success: true, message_id: '', error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { success: false, message_id: '', error: err.message };
  }
}

// ============================================================
// 3. message_recall - 撤回消息
// ============================================================

export async function messageRecall(bot: BotInterface, event: OneBotEvent, messageId: number = 0): Promise<{ success: boolean; error: string }> {
  const mid = messageId || event?.message_id || 0;
  if (!mid) return { success: false, error: 'message_id 不能为空' };
  try {
    await bot.callApi('delete_msg', { message_id: mid });
    return { success: true, error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
    if (err.message.includes('1300') || err.message.includes('权限')) {
      return { success: false, error: '机器人权限不足（需要管理员/群主权限）' };
    }
    return { success: false, error: err.message };
  }
}

// ============================================================
// 4. message_edit - 编辑消息
// ============================================================

export async function messageEdit(
  bot: BotInterface,
  _event: OneBotEvent | null = null,
  messageId: string = '',
  newText: string = ''
): Promise<{ success: boolean; error: string }> {
  if (!messageId) return { success: false, error: 'message_id 为空' };
  if (!newText) return { success: false, error: 'new_text 为空' };

  try {
    await bot.callApi('edit_msg', { message_id: messageId, message: newText });
    return { success: true, error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, error: err.message };
  }
}

// ============================================================
// 5. scheduled - 定时触发（占位，实际由运行时调度）
// ============================================================

export function scheduled(): void {
  // 实际调度由运行时处理，此处仅作类型占位
}

// ============================================================
// 6. request_received - 请求事件触发器（占位）
// ============================================================

export function requestReceived(): void {
  // 实际由运行时 handle_request_event 处理
}

// ============================================================
// 7. notice_received - 通知事件触发器（占位）
// ============================================================

export function noticeReceived(): void {
  // 实际由运行时 handle_notice_event 处理
}

export function variableSet(
  bot: BotInterface,
  event: OneBotEvent,
  value: unknown = null,
  varName: string = 'x'
): { result: unknown; var_name: string; error: string } {
  if (!varName || !VAR_NAME_RE.test(varName)) {
    return {
      result: value,
      var_name: varName,
      error: `非法变量名: ${varName}（需以字母/下划线开头，仅含字母/数字/下划线）`
    };
  }
  return { result: value, var_name: varName, error: '' };
}



// ============================================================
// 13. variable_merge - 变量合并
// ============================================================

export async function variableMerge(
  _bot: BotInterface,
  _event: OneBotEvent,
  mode: 'dict' | 'list' | 'concat' = 'dict',
  v1: unknown = null,
  v2: unknown = null,
  v3: unknown = null,
  v4: unknown = null,
  v5: unknown = null,
  v6: unknown = null,
  keyNames: unknown = '[]',
): Promise<{ result: unknown; count: number; error: string }> {
  // 目录承诺：dict=按键名合并为字典, list=按顺序合并为列表, concat=拼接多个列表。
  // 历史实现是空壳（只 console.info 然后返回 success）—— 用户聚合出来的东西永远是空，
  // 而且没有任何报错。这里按契约实现。
  const values = [v1, v2, v3, v4, v5, v6];
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  try {
    if (mode === 'dict') {
      const names = asList(keyNames).map((n) => String(n));
      const dict: Record<string, unknown> = {};
      values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        dict[names[i] || `v${i + 1}`] = v;
      });
      return { result: dict, count: Object.keys(dict).length, error: '' };
    }
    if (mode === 'list') {
      return { result: present, count: present.length, error: '' };
    }
    if (mode === 'concat') {
      const flat = present.flatMap((v) => asList(v));
      return { result: flat, count: flat.length, error: '' };
    }
    return { result: null, count: 0, error: `未知模式: ${mode}（支持 dict/list/concat）` };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { result: null, count: 0, error: err.message };
  }
}

// ============================================================
// 14. on_request - 请求处理
// ============================================================

export async function onRequest(
  bot: BotInterface,
  event: OneBotEvent,
  action: string = ''
): Promise<{ success: boolean; error: string }> {
  console.info(`[on_request] action=${action}`);
  return { success: true, error: '' };
}

// ============================================================
// 15. on_notice - 事件通知
// ============================================================

export async function onNotice(
  bot: BotInterface,
  event: OneBotEvent,
  noticeType: string = ''
): Promise<{ success: boolean; error: string }> {
  console.info(`[on_notice] noticeType=${noticeType}`);
  return { success: true, error: '' };
}

// ============================================================
// 16. on_button_click - 按钮点击
// ============================================================

export async function onButtonClick(
  bot: BotInterface,
  event: OneBotEvent,
  action: string = ''
): Promise<{ success: boolean; error: string }> {
  console.info(`[on_button_click] action=${action}`);
  return { success: true, error: '' };
}

// ============================================================
// 17. switch_case - 案例分支
// ============================================================

export function switchCase(
  value: string | number,
  cases: Record<string, unknown>
): { result: unknown; error: string } {
  const key = String(value);
  if (key in cases) {
    return { result: cases[key], error: '' };
  }
  return { result: null, error: `case "${key}" not found` };
}

// ============================================================
// 18. loop_control - 循环控制
// ============================================================

interface LoopControlResult {
  action: 'continue' | 'break' | 'return';
  value?: unknown;
  error: string;
}

export function loopControl(
  action: 'continue' | 'break' | 'return',
  value: unknown = null
): LoopControlResult {
  return { action, value, error: '' };
}

// ============================================================
// 19. on_ready - 启动就绪
// ============================================================

export function onReady(): void {
  // 启动就绪触发
}

// ============================================================
// 20. on_startup - 启动触发
// ============================================================

export function onStartup(): void {
  // 启动触发
}

// ============================================================
// 21. memory_add - 记忆添加
// ============================================================

export async function memoryAdd(
  bot: BotInterface,
  event: OneBotEvent,
  key: string = '',
  _value: unknown = null
): Promise<{ success: boolean; error: string }> {
  console.info(`[memory_add] key=${key}`);
  return { success: true, error: '' };
}

// ============================================================
// 22. memory_search - 记忆搜索
// ============================================================

export async function memorySearch(
  bot: BotInterface,
  event: OneBotEvent,
  query: string = '',
  limit: number = 10
): Promise<{ results: unknown[]; count: number; error: string }> {
  console.info(`[memory_search] query=${query}, limit=${limit}`);
  return { results: [], count: 0, error: '' };
}

// ============================================================
// 23. memory_clear - 记忆清除
// ============================================================

export async function memoryClear(
  bot: BotInterface,
  event: OneBotEvent,
  pattern: string = '*'
): Promise<{ success: boolean; count: number; error: string }> {
  console.info(`[memory_clear] pattern=${pattern}`);
  return { success: true, count: 0, error: '' };
}

// ============================================================
// 24. memory_list - 记忆列表
// ============================================================

export async function memoryList(
  bot: BotInterface,
  event: OneBotEvent,
  limit: number = 100
): Promise<{ items: unknown[]; count: number; error: string }> {
  console.info(`[memory_list] limit=${limit}`);
  return { items: [], count: 0, error: '' };
}

// ============================================================
// 25. agent_chat - AI 对话（合并 llm_chat + ai_tool_call）
// ============================================================

export async function agentChat(
  bot: BotInterface,
  event: OneBotEvent,
  prompt: string = '',
  _systemPrompt: string = '',
  _model: string = '',
  _temperature: number = 0.7,
  _maxTokens: number = 2000,
  _tools: unknown[] = []
): Promise<{ response: string; toolCalls: unknown[]; error: string }> {
  console.info(`[agent_chat] prompt=${prompt?.slice(0, 50)}...`);
  // 以前这里 `return { response: '', error: '' }` —— 节点"成功"了、回复是空的，
  // 用户以为 AI 答了、其实是空字符串（属最坏的一类"假装成功"）。
  return {
    response: '',
    toolCalls: [],
    error: 'AI 能力未接入：agent_chat 需要配置模型与密钥，当前版本不含真实 AI 调用',
  };
}

// ============================================================
// 26. api_call - API 调用
// ============================================================

/**
 * http_request / api_call 的真实实现（两个节点参数一致，api_call 是历史别名）。
 *
 * 历史：两者都直接 `return { status: 200, data: null, error: '' }` —— **假装请求成功**。
 * 流程里"调用接口"看着通过、拿到的 data 永远是 null，是本项目最容易被误判为
 * "节点坏了/网络不通"的坑之一。这里改成真正发请求。
 *
 * 约束（本地工具场景，避免把一次配置失误变成无限等待/超大内存）：
 *   - 超时上限 120s（默认 30s），用 AbortController
 *   - 响应体上限 5MB（超出截断并给出提示）
 *   - 只发 http/https；其它协议直接报错
 *   - 返回 { status, data, error }，error 非空即失败；JSON 响应自动解析，其余返回文本
 */
const HTTP_MAX_TIMEOUT_MS = 120_000;
const HTTP_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** http_request 的可选入参（目录里承诺、此前被完全忽略的三个端口） */
export interface HttpRequestOptions {
  /** URL 查询参数：对象，或 JSON 字符串（目录端口 `params`，默认 '{}'） */
  params?: unknown;
  /** 响应格式：auto（默认，按 content-type 猜）/ json（强制解析）/ text（原样文本）/ binary */
  responseFormat?: string;
  /** 最大响应体字节数（0/未给 = 用 HTTP_MAX_RESPONSE_BYTES 默认值） */
  maxResponseSize?: number;
}

export async function performHttpRequest(
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  body: unknown = null,
  timeout: number = 30000,
  options: HttpRequestOptions = {},
): Promise<{ status: number; data: unknown; error: string }> {
  const target = String(url || '').trim();
  if (!target) return { status: 0, data: null, error: 'url 不能为空' };
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { status: 0, data: null, error: `url 非法: ${target}` };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { status: 0, data: null, error: `只支持 http/https，收到 ${parsed.protocol}` };
  }

  // 目录承诺的 `params`：拼到 URL 上（此前被忽略 —— 用户填的查询参数一次都没发出去）
  if (options.params !== null && options.params !== undefined && options.params !== '') {
    let query: Record<string, unknown> = {};
    if (typeof options.params === 'string') {
      try {
        const p = JSON.parse(options.params);
        if (p && typeof p === 'object' && !Array.isArray(p)) query = p as Record<string, unknown>;
      } catch {
        return { status: 0, data: null, error: `params 不是合法 JSON: ${options.params}` };
      }
    } else if (typeof options.params === 'object' && !Array.isArray(options.params)) {
      query = options.params as Record<string, unknown>;
    }
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined) continue;
      parsed.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  const maxBytes =
    Number(options.maxResponseSize) > 0 ? Number(options.maxResponseSize) : HTTP_MAX_RESPONSE_BYTES;
  const timeoutMs = Math.min(Math.max(Number(timeout) || 30000, 1000), HTTP_MAX_TIMEOUT_MS);
  const upperMethod = String(method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: RequestInit = { method: upperMethod, headers, signal: controller.signal };
    if (body !== null && body !== undefined && upperMethod !== 'GET' && upperMethod !== 'HEAD') {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
      if (!hasContentType && typeof body !== 'string') {
        init.headers = { ...headers, 'Content-Type': 'application/json' };
      }
    }

    const res = await fetch(parsed.toString(), init);
    const raw = await res.text();
    const truncated = raw.length > maxBytes;
    const text = truncated ? raw.slice(0, maxBytes) : raw;

    let data: unknown = text;
    const contentType = res.headers.get('content-type') ?? '';
    const format = String(options.responseFormat ?? 'auto').toLowerCase();
    if (format === 'json' || (format !== 'text' && format !== 'binary' && (contentType.includes('json') || /^\s*[[{]/.test(text)))) {
      try {
        data = JSON.parse(text);
      } catch (e: unknown) {
        // 明确要求 json 却解析不了 → 报错，不要静默给回一段字符串
        if (format === 'json') {
          const msg = e instanceof Error ? e.message : String(e);
          return { status: res.status, data: null, error: `响应不是合法 JSON: ${msg}` };
        }
        data = text;
      }
    }

    return {
      status: res.status,
      data,
      error: res.ok ? '' : `HTTP ${res.status} ${res.statusText}${truncated ? '（响应体过大已截断）' : ''}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      status: 0,
      data: null,
      error: aborted ? `请求超时（${timeoutMs}ms）` : `请求失败: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function apiCall(
  bot: BotInterface,
  _event: OneBotEvent,
  action: string = '',
  params: unknown = null,
): Promise<{ success: boolean; result: unknown; data: unknown; error: string }> {
  // api_call 的目录契约是「调用 OneBot API」：端口只有 `action` + `params`（**没有 url**）。
  // 历史实现把它当成 http_request 的别名（读 url/method/…）—— 于是 url 永远是空字符串，
  // 这个节点 100% 报「url 不能为空」，用户按面板填的 action/params 一次都没生效过。
  const api = String(action || '').trim();
  if (!api) {
    return { success: false, result: null, data: null, error: 'action 不能为空（如 get_group_list）' };
  }
  let parsed: Record<string, unknown> = {};
  if (params !== null && params !== undefined && params !== '') {
    if (typeof params === 'string') {
      try {
        const p = JSON.parse(params);
        parsed = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      } catch {
        return { success: false, result: null, data: null, error: `params 不是合法 JSON: ${params}` };
      }
    } else if (typeof params === 'object') {
      parsed = params as Record<string, unknown>;
    }
  }
  try {
    const data = await bot.callApi(api, parsed);
    return { success: true, result: data, data, error: '' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { success: false, result: null, data: null, error: err.message };
  }
}

// ============================================================
// 27. check_permission - 权限检查
// ============================================================

/** 权限层级：数字越大权限越高。契约见目录 summary「超级管理员 > 群主 > 管理员 > 成员 > 游客」。 */
const PERMISSION_LEVELS: Record<string, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
  super_admin: 4,
};

/**
 * 组装返回值。
 *
 * ⚠️ **`passed` 是目录声明的输出端口 id，必须出现在返回对象里** ——
 * 运行时按端口 id 把返回值写进 `ctx.variables['<节点>:<端口>']`，下游数据线才拿得到。
 * 第一版只返回了 `hasPermission`，于是 `passed` 端口永远是 undefined，
 * 下游模板里的 `{var1}` 原样打在消息里（实测冒烟抓到：`/管理员` 输出字面量 `{var1}`）。
 * 两个键都保留：`passed` 供端口映射，`hasPermission` 供直接调用方（如单测）读。
 */
function permissionResult(
  success: boolean,
  hasPermission: boolean,
  error: string,
): { success: boolean; hasPermission: boolean; passed: boolean; error: string } {
  return { success, hasPermission, passed: hasPermission, error };
}

/** OneBot `get_group_member_info` 返回的 role → 层级（返回别的值一律按最低处理） */
const ONEBOT_ROLE_LEVELS: Record<string, number> = { member: 1, admin: 2, owner: 3 };

/** 机器人主人名单：环境变量 `SUPER_ADMIN_IDS`，逗号分隔。每次读，便于测试注入。 */
function superAdminIds(): string[] {
  return String(process.env.SUPER_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function checkPermission(
  bot: BotInterface,
  event: OneBotEvent,
  role: string = 'admin'
): Promise<{ success: boolean; hasPermission: boolean; passed: boolean; error: string }> {
  // 历史：这个函数曾经直接 `return { hasPermission: true }` —— 任何权限检查都无条件放行，
  // 比"不支持"更危险（流程会照常走管理员分支）。后来改成默认拒绝 + 明确说明，
  // 让缺口以失败形式暴露。**现在按目录契约真正实现。**
  //
  // 契约（builtinCatalog.ts）：按「超级管理员 > 群主 > 管理员 > 成员 > 游客」判断；
  // 超级管理员 = 机器人主人（环境变量 SUPER_ADMIN_IDS）；私聊只有超级管理员生效。
  const need = String(role || 'admin').trim() || 'admin';
  if (!(need in PERMISSION_LEVELS)) {
    return permissionResult(
      false,
      false,
      `权限级别非法: ${need}（支持 ${Object.keys(PERMISSION_LEVELS).join(' / ')}）`,
    );
  }

  const userId = event?.user_id !== undefined && event?.user_id !== null ? String(event.user_id) : '';
  if (!userId) {
    // 拿不到身份就不能放行 —— 这是权限判断，宁可拒绝
    return permissionResult(false, false, '无法判断权限：触发事件里没有 user_id');
  }

  // ① 超级管理员：只看环境变量，不查群
  const isSuper = superAdminIds().includes(userId);
  if (need === 'super_admin') {
    return permissionResult(true, isSuper, '');
  }
  if (isSuper) {
    return permissionResult(true, true, '');
  }

  // ② 私聊：契约明说"只有超级管理员生效"，走到这里说明不是超管 → 拒绝（且这不是错误）
  const isPrivate = event?.message_type === 'private' || event?.group_id === undefined || event?.group_id === null;
  if (isPrivate) {
    return permissionResult(true, false, '');
  }

  // ③ 群聊：查成员角色。查不到就报错而不是静默当"没权限"——
  //    那两种情况的排查方向完全不同（一个是权限不够，一个是适配器/API 有问题）。
  let memberRole = '';
  try {
    const resp = await bot.callApi('get_group_member_info', {
      group_id: String(event.group_id),
      user_id: userId,
      no_cache: false,
    });
    const payload = (resp as { data?: unknown })?.data ?? resp;
    memberRole = String((payload as { role?: unknown })?.role ?? '');
  } catch (e) {
    return permissionResult(
      false,
      false,
      `查询群成员信息失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const haveLevel = ONEBOT_ROLE_LEVELS[memberRole] ?? 0;
  const needLevel = PERMISSION_LEVELS[need];
  return permissionResult(true, haveLevel >= needLevel, '');
}

// ============================================================
// 28. delay - 延迟
// ============================================================

export async function delay(
  ms: number = 1000
): Promise<{ success: boolean; error: string }> {
  await new Promise(resolve => setTimeout(resolve, ms));
  return { success: true, error: '' };
}

// ============================================================
// 29. embedding - 向量嵌入
// ============================================================

export async function embedding(
  bot: BotInterface,
  event: OneBotEvent,
  text: string = '',
  _model: string = ''
): Promise<{ embedding: number[]; error: string }> {
  console.info(`[embedding] text=${text?.slice(0, 50)}...`);
  // 同上面三个 AI 节点：空向量 + 无错误会被下游当成"算出来了"。
  return {
    embedding: [],
    error: 'AI 能力未接入：embedding 需要配置模型与密钥，当前版本不含真实向量计算',
  };
}

// ============================================================
// 30. error_op - 错误处理
// ============================================================

export function errorOp(
  error: unknown,
  mode: 'throw' | 'catch' | 'return' = 'return'
): { success: boolean; error: string } {
  if (mode === 'throw') throw error;
  return { success: false, error: String(error) };
}

// ============================================================
// 31. expression_eval - 表达式求值
// ============================================================
//
// 实现已移到 `src/main/runtime/handlerRegistry.ts` 的 kwargs handler（同层调用 `safeEval`）。
//
// 为什么搬走而不是改这里：原来这里是
//   `new Function('vars', 'with(vars) { return ${expression}; }')`
// —— 一个**独立的纯 JS 求值器**，与 `branch_if` 用的 `safeEval`（带 Python→JS 翻译）
// 是两套语义。目录里教的 Python 写法（`clamp(...)`、`s.upper()`、`[x for x in lst]`、f-string）
// 在它下面**全部不生效**，同一个表达式写在 `branch_if` 里能跑、写在这里就报错。
// 搬到 runtime 层后两处共用一个求值器，且**错误会如实报出来**（原来被压成 false）。

// ============================================================
// 32. format_text - 文本格式化
// ============================================================

export function formatText(
  template: string = '',
  variables: Record<string, unknown> = {}
): { result: string; error: string } {
  /**
   * 把值渲染成文本。
   *
   * 历史实现直接用 `String(value)`：于是 `variable_merge(dict)` 的输出、`json_op` 解析出的
   * 对象，在消息里全是 `[object Object]`（对小白来说等于"坏了"）。对象改按 JSON 渲染，
   * 数组仍按元素连接（与原行为一致：`['a','b']` → `a,b`）。
   */
  const render = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(render).join(',');
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  };

  try {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), render(value));
    }
    return { result, error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { result: '', error: err.message };
  }
}

// ============================================================
// 33. get_context - 获取上下文
// ============================================================

/**
 * get_context 的入参（来自节点目录的 defaultConfig）。
 *
 * mode 取值见 `builtinCatalog.ts`：
 *   user_id / group_id / message_text / self_id / operator_id / message_id / raw_message /
 *   sub_type / command_args / message_part / group_members / user_name / group_name
 */
export interface GetContextOptions {
  mode?: string;
  index?: number | string;
  group_id?: string | number;
  user_id?: string | number;
  part_mode?: string;
  /** 分页游标（group_members / blacklist_list / join_requests）：大群不传就只能拿到第一页 */
  cursor?: string;
}

/** 把消息段数组里的文本拼起来（message_text 模式用） */
function messageTextOf(event: OneBotEvent): string {
  const msg: unknown = (event as { message?: unknown }).message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg)) {
    return msg
      .map((seg) => {
        const s = seg as { type?: string; data?: Record<string, unknown> };
        if (s?.type === 'text') return String(s.data?.text ?? '');
        if (s?.type === 'at') return `@${String(s.data?.qq ?? '')}`;
        return '';
      })
      .join('');
  }
  if (typeof event.get_message === 'function') {
    try {
      return String(event.get_message());
    } catch {
      return '';
    }
  }
  return '';
}

/** 取消息段数组（兼容 OneBot v11 的 array 格式与单个段对象） */
function segmentsOf(event: OneBotEvent): Array<{ type?: string; data?: Record<string, unknown> }> {
  const msg: unknown = (event as { message?: unknown }).message;
  if (Array.isArray(msg)) return msg as Array<{ type?: string; data?: Record<string, unknown> }>;
  if (msg && typeof msg === 'object') {
    const single = msg as { type?: string; data?: Record<string, unknown> };
    // CQ 码风格 {"type":"at","data":{...}} 视为单段
    return [single];
  }
  return [];
}

/**
 * 归一化「可被 `message_part` 取用的段」。
 *
 * BUG3（配了也拿不到）：`message_part` 以前只读 `event.message`，而官方接入的事件里
 * 消息段只有 text / at（附件在翻译层就被丢弃），引用与结构化卡片更是零解析 ——
 * 于是 image / file / reply / record / video / json 六种 part_mode **永远返回 null**。
 *
 * 现在补齐三条来源（段类型与 `GET_CONTEXT_PART_MODE_OPTIONS` 的取值一一对应）：
 *   · 附件 —— 翻译器已合成成 image / record / video / file 段，直接在 `message` 里；
 *   · 引用 —— 由 `_ref_idx`（官方 `message_scene` 的 `msg_idx`）合成 `reply` 段；
 *   · 卡片 —— 由 `ark_data` 合成 `json` 段。
 */
function normalizedPartsOf(
  event: OneBotEvent,
): Array<{ type?: string; data?: Record<string, unknown> }> {
  const parts = [...segmentsOf(event)];
  const ev = event as unknown as Record<string, unknown>;
  const refIdx = String(ev._ref_idx ?? '');
  if (refIdx) parts.push({ type: 'reply', data: { id: refIdx } });
  const ark = ev.ark_data;
  if (ark && typeof ark === 'object') {
    parts.push({ type: 'json', data: ark as Record<string, unknown> });
  }
  return parts;
}

/** 指令参数解析：`/禁言 @某人 600` → ['@某人', '600']（去掉指令名与前缀） */
function commandArgsOf(event: OneBotEvent): string[] {
  const raw = String(
    (event as { raw_message?: unknown }).raw_message ?? messageTextOf(event) ?? '',
  ).trim();
  if (!raw) return [];
  const tokens = raw.split(/\s+/).filter(Boolean);
  // 第一个 token 是指令名（含前缀），从第二个开始才是参数
  return tokens.slice(1);
}

/**
 * 提取上下文信息（mode 切换）。
 *
 * 历史：原实现是 `getContext(bot, event, key)` 且**直接返回 `{ value: null }`** ——
 * 一个什么都不做的空壳。而模板里用了它 83 次（取时长参数、取 @ 对象、取群号…），
 * 于是模板项目跑起来"全部成功但什么都不发生"。这里按目录声明的 mode 真正实现。
 *
 * 需要调用 QQ 接口的模式（group_members / user_name / group_name）在接口不可用或
 * 当前接入不支持时返回**明确错误**，而不是静默返回 null。
 */
export async function getContext(
  bot: BotInterface,
  event: OneBotEvent,
  options: GetContextOptions | string = {},
): Promise<{
  success: boolean;
  error: string;
  result?: unknown;
  args_list?: string[];
  members?: unknown[];
  part_list?: unknown[];
  part_count?: number;
  card?: string;
  nickname?: string;
  role?: string;
  is_admin?: boolean;
  recv_msg_setting?: string;
  next_cursor?: string;
  mute_mode?: string;
  mute_rules?: unknown;
  muted_members?: unknown[];
}> {
  // 兼容历史用法（第二参传字符串 key）：不再静默返回 null，而是明确报错
  const opts: GetContextOptions = typeof options === 'string' ? { mode: options } : (options ?? {});
  const mode = String(opts.mode || 'user_id');
  const ev = event as unknown as Record<string, unknown>;
  const num = (v: unknown): number | string => (v === undefined || v === null ? '' : (v as number | string));
  const index = Number(opts.index ?? 0) || 0;

  const ok = (result: unknown, extra: Record<string, unknown> = {}) => ({
    success: true,
    error: '',
    result,
    ...extra,
  });
  const fail = (error: string) => ({ success: false, error, result: null });

  switch (mode) {
    // ---- 纯事件字段：无需调用接口 ----
    case 'user_id':
      return ok(num(ev.user_id));
    case 'group_id':
      return ok(num(ev.group_id));
    case 'self_id':
      return ok(num(ev.self_id));
    case 'operator_id':
      // 通知类事件的操作用户；没有则回退到触发者
      return ok(num(ev.operator_id ?? ev.user_id));
    case 'message_id':
      return ok(num(ev.message_id));
    case 'sub_type':
      return ok(String(ev.sub_type ?? ''));
    case 'raw_message':
      return ok(String(ev.raw_message ?? messageTextOf(event)));
    case 'message_text':
      return ok(messageTextOf(event));

    // 引用回复要用的标识：优先本会话内的官方 REFIDX，没有就回退到 message_id
    // （翻译器会拿它去查 REFIDX 映射表，查不到会明确报错，不会静默丢引用）
    case 'message_ref':
      return ok(String(ev._ref_idx ?? ev.message_id ?? ''));

    case 'command_args': {
      const args = commandArgsOf(event);
      // index < 0 表示从末尾数（-1 = 最后一个）
      const picked = index < 0 ? args[args.length + index] : args[index];
      return ok(picked ?? '', { args_list: args });
    }

    case 'message_part': {
      const wanted = String(opts.part_mode || 'at');
      const parts = normalizedPartsOf(event).filter((s) => s?.type === wanted);
      const partList = parts.map((s) => s.data ?? {});
      const picked = index < 0 ? parts[parts.length + index] : parts[index];
      // at 段最常用：直接把 qq 作为 result，省掉下游再取一层字段
      const result =
        wanted === 'at' && picked ? String(picked.data?.qq ?? '') : (picked?.data ?? null);
      // part_count 是目录里声明过的出口：不给就等于承诺了一个永远为空的端口
      return ok(result, { part_list: partList, part_count: parts.length });
    }

    // ---- 需要调用 QQ 接口：拿不到就明确报错 ----
    case 'group_members': {
      const gid = String(opts.group_id || ev.group_id || '');
      if (!gid) return fail('group_members 需要群号（当前事件不在群里）');
      try {
        const params: Record<string, unknown> = { group_id: Number(gid) };
        // 游标必须传下去：大群一次只回一页，不透传的话流程永远只能看到前 N 人
        if (opts.cursor) params.cursor = String(opts.cursor);
        const members = await bot.callApi('get_group_member_list', params);
        // 两种回包形态都收：数组（OneBot 标准）与 { members, next_cursor }（官方分页接口）
        const page = !Array.isArray(members) && members && typeof members === 'object'
          ? (members as { members?: unknown; next_cursor?: unknown })
          : null;
        const list = page
          ? (Array.isArray(page.members) ? page.members : [])
          : (Array.isArray(members) ? members : []);
        const next = page?.next_cursor;
        return ok(list, next === undefined ? { members: list } : { members: list, next_cursor: String(next) });
      } catch (e) {
        return fail(`获取群成员失败（当前接入可能不支持该接口）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    case 'user_name': {
      const uid = String(opts.user_id || ev.user_id || '');
      const gid = String(opts.group_id || ev.group_id || '');
      if (!uid) return fail('user_name 需要 QQ 号（当前事件没有触发者）');
      try {
        const info = await bot.callApi('get_group_member_info', {
          group_id: gid ? Number(gid) : undefined,
          user_id: Number(uid),
        });
        const card = String((info as { card?: string })?.card ?? '');
        const nickname = String((info as { nickname?: string })?.nickname ?? '');
        // 群名片优先（群里显示的是名片），但两个出口都要给：下游可能要做「@名片 而不是 @昵称」
        const name = card || nickname;
        if (!name) return fail('获取昵称失败：接口未返回昵称');
        return ok(name, { card, nickname });
      } catch (e) {
        return fail(`获取昵称失败（当前接入可能不支持该接口）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    case 'group_name': {
      const gid = String(opts.group_id || ev.group_id || '');
      if (!gid) return fail('group_name 需要群号（当前事件不在群里）');
      try {
        const info = await bot.callApi('get_group_info', { group_id: Number(gid) });
        const name = (info as { group_name?: string })?.group_name || '';
        if (!name) return fail('获取群名称失败：接口未返回群名');
        return ok(name);
      } catch (e) {
        return fail(`获取群名称失败（当前接入可能不支持该接口）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ---- 群管理类只读查询（都要机器人是群管理员；官方群专属接口） ----
    case 'group_mute_state': {
      const gid = String(opts.group_id || ev.group_id || '');
      if (!gid) return fail('group_mute_state 需要群号（当前事件不在群里）');
      try {
        const state = await bot.callApi('get_group_mute_state', { group_id: Number(gid) });
        const s = (state ?? {}) as {
          mute_all?: unknown; mute_mode?: unknown; global_rule?: unknown; members?: unknown;
        };
        // `mute_all` 缺失时按 false —— 不臆造「正在全员禁言」，否则流程会误走拒绝分支
        const muteAll = s.mute_all === true;
        return ok(muteAll, {
          mute_mode: String(s.mute_mode ?? (muteAll ? 'always' : 'none')),
          mute_rules: s.global_rule ?? null,
          muted_members: Array.isArray(s.members) ? s.members : [],
        });
      } catch (e) {
        return fail(`获取全员禁言状态失败（该接口仅 QQ 官方群可用，需机器人是群管理员）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    case 'member_info': {
      const uid = String(opts.user_id || ev.user_id || '');
      const gid = String(opts.group_id || ev.group_id || '');
      if (!uid) return fail('member_info 需要 QQ 号（当前事件没有触发者）');
      try {
        const info = await bot.callApi('get_group_member_info', {
          group_id: gid ? Number(gid) : undefined,
          user_id: Number(uid),
        });
        const m = (info ?? {}) as Record<string, unknown>;
        const role = String(m.role ?? '');
        // result 是对象：下游常常要同时用 role / joined_at / bot，用一个昵称字符串会丢信息
        const result = { ...m, is_admin: role === 'admin' || role === 'owner' };
        return ok(result, { role });
      } catch (e) {
        return fail(`获取成员信息失败（官方群成员接口仍在「内邀接入中」，普通群可改用 user_name）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    case 'bot_state': {
      const gid = String(opts.group_id || ev.group_id || '');
      if (!gid) return fail('bot_state 需要群号（当前事件不在群里）');
      try {
        const state = await bot.callApi('get_group_bot_state', { group_id: Number(gid) });
        const s = (state ?? {}) as { is_admin?: unknown; role?: unknown; recv_msg_setting?: unknown };
        const isAdmin = s.is_admin === true;
        return ok(isAdmin, {
          is_admin: isAdmin,
          role: String(s.role ?? (isAdmin ? 'admin' : 'member')),
          recv_msg_setting: String(s.recv_msg_setting ?? ''),
        });
      } catch (e) {
        return fail(`获取机器人群内状态失败（该接口仅 QQ 官方群可用，需机器人是群管理员）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    case 'blacklist_list': {
      const gid = String(opts.group_id || ev.group_id || '');
      if (!gid) return fail('blacklist_list 需要群号（当前事件不在群里）');
      try {
        const params: Record<string, unknown> = { group_id: Number(gid) };
        if (opts.cursor) params.cursor = String(opts.cursor);
        const page = await bot.callApi('list_group_blacklist', params);
        const p = (page ?? {}) as { users?: unknown; next_cursor?: unknown };
        const users = Array.isArray(p.users) ? p.users : [];
        return ok(users, p.next_cursor === undefined
          ? { members: users }
          : { members: users, next_cursor: String(p.next_cursor) });
      } catch (e) {
        return fail(`获取群黑名单失败（该接口仅 QQ 官方群可用，需机器人是群管理员）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    case 'join_requests': {
      const gid = String(opts.group_id || ev.group_id || '');
      if (!gid) return fail('join_requests 需要群号（当前事件不在群里）');
      try {
        const params: Record<string, unknown> = { group_id: Number(gid) };
        if (opts.cursor) params.cursor = String(opts.cursor);
        const page = await bot.callApi('get_group_join_requests', params);
        const p = (page ?? {}) as { requests?: unknown; next_cursor?: unknown };
        const requests = Array.isArray(p.requests) ? p.requests : [];
        return ok(requests, p.next_cursor === undefined
          ? { members: requests }
          : { members: requests, next_cursor: String(p.next_cursor) });
      } catch (e) {
        return fail(`获取入群申请失败（该接口仅 QQ 官方群可用，需机器人是群管理员）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    default:
      return fail(`未知 mode: ${mode}`);
  }
}

// ============================================================
// 34. http_request - HTTP 请求
// ============================================================

export async function httpRequest(
  _bot: BotInterface,
  _event: OneBotEvent,
  url: string = '',
  method: string = 'GET',
  headers: Record<string, string> = {},
  body: unknown = null,
  timeout: number = 30,
  params: unknown = null,
  responseFormat: string = 'auto',
  maxResponseSize: number = 0,
): Promise<{ status: number; data: unknown; error: string }> {
  // 目录里 `timeout` 的单位是**秒**（默认 30，描述"超时秒数"），而底层用的是毫秒 ——
  // 以前直接把 30 当毫秒传下去、再被夹到 1 秒：用户填 30 秒实际只有 1 秒。
  return performHttpRequest(url, method, headers, body, (Number(timeout) || 30) * 1000, {
    params,
    responseFormat,
    maxResponseSize,
  });
}

// ============================================================
// 35. intent_classify - 意图分类
// ============================================================

export async function intentClassify(
  bot: BotInterface,
  event: OneBotEvent,
  text: string = '',
  _intents: string[] = []
): Promise<{ intent: string; confidence: number; error: string }> {
  console.info(`[intent_classify] text=${text?.slice(0, 50)}...`);
  // 以前返回 `{intent:'', confidence:0, error:''}`：下游按"意图为空"继续分支，
  // 用户完全不知道是分类没接还是没匹配上 —— 改为明确报错。
  return {
    intent: '',
    confidence: 0,
    error: 'AI 能力未接入：intent_classify 需要配置模型与密钥，当前版本不含真实意图分类',
  };
}

// ============================================================
// 36. json_op - JSON 操作
// ============================================================

export function jsonOp(
  mode: 'parse' | 'stringify' | 'get' | 'set' | 'delete',
  data: unknown = '',
  path: string = '',
  value: unknown = null
): { result: unknown; error: string } {
  try {
    let obj: Record<string, unknown>;
    if (typeof data === 'string') obj = JSON.parse(data);
    else obj = data as Record<string, unknown>;

    switch (mode) {
      case 'parse': return { result: obj, error: '' };
      case 'stringify': return { result: JSON.stringify(data, null, 2), error: '' };
      case 'get': {
        const keys = path.split('.');
        let val: unknown = obj;
        for (const k of keys) val = (val as Record<string, unknown> | null | undefined)?.[k];
        return { result: val, error: '' };
      }
      case 'set': {
        const keys = path.split('.');
        let val = obj;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!(keys[i] in val)) val[keys[i]] = {};
          val = val[keys[i]] as Record<string, unknown>;
        }
        val[keys[keys.length - 1]] = value;
        return { result: obj, error: '' };
      }
      case 'delete': {
        const keys = path.split('.');
        let val = obj;
        for (let i = 0; i < keys.length - 1; i++) val = val[keys[i]] as Record<string, unknown>;
        delete val[keys[keys.length - 1]];
        return { result: obj, error: '' };
      }
      default: return { result: null, error: `未知 mode: ${mode}` };
    }
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { result: null, error: err.message };
  }
}

// ============================================================
// 37. list_op - 列表操作
// ============================================================

/**
 * 把"列表"入参归一成数组。
 *
 * 面板/片段存的经常是 JSON 字符串（片段「添加物品」的 inventory 默认值就是 `'[]'`），
 * 旧实现遇到字符串直接当空数组，等于把已有数据丢掉。
 */
function asList(input: unknown): unknown[] {
  if (Array.isArray(input)) return [...input];
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 不是 JSON，按单元素处理
    }
    return [input];
  }
  return [];
}

/** list_op 支持的模式（与 shared/nodes/builtinCatalog.ts 里 list_op 的 mode 说明一致） */
export type ListOpMode =
  | 'append'
  | 'remove'
  | 'contains'
  | 'size'
  | 'get'
  | 'sort'
  | 'reverse'
  | 'unique'
  | 'merge'
  | 'slice'
  | 'insert'
  | 'index_of'
  | 'pop'
  /** 按字段找同款并累加计数（背包加物品）；见 listOp 里 upsert 分支的说明 */
  | 'upsert'
  // 兼容早期流程图/片段里出现过的模式
  | 'prepend'
  | 'shift'
  | 'length'
  | 'filter'
  | 'map'
  | 'reduce';

export function listOp(
  mode: ListOpMode,
  list: unknown[] = [],
  value: unknown = null,
  index: number | null = null,
  start = 0,
  end = 10,
  /** upsert 模式：按哪个字段判断"同一件物品"（如 `name`） */
  keyField = '',
  /** upsert 模式：把增量加到哪个字段（如 `count`） */
  countField = 'count',
  /** upsert 模式：已有同款时该字段加多少 */
  delta: unknown = 1
): { result: unknown[]; changed: boolean; count: number; total: number; error: string } {
  const arr = asList(list);
  const total = arr.length;
  const clamp = (i: unknown, max: number): number =>
    Math.max(0, Math.min(Math.floor(Number(i) || 0), max));
  /**
   * 统一出口：count 默认按目录约定推导（列表类=len(result)，单元素类=0/1）。
   *
   * `result` 声明成 `unknown[]` 是为了让下游（含测试）能把它直接当作列表继续传递；
   * contains/index_of/get/size 等标量模式运行时返回的是标量，类型只是历史契约的收窄。
   */
  const done = (result: unknown, changed: boolean, count?: number) => ({
    result: result as unknown[],
    changed,
    count:
      count ??
      (Array.isArray(result)
        ? result.length
        : result === null || result === undefined || result === false || result === -1
          ? 0
          : 1),
    total,
    error: '',
  });
  try {
    switch (mode) {
      case 'append':
        arr.push(value);
        return done(arr, true);
      /**
       * upsert：按字段找同款，找到就把计数字段加 `delta`，没找到就整条塞进去。
       *
       * 为什么需要（真机缺口）：`remove`/`contains`/`index_of` 全是**严格相等**匹配
       * （`arr.indexOf(value)`），没法"按字段找对象"。于是背包最核心的一步
       * ——"有新手剑就 +1，没有就新增"——**做不到**，只能去写 JS 数组表达式。
       *
       * 用法：`value` 传要加的物品对象（如 `{name:"新手剑", desc:"..."}`），
       * `key_field` 传 `name`，`count_field` 传 `count`，`delta` 传 1。
       */
      case 'upsert': {
        if (!keyField) {
          return { ...done(arr, false), error: 'upsert 模式需要「匹配字段」（如 name）' };
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return { ...done(arr, false), error: 'upsert 模式的「操作元素」必须是一个对象' };
        }
        const next = value as Record<string, unknown>;
        const keyValue = next[keyField];
        if (keyValue === undefined || keyValue === null || keyValue === '') {
          return {
            ...done(arr, false),
            error: `upsert 模式：操作元素里没有「${keyField}」字段，无法判断同款`,
          };
        }
        const step = Number(delta);
        if (!Number.isFinite(step)) {
          return { ...done(arr, false), error: `upsert 模式的增量不是数字：${JSON.stringify(delta)}` };
        }
        const at = arr.findIndex(
          (it) =>
            it && typeof it === 'object' && !Array.isArray(it) &&
            (it as Record<string, unknown>)[keyField] === keyValue,
        );
        if (at >= 0) {
          const current = Number((arr[at] as Record<string, unknown>)[countField]);
          const base = Number.isFinite(current) ? current : 0;
          const merged = { ...(arr[at] as Record<string, unknown>), [countField]: base + step };
          arr[at] = merged;
          return done(arr, true, merged[countField] as number);
        }
        const created = { ...next, [countField]: step };
        arr.push(created);
        return done(arr, true, created[countField] as number);
      }
      case 'prepend':
        arr.unshift(value);
        return done(arr, true);
      case 'insert': {
        arr.splice(clamp(index, arr.length), 0, value);
        return done(arr, true);
      }
      case 'remove': {
        const i = arr.indexOf(value);
        if (i >= 0) arr.splice(i, 1);
        return done(arr, i >= 0);
      }
      case 'pop': {
        // 目录约定「pop 默认最后一个元素」：面板会把 index 默认写成 0，
        // 因此只有显式传正数时才按下标删除，否则出栈最后一个。
        const i = Number(index) > 0 ? Math.min(Math.floor(Number(index)), arr.length - 1) : arr.length - 1;
        if (i < 0) return done(arr, false);
        arr.splice(i, 1);
        return done(arr, true);
      }
      case 'shift': {
        const removed = arr.shift();
        return done(arr, removed !== undefined);
      }
      case 'contains': {
        const has = arr.includes(value);
        return done(has, false, has ? 1 : 0);
      }
      case 'index_of': {
        const i = arr.indexOf(value);
        return done(i, false, i >= 0 ? 1 : 0);
      }
      case 'get': {
        // 越界返回 null（不 clamp 成第一个元素，否则"取不到"会被伪装成"取到了"）
        const i = Math.max(0, Math.floor(Number(index) || 0));
        const item = i < arr.length ? arr[i] : null;
        return done(item ?? null, false, item === undefined || item === null ? 0 : 1);
      }
      case 'size':
        return done(total, false, total);
      case 'length':
        // 兼容旧行为：返回 [长度]
        return done([total], false);
      case 'slice': {
        const sliced = arr.slice(Number(start) || 0, Number(end) || 0);
        return done(sliced, sliced.length !== total);
      }
      case 'sort': {
        arr.sort((a, b) => ((a as string) > (b as string) ? 1 : (a as string) < (b as string) ? -1 : 0));
        return done(arr, JSON.stringify(arr) !== JSON.stringify(list));
      }
      case 'reverse': {
        arr.reverse();
        return done(arr, JSON.stringify(arr) !== JSON.stringify(list));
      }
      case 'unique': {
        const uniq = [...new Set(arr)];
        return done(uniq, uniq.length !== total);
      }
      case 'merge': {
        const other = asList(value);
        return done(arr.concat(other), other.length > 0);
      }
      case 'filter': {
        const filtered = arr.filter((x) => x === value);
        return done(filtered, filtered.length !== total);
      }
      case 'map':
        return done(arr, false);
      case 'reduce': {
        const sum = arr.reduce((a, b) => Number(a) + Number(b), 0);
        return done(sum, false, 1);
      }
      default:
        return { result: [], changed: false, count: 0, total, error: `未知 mode: ${mode}` };
    }
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { result: [], changed: false, count: 0, total, error: err.message };
  }
}

// ============================================================
// 38. llm_chat - LLM 对话
// ============================================================

export async function llmChat(
  bot: BotInterface,
  event: OneBotEvent,
  prompt: string = '',
  _systemPrompt: string = '',
  _model: string = '',
  _temperature: number = 0.7,
  _maxTokens: number = 2000
): Promise<{ response: string; error: string }> {
  console.info(`[llm_chat] prompt=${prompt?.slice(0, 50)}...`);
  // 同 agent_chat：不能"成功返回空回复"，否则用户看到的是机器人不回话却一路绿灯。
  return {
    response: '',
    error: 'AI 能力未接入：llm_chat 需要配置模型与密钥，当前版本不含真实 AI 调用',
  };
}

// ============================================================
// 39. loop - 循环
// ============================================================

export async function loop(
  count: number = 1,
  body: () => Promise<unknown>
): Promise<{ results: unknown[]; error: string }> {
  const results: unknown[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const result = await Promise.resolve(body());
      results.push(result);
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        results.push({ error: err.message });
    }
  }
  return { results, error: '' };
}

// ============================================================
// 40. memory_op - 记忆操作（已拆分为 memory_add/search/clear/list）
// ============================================================

export function memoryOp(): void {
  // 已拆分为 memory_add/search/clear/list，此处仅作占位
}

// ============================================================
// 41. parallel_exec - 并行执行
// ============================================================

export async function parallelExec(
  tasks: Array<() => Promise<unknown>>
): Promise<{ results: unknown[]; error: string }> {
  try {
    const results = await Promise.all(tasks.map(t => t()));
    return { results, error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { results: [], error: err.message };
  }
}

// ============================================================
// 42. persistent_store - 持久化存储（已由 variable_persist 覆盖）
// ============================================================

export function persistentStore(): void {
  // 已由 variable_persist 覆盖，此处仅作占位
}

// ============================================================
// 43. query - 批量数据查询
// ============================================================

export async function queryFn(
  bot: BotInterface,
  event: OneBotEvent,
  mode: 'list' | 'sort' | 'filter' | 'aggregate' = 'list',
  keyPattern: string = '*',
  _scope: string = 'global',
  _sortBy: string = '',
  _order: 'asc' | 'desc' = 'asc',
  _limit: number = 1000,
  _filterExpr: string = '',
  _aggregateFunc: 'count' | 'sum' | 'avg' = 'count'
): Promise<{ results: unknown[]; count: number; error: string }> {
  console.info(`[query] mode=${mode}, pattern=${keyPattern}`);
  return { results: [], count: 0, error: '' };
}

// ============================================================
// 44. random - 随机数
// ============================================================

/** 把端口值拍成数组：面板里存的是 JSON 字符串，节点间连线传的是数组 */
function asRandomList(list: unknown): unknown[] {
  if (Array.isArray(list)) return list;
  if (typeof list === 'string' && list.trim()) {
    try {
      const parsed = JSON.parse(list);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function random(
  mode: 'int' | 'float' | 'choice' | 'weighted' | 'shuffle',
  min: number = 0,
  max: number = 1,
  list: unknown[] = []
): { result: unknown; error: string } {
  try {
    const arr = asRandomList(list);
    switch (mode) {
      case 'int': return { result: Math.floor(Math.random() * (max - min + 1)) + min, error: '' };
      case 'float': return { result: Math.random() * (max - min) + min, error: '' };
      case 'choice': return { result: arr[Math.floor(Math.random() * arr.length)], error: '' };
      case 'shuffle': return { result: [...arr].sort(() => Math.random() - 0.5), error: '' };
      /**
       * 加权随机（抽卡用）：list = [{ value, weight }]，按权重占比抽一个，返回 value。
       *
       * 为什么现在才实现：节点目录与属性面板一直提供"加权选择"这个模式，但 handler 里没有它 ——
       * 选了就报「未知 mode: weighted」（片段库里的「抽卡」就是这么坏的）。
       */
      case 'weighted': {
        const items = arr.filter(
          (it): it is Record<string, unknown> => !!it && typeof it === 'object',
        );
        const weights = items.map((it) => Math.max(0, Number(it.weight) || 0));
        const total = weights.reduce((s, w) => s + w, 0);
        if (items.length === 0 || total <= 0) {
          return { result: null, error: 'weighted 需要 [{value,weight}] 且权重之和 > 0' };
        }
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
          r -= weights[i];
          if (r < 0) return { result: items[i].value, error: '' };
        }
        return { result: items[items.length - 1].value, error: '' };
      }
      default: return { result: null, error: `未知 mode: ${mode}` };
    }
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { result: null, error: err.message };
  }
}

// ============================================================
// 45. regex_extract - 正则提取
// ============================================================

export function regexExtract(
  text: string = '',
  pattern: string = '',
  flags: string = '',
  group: number = 0,
  asList: boolean = false
): { result: unknown; matched: boolean; matches: string[]; groups: string[][]; error: string } {
  // 目录的输出口是 `result` + `matched`，还有 `as_list` 开关。历史实现只返回
  // {matches, groups} —— `result`/`matched` 两个口拿不到值（节点跑了、结果为空）。
  try {
    // ⚠️ `String.prototype.matchAll` 要求正则带 g 标志，否则直接抛
    // "called with a non-global RegExp argument" —— 历史实现传的是 `flags`
    // （面板默认空串），于是这个节点**每次都抛错**、result 永远是 null。
    const flagsWithG = flags.includes('g') ? flags : flags + 'g';
    const re = new RegExp(pattern, flagsWithG);
    const matches = text.match(re) ?? [];
    const groupArrays = Array.from(text.matchAll(re)).map(m => Array.from(m).slice(1));
    // as_list=false：给出指定分组（group=0 为整体匹配）的第一个结果；true：给出全部匹配
    const firstGroups = groupArrays[0] ?? [];
    const g = Number(group) || 0;
    const single = g > 0 ? (firstGroups[g - 1] ?? '') : (matches[0] ?? '');
    const result = asList ? matches : single;
    return { result, matched: matches.length > 0, matches, groups: groupArrays, error: '' };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { result: null, matched: false, matches: [], groups: [], error: err.message };
  }
}

// ============================================================
// 46. retry_exec - 重试执行
// ============================================================

export async function retryExec(
  fn: () => Promise<unknown>,
  retries: number = 3,
  delayMs: number = 1000
): Promise<{ result: unknown; error: string }> {
  let lastError: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return { result: await fn(), error: '' };
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (i < retries) await new Promise(r => setTimeout(r, delayMs));
    }
    return { result: null, error: lastError?.message || 'retry failed' };
  }
  // TypeScript safety: explicit return to satisfy compiler
  return { result: null, error: 'unreachable' };
}

// ============================================================
// 47. subflow_call - 子流程调用
// ============================================================

export async function subflowCall(
  subflowId: string = '',
  _input: unknown = {}
): Promise<{ output: unknown; error: string }> {
  console.info(`[subflow_call] subflowId=${subflowId}`);
  return { output: null, error: '' };
}

// ============================================================
// 48. subflow_defined - 子流程定义
// ============================================================

export function subflowDefined(): void {
  // 子流程定义占位
}

// ============================================================
// 49. system_log - 系统日志
// ============================================================

export function systemLog(
  level: 'info' | 'warn' | 'error' | 'debug' = 'info',
  message: string = '',
  data: unknown = null
): void {
  console[level](message, data);
}

// ============================================================
// 50. table_define - 表定义
// ============================================================

export function tableDefine(
  name: string = '',
  _schema: Record<string, unknown> = {}
): { success: boolean; error: string } {
  console.info(`[table_define] name=${name}`);
  return { success: true, error: '' };
}

// ============================================================
// 51. time_op - 时间操作
// ============================================================

/** 把时间戳/字符串转成 Date（数字小于 1e11 视为"秒"） */
function toDate(value: string | number | null | undefined): Date {
  if (value === null || value === undefined || value === '') return new Date();
  if (typeof value === 'number') return new Date(value < 1e11 ? value * 1000 : value);
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && String(value).trim() !== '') return toDate(asNumber);
  return new Date(value);
}

/** 按 `%Y-%m-%d %H:%M:%S` 这类格式渲染（也接受 YYYY/MM/DD 写法），timezone 为空用本地时区 */
function formatDate(date: Date, fmt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const map: Record<string, string> = {
    '%Y': get('year'),
    YYYY: get('year'),
    '%m': get('month'),
    MM: get('month'),
    '%d': get('day'),
    DD: get('day'),
    '%H': get('hour'),
    HH: get('hour'),
    '%M': get('minute'),
    mm: get('minute'),
    '%S': get('second'),
    ss: get('second'),
  };
  let out = fmt || '%Y-%m-%d %H:%M:%S';
  for (const [token, value] of Object.entries(map)) out = out.split(token).join(value);
  return out;
}

/**
 * 时间节点。
 *
 * 目录契约是 `now / is_today / date_diff`（端口 fmt / timezone / timestamp / target / unit /
 * target_fmt），而历史实现是另一套模式名（timestamp/format/parse/add/sub）—— 前三个模式
 * 全部落进「未知 mode」，且 `fmt` 参数根本没用上（format 模式直接返回 ISO 串）。
 * 这里按契约实现，旧模式保留兼容。
 */
export function timeOp(
  mode: 'now' | 'is_today' | 'date_diff' | 'timestamp' | 'format' | 'parse' | 'add' | 'sub' = 'now',
  timestamp: string | number | null = null,
  fmt: string = '%Y-%m-%d %H:%M:%S',
  timezone: string = '',
  target: string | number | null = null,
  unit: string = 'seconds',
  targetFmt: string = '%Y-%m-%d %H:%M:%S',
): { result: unknown; error: string } {
  try {
    const date = toDate(timestamp);
    const toUnit = (ms: number) => (String(unit) === 'milliseconds' || String(unit) === 'ms' ? ms : Math.floor(ms / 1000));
    switch (mode) {
      case 'now':
        return { result: toUnit(Date.now()), error: '' };
      case 'timestamp':
        return { result: toUnit(date.getTime()), error: '' };
      case 'is_today': {
        // 同一时区下的"年月日"是否相同
        const ymd = (d: Date) => {
          const p = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone || undefined,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).formatToParts(d);
          const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
          return `${g('year')}-${g('month')}-${g('day')}`;
        };
        return { result: ymd(date) === ymd(new Date()), error: '' };
      }
      case 'date_diff': {
        const other = toDate(target ?? Date.now());
        return { result: toUnit(date.getTime() - other.getTime()), error: '' };
      }
      case 'format':
        return { result: formatDate(date, fmt, timezone), error: '' };
      case 'parse':
        return { result: new Date(timestamp ?? Date.now()).getTime(), error: '' };
      case 'add':
      case 'sub': {
        const offset = Number(target ?? 0);
        const ms = mode === 'add' ? date.getTime() + offset : date.getTime() - offset;
        return { result: formatDate(new Date(ms), targetFmt || fmt, timezone), error: '' };
      }
      default:
        return { result: '', error: `未知 mode: ${mode}` };
    }
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { result: '', error: err.message };
  }
}

// ============================================================
// 51. timer - 定时器
// ============================================================

/** timer 节点的计时表（按 timer_id，进程内） */
const timerStarts = new Map<string, number>();

/**
 * 计时节点。
 *
 * 目录契约：`mode = start / stop / elapsed`，端口 `timer_id`，输出 `elapsed`(秒) / `elapsed_ms`。
 * 历史实现是 `setInterval(callback, ms)` —— 流程图里根本给不出 `callback`，
 * 且它没注册进 `handlerRegistry`，跑到这里只会报"找不到 handler"。
 */
export function timerOp(
  mode: 'start' | 'stop' | 'elapsed' = 'elapsed',
  timerId: string = 'default',
): { elapsed: number; elapsed_ms: number; error: string } {
  try {
    const id = timerId || 'default';
    if (mode === 'start') {
      timerStarts.set(id, Date.now());
      return { elapsed: 0, elapsed_ms: 0, error: '' };
    }
    const startedAt = timerStarts.get(id);
    if (startedAt === undefined) {
      return { elapsed: 0, elapsed_ms: 0, error: `计时器 ${id} 还没 start 过` };
    }
    const ms = Date.now() - startedAt;
    if (mode === 'stop') timerStarts.delete(id);
    return { elapsed: Math.round(ms / 10) / 100, elapsed_ms: ms, error: '' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { elapsed: 0, elapsed_ms: 0, error: err.message };
  }
}

export function timer(
  mode: 'setInterval' | 'setTimeout' | 'clearInterval' | 'clearTimeout',
  callback: () => void,
  ms: number = 1000
): { id: unknown; error: string } {
  try {
    if (mode === 'setInterval') return { id: setInterval(callback, ms), error: '' };
    if (mode === 'setTimeout') return { id: setTimeout(callback, ms), error: '' };
    if (mode === 'clearInterval') { clearInterval(callback as unknown as NodeJS.Timeout); return { id: null, error: '' }; }
    if (mode === 'clearTimeout') { clearTimeout(callback as unknown as NodeJS.Timeout); return { id: null, error: '' }; }
    return { id: null, error: `未知 mode: ${mode}` };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { id: null, error: err.message };
  }
}

// ============================================================
// 52. try_catch - 异常捕获
// ============================================================

export async function tryCatch(
  fn: () => Promise<unknown>,
  _catchFn?: (error: Error) => unknown
): Promise<{ result: unknown; error: string | null }> {
  try {
    return { result: await fn(), error: null };
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { result: null, error: err.message };
  }
}

// ============================================================
// 53. variable_merge - 变量合并（已在前面实现）
// ============================================================

// ============================================================
// 54. wait_input - 等待输入
// ============================================================

export async function waitInput(
  _bot: BotInterface,
  _event: OneBotEvent,
  timeout: number = 30000,
  prompt: string = ''
): Promise<{ success: boolean; input: string; timeout: boolean; error: string }> {
  // 真正的"等待"由解释器实现（见 runtime/FlowInterpreter.ts 的 suspendForWaitInput）：
  // 它会登记恢复现场并结束本次事件，下一条消息到达时从 received 出口继续。
  // 走到这个 handler 说明解释器**没能挂起**（预览模式、或图结构/入参异常），
  // 此时必须明确报错，不能假装问过用户 —— 历史实现直接返回空输入，下游拿到空值继续跑。
  return {
    success: false,
    input: '',
    timeout: false,
    error: `等待未挂起（解释器未登记恢复现场；配置：超时 ${timeout}ms${prompt ? `，提示「${prompt}」` : ''}）`,
  };
}

// ============================================================
// 导出所有 handler
// ============================================================

export const builtinHandlers = {
  message_received: messageReceived,
  message_send: messageSend,
  message_recall: messageRecall,
  message_edit: messageEdit,
  scheduled: scheduled,
  request_received: requestReceived,
  notice_received: noticeReceived,
  variable_set: variableSet,
  variable_persist: variablePersist,
  variable_merge: variableMerge,
  file_operate: fileOperate,
  database_write: databaseWrite,
  group_op: groupOp,
  on_request: onRequest,
  on_notice: onNotice,
  on_button_click: onButtonClick,
  switch_case: switchCase,
  loop_control: loopControl,
  on_ready: onReady,
  on_startup: onStartup,
  memory_add: memoryAdd,
  memory_search: memorySearch,
  memory_clear: memoryClear,
  memory_list: memoryList,
  agent_chat: agentChat,
  api_call: apiCall,
  check_permission: checkPermission,
  delay: delay,
  embedding: embedding,
  error_op: errorOp,
  format_text: formatText,
  get_context: getContext,
  http_request: httpRequest,
  intent_classify: intentClassify,
  json_op: jsonOp,
  list_op: listOp,
  llm_chat: llmChat,
  loop: loop,
  memory_op: memoryOp,
  parallel_exec: parallelExec,
  persistent_store: persistentStore,
  query: queryFn,
  random: random,
  regex_extract: regexExtract,
  retry_exec: retryExec,
  subflow_call: subflowCall,
  subflow_defined: subflowDefined,
  system_log: systemLog,
  table_define: tableDefine,
  time_op: timeOp,
  timer: timer,
  try_catch: tryCatch,
  wait_input: waitInput,
}

// ============================================================
// 41. variable_persist - 持久化变量存储
// ============================================================

const VAR_PERSIST_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DEFAULT_PERSIST_TTL = 0;
const MAX_PERSIST_TTL = 86400; // 24 hours

export async function variablePersist(
  bot: BotInterface,
  event: OneBotEvent,
  mode: 'save' | 'load' | 'delete' | 'exists' | 'load_or_default' | 'increment' | 'batch_load' | 'batch_save' | 'batch_update' | 'list_append' | 'compare_update' = 'load',
  key: string = '',
  value: unknown = null,
  scope: 'user' | 'group' | 'global' = 'user',
  ttl: number = DEFAULT_PERSIST_TTL,
  defaultValue: unknown = null,
  amount: number = 1,
  autoSave: boolean = true,
  maxLength: number = 0,
  data: string = '',
  compareOp: string = '>=',
  threshold: number = 1,
  delta: number = -1,
  keys: unknown = '[]',
  item: unknown = null
): Promise<{
  result: unknown;
  success: boolean;
  error: string;
  exists: boolean;
  is_default: boolean;
  old_value: unknown;
  new: boolean;
  saved: number;
  values: Record<string, unknown>;
  count: number;
  length: number;
  keys_list: string[];
  failed_key: string;
  ok: boolean;
  reason: string;
  __control_port__: string;
}> {
  console.info(`[variable_persist] mode=${mode}, key=${JSON.stringify(key)}, scope=${scope}, ttl=${ttl}`);

  const result: {
    result: unknown;
    success: boolean;
    error: string;
    exists: boolean;
    is_default: boolean;
    old_value: unknown;
    new: boolean;
    saved: number;
    values: Record<string, unknown>;
    count: number;
    length: number;
    keys_list: string[];
    failed_key: string;
    ok: boolean;
    reason: string;
    __control_port__: string;
  } = {
    result: null,
    success: false,
    error: '',
    exists: false,
    is_default: false,
    old_value: null,
    new: false,
    saved: 0,
    values: {},
    count: 0,
    length: 0,
    keys_list: [],
    failed_key: '',
    ok: false,
    reason: '',
    __control_port__: '',
  };

  // 验证 key（batch_load 用 `keys`、batch_save / batch_update 用 `data`，
  // 都不需要单个 key —— 以前一律先校验 key，导致这些模式**永远失败**在"非法变量名"上）
  const modesWithoutKey =
    mode === 'batch_load' || mode === 'batch_save' || mode === 'batch_update';
  if (!modesWithoutKey && (!key || !VAR_PERSIST_IDENT_RE.test(key))) {
    result.error = '非法变量名: ' + key + '（需以字母/下划线开头，仅含字母/数字/下划线）';
    return result;
  }

  // 验证 ttl
  if (ttl < 0) {
    result.error = '非法 ttl: ' + ttl;
    return result;
  }
  if (ttl > MAX_PERSIST_TTL) {
    result.error = `ttl 超出上限: ${ttl}（最大 ${MAX_PERSIST_TTL}）`;
    return result;
  }

  try {
    // 使用 persistentStore 进行实际的持久化存储操作
    // 实现逻辑由原 variable_persist 移植而来（该 Python 运行时已移除）
    // 持久化存储使用 SQLite + better-sqlite3，作用域隔离：user/group/global

    // 校验 scope 与事件里的身份（非法 scope / user scope 缺 user_id 都在这条抛错里报出来）。
    // ⚠️ 这一步**不能省**：下游 loadValue / saveValue 内部各自 catch 掉异常并返回 null/false，
    // 少了它，「非法 scope」会退化成"操作成功但什么都没写"这种静默失败。
    // 返回值本身没用（各模式下游会自己拼 key），要的是它的校验副作用。
    makeKey(key, scope, { user_id: event?.user_id, group_id: event?.group_id });

    switch (mode) {
      case 'compare_update': {
        // D3 · 原子条件更新（防超卖）：读 → 判断条件 → 变更 在一次原子操作里完成。
        // 两个并发请求里只有一个能成功；没成功的走「条件不满足」出口，不是错误。
        const cmp = await persistentStoreModule.compareAndUpdate(key, scope, event, {
          op: String(compareOp || '>='),
          threshold: Number(threshold ?? 1),
          delta: Number(delta ?? -1),
          defaultVal: Number(defaultValue ?? 0),
        });
        result.ok = cmp.ok;
        result.success = cmp.ok;
        result.result = cmp.ok ? cmp.newValue : cmp.oldValue;
        result.old_value = cmp.oldValue;
        result.reason = cmp.reason;
        result.error = cmp.error;
        result.__control_port__ = cmp.ok ? 'out' : 'failed';
        break;
      }

      case 'batch_update': {
        // D4 · 多键原子更新：一次事务里「读全部 → 判全部 → 写全部」。
        //
        // `data` 是 JSON 数组：[{key, op, value, expectOp, expect, defaultVal}, ...]
        //   op: 'set'（默认，直接赋 value）/ 'inc' / 'dec'（在事务内基于当前值加减）
        //   expectOp + expect: 可选前置条件，如 "金币至少 50"
        // **任何一项条件不满足，整批一个键都不写** —— 走「条件不满足」出口，这不是错误。
        //
        // 与 batch_save 的区别（也是它存在的理由）：batch_save 只管"把这批值写下去"，
        // 判定必须由它之前的节点做，于是 `batch_load → 表达式 → batch_save` 之间是敞开的 ——
        // 两条并发消息可以都读到"材料 3"、都判定通过、各写一遍，
        // 结果材料只扣一次而成品出了两件。compare_update 只覆盖单键，多键没有对应物。
        //
        // 空数据同样必须报错（理由见 batch_save 那段注释）：`data` 端口没连、或上游表达式
        // 求值失败，都是 null；静默当成"没有要改的键"就等于告诉用户"已经改好了"。
        if (data === null || data === undefined || data === '') {
          result.error =
            '批量更新的「数据」为空：请把上游表达式的结果连到 data 端口，' +
            '并确认它输出的是 JSON 数组（如 to_json([{"key":"gold","op":"dec","value":50,"expectOp":">=","expect":50}])）。';
          break;
        }
        let batchOps: BatchUpdateOp[];
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          if (!Array.isArray(parsed)) {
            result.error = `批量更新的「数据」必须是 JSON 数组，实际收到 ${typeof parsed}`;
            break;
          }
          batchOps = parsed as BatchUpdateOp[];
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.error = `批量更新的「数据」不是合法 JSON：${msg}（原文前 200 字：${String(data).slice(0, 200)}）`;
          break;
        }

        const bu = await persistentStoreModule.batchUpdateValues(batchOps, scope, event, ttl);
        result.ok = bu.ok;
        result.success = bu.ok;
        result.values = bu.values;
        result.old_value = bu.oldValues;
        result.count = bu.writtenKeys.length;
        result.keys_list = bu.writtenKeys;
        result.reason = bu.reason;
        result.error = bu.error;
        result.failed_key = bu.failedKey;
        result.__control_port__ = bu.ok ? 'out' : 'failed';
        break;
      }

      case 'save':
        // 保存值到持久化存储
        const saved = persistentStoreModule.saveValue(key, value, scope, event, ttl);
        result.success = saved;
        result.saved = saved ? 1 : 0;
        result.new = true;
        result.values = { [key]: value };
        result.count = 1;
        result.length = 1;
        result.keys_list = [key];
        break;

      case 'load':
        // 从持久化存储加载值
        const loadedVal = persistentStoreModule.loadValue(key, scope, event);
        result.success = true;
        result.result = loadedVal !== null ? loadedVal : defaultValue;
        result.exists = loadedVal !== null;
        result.old_value = loadedVal;
        result.is_default = loadedVal === null;
        break;

      case 'delete':
        // 从持久化存储删除值
        const deleted = persistentStoreModule.deleteValue(key, scope, event);
        result.success = deleted;
        result.exists = !deleted;
        break;

      case 'exists':
        // 检查键是否存在
        const loadedValExists = persistentStoreModule.loadValue(key, scope, event);
        result.success = true;
        result.exists = loadedValExists !== null;
        break;

      case 'load_or_default':
        // 加载值，如果不存在返回默认值
        const loadedVal2 = persistentStoreModule.loadValue(key, scope, event);
        result.success = true;
        result.result = loadedVal2 !== null ? loadedVal2 : defaultValue;
        result.exists = loadedVal2 !== null;
        result.is_default = loadedVal2 === null;
        break;

      case 'increment':
        // 原子自增
        const incrResult = persistentStoreModule.incrValue(key, Number(amount) || 1, scope, Number(defaultValue ?? 0), event);
        // 原来无条件 success=true，把 incrValue 的错误整个吞掉（写失败/值不是数字都当成功）
        result.success = !incrResult.error;
        result.error = incrResult.error;
        result.result = incrResult.result;
        result.old_value = incrResult.oldValue;
        result.new = true;
        break;

      case 'batch_load': {
        // 目录端口是 `keys`（JSON 数组）。历史实现调的是 batchSaveValues（**保存**函数！）
        // 并且永远返回空 values/count 0 —— 用户以为批量读出来了，其实什么都没读。
        const keyList = asList(keys).map((k) => String(k)).filter(Boolean);
        const values: Record<string, unknown> = {};
        for (const k of keyList) {
          const loaded = persistentStoreModule.loadValue(k, scope, event);
          values[k] = loaded !== null ? loaded : defaultValue;
        }
        result.success = true;
        result.values = values;
        result.count = keyList.length;
        result.keys_list = keyList;
        break;
      }

      case 'batch_save': {
        // 批量保存（`data` 是 JSON 字符串字典，也接受已解析好的对象）
        //
        // ⚠️ 这里**必须对空数据报错**。历史实现是 `JSON.parse((data as string) || '{}')`，
        // 于是「data 端口没连 / 上游表达式求值失败（端口为 null）」和「用户真的想写空字典」
        // 长得一模一样 —— 都静默写成 0 条并返回 `saved: 0`。
        // 真机后果（2026-09-21）：`/购买` 的 `data` 公式被 Python→JS 三元翻译器改坏 → 求值报错 →
        // 端口 null → 这里兜成 `{}` → **一句错都没冒出来，但金币没扣**；
        // `/卸下` 早前也栽在同一处（见 scripts/e2e/tmp-fix-unequip-ports.mjs 的注释）。
        // 批量写是"一次事务改多个键"的高危操作，宁可报错也不能假装成功。
        const rawData = data;
        if (rawData === null || rawData === undefined || rawData === '') {
          result.error =
            '批量保存的「数据」为空：请把上游表达式的结果连到 data 端口，' +
            '并确认它输出的是 JSON 字符串（如 to_json({"gold": 10, "bag": [...]})）。' +
            '如果上游是个表达式节点，先在它的「错误」端口上看看表达式有没有报错。';
          break;
        }
        let dict: Record<string, unknown>;
        if (typeof rawData === 'string') {
          let parsed: unknown;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            result.error = `批量保存的「数据」不是合法 JSON 字符串: ${rawData.slice(0, 200)}`;
            break;
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            result.error = `批量保存的「数据」必须是 JSON 对象（键→值），收到: ${rawData.slice(0, 200)}`;
            break;
          }
          dict = parsed as Record<string, unknown>;
        } else if (typeof rawData === 'object' && !Array.isArray(rawData)) {
          dict = rawData as Record<string, unknown>;
        } else {
          result.error = `批量保存的「数据」类型不支持（应为 JSON 字符串或对象）: ${typeof rawData}`;
          break;
        }
        if (Object.keys(dict).length === 0) {
          result.error = '批量保存的「数据」是空对象 {}，没有任何键可以写入（检查上游表达式是否走到了提前返回的分支）';
          break;
        }
        const batchResult = persistentStoreModule.batchSaveValues(dict, scope, event, ttl);
        // batchSaveValues 把每个键的失败累积在 errors 里而不是抛出（见其实现），
        // 不读它就会重演"写了一半还说成功"。
        if (batchResult.errors.length > 0) {
          result.error = `批量保存部分失败: ${batchResult.errors.join('；')}`;
        }
        result.success = batchResult.errors.length === 0;
        result.saved = batchResult.saved;
        result.values = dict;
        result.count = batchResult.saved;
        result.keys_list = batchResult.keysList || [];
        break;
      }

      case 'list_append': {
        // 列表追加：读 → 追加 `item` → （auto_save 时）写回。历史实现是空壳
        // （直接返回 { [key]: [] } + length 0），用户追了半天背包永远是空的。
        const appended = persistentStoreModule.listAppendValue(
          key,
          item,
          scope,
          Number(maxLength) || 0,
          event,
        );
        if (appended.error) {
          result.error = appended.error;
          break;
        }
        if (autoSave !== false) persistentStoreModule.saveValue(key, appended.result, scope, event, ttl);
        result.success = true;
        result.result = appended.result;
        result.old_value = appended.result.slice(0, -1);
        result.new = true;
        result.values = { [key]: appended.result };
        result.count = appended.length;
        result.length = appended.length;
        result.keys_list = [key];
        break;
      }

      default:
        result.error = '未知模式: ' + mode;
        break;
    }

    if (mode !== 'save' && mode !== 'load' && mode !== 'delete' && mode !== 'exists' && mode !== 'load_or_default' && mode !== 'increment') {
      // 对于其他模式，已在 switch 中设置 error
    }
  } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        result.error = err.message;
  }

  return result;
}

// 类型导出
export type { 
  PersistResult, 
  FileResult, 
  DBResult, 
  GroupOpResult,
  LoopControlResult
};