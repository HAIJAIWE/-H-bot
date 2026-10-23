// tests/renderer/components/ui/miniMarkdown.test.tsx
//
// MiniMarkdown 的版式契约：块级间距、硬换行、引用块 —— 都直接影响长回复的可读性。
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MiniMarkdown } from '@renderer/components/ui/MiniMarkdown';

afterEach(cleanup);

describe('★ MiniMarkdown 版式', () => {
  it('有序列表渲染成 ol/li（不是挤成一段）', () => {
    const { container } = render(<MiniMarkdown content={'1. 第一项\n2. 第二项'} />);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('★ 单换行保留为换行（AI 常按行写清单，拼成一段会糊）', () => {
    const { container } = render(<MiniMarkdown content={'第一行\n第二行'} />);
    expect(container.querySelector('p')?.textContent).toBe('第一行\n第二行');
  });

  it('引用块有 blockquote，分隔线有 hr', () => {
    const { container } = render(<MiniMarkdown content={'> 引用一句\n\n---\n\n正文'} />);
    expect(container.querySelector('blockquote')?.textContent).toContain('引用一句');
    expect(container.querySelector('hr')).toBeTruthy();
  });
});
