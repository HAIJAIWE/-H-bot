// src/renderer/src/components/layout/ThreeColumn.tsx
import { useCallback, useRef, useEffect } from 'react';
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

export function ThreeColumn() {
  useLocaleSubscription();
  const leftCollapsed = useUiStore((s) => s.leftPanelCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightPanelCollapsed);
  const leftWidth = useUiStore((s) => s.leftPanelWidth);
  const rightWidth = useUiStore((s) => s.rightPanelWidth);
  const setLeftWidth = useUiStore((s) => s.setLeftPanelWidth);
  const setRightWidth = useUiStore((s) => s.setRightPanelWidth);

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
          <div style={{ width: leftWidth }} className="shrink-0 overflow-hidden flex flex-col">
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
          <div style={{ width: rightWidth }} className="shrink-0 overflow-hidden flex flex-col">
            <RightPanel />
          </div>
        </>
      )}
    </main>
  );
}
