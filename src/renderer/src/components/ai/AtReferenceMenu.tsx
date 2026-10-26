// src/renderer/src/components/ai/AtReferenceMenu.tsx
//
// `@` 文件引用的候选浮层（第 58 批）。纯展示 + 鼠标交互：键盘（↑↓/Enter/Tab/Esc）
// 由输入框的 handleKeyDown 交给 useAtReference 处理，这里不抢焦点 —— 否则用户
// 打字打一半焦点跳进菜单，句子里就多出半截路径。
//
// 只显示**路径**（不显示大小/时间/内容摘要）：选中的目的就是插一段路径文本，
// 多给的信息都是噪音。
import { useEffect, useRef } from 'react'
import { FolderOpen } from 'lucide-react'
import type { FileReference } from '@shared/ai/fileReference'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

export interface AtReferenceMenuProps {
  items: FileReference[]
  activeIndex: number
  loading: boolean
  error: string | null
  unsupported: boolean
  query: string
  onHover: (index: number) => void
  onPick: (index: number) => void
}

export function AtReferenceMenu({
  items,
  activeIndex,
  loading,
  error,
  unsupported,
  query,
  onHover,
  onPick,
}: AtReferenceMenuProps): React.ReactNode {
  // 用了 t() 的组件必须订阅语言变化（i18n 闸门）
  useLocaleSubscription()
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])

  // 键盘移出可视区时把高亮行滚进来（jsdom 里没有 scrollIntoView，测试不受影响）
  useEffect(() => {
    const el = optionRefs.current[activeIndex]
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div
      role="listbox"
      aria-label={t('ai.at.title')}
      className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-xl overflow-hidden rounded-lg border border-zinc-700/70 bg-zinc-900 shadow-xl shadow-black/40"
    >
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-2.5 py-1.5 text-[11px] text-zinc-500">
        <span>{t('ai.at.title')}</span>
        <span className="shrink-0 pl-3">{t('ai.at.hint')}</span>
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {loading && <p className="px-1.5 py-1 text-[11px] text-zinc-600">{t('ai.at.searching')}</p>}
        {error !== null && (
          // 检索失败不能静默：否则用户会以为「项目里没有这个文件」
          <p role="alert" className="px-1.5 py-1 text-[11px] leading-tight text-amber-500/80">
            {t('ai.at.failed', { message: error })}
          </p>
        )}
        {!loading && error === null && items.length === 0 && (
          <p className="px-1.5 py-1 text-[11px] text-zinc-600">{t('ai.at.empty')}</p>
        )}
        {error === null &&
          items.map((item, index) => (
            <AtReferenceOption
              key={item.path}
              item={item}
              index={index}
              active={index === activeIndex}
              query={query}
              onHover={onHover}
              onPick={onPick}
              ref={el => {
                optionRefs.current[index] = el
              }}
            />
          ))}
        {unsupported && (
          <p role="alert" className="px-1.5 py-1 text-[11px] leading-tight text-amber-500/80">
            {t('ai.at.unsupported')}
          </p>
        )}
      </div>
    </div>
  )
}

interface AtReferenceOptionProps {
  item: FileReference
  index: number
  active: boolean
  query: string
  onHover: (index: number) => void
  onPick: (index: number) => void
  ref?: React.Ref<HTMLDivElement>
}

function AtReferenceOption({
  item,
  index,
  active,
  query,
  onHover,
  onPick,
  ref,
}: AtReferenceOptionProps): React.ReactNode {
  // 目录带 `/` 后缀：这一行插进句子后是 `@src/renderer/`，视觉上要和结果一致
  const label = item.kind === 'directory' ? `${item.path}/` : item.path
  const at = findHighlight(label, query)
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      title={label}
      // 点候选时保住输入框焦点：onMouseDown 的默认行为会把焦点挪到这一行
      onMouseDown={event => event.preventDefault()}
      onMouseEnter={() => onHover(index)}
      onClick={() => onPick(index)}
      className={`flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors ${
        active ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/60'
      }`}
    >
      {item.kind === 'directory' && (
        <FolderOpen size={12} className="shrink-0 text-zinc-500" aria-hidden="true" />
      )}
      <span className="min-w-0 truncate font-mono">
        {at < 0 ? (
          label
        ) : (
          <>
            {label.slice(0, at)}
            <mark className="rounded bg-amber-500/25 px-0.5 text-amber-200">
              {label.slice(at, at + query.length)}
            </mark>
            {label.slice(at + query.length)}
          </>
        )}
      </span>
    </div>
  )
}

/** 命中的首个下标（大小写不敏感；主进程也是大小写不敏感匹配）；没命中返回 -1 */
function findHighlight(label: string, query: string): number {
  if (query.length === 0) return -1
  return label.toLowerCase().indexOf(query.toLowerCase())
}
