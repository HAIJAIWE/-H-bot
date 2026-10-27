// src/renderer/src/components/ai/declarativeAgentSurface.tsx
//
// **声明式智能体窗口**（第 73 批，P4 加载器 v1 的渲染端）。
//
// 外部窗口包只带清单（layout / parts / 文案），不带代码；这个组件是宿主的**通用画布**：
// 按清单把「标题 / 消息 / 输入」三件拼出来。数据全部来自 `AgentSurfaceContext`
// （第 70 批契约），不 import aiStore —— 和内置窗口守同一条纪律。
//
// 为什么不让外部包带 JS：渲染层进程里 eval 第三方代码 = 把整个应用交出去，
// `sandbox: true` 挡不住同进程的 React 树。可执行窗口等 P4b 的 worker 沙箱。
import { useSyncExternalStore } from 'react'
import type { AgentSurfaceContext } from '../../lib/ai/agentSurfaceContext'
import { windowPackagePartEnabled, type WindowPackageInfo } from '@shared/plugins/windowPackage'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

export interface DeclarativeAgentSurfaceProps {
  context: AgentSurfaceContext
  spec: WindowPackageInfo
}

/** 一条消息的窄版渲染：不追求与 ChatPanel 一样全，够看懂发生了什么即可 */
function MessageRow({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[92%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs leading-relaxed',
          isUser
            ? 'bg-blue-600 text-white'
            : role === 'system'
              ? 'bg-zinc-800/60 text-zinc-400'
              : 'bg-zinc-800 text-zinc-100',
        ].join(' ')}
      >
        {content.length > 1200 ? content.slice(0, 1200) + '…' : content}
      </div>
    </div>
  )
}

export function DeclarativeAgentSurface({ context, spec }: DeclarativeAgentSurfaceProps) {
  useLocaleSubscription()
  const snapshot = useSyncExternalStore(context.subscribe, context.getSnapshot, context.getSnapshot)

  const compact = spec.layout === 'compact'
  const showHeader = windowPackagePartEnabled(spec, 'header')
  const showMessages = windowPackagePartEnabled(spec, 'messages')
  const showComposer = windowPackagePartEnabled(spec, 'composer')

  const thread = snapshot.threads.find(item => item.id === snapshot.threadId)
  const title = thread?.title ?? spec.name
  const visible = compact ? snapshot.messages.slice(-20) : snapshot.messages

  const send = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || snapshot.streaming) return
    void context.actions.send(trimmed)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      {showHeader && (
        <div
          className={[
            'flex shrink-0 items-center justify-between border-b border-zinc-800',
            compact ? 'px-3 py-1.5' : 'px-4 py-2.5',
          ].join(' ')}
        >
          <div className="min-w-0">
            <div
              className={compact ? 'truncate text-xs font-medium' : 'truncate text-sm font-medium'}
            >
              {title}
            </div>
            <div className="truncate text-[10px] text-zinc-500">
              {spec.name} · {t('externalWindow.messageCount', { count: snapshot.messages.length })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {snapshot.streaming && (
              <button
                type="button"
                className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
                onClick={() => context.actions.stop()}
              >
                {t('ai.chat.stop')}
              </button>
            )}
          </div>
        </div>
      )}

      {snapshot.pendingApproval && (
        <div className="shrink-0 border-b border-amber-700/40 bg-amber-900/20 px-3 py-1.5 text-[10px] text-amber-300">
          {t('ai.approval.title', { tool: snapshot.pendingApproval.toolName })}
          <button
            type="button"
            className="ml-2 rounded bg-amber-600/30 px-1.5 py-0.5 hover:bg-amber-600/50"
            onClick={() => void context.actions.resolveApproval('allow')}
          >
            {t('ai.approval.allow')}
          </button>
          <button
            type="button"
            className="ml-1 rounded bg-zinc-700/60 px-1.5 py-0.5 hover:bg-zinc-700"
            onClick={() => void context.actions.resolveApproval('deny')}
          >
            {t('ai.approval.deny')}
          </button>
        </div>
      )}

      {showMessages && (
        <div
          className={[
            'min-h-0 flex-1 overflow-y-auto',
            compact ? 'space-y-2 p-2' : 'space-y-3 p-3',
          ].join(' ')}
        >
          {visible.length === 0 && (
            <p className="px-1 pt-6 text-center text-[11px] text-zinc-500">
              {t('settings.aiProvider.agentSurface.empty')}
            </p>
          )}
          {visible.map((message, index) => (
            <MessageRow key={index} role={message.role} content={message.content} />
          ))}
        </div>
      )}

      {showComposer && (
        <form
          className={['shrink-0 border-t border-zinc-800', compact ? 'p-2' : 'p-3'].join(' ')}
          onSubmit={event => {
            event.preventDefault()
            const field = event.currentTarget.elements.namedItem('message')
            if (!(field instanceof HTMLTextAreaElement)) return
            send(field.value)
            field.value = ''
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              name="message"
              rows={compact ? 1 : 2}
              placeholder={t('ai.chat.placeholder')}
              className="min-h-8 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs outline-none placeholder:text-zinc-600 focus:border-zinc-500"
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send(event.currentTarget.value)
                  event.currentTarget.value = ''
                }
              }}
            />
            <button
              type="submit"
              disabled={snapshot.streaming}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('ai.send')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
