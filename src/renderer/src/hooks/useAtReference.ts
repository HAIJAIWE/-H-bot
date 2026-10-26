// src/renderer/src/hooks/useAtReference.ts
//
// `@` 文件引用的**界面态**（第 58 批）：什么时候弹、候选从哪来、选中后怎么改文本。
//
// 语义全部在 `@shared/ai/fileReference`（纯函数，主进程/测试共用），这里只做三件事：
//   · 把「输入框内容 + 光标」翻成「当前在打的 @token」（`findActiveFileReferenceQuery`）；
//   · 防抖 120ms 后问主进程要候选（空 query 也问 = 列当前目录，与 DSH 一致）；
//   · 选中时用 `applyFileReferencePick` 算新文本/新光标，交给调用方 setState。
//
// Esc 只关菜单、不动文本：输入框的 Esc 本来是"清空"，清空用户刚打的 `@src/...`
// 属于最坏的一种"帮忙"。所以这里把 Esc 拦下来（onKeyDown 返回 true），
// 让调用方跳过自己的清空逻辑。
import { useEffect, useMemo, useState } from 'react'
import {
  FILE_REFERENCE_MAX_RESULTS,
  applyFileReferencePick,
  findActiveFileReferenceQuery,
  type FileReference,
} from '@shared/ai/fileReference'

/** 防抖窗口：每敲一个键就发 IPC 会白读目录；120ms 后只让最后一下发出 */
const SEARCH_DEBOUNCE_MS = 120

/** 选中后要写回输入框的内容 */
export interface AtReferenceApply {
  text: string
  caret: number
}

/** 只取键盘判断需要的字段：调用方传 React.KeyboardEvent 进来即可（不绑 DOM 细节） */
export interface AtReferenceKeyEvent {
  key: string
  shiftKey?: boolean
}

export interface UseAtReferenceOptions {
  /** 输入框当前文本（受控） */
  value: string
  /** 当前光标位置（`selectionStart`）；必须是**实时**的，否则菜单会在错误的位置弹 */
  caret: number
  /** 当前项目路径；没有项目就没有候选（空态会被 open 挡掉） */
  projectPath: string | undefined
  /** 选中一条候选后由调用方落进 state（含 requestAnimationFrame 设光标） */
  onApply: (next: AtReferenceApply) => void
}

export interface UseAtReferenceResult {
  /** 菜单是否显示（光标在 @token 末尾 + 没被 Esc 关掉 + 有项目） */
  open: boolean
  items: FileReference[]
  activeIndex: number
  loading: boolean
  /** 检索失败原文；`ipc-missing` = 界面与主进程版本不一致（桥不存在） */
  error: string | null
  /** 最近一次选中因路径不可表达（含引号/控制字符）而失败 —— 菜单据此显示 ai.at.unsupported */
  unsupported: boolean
  /** 当前查询（菜单用它做 `<mark>` 高亮） */
  query: string
  /** 返回 true = 已处理，调用方必须 preventDefault 且**不要**继续走发送/清空逻辑 */
  onKeyDown: (e: AtReferenceKeyEvent) => boolean
  /** 上下移动高亮（循环） */
  moveActive: (delta: number) => void
  /** 鼠标悬停到第 index 条 */
  hover: (index: number) => void
  /** 选中第 index 条：Enter/点击 = settle，目录 Tab/点击 = drill（插入后继续列该目录） */
  pick: (index?: number, action?: 'settle' | 'drill') => void
}

export function useAtReference({
  value,
  caret,
  projectPath,
  onApply,
}: UseAtReferenceOptions): UseAtReferenceResult {
  /** 光标处正在输入的 @token；null = 光标不在 token 末尾 */
  const active = useMemo(() => findActiveFileReferenceQuery(value, caret), [value, caret])
  const [items, setItems] = useState<FileReference[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  /** Esc 关掉菜单；文本或光标一变就恢复（用户继续在打这个引用） */
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
  }, [value, caret])

  useEffect(() => {
    if (!projectPath || active === null) {
      setItems(prev => (prev.length === 0 ? prev : []))
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    // 立刻进 loading：否则防抖窗口里会先闪一下「没有匹配的文件」
    setLoading(true)
    const timer = setTimeout(() => {
      void (async () => {
        const bridge = window.qqbat?.file?.searchReferences
        if (typeof bridge !== 'function') {
          setItems([])
          setError('ipc-missing')
          setLoading(false)
          return
        }
        try {
          const res = await bridge(projectPath, active.query, FILE_REFERENCE_MAX_RESULTS)
          // 查询已经变了（或组件卸载）：这次结果作废，别覆盖新结果
          if (cancelled) return
          if (res.ok && res.data) {
            setItems(res.data.references)
            setActiveIndex(0)
            setError(null)
            setUnsupported(false)
          } else {
            setItems([])
            setError(res.error ?? 'unknown')
          }
        } catch (e) {
          if (cancelled) return
          setItems([])
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, SEARCH_DEBOUNCE_MS)
    // cleanup = 新查询清旧计时器 + 卸载清计时器（同一处，不会漏）
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [projectPath, active])

  const open = projectPath !== undefined && active !== null && !dismissed

  const moveActive = (delta: number): void => {
    setActiveIndex(current => {
      if (items.length === 0) return 0
      return (current + delta + items.length) % items.length
    })
  }

  const hover = (index: number): void => setActiveIndex(index)

  const pick = (index: number = activeIndex, action: 'settle' | 'drill' = 'settle'): void => {
    const reference = items[index]
    if (!active || !reference) return
    const result = applyFileReferencePick(value, active, reference, action)
    // 路径不可表达（引号/控制字符）：不改文本，菜单里说清楚为什么
    if (result === null) {
      setUnsupported(true)
      return
    }
    setUnsupported(false)
    onApply({ text: result.text, caret: result.caret })
  }

  const onKeyDown = (e: AtReferenceKeyEvent): boolean => {
    if (!open) return false
    if (e.key === 'Escape') {
      setDismissed(true)
      return true
    }
    if (e.key === 'ArrowDown') {
      moveActive(1)
      return true
    }
    if (e.key === 'ArrowUp') {
      moveActive(-1)
      return true
    }
    // 这一轮搜索还没回来时，items 还是上一轮的结果：这时候插进去会插成过期路径。
    // 所以 Enter/Tab 先吞掉（不插、也不让它落到「发送」）—— 用户再按一次就有结果了。
    if (loading && (e.key === 'Enter' || e.key === 'Tab')) return true
    // 没有候选时把 Enter/Tab 还给输入框：没东西可插，用户是在"发这句话"
    if (items.length === 0) return false
    if (e.key === 'Enter') {
      pick()
      return true
    }
    if (e.key === 'Tab') {
      pick(activeIndex, items[activeIndex]?.kind === 'directory' ? 'drill' : 'settle')
      return true
    }
    return false
  }

  return {
    open,
    items,
    activeIndex,
    loading,
    error,
    unsupported,
    query: active?.query ?? '',
    onKeyDown,
    moveActive,
    hover,
    pick,
  }
}
