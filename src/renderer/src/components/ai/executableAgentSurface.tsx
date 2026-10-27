// src/renderer/src/components/ai/executableAgentSurface.tsx
//
// **可执行窗口的宿主**（第 74 批，P4b-1）。
//
// 第三方包只带一份自包含 JS（`entry`），主进程把源码读成字符串，这里用
// `new Worker(Blob, { type: 'module' })` 跑起来：
//   - worker 里没有 DOM、没有 Node、import 无从解析（Blob 没有 base URL）→ 只能收发消息
//   - 宿主发：init（版本 + 能力白名单）、context（只读会话快照）
//   - worker 回：view（受限视图树，宿主画）、command（宿主按白名单执行）
//
// 组件本身不碰 store，只吃 `AgentSurfaceContext`（第 70 批契约），与内置窗口同纪律。
// 失败一律"降级成一块提示"，不让一个坏包把右栏打白。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { AgentSurfaceContext } from '../../lib/ai/agentSurfaceContext'
import {
  buildInitMessage,
  interpretEntryMessage,
  toEntryContext,
  type EntryMessageInterpretation,
} from '../../lib/ai/executableProtocol'
import type { WindowPackageInfo } from '@shared/plugins/windowPackage'
import type { WindowView, WindowViewCommand, WindowViewNode } from '@shared/plugins/windowView'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

/** 主进程读入口源码的返回（preload 桥的形状）；注入是为了测试不依赖 window */
export type WindowEntryFetch = (
  id: string,
) => Promise<{ ok: boolean; data?: { source: string; byteLength: number }; error?: string }>

export interface ExecutableAgentSurfaceProps {
  context: AgentSurfaceContext
  spec: WindowPackageInfo
  loadEntry: WindowEntryFetch
}

/** 视图树 → React。只认白名单节点（校验已在 interpretEntryMessage 里做过）。 */
function ViewNode({
  node,
  onCommand,
}: {
  node: WindowViewNode
  onCommand: (command: WindowViewCommand, payload?: string) => void
}) {
  switch (node.type) {
    case 'stack':
      return (
        <div
          className="flex flex-col"
          style={{
            gap: node.gap === 'sm' ? 4 : node.gap === 'lg' ? 16 : node.gap === 'md' ? 8 : 6,
          }}
        >
          {node.children.map((child, index) => (
            <ViewNode key={index} node={child} onCommand={onCommand} />
          ))}
        </div>
      )
    case 'header':
      return (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{node.title}</div>
          {node.subtitle && (
            <div className="truncate text-[10px] text-zinc-500">{node.subtitle}</div>
          )}
        </div>
      )
    case 'text':
      return (
        <p
          className={[
            'whitespace-pre-wrap break-words text-xs leading-relaxed',
            node.muted ? 'text-zinc-500' : 'text-zinc-200',
          ].join(' ')}
        >
          {node.content}
        </p>
      )
    case 'message':
      return (
        <div className={node.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
          <div
            className={[
              'max-w-[92%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs leading-relaxed',
              node.role === 'user'
                ? 'bg-blue-600 text-white'
                : node.role === 'system'
                  ? 'bg-zinc-800/60 text-zinc-400'
                  : 'bg-zinc-800 text-zinc-100',
            ].join(' ')}
          >
            {node.content}
          </div>
        </div>
      )
    case 'list':
      return (
        <ul className="flex flex-col gap-1">
          {node.items.map((item, index) => {
            const clickable = item.command !== undefined
            return (
              <li key={index}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (item.command) onCommand(item.command, item.payload)
                  }}
                  className={[
                    'w-full rounded border px-2 py-1 text-left text-xs',
                    clickable
                      ? 'border-zinc-700 hover:bg-zinc-800'
                      : 'cursor-default border-transparent',
                    item.active ? 'border-blue-600/60 bg-blue-950/40' : '',
                  ].join(' ')}
                >
                  <span className="block truncate">{item.title}</span>
                  {item.detail && (
                    <span className="block truncate text-[10px] text-zinc-500">{item.detail}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )
    case 'button':
      return (
        <button
          type="button"
          disabled={node.disabled}
          onClick={() => onCommand(node.command, node.payload)}
          className={[
            'rounded px-2 py-1 text-xs',
            node.primary
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800',
            node.disabled ? 'cursor-not-allowed opacity-40' : '',
          ].join(' ')}
        >
          {node.label}
        </button>
      )
    case 'divider':
      return <div className="border-t border-zinc-800" />
    case 'empty':
      return <p className="py-6 text-center text-[11px] text-zinc-500">{node.text}</p>
    default:
      return null
  }
}

export function ExecutableAgentSurface({ context, spec, loadEntry }: ExecutableAgentSurfaceProps) {
  useLocaleSubscription()
  const snapshot = useSyncExternalStore(context.subscribe, context.getSnapshot, context.getSnapshot)
  const [view, setView] = useState<WindowView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  const capabilities = useMemo(() => spec.capabilities ?? [], [spec])

  // 命令执行：worker 只能请求，宿主决定做什么（与 declarative 窗口同一套 actions）
  const runCommand = useMemo(
    () =>
      (command: WindowViewCommand, payload?: string): void => {
        switch (command) {
          case 'send-message': {
            const text = (payload ?? '').trim()
            if (text) void context.actions.send(text)
            return
          }
          case 'stop':
            context.actions.stop()
            return
          case 'select-thread':
            if (payload) void context.actions.switchThread(payload)
            return
        }
      },
    [context],
  )

  useEffect(() => {
    let disposed = false
    let worker: Worker | null = null
    let objectUrl: string | null = null
    let unsubscribe: (() => void) | null = null

    const teardown = (): void => {
      unsubscribe?.()
      unsubscribe = null
      worker?.terminate()
      worker = null
      workerRef.current = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = null
    }

    void (async () => {
      try {
        const result = await loadEntry(spec.id)
        if (disposed) return
        if (!result.ok || !result.data) {
          setError(result.error ?? t('externalWindow.entryReadFailed'))
          return
        }
        objectUrl = URL.createObjectURL(new Blob([result.data.source], { type: 'text/javascript' }))
        worker = new Worker(objectUrl, { type: 'module', name: `window-package:${spec.id}` })
        workerRef.current = worker
        worker.onmessage = event => {
          const interpretation: EntryMessageInterpretation = interpretEntryMessage(
            event.data,
            capabilities,
          )
          if (interpretation.kind === 'view') setView(interpretation.view)
          if (interpretation.kind === 'command')
            runCommand(interpretation.command, interpretation.payload)
        }
        worker.onerror = event => {
          setError(event.message || t('externalWindow.workerError'))
        }
        worker.postMessage(buildInitMessage(spec))

        const sendContext = (): void => {
          worker?.postMessage({ type: 'context', context: toEntryContext(context.getSnapshot()) })
        }
        unsubscribe = context.subscribe(sendContext)
        if (disposed) return
        sendContext()
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    })()

    return () => {
      disposed = true
      teardown()
    }
  }, [spec, capabilities, context, loadEntry, runCommand])

  // 快照变化时刷新外部包头部计数（与声明式窗口一致：让用户知道接的是同一份会话）
  const thread = snapshot.threads.find(item => item.id === snapshot.threadId)

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{thread?.title ?? spec.name}</div>
          <div className="truncate text-[10px] text-zinc-500">
            {spec.name} · {t('externalWindow.messageCount', { count: snapshot.messages.length })}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="rounded border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {t('externalWindow.failed', { reason: error })}
          </p>
        ) : view ? (
          <ViewNode node={view.root} onCommand={runCommand} />
        ) : (
          <p className="py-6 text-center text-[11px] text-zinc-500">
            {t('externalWindow.loading')}
          </p>
        )}
      </div>
    </div>
  )
}
