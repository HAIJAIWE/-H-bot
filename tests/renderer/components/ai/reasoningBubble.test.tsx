// tests/renderer/components/ai/reasoningBubble.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StreamingBubble } from '@renderer/components/ai/MessageBubble';

afterEach(cleanup);

describe('★ 思考过程（reasoning）', () => {
  it('流式气泡：标题与内容都在 DOM 里（点开即见）', () => {
    render(<StreamingBubble text="答案" reasoning="先想一下" />);
    expect(screen.getByText('思考过程')).toBeTruthy();
    expect(screen.getByText('先想一下')).toBeTruthy();
  });

  it('没有 reasoning 时不渲染那一段（不占版面）', () => {
    render(<StreamingBubble text="答案" />);
    expect(screen.queryByText('思考过程')).toBeNull();
  });
});
