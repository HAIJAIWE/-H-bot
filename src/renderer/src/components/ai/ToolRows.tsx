// src/renderer/src/components/ai/ToolRows.tsx
//
// **工具行**：运行中的一行（`ToolCallCard`）与"这一轮干了什么"的折叠列表（`ToolTrace`）。
//
// 从 ChatPanel 拆出来（2026-10-18）：那个文件已经贴着 fileGrowth 的增长预算，
// 而这两块是**自成一体的展示件** —— 不碰发送、不碰会话状态，搬出去风险最低。
//
// 工具事件都渲染在这里：主进程循环发来的 toolCall 行与历史回放是同一套消息形状
// （见 docs/ai/agent-core-wiring.md §9）。
import { useState } from 'react'
import { Button } from '../ui/Button'
import { t } from '../../i18n'
import { toolLabel } from '@shared/ai/toolLabels'
import { runningText, settledFallbackText, summarizeToolResult } from '@shared/ai/toolSummary'
import { useLocaleSubscription } from '../../stores/i18nStore'
import type { ToolCallRecord, ToolTraceEntry } from '../../stores/aiStore'
import { getToolPresenter, toolResultText } from '../../lib/ai/toolPresenters'

/**
 * 契约形状来自 `@shared/ai/toolPresentation`（跨进程唯一来源）。
 * 运行时仍做窄化：认不出的形状一律当"没有契约"→ 回退现状。
 */
import type { ToolPresentation as ToolPresentationView } from '@shared/ai/toolPresentation'

/** 工具记录可能带呈现契约（事件链路透传；目前的 aiStore 还没保存这个字段） */
type PresentableToolCall = ToolCallRecord & { presentation?: unknown }

function isResultKind(v: unknown): v is NonNullable<ToolPresentationView['resultKind']> {
  return v === 'text' || v === 'diff' || v === 'files' || v === 'json'
}

/** 运行时窄化：IPC 载荷是 unknown，只认契约里认识的形状 */
function presentationOf(call: ToolCallRecord): ToolPresentationView | undefined {
  const raw = (call as PresentableToolCall).presentation
  if (!raw || typeof raw !== 'object') return undefined
  const fields = raw as Record<string, unknown>
  const label = typeof fields.label === 'string' && fields.label ? fields.label : undefined
  const icon = typeof fields.icon === 'string' && fields.icon ? fields.icon : undefined
  const resultKind = isResultKind(fields.resultKind) ? fields.resultKind : undefined
  const presenter =
    typeof fields.presenter === 'string' && fields.presenter ? fields.presenter : undefined
  if (!label && !icon && !resultKind && !presenter) return undefined
  return {
    ...(label ? { label } : {}),
    ...(resultKind ? { resultKind } : {}),
    ...(presenter ? { presenter } : {}),
    ...(icon ? { icon } : {}),
  }
}

/**
 * 按呈现契约渲染工具结果：**先查呈现器注册表**（presenter 名优先于 resultKind），
 * 查不到就回退原始文本 —— 呈现器是增强，缺了不能把内容弄丢。
 * 内置的 'diff' / 'files' 由 lib/ai/toolPresenters.tsx 在模块加载时注册。
 */
function ToolResultView({
  result,
  presentation,
}: {
  result: unknown
  presentation?: ToolPresentationView
}): React.ReactNode {
  const name = presentation?.presenter ?? presentation?.resultKind
  const presenter = name ? getToolPresenter(name) : undefined
  if (presenter) return presenter(result)
  return (
    <pre className="text-xs text-zinc-400 bg-zinc-800/40 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto mt-0.5">
      {toolResultText(result)}
    </pre>
  )
}

/** 失败分类/动作的展示名（键是字面量，i18n 闸门能扫到） */
function failureLabels(): Record<string, string> {
  return {
    permission_denied: t('ai.tool.failure.code.permissionDenied'),
    cancelled: t('ai.tool.failure.code.cancelled'),
    timeout: t('ai.tool.failure.code.timeout'),
    not_found: t('ai.tool.failure.code.notFound'),
    invalid_args: t('ai.tool.failure.code.invalidArgs'),
    upstream_error: t('ai.tool.failure.code.upstreamError'),
    unknown: t('ai.tool.failure.code.unknown'),
  }
}

function actionLabels(): Record<string, string> {
  return {
    approve: t('ai.tool.failure.action.approve'),
    retry: t('ai.tool.failure.action.retry'),
    change_args: t('ai.tool.failure.action.changeArgs'),
    switch_model: t('ai.tool.failure.action.switchModel'),
  }
}

export function ToolCallCard({ call }: { call: ToolCallRecord }) {
  useLocaleSubscription()
  const [expanded, setExpanded] = useState(false)
  // 呈现契约（缺省 = 没有：行头回退工具名标签，结果回退原始 pre）
  const presentation = presentationOf(call)
  const FAILURE_LABEL = failureLabels()
  const ACTION_LABEL = actionLabels()

  /** 一个中性圆点：运行中脉冲、失败红、其余灰 —— 过程不该用颜色抢戏 */
  const dot = (() => {
    switch (call.status) {
      case 'running':
        return 'bg-zinc-300 animate-pulse'
      case 'error':
        return 'bg-red-500'
      case 'aborted':
        return 'bg-zinc-500'
      default:
        return 'bg-zinc-600'
    }
  })()

  // 目标值：优先文件/命令/节点这类「一眼看出干了啥」的参数
  const target = String(
    call.args?.path ??
      call.args?.filePath ??
      call.args?.filename ??
      call.args?.command ??
      call.args?.nodeKind ??
      call.args?.kind ??
      '',
  ).slice(0, 80)

  return (
    <div className="mt-1">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left font-mono text-[11px] leading-5 text-zinc-400 hover:text-zinc-200"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="shrink-0 text-zinc-300">
          {presentation?.icon ? presentation.icon + ' ' : ''}
          {presentation?.label ?? toolLabel(call.name)}
        </span>
        {/*
         * 摘要占位固定一个：运行中是「运行中」+ 微光，结束后换成结果摘要（退出码/体积/行数），
         * 拿不到摘要就退回「已完成」。这样同一位置只讲一件事，不会出现「已完成 + 已完成」的重复。
         */}
        {call.status === 'running' || call.status === 'pending' ? (
          <span className="shrink-0 animate-pulse text-zinc-400">{runningText()}</span>
        ) : (
          <span
            className={call.status === 'error' ? 'shrink-0 text-red-400' : 'shrink-0 text-zinc-500'}
          >
            {summarizeToolResult(call.name, call.result) ?? settledFallbackText()}
          </span>
        )}
        {target && <span className="truncate text-zinc-600">{target}</span>}
        <span
          className={`ml-auto shrink-0 text-zinc-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 pt-1">
          {call.failure && (
            <p className="mb-1 text-xs text-red-300">
              {t('ai.tool.failure.title')}：{FAILURE_LABEL[call.failure.code] ?? call.failure.code}
              {call.failure.actions.length > 0 && (
                <>
                  {' · '}
                  {t('ai.tool.failure.suggest')}：
                  {call.failure.actions.map(a => ACTION_LABEL[a] ?? a).join(' / ')}
                </>
              )}
            </p>
          )}
          <pre className="text-xs text-zinc-400 bg-zinc-800/40 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
            {JSON.stringify(call.args, null, 2)}
          </pre>
          {call.result !== undefined && (
            <div className="mt-1">
              <span className="text-xs text-zinc-500">{t('ai.tool.result')}</span>
              <ToolResultView result={call.result} presentation={presentation} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── 这一轮"干了什么"（随消息长期可见，可折叠） ────────── */

/**
 * 真机诉求原话（2026-10-06）："不知道他的工作干了什么？还有为啥完事后那个绿色会消失？"
 *
 * 在此之前工具卡片只挂在**最新一条消息**上，下一次发送就把它们清掉了 —— 于是
 * "它刚查了 8 个节点定义"在界面上消失得无影无踪。现在工具调用随消息存下来：
 * 默认一行摘要（`🔧 8 次工具调用：list_nodes ×7、read_flow ×1`），点开是逐条卡片。
 */
export function ToolTrace({ trace }: { trace: ToolTraceEntry[] }) {
  useLocaleSubscription()
  const [expanded, setExpanded] = useState(false)

  const counts = new Map<string, number>()
  for (const entry of trace) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  const detail = [...counts.entries()]
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join('、')

  return (
    <div className="mt-1 w-full">
      <Button
        variant="ghost"
        size="sm"
        className="w-full flex items-center gap-2 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span
          className={`text-zinc-600 text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="truncate">{t('ai.tool.trace', { count: trace.length, detail })}</span>
      </Button>
      {expanded && (
        <div className="space-y-1">
          {trace.map(entry => (
            <ToolCallCard
              key={entry.id}
              call={{
                id: entry.id,
                name: entry.name,
                args: entry.args,
                // 痕迹里不会有 pending（那是运行中的临时态）
                status: entry.status === 'pending' ? 'done' : entry.status,
                result: entry.result,
                timestamp: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
