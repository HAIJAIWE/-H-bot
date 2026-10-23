// 轻量 Markdown 渲染器 — 不依赖外部库
// 支持语法：代码块、行内代码、标题、列表、粗体、斜体、链接
// 适用于 AI 聊天回复等短文本场景

import { useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';
import { highlightCode } from './codeHighlight';

/**
 * 代码块 + 复制按钮（对齐主流客户端：右上角一个复制图标）。
 * 文案只用符号与语言名 —— 渲染层不拼中文（i18n 闸门）。
 */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        // 复制失败也要看得见（闸门：失败不许静默）—— 图标变叉，1.2 秒后恢复
        setFailed(true);
        setTimeout(() => setFailed(false), 1200);
      });
  };
  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between px-2 py-1 text-[11px] text-zinc-500">
        <span className="font-mono">{lang || t('common.codeBlock')}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          title={copied ? 'copied' : 'copy'}
        >
          {failed ? '✕' : copied ? '✓' : '⧉'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 text-xs">
        <code className="font-mono text-zinc-200">{highlightCode(code, lang)}</code>
      </pre>
    </div>
  );
}

/** URL 协议白名单：仅允许 http/https/mailto，拦截 javascript:/data: 等 XSS 向量 */
function isSafeUrl(url: string): boolean {
  try {
    // 处理无协议相对路径（自动以当前页面协议解析）
    const u = new URL(url, window.location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * 管道表（GFM 风格）的最小解析：header 行 + 分隔行 + 数据行。
 *
 * 不做的事（刻意）：转义竖线、多行单元格、表格内嵌套块。
 * AI 总结用的表基本用不到；真需要时再上完整解析器，别手写半个。
 */
function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

/** 分隔行：|---|:--:|---:|（至少两列；首尾竖线可省） */
function isTableSeparator(line: string): boolean {
  if (!line.includes('|')) return false;
  const cells = splitTableRow(line);
  if (cells.length < 2) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines: readonly string[], at: number): boolean {
  return lines[at]?.includes('|') === true && isTableSeparator(lines[at + 1] ?? '');
}

function tableAligns(separator: string): Array<'left' | 'right' | 'center'> {
  return splitTableRow(separator).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

/** 渲染行内格式（粗体、斜体、行内代码、链接） */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 正则匹配：`code` / **bold** / *italic* / [text](url)
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${i}`}
          className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[0.9em] text-zinc-200"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-zinc-100">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={`${keyPrefix}-i-${i}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith('[')) {
      const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        const url = m[2];
        // 协议白名单过滤：javascript:/data: 等不安全协议退化为纯文本，
        // 避免 AI 回复或粘贴的 prompt 中注入恶意链接触发 XSS
        if (isSafeUrl(url)) {
          nodes.push(
            <a
              key={`${keyPrefix}-a-${i}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              {m[1]}
            </a>,
          );
        } else {
          nodes.push(<span key={`${keyPrefix}-a-${i}`}>{m[1]}</span>);
        }
      }
    }
    lastIdx = regex.lastIndex;
    i++;
  }
  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }
  return nodes;
}

interface MiniMarkdownProps {
  content: string;
  /** 容器 className */
  className?: string;
}

/** 轻量 Markdown 渲染 */
export function MiniMarkdown({ content, className }: MiniMarkdownProps) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ```
      blocks.push(<CodeBlock key={`pre-${key++}`} lang={lang} code={codeLines.join('\n')} />);
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      // 标题层级要拉得开：AI 回复常用 ## 分节，全渲染成 text-sm 会糊成一段
      const sizes = ['text-lg', 'text-base', 'text-sm', 'text-xs'];
      blocks.push(
        <div
          key={`h-${key++}`}
          className={`mt-4 mb-1.5 font-semibold text-zinc-100 first:mt-0 ${sizes[level - 1]}`}
        >
          {renderInline(text, `h-${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${key++}`} className="list-disc pl-5 space-y-1 my-1">
          {items.map((item, idx) => (
            <li key={idx} className="text-zinc-200">
              {renderInline(item, `ul-${key}-${idx}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol-${key++}`} className="list-decimal pl-5 space-y-1 my-1">
          {items.map((item, idx) => (
            <li key={idx} className="text-zinc-200">
              {renderInline(item, `ol-${key}-${idx}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // 管道表：header 行 + 分隔行 + 数据行（对齐：左/右/中）
    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i]);
      const aligns = tableAligns(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        lines[i].includes('|') &&
        !isTableSeparator(lines[i])
      ) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const cols = Math.max(header.length, 1, ...rows.map((row) => row.length));
      const alignClass = (idx: number) => ALIGN_CLASS[aligns[idx] ?? 'left'];
      const tableKey = 'table-' + String(key++);
      blocks.push(
        <div key={tableKey} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {Array.from({ length: cols }, (_, c) => (
                  <th
                    key={c}
                    className={
                      'border-b border-zinc-700 px-2 py-1 font-medium text-zinc-300 ' +
                      alignClass(c)
                    }
                  >
                    {renderInline(header[c] ?? '', tableKey + '-th-' + String(c))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td
                      key={c}
                      className={
                        'border-b border-zinc-800 px-2 py-1 align-top text-zinc-200 ' +
                        alignClass(c)
                      }
                    >
                      {renderInline(row[c] ?? '', tableKey + '-td-' + String(r) + '-' + String(c))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 引用块（> 开头连续行）：左侧竖线 + 次级颜色，和正文分层
    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={`quote-${key++}`}
          className="my-1 border-l-2 border-zinc-600 pl-3 text-zinc-400"
        >
          {renderInline(quoted.join('\n'), `quote-${key}`)}
        </blockquote>,
      );
      continue;
    }

    // 分隔线
    if (/^\s*(-\s*){3,}$/.test(line)) {
      blocks.push(<hr key={`hr-${key++}`} className="my-2 border-zinc-800" />);
      i++;
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 普通段落
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].match(/^(#{1,4})\s+/) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*(-\s*){3,}$/.test(lines[i]) &&
      !isTableStart(lines, i)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      // 保留**硬换行**：AI 回复经常用单换行分行（不是空行分段），
      // 拼成一行会把清单和句子糊在一起；whitespace-pre-wrap 让换行按原样显示。
      <p key={`p-${key++}`} className="leading-relaxed whitespace-pre-wrap">
        {renderInline(paraLines.join('\n'), `p-${key}`)}
      </p>,
    );
  }

  // 统一的块间距（对齐 DSH 的 assistant 正文节奏：相邻块 8px，不靠每个组件自己写 margin）
  return <div className={`space-y-2 ${className ?? ''}`}>{blocks}</div>;
}
