// src/renderer/src/components/ai/TurnOutlineLauncher.tsx
//
// 「回合目录」的**接线件**（第 56 批 Phase C）：抽屉只负责画，这里负责它需要的界面态
// 与那一个入口按钮。
//
// ## 为什么不把这三份态摊进 ChatPanel
//
// 抽屉要的东西全是**纯界面态**：开着没、视口在第几轮、跳转后高亮多久。
// ChatPanel 已经 1600+ 行（fileGrowth 闸门在管），把"某个功能的局部状态"再堆进去，
// 下次想拆就得多读一遍上下文。所以 ChatPanel 只留一行 JSX，其余在这里。
//
// ## 锚点口径
//
// `AgentTranscript` 给每条消息容器挂 `id=ai-msg-<消息下标>`；`buildTurnOutline` 的
// `userIndex` 就是同一个下标 —— 两边都不做映射，跳转直接拼 id。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ListOrdered } from 'lucide-react'
import type { ChatMessageWithTrace } from '../../stores/aiStore'
import { buildTurnOutline, type TurnOutlineEntry } from '@shared/ai/turnOutline'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'
import { TurnOutlineDrawer } from './TurnOutlineDrawer'

/**
 * 跳过去之后高亮多久（毫秒）。
 *
 * 1.5 秒：够眼睛找到落点，又不至于一直亮着让人以为"这条被选中了"。
 * 与抽屉无关 —— 抽屉点完就收起来了，高亮留在消息流上。
 */
const HIGHLIGHT_MS = 1500

/** 判定"这条消息的顶边已经越过滚动容器顶边"时给的容差（像素），避免刚好贴边时来回跳 */
const TOP_TOLERANCE = 4

export interface TurnOutlineLauncherProps {
  /** 与 ChatPanel 的 `messages` 同一个数组（锚点与目录都按同一套下标算） */
  messages: readonly ChatMessageWithTrace[]
  /** 消息滚动容器（ChatPanel 的 `listRef`）—— 求"视口顶部在第几轮"要用它 */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 跳转落点的高亮回调；null = 撤掉高亮 */
  onHighlight: (index: number | null) => void
}

/**
 * 视口顶部那一轮的用户消息下标。
 *
 * 取"最后一条顶边已越过容器顶部的第 N 轮"而不是"离顶部最近的那条消息"：
 * 一轮的正文（助手回答）比用户气泡长得多，按消息取会把高亮在**同一轮内**来回甩。
 * 一条都没越过（刚进对话）就取第一轮 —— 抽屉的高亮永远落在一个存在的轮上。
 */
function findActiveUserIndex(
  container: HTMLElement,
  outline: readonly TurnOutlineEntry[],
): number | null {
  const first = outline[0]
  if (!first) return null
  const containerTop = container.getBoundingClientRect().top
  let active = first.userIndex
  for (const entry of outline) {
    const el = container.querySelector<HTMLElement>(`#ai-msg-${entry.userIndex}`)
    if (!el) continue
    if (el.getBoundingClientRect().top - containerTop <= TOP_TOLERANCE) active = entry.userIndex
    // 目录与消息顺序一致：一旦某轮还在视口下方，后面的也都还在下方
    else break
  }
  return active
}

export function TurnOutlineLauncher({
  messages,
  scrollRef,
  onHighlight,
}: TurnOutlineLauncherProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const outline = useMemo(() => buildTurnOutline(messages), [messages])
  const [open, setOpen] = useState(false)
  const [activeUserIndex, setActiveUserIndex] = useState<number | null>(null)
  const clearTimerRef = useRef<number | null>(null)

  // 卸载时收掉"1.5 秒后撤高亮"的计时器 —— 否则对话面板关掉后还会调一次 setState
  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  // 只在抽屉开着时监听滚动：关着的时候算"当前第几轮"没人看，白花滚动回调
  useEffect(() => {
    if (!open) return
    const container = scrollRef.current
    if (!container) return
    const update = (): void => setActiveUserIndex(findActiveUserIndex(container, outline))
    update()
    container.addEventListener('scroll', update, { passive: true })
    return () => container.removeEventListener('scroll', update)
  }, [open, outline, scrollRef])

  /** 点一轮：滚到那条消息，亮一下，1.5 秒后自动褪去 */
  const jumpTo = (userIndex: number): void => {
    // jsdom 里没有布局，真实浏览器里 scroll-mt-3 会留出顶部余量（见 AgentTranscript 的容器 class）
    document.getElementById(`ai-msg-${userIndex}`)?.scrollIntoView({ block: 'start' })
    setActiveUserIndex(userIndex)
    onHighlight(userIndex)
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null
      onHighlight(null)
    }, HIGHLIGHT_MS)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('ai.turnOutline.title')}
        aria-label={t('ai.turnOutline.title')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <ListOrdered size={14} />
      </button>
      <TurnOutlineDrawer
        open={open}
        messages={messages}
        activeUserIndex={activeUserIndex}
        onJump={jumpTo}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
