// src/renderer/src/lib/format.ts
//
// 统一格式化工具 — 时间 / 字节 / 通用格式化函数集中管理。
//
// 背景：在创建本文件之前，renderer 中 5 个组件各自重复实现了 formatTime /
// formatTimestamp：
//   - BotStateDialog.tsx     : formatTime(ms: number) → 月日时分秒
//   - MetricsPanel.tsx       : formatTime(ts: number) → HH:MM:SS
//   - CrashReportDialog.tsx  : formatTimestamp(iso: string) → YYYY-MM-DD HH:MM:SS
//   - GitHistoryDialog.tsx   : formatTimestamp(ts: string) → 年月日时分
//
// 各处实现略有差异但语义重叠，维护成本高、行为不一致。
// 本模块提供统一实现，调用方按输出格式选择合适的函数：
//   - formatTimestamp       : 完整时间戳 YYYY-MM-DD HH:MM:SS
//   - formatDateTime        : 短日期时间 月日时分秒
//   - formatFullDateTime    : 含年月日时分
//   - formatTimeOnly        : 仅时分秒 HH:MM:SS
//   - formatFileSize        : 字节大小
//
// 输入归一化：支持 number（毫秒时间戳）和 string（ISO 字符串或 SQLite
// 'YYYY-MM-DD HH:MM:SS' 形式）。SQLite 形式按 UTC 解释（与数据库 CURRENT_TIMESTAMP
// 默认 UTC 行为一致），其余按 new Date() 默认行为解释。

import { getLocale } from '../i18n';

/** 时间输入类型 */
export type TimeInput = number | string;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * 将多种形式的输入归一化为 Date 对象。
 * @returns 无法解析时返回 null。
 */
function toDate(value: TimeInput): Date | null {
  try {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      // 防御两种时间戳单位：>1e12 视为毫秒（epoch ms），否则视为秒（epoch s），
      // 避免把秒级时间戳按毫秒解析成 1970 年。
      return new Date(value >= 1e12 ? value : value * 1000);
    }
    if (typeof value === 'string') {
      // 处理 SQLite CURRENT_TIMESTAMP 形式：'YYYY-MM-DD HH:MM:SS' → ISO
      // 按本地时间还是 UTC 解释？SQLite CURRENT_TIMESTAMP 默认 UTC，所以这里加 'Z'。
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
        const iso = value.replace(' ', 'T') + 'Z';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

/** 输入无法解析时返回的兜底值 */
function fallback(value: TimeInput): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * 格式化为完整时间戳 `YYYY-MM-DD HH:MM:SS`（本地时间）。
 * 用于：日志展示、崩溃报告等需要精确到秒的场景。
 */
export function formatTimestamp(value: TimeInput): string {
  const d = toDate(value);
  if (!d) return fallback(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 格式化为短日期时间（跟随当前界面语言：中文为月日时分秒）。
 * 用于：列表项、状态面板等紧凑展示场景。
 */
export function formatDateTime(value: TimeInput): string {
  const d = toDate(value);
  if (!d) return fallback(value);
  return d.toLocaleString(getLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 格式化为含年的日期时间（跟随当前界面语言：中文为年月日时分）。
 * 用于：Git 历史、文件属性等需要年信息的场景。
 */
export function formatFullDateTime(value: TimeInput): string {
  const d = toDate(value);
  if (!d) return fallback(value);
  return d.toLocaleString(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化为仅时间 `HH:MM:SS`（本地时间）。
 * 用于：当日内事件展示，如资源告警、实时指标。
 */
export function formatTimeOnly(value: TimeInput): string {
  const d = toDate(value);
  if (!d) return fallback(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 格式化字节数为人类可读字符串（B / KB / MB / GB）。
 * 用于：文件大小、内存占用等展示。
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
