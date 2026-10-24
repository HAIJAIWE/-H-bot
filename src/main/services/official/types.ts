// src/main/services/official/types.ts
//
// 官方适配器的**数据形状**。单独一层是因为 ws.ts / messages.ts 是
// 10/18 产物还原出来的 `@ts-nocheck` 文件：在里面写实现没问题，
// 但返回值若只靠推导，调用方（IPC、测试、翻译器）看到的就是一堆 any，
// 字段少一个也不会报错。把形状钉在这里，nocheck 文件只负责填字段。
//
// 只放**跨模块共用**的形状；模块内部的中间态留在各自文件里。

/** 消息附件（图片/视频/语音/文件；图片带宽高，官方只对图片给） */
export interface OfficialAttachment {
  contentType: string;
  filename: string;
  url: string;
  width?: number;
  height?: number;
  size?: number;
}

/** 结构化卡片（ARK / Embed）：官方只支持收，不支持发 */
export interface OfficialArkData {
  arkType: string;
  arkName: string;
  prompt: string;
  fields: Record<string, unknown>;
}

/** 消息场景：msg_idx 就是引用回复要用的 REFIDX */
export interface OfficialMessageScene {
  source: string;
  ext: string[];
  refIdx: string;
}

/**
 * 解析后的事件负载。
 *
 * 之所以是「可选字段」而不是空值占位：下游用 `ev.attachments?.[0]` 判断有没有，
 * 空数组会让人以为「有附件但解析失败」，undefined 才是「这条消息没有附件」。
 */
export interface ParsedOfficialEvent {
  type: string;
  id: string;
  content: string;
  timestamp: string;
  /** 官方作者对象（user_openid / member_openid / member_role / bot / username / union_openid） */
  author: Record<string, unknown>;
  messageType?: number;
  arkType?: string;
  groupOpenid?: string;
  attachments?: OfficialAttachment[];
  arkData?: OfficialArkData;
  /** 嵌套消息元素（引用 103 / 聊天记录 102 等），原样交给翻译器 */
  msgElements?: unknown[];
  messageScene?: OfficialMessageScene;
}

/** 官方连接状态 */
export type OfficialStatus = "disconnected" | "connecting" | "connected" | "error";
