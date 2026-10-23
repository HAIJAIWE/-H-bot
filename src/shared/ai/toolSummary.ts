// src/shared/ai/toolSummary.ts
//
// 工具结果的一句话摘要（2026-10-18）。
//
// 目的：展开区里一堆原始 JSON 对作者没用。这里把常见结果压成一行
// （退出码 / 写入体积 / 行数），拿不到摘要就不显示 —— 不编。
// 文案放 shared，渲染层只查表（i18n 闸门）。

export function runningText(): string {
  return '运行中';
}

export function settledFallbackText(): string {
  return '已完成';
}

function asText(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result ?? '');
  } catch {
    return '';
  }
}

/** 退出码：`[退出码 0]` 或 `exit code: 0` 都认 */
function exitCodeOf(text: string): number | null {
  const a = text.match(/退出码\s*(-?\d+)/);
  if (a) return Number(a[1]);
  const b = text.match(/exit code:\s*(-?\d+)/i);
  if (b) return Number(b[1]);
  return null;
}

export function summarizeToolResult(name: string, result: unknown): string | null {
  if (result === undefined || result === null) return null;
  const text = asText(result);
  if (!text.trim()) return null;

  if (name === 'run_command' || name === 'run_test') {
    const code = exitCodeOf(text);
    return code === null ? null : '退出码 ' + String(code);
  }
  if (name === 'write_file' || name === 'write_code') {
    const bytes = new TextEncoder().encode(text).length;
    return bytes >= 1024 ? '已写入 ' + (bytes / 1024).toFixed(1) + 'KB' : '已写入 ' + String(bytes) + 'B';
  }
  if (name === 'read_file' || name === 'read_code') {
    return '读取 ' + String(text.split('\n').length) + ' 行';
  }
  if (name === 'validate_flow') {
    return text.includes('通过') ? '校验通过' : '发现问题';
  }
  return null;
}
