// tests/renderer/components/ui/zoomableImage.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZoomableImage } from '@renderer/components/ui/ZoomableImage';

afterEach(cleanup);

describe('★ 图片可放大', () => {
  it('点击缩略图 → 弹层出现；点关闭 → 消失', () => {
    render(<ZoomableImage src="data:image/png;base64,AAAA" alt="x" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByAltText('x'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('关闭预览'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc 也能关', () => {
    render(<ZoomableImage src="data:image/png;base64,AAAA" alt="y" />);
    fireEvent.click(screen.getByAltText('y'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
