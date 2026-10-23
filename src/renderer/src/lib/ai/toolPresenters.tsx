// src/renderer/src/lib/ai/toolPresenters.tsx
//
// **工具呈现器注册表**（2026-10-19）：工具声明"怎么展示"（presentation），渲染层按名字查实现。
//
// 为什么需要它：`resultKind` 只能覆盖几种通用形态（文本/diff/文件列表/JSON）；
// 数据库查询要出表格、流程图补丁要出缩略图 —— 这些渲染逻辑属于**工具的作者**，
// 不该塞进 ToolRows 的 switch 里（每加一种就改一次核心组件）。
//
// 查不到就回退原始文本：呈现器是**增强**，缺了不能把内容弄丢。
import type { ReactNode } from 'react';

/** 渲染器：拿到工具的原始 result（unknown），返回节点；不许抛错（调用方不兜底） */
export type ToolPresenter = (result: unknown) => ReactNode;

const REGISTRY = new Map<string, ToolPresenter>();

/** 注册一个呈现器；重名直接抛（两个工具抢同一个名字比"显示错了"更难查） */
export function registerToolPresenter(name: string, render: ToolPresenter): () => void {
  if (!name) throw new Error('presenter name is required');
  if (REGISTRY.has(name)) throw new Error('presenter already registered: ' + name);
  REGISTRY.set(name, render);
  return () => {
    if (REGISTRY.get(name) === render) REGISTRY.delete(name);
  };
}

/** 按名字取呈现器；没注册返回 undefined（调用方回退原始文本） */
export function getToolPresenter(name: string): ToolPresenter | undefined {
  return REGISTRY.get(name);
}

/** 结果文本化：字符串原样；对象按 JSON 展开（拿不到就空串） */
export function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2) ?? '';
  } catch {
    return '';
  }
}

/** diff：只显示前 N 行，超出用纯符号标出行数（不新增 i18n 键） */
const DIFF_PREVIEW_LINES = 12;

function renderText(text: string): ReactNode {
  return (
    <pre className="text-xs text-zinc-400 bg-zinc-800/40 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto mt-0.5">
      {text}
    </pre>
  );
}

// 内置呈现器：模块加载即注册（write_file 的 resultKind='diff' 靠它渲染）
registerToolPresenter('diff', (result) => {
  const lines = toolResultText(result).split('\n');
  const shown = lines.slice(0, DIFF_PREVIEW_LINES);
  const hidden = lines.length - shown.length;
  return (
    <div>
      {renderText(shown.join('\n'))}
      {hidden > 0 && <div className="mt-0.5 text-xs text-zinc-600">{'… +' + String(hidden)}</div>}
    </div>
  );
});

registerToolPresenter('files', (result) => {
  const rows = toolResultText(result)
    .split('\n')
    .filter((line) => line.trim().length > 0);
  return (
    <ul className="mt-0.5 max-h-24 overflow-y-auto rounded bg-zinc-800/40 p-1.5 text-xs text-zinc-400 list-disc list-inside">
      {rows.map((line, i) => (
        <li key={i} className="truncate font-mono">
          {line}
        </li>
      ))}
    </ul>
  );
});
