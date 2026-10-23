// src/renderer/src/components/editor/MetricsPanel.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useMetricsStore, type MetricSnapshot } from '../../stores/metricsStore';
import { useResourceStore } from '../../stores/resourceStore';
import { useToast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { formatTimeOnly as formatTime } from '../../lib/format';
import { t } from '../../i18n';

// ─── 工具函数 ──────────────────────────────────────────────

/** 生成 SVG 折线的 points 属性 */
function toPoints(values: number[], width: number, height: number, maxVal: number): string {
  if (values.length === 0) return '';
  const step = width / Math.max(values.length - 1, 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = maxVal > 0 ? height - (v / maxVal) * height : height;
      return `${x},${y}`;
    })
    .join(' ');
}

/** 取最近 N 个数据点 */
function sliceRecent(data: MetricSnapshot[], n: number): MetricSnapshot[] {
  return data.length > n ? data.slice(-n) : data;
}

// ─── SVG Line Chart ────────────────────────────────────────

const CHART_W = 280;
const CHART_H = 80;

function SvgLineChart({
  values,
  color,
  fillColor,
  maxValue,
  extraLine,
  unit,
}: {
  values: number[];
  color: string;
  fillColor?: string;
  maxValue: number;
  extraLine?: { values: number[]; color: string };
  unit?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (values.length === 0) {
    return (
      <div className="h-[80px] flex items-center justify-center text-zinc-500 text-xs">
        {t('editor.metrics.waiting')}
      </div>
    );
  }

  const effectiveMax = Math.max(maxValue, 1);

  // 主折线
  const points = toPoints(values, CHART_W, CHART_H, effectiveMax);

  // 面积填充
  const areaPoints = points + ` ${CHART_W},${CHART_H} 0,${CHART_H}`;

  // 额外折线（如 P95）
  const extraPoints = extraLine ? toPoints(extraLine.values, CHART_W, CHART_H, effectiveMax) : '';

  const step = CHART_W / Math.max(values.length - 1, 1);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const xView = xRatio * CHART_W;
    const idx = Math.round(xView / step);
    setHoverIdx(Math.max(0, Math.min(values.length - 1, idx)));
  };

  const hoverX = hoverIdx !== null ? hoverIdx * step : 0;
  const hoverY = hoverIdx !== null ? CHART_H - (values[hoverIdx] / effectiveMax) * CHART_H : 0;
  const extraHoverY =
    hoverIdx !== null && extraLine
      ? CHART_H - (extraLine.values[hoverIdx] / effectiveMax) * CHART_H
      : 0;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        role="img"
        aria-label={t('editor.metrics.cpuChart')}
        width="100%"
        height={CHART_H}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        style={{ cursor: 'crosshair' }}
      >
        {/* 网格线 */}
        <line
          x1="0"
          y1={CHART_H * 0.25}
          x2={CHART_W}
          y2={CHART_H * 0.25}
          stroke="#27272a"
          strokeWidth="0.5"
        />
        <line
          x1="0"
          y1={CHART_H * 0.5}
          x2={CHART_W}
          y2={CHART_H * 0.5}
          stroke="#27272a"
          strokeWidth="0.5"
        />
        <line
          x1="0"
          y1={CHART_H * 0.75}
          x2={CHART_W}
          y2={CHART_H * 0.75}
          stroke="#27272a"
          strokeWidth="0.5"
        />
        {/* 面积 */}
        {fillColor && <polygon points={areaPoints} fill={fillColor} opacity="0.15" />}
        {/* 额外折线 */}
        {extraPoints && (
          <polyline
            points={extraPoints}
            fill="none"
            stroke={extraLine!.color}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.7"
          />
        )}
        {/* 主折线 */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* hover 指示线 + 数据点 */}
        {hoverIdx !== null && (
          <>
            <line
              x1={hoverX}
              y1="0"
              x2={hoverX}
              y2={CHART_H}
              stroke="#71717a"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoverX}
              cy={hoverY}
              r="3"
              fill={color}
              stroke="#fff"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {extraLine && (
              <circle
                cx={hoverX}
                cy={extraHoverY}
                r="3"
                fill={extraLine.color}
                stroke="#fff"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </>
        )}
      </svg>
      {hoverIdx !== null && (
        <div
          className="absolute pointer-events-none bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs shadow-lg z-10 whitespace-nowrap"
          style={{
            left: `${(hoverX / CHART_W) * 100}%`,
            top: '-6px',
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-mono text-white">
            <span style={{ color }}>{'●'}</span> {values[hoverIdx]}
            {unit}
          </div>
          {extraLine && (
            <div className="font-mono" style={{ color: extraLine.color }}>
              <span>{'●'}</span> {extraLine.values[hoverIdx]}
              {unit}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SVG Bar Chart ─────────────────────────────────────────

function SvgBarChart({
  values,
  color,
  maxValue,
  unit,
}: {
  values: number[];
  color: string;
  maxValue: number;
  unit?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (values.length === 0) {
    return (
      <div className="h-[80px] flex items-center justify-center text-zinc-500 text-xs">
        {t('editor.metrics.waiting')}
      </div>
    );
  }

  const effectiveMax = Math.max(maxValue, 1);
  const barW = CHART_W / Math.max(values.length, 1);

  return (
    <div className="relative">
      <svg
        width="100%"
        height={CHART_H}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('editor.metrics.memChart')}
      >
        {values.map((v, i) => {
          const barH = (v / effectiveMax) * CHART_H;
          const x = i * barW;
          const y = CHART_H - barH;
          const isActive = hoverIdx === i;
          return (
            <rect
              key={i}
              x={x + 1}
              y={y}
              width={Math.max(barW - 2, 1)}
              height={barH}
              fill={color}
              opacity={hoverIdx === null ? 0.4 + (i / values.length) * 0.6 : isActive ? 1 : 0.25}
              rx="1"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div
          className="absolute pointer-events-none bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs shadow-lg z-10 whitespace-nowrap"
          style={{
            left: `${((hoverIdx + 0.5) / values.length) * 100}%`,
            top: '-6px',
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-mono text-white">
            <span style={{ color }}>{'●'}</span> {values[hoverIdx]}
            {unit}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Summary Row ───────────────────────────────────────────

function SummaryRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-zinc-400 text-xs">{label}</span>
      <span className="text-white text-lg font-mono font-semibold">
        {value}
        {unit && <span className="text-zinc-500 text-xs ml-1">{unit}</span>}
      </span>
    </div>
  );
}

// ─── Legend ────────────────────────────────────────────────

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-zinc-500 text-xs">
      <span className="inline-block w-2 h-[2px] rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ─── MetricsPanel ──────────────────────────────────────────

// ─── Toast ─────────────────────────────────────────────────

function Toast({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-green-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm transition-opacity duration-300"
      role="alert"
    >
      {message}
    </div>
  );
}

// ─── Export Dropdown ───────────────────────────────────────

function ExportDropdown() {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      setOpen(false);
      setExporting(true);
      try {
        const fn =
          format === 'csv'
            ? window.qqbat.metrics.exportToCSV()
            : window.qqbat.metrics.exportToJSON();
        const result = await fn;
        if (!result.ok || !result.data) {
          toast.error(result.error ?? t('editor.metrics.exportFailed'));
          return;
        }
        // toast 通知会在父组件中触发
        window.dispatchEvent(
          new CustomEvent('metrics:exported', {
            detail: t('editor.metrics.exportedTo', { path: result.data.filePath }),
          }),
        );
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : t('editor.metrics.exportFailed'));
      } finally {
        setExporting(false);
      }
    },
    [toast],
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="secondary"
        size="sm"
        className="border border-zinc-700"
        onClick={() => setOpen((v) => !v)}
        disabled={exporting}
        aria-label={t('editor.metrics.exportTitle')}
        aria-expanded={open}
      >
        {exporting ? t('editor.metrics.exporting') : t('editor.metrics.export')}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10 overflow-hidden">
          <Button
            variant="ghost"
            size="md"
            className="w-full justify-start text-left"
            onClick={() => handleExport('csv')}
          >
            {t('editor.metrics.exportCsv')}
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="w-full justify-start text-left"
            onClick={() => handleExport('json')}
          >
            {t('editor.metrics.exportJson')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Resource Bar ──────────────────────────────────────────
// 注意：ResourceBar 必须定义在 MetricsPanel 外部。
// 之前定义在组件体内部会导致每次 MetricsPanel 重渲染时 ResourceBar 组件类型身份变化，
// React 会卸载并重新挂载整个 ResourceBar 子树（包括 transition 动画重置）。

function ResourceBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(value / Math.max(max, 1), 1) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-400 text-xs w-12 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-white text-xs font-mono w-20 text-right">{value.toFixed(1)}</span>
    </div>
  );
}

// ─── Alert History Block ───────────────────────────────────

function AlertHistoryBlock() {
  const alerts = useResourceStore((s) => s.alerts);
  const clearAlerts = useResourceStore((s) => s.clearAlerts);
  const [expanded, setExpanded] = useState(true);

  // 仅展示最近 10 条
  const recent = useMemo(() => alerts.slice(-10).reverse(), [alerts]);

  if (alerts.length === 0) return null;

  return (
    <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className={`text-zinc-600 transition-transform ${expanded ? 'rotate-90' : ''}`}>
            ▶
          </span>
          <span className="font-medium">{t('editor.metrics.alerts')}</span>
          <span className="text-red-400">({alerts.length})</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={clearAlerts} aria-label={t('editor.metrics.clearAlerts')}>
          {t('editor.action.clear')}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {recent.map((a, i) => (
            <div key={`${a.timestamp}-${i}`} className="flex items-start gap-2 text-xs">
              <span className="text-zinc-600 font-mono shrink-0">{formatTime(a.timestamp)}</span>
              <span
                className={`shrink-0 ${a.type === 'memory' ? 'text-yellow-400' : 'text-orange-400'}`}
              >
                [{a.type === 'memory' ? t('editor.metrics.memory') : 'CPU'}]
              </span>
              <span className="text-zinc-300 break-all">{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MetricsPanel ──────────────────────────────────────────

export const MetricsPanel = React.memo(function MetricsPanel() {
  const dataPoints = useMetricsStore((s) => s.dataPoints);
  const current = useMetricsStore((s) => s.current);
  const init = useMetricsStore((s) => s.init);
  const didInit = useRef(false);

  // 资源监控
  const resource = useResourceStore((s) => s.current);
  const resourceInit = useResourceStore((s) => s.init);
  const resourceDidInit = useRef(false);

  const [toast, setToast] = useState({ message: '', visible: false });

  // 监听导出成功事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      setToast({ message: detail, visible: true });
      setTimeout(() => setToast({ message: '', visible: false }), 3000);
    };
    window.addEventListener('metrics:exported', handler);
    return () => window.removeEventListener('metrics:exported', handler);
  }, []);

  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true;
      const cleanup = init();
      return cleanup;
    }
  }, [init]);

  useEffect(() => {
    if (!resourceDidInit.current) {
      resourceDidInit.current = true;
      const cleanup = resourceInit();
      return cleanup;
    }
  }, [resourceInit]);

  // 最多显示 30 个点 —— useMemo 避免每次 1s tick 重渲染时重复 slice
  const display = useMemo(() => sliceRecent(dataPoints, 30), [dataPoints]);

  // 各图表数据序列 —— deps=[display]，display 不变时跳过 .map 重算
  const msgVals = useMemo(() => display.map((s) => s.msgCount), [display]);
  const avgLatVals = useMemo(() => display.map((s) => s.avgLatency), [display]);
  const p95LatVals = useMemo(() => display.map((s) => s.p95Latency), [display]);
  const errVals = useMemo(() => display.map((s) => s.errorRate), [display]);

  // 各图表 max 值 —— 仅在对应数据序列变化时重算
  const maxMsg = useMemo(() => Math.max(...msgVals, 1), [msgVals]);
  const maxLat = useMemo(() => Math.max(...avgLatVals, ...p95LatVals, 1), [avgLatVals, p95LatVals]);
  const maxErr = useMemo(() => Math.max(...errVals, 1), [errVals]);

  const hasData = dataPoints.length > 0;

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 p-4 space-y-4">
      {/* 标题栏 + 导出按钮 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-400 tracking-wide">{t('editor.metrics.title')}</h2>
        <ExportDropdown />
      </div>

      {/* 资源占用面板 */}
      {resource && (
        <div className="bg-zinc-900 rounded-lg p-3 flex flex-col gap-2 border border-zinc-800">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">{t('editor.metrics.resources')}</span>
            <span className="text-xs text-zinc-500">
              {resource.uptime > 0
                ? t('editor.metrics.uptime', {
                    minutes: Math.floor(resource.uptime / 60),
                    seconds: resource.uptime % 60,
                  })
                : ''}
            </span>
          </div>
          <ResourceBar label="CPU" value={resource.cpuPercent} max={100} color="#3b82f6" />
          <ResourceBar
            label={t('editor.metrics.memory')}
            value={resource.memoryMB}
            max={resource.memoryMB * 2}
            color="#22c55e"
          />
        </div>
      )}

      {/* 资源告警历史（有告警时显示） */}
      <AlertHistoryBlock />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 卡片 1: 消息处理速率 */}
        <div className="bg-zinc-900 rounded-lg p-4 flex flex-col gap-3 border border-zinc-800">
          <SummaryRow label={t('editor.metrics.msgRate')} value={current?.msgCount ?? 0} unit="msg/s" />
          <SvgLineChart
            values={msgVals}
            color="#3b82f6"
            fillColor="#3b82f6"
            maxValue={maxMsg}
            unit=" msg/s"
          />
        </div>

        {/* 卡片 2: 响应延迟（avg + p95 双线） */}
        <div className="bg-zinc-900 rounded-lg p-4 flex flex-col gap-3 border border-zinc-800">
          <SummaryRow label={t('editor.metrics.latency')} value={current?.avgLatency ?? 0} unit="ms" />
          <div className="flex gap-3">
            <LegendItem color="#f59e0b" label={t('editor.metrics.average')} />
            <LegendItem color="#ef4444" label="P95" />
          </div>
          <SvgLineChart
            values={avgLatVals}
            color="#f59e0b"
            fillColor="#f59e0b"
            maxValue={maxLat}
            extraLine={{ values: p95LatVals, color: '#ef4444' }}
            unit=" ms"
          />
        </div>

        {/* 卡片 3: 错误率 */}
        <div className="bg-zinc-900 rounded-lg p-4 flex flex-col gap-3 border border-zinc-800">
          <SummaryRow label={t('editor.metrics.errorRate')} value={current?.errorRate ?? 0} unit="%" />
          <SvgBarChart values={errVals} color="#ef4444" maxValue={maxErr} unit="%" />
        </div>
      </div>

      {!hasData && <EmptyState title={t('editor.metrics.empty')} description={t('editor.metrics.emptyHint')} />}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
});
