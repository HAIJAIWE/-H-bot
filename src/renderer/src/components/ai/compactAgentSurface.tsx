// src/renderer/src/components/ai/compactAgentSurface.tsx
//
// 第 71 批：**示例窗口** —— 只吃第 70 批的 `AgentSurfaceContext`，不 import `useAiStore`。
//
// 两个用途：
//   1. 证明「第三方能写」：本文件只用公开契约 + i18n + 最小 tailwind，替换掉它不用动内核；
//   2. 当契约的活体守门员：`tests/guards/agentSurfaceContract.test.ts` 静态断言
//      本文件不出现 `stores/aiStore` / `useAiStore`，谁把私有状态当 API 谁就红。
//
// 刻意极简（最后 6 条消息 + 审批条 + 输入框），不是产品形态 —— 第三方窗口可以照它起步。
// 已知特权差异：它是**内置**窗口（和默认对话窗口一样在树内），将来 P4 外部窗口会被
// 放进沙箱，只能用契约、不能 import 任何渲染层模块 —— 本文件注释里不依赖树内特权。
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { registerAgentSurface } from '../../lib/ai/agentSurface'
import type { AgentSurfaceContext } from '../../lib/ai/agentSurfaceContext'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

const SNIPPET_LIMIT = 240
const RECENT_LIMIT = 6

function CompactAgentSurface({ context }: { context: AgentSurfaceContext }): ReactNode {
  useLocaleSubscription()
  const snapshot = useSyncExternalStore(context.subscribe, context.getSnapshot, context.getSnapshot)
  const [draft, setDraft] = useState('')
  const recent = snapshot.messages.slice(-RECENT_LIMIT)
  const activeThread = snapshot.threads.find(thread => thread.id === snapshot.threadId)
  const headerTitle = activeThread?.title ?? snapshot.threadId

  // 恢复历史：内置 ChatPanel 在自己的 effect 里做这件事，窗口一换就没人做了。
  // 这是**窗口级**兜底（示例窗口自己补），host 级恢复留到 P3 收口时做。
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const current = context.getSnapshot()
    if (current.messages.length === 0 && current.threads.length > 0) {
      void context.actions.switchThread(current.threadId)
    }
  }, [context])

  const submit = (): void => {
    const text = draft.trim()
    if (text.length === 0 || snapshot.streaming) return
    setDraft('')
    void context.actions.send(text)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-xs text-zinc-300">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-700/60 pb-2">
        <span className="truncate font-medium text-zinc-200">
          {headerTitle || t('settings.aiProvider.agentSurface.empty')}
        </span>
        <span className="shrink-0 text-zinc-500">
          {snapshot.running ? '●' : '○'} {snapshot.messages.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {recent.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={message.role === 'user' ? 'text-right' : ''}
          >
            <div
              className={`inline-block max-w-full rounded-md px-2 py-1 break-words whitespace-pre-wrap ${
                message.role === 'user'
                  ? 'bg-blue-600/30 text-blue-50'
                  : 'bg-zinc-800/70 text-zinc-300'
              }`}
            >
              {message.content.length > SNIPPET_LIMIT
                ? `${message.content.slice(0, SNIPPET_LIMIT)}…`
                : message.content}
            </div>
          </div>
        ))}
        {recent.length === 0 && (
          <div className="pt-6 text-center text-zinc-500">
            {t('settings.aiProvider.agentSurface.empty')}
          </div>
        )}
      </div>
      {snapshot.pendingApproval !== null && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <div className="mb-1 truncate text-amber-200">
            {t('settings.aiProvider.agentSurface.approval', {
              tool: snapshot.pendingApproval.toolName,
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void context.actions.resolveApproval('allow')}
              className="rounded-md bg-emerald-600/80 px-2 py-0.5 text-white hover:bg-emerald-600"
            >
              {t('ai.approval.allow')}
            </button>
            <button
              type="button"
              onClick={() => void context.actions.resolveApproval('deny')}
              className="rounded-md bg-zinc-700 px-2 py-0.5 text-zinc-200 hover:bg-zinc-600"
            >
              {t('ai.approval.deny')}
            </button>
          </div>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={t('ai.chat.placeholder')}
          className="min-h-0 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500"
        />
        {snapshot.streaming ? (
          <button
            type="button"
            onClick={() => context.actions.stop()}
            className="rounded-md border border-zinc-600 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
          >
            {t('ai.chat.stop')}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={draft.trim().length === 0}
            className="rounded-md bg-blue-600 px-2 py-1 text-white disabled:opacity-40"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}

/** 注册「紧凑窗口」示例；order=2000 排在默认窗口之后（不抢默认，但可在设置里选） */
export function registerCompactAgentSurface(): () => void {
  return registerAgentSurface({
    id: 'compact',
    order: 2000,
    label: () => t('settings.aiProvider.agentSurface.compact'),
    render: context => <CompactAgentSurface context={context} />,
  })
}
