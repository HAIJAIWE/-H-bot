// src/renderer/src/components/layout/ThreeColumn.tsx
import { useCallback, useRef, useEffect, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { ErrorBoundary } from '../ErrorBoundary';
import { LeftPanel } from './LeftPanel';
import { CenterPanel } from './CenterPanel';
import { RightPanel } from './RightPanel';
import { Button } from '../ui/Button';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

function ResizeHandle({
  onDragStart,
  direction,
}: {
  onDragStart: () => (delta: number) => void;
  direction: 'left' | 'right';
}) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const onDragRef = useRef<((delta: number) => void) | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      onDragRef.current = onDragStart();

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current || !onDragRef.current) return;
        const delta =
          direction === 'left' ? ev.clientX - startX.current : startX.current - ev.clientX;
        startX.current = ev.clientX;
        onDragRef.current(delta);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        onDragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onDragStart, direction],
  );

  return (
    <div
      className="w-1.5 hover:w-2 bg-zinc-800 hover:bg-blue-500/60 cursor-col-resize shrink-0 transition-colors relative group z-10"
      onMouseDown={handleMouseDown}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}

/** 中间栏最小宽度：主页面、画布、代码编辑器都要横向空间。
 *  两侧宽度是可拖拽并持久化的，窗口变小后会把中间栏挤到没法用（曾经出现过只剩 250px 的主页面），
 *  所以渲染时按视口收敛一次 —— 只影响这一次布局，不改用户存下来的宽度，窗口拉大就恢复。 */
const MIN_CENTER_WIDTH = 380;
const MIN_SIDE_WIDTH = 180;

function fitPanels(
  viewport: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
): { left: number; right: number } {
  let left = leftCollapsed ? 0 : leftWidth;
  let right = rightCollapsed ? 0 : rightWidth;
  if (left + right <= viewport - MIN_CENTER_WIDTH) return { left, right };

  // 先压右侧（AI 面板），不够再压左侧（节点库）；压到最小仍放不下就让内容溢出隐藏。
  let excess = left + right - (viewport - MIN_CENTER_WIDTH);
  const rightRoom = Math.max(0, right - MIN_SIDE_WIDTH);
  const shrinkRight = Math.min(excess, rightRoom);
  right -= shrinkRight;
  excess -= shrinkRight;
  if (excess > 0) left = Math.max(MIN_SIDE_WIDTH, left - excess);
  return { left, right };
}

export function ThreeColumn() {
  useLocaleSubscription();
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const leftWidth = useUiStore((s) => s.leftPanelWidth);
  const rightWidth = useUiStore((s) => s.rightPanelWidth);
  const setLeftWidth = useUiStore((s) => s.setLeftPanelWidth);
  const setRightWidth = useUiStore((s) => s.setRightPanelWidth);

  const [viewport, setViewport] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const fitted = fitPanels(viewport, leftWidth, rightWidth, leftCollapsed, rightCollapsed);

  const leftWidthRef = useRef(leftWidth);
  const rightWidthRef = useRef(rightWidth);
  useEffect(() => {
    leftWidthRef.current = leftWidth;
  }, [leftWidth]);
  useEffect(() => {
    rightWidthRef.current = rightWidth;
  }, [rightWidth]);

  const startLeftDrag = useCallback(() => {
    return (delta: number) => setLeftWidth(leftWidthRef.current + delta);
  }, [setLeftWidth]);

  const startRightDrag = useCallback(() => {
    return (delta: number) => setRightWidth(rightWidthRef.current + delta);
  }, [setRightWidth]);

  return (
    <main className="flex-1 flex overflow-hidden" role="main">
      {!leftCollapsed && (
        <>
          <div style={{ width: fitted.left }} className="shrink-0 overflow-hidden flex flex-col">
            <LeftPanel />
          </div>
          <ResizeHandle direction="left" onDragStart={startLeftDrag} />
        </>
      )}
      <ErrorBoundary
        fallback={(error, reset) => (
          <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 text-center p-6">
            <p className="text-sm text-red-400 mb-2">{t('panel.crash.title')}</p>
            <p className="text-xs text-zinc-500 mb-4 font-mono max-w-md break-all">
              {error.message}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={reset}
              className="border border-zinc-700"
            >
              {t('panel.crash.retry')}
            </Button>
          </div>
        )}
      >
        <CenterPanel />
      </ErrorBoundary>
      {!rightCollapsed && (
        <>
          <ResizeHandle direction="right" onDragStart={startRightDrag} />
          <div style={{ width: fitted.right }} className="shrink-0 overflow-hidden flex flex-col">
            <RightPanel />
          </div>
        </>
      )}
    </main>
  );
}
