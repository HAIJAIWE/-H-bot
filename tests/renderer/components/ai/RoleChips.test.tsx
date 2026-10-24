// tests/renderer/components/ai/RoleChips.test.tsx
//
// 角色 chips 的**换行观感**是这轮修的（869px 窄栏下原来每个 chip 内部折字、高低不齐）。
// 布局本身截图才能看全，但"按钮内部不许折行"这条可以由 class 兜住 —— 以后谁把
// whitespace-nowrap 删了，这条测试会红，而不是等用户看截图才发现。
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t } from '@renderer/i18n';
import { RoleChips } from '@renderer/components/ai/RoleChips';
import { AI_MODE_BUTTONS } from '@renderer/components/ai/agentModes';

afterEach(() => {
  cleanup();
});

const label = (mode: (typeof AI_MODE_BUTTONS)[number]['mode']) => {
  const entry = AI_MODE_BUTTONS.find((b) => b.mode === mode);
  if (!entry) throw new Error('角色表里缺 ' + mode);
  return t(entry.labelKey);
};

describe('RoleChips', () => {
  it('四档角色都渲染出来，文案来自语言包', () => {
    render(<RoleChips value="blocks" onChange={() => {}} />);
    for (const btn of AI_MODE_BUTTONS) {
      expect(screen.getByRole('button', { name: new RegExp(t(btn.labelKey)) })).toBeInTheDocument();
    }
    expect(AI_MODE_BUTTONS).toHaveLength(4);
  });

  it('只有当前角色是 aria-pressed=true', () => {
    render(<RoleChips value="code" onChange={() => {}} />);
    const pressed = AI_MODE_BUTTONS.filter((b) => {
      const node = screen.getByRole('button', { name: new RegExp(t(b.labelKey)) });
      return node.getAttribute('aria-pressed') === 'true';
    });
    expect(pressed.map((b) => b.mode)).toEqual(['code']);
  });

  it('点击把目标角色回传给调用方', () => {
    const onChange = vi.fn();
    render(<RoleChips value="blocks" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label('creator')) }));
    expect(onChange).toHaveBeenCalledWith('creator');
  });

  it('没传 onReset 就不显示「跟随页面」，传了就回调', () => {
    const { rerender } = render(<RoleChips value="duo" onChange={() => {}} />);
    expect(screen.queryByText(t('ai.mode.followPage'))).toBeNull();

    const onReset = vi.fn();
    rerender(<RoleChips value="duo" onChange={() => {}} onReset={onReset} />);
    fireEvent.click(screen.getByText(t('ai.mode.followPage')));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('每个 chip 都不许在按钮内部折行（窄栏换行时整颗下移）', () => {
    render(<RoleChips value="blocks" onChange={() => {}} />);
    for (const btn of AI_MODE_BUTTONS) {
      const node = screen.getByRole('button', { name: new RegExp(t(btn.labelKey)) });
      expect(node.className).toContain('whitespace-nowrap');
    }
    const row = screen.getByRole('button', { name: new RegExp(label('blocks')) }).parentElement;
    expect(row?.className).toContain('flex-wrap');
  });
});
