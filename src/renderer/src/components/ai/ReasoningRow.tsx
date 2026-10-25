// src/renderer/src/components/ai/ReasoningRow.tsx
//
// **思考行**（对齐 DSH 的 `ReasoningRow`）：折叠时只占一行 —— 「思考」+ 首行灰字预览，
// 点开才是完整思考。为什么不用带边框的 <details> 灰框：每条回复都多一块盒子，一屏全是边框；
// DSH 的口径是「过程收成一行，结论才是正文」（见 docs/ai/agent-ui-dsh.md）。
import { useState } from 'react'
import { t } from '../../i18n'
import { useLocaleSubscription } from '../../stores/i18nStore'

/**
 * 折叠预览：第一行非空文字，去掉 markdown 的粗体标记。
 *
 * DSH 是 `replaceAll('**','')` 之后整段塞进一行；这里多两件事：**只取首行**
 * （思考动辄上千字，一行里塞不下）与**长度上限**（窄右栏 180px 下 96 字已经要横向溢出）。
 */
export function reasoningPreview(text: string, max = 96): string {
  const first =
    text
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) ?? ''
  const plain = first.replace(/\*\*/g, '').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

export function ReasoningRow({
  text,
  running = false,
  defaultOpen = false,
}: {
  /** 完整思考文本（可能很长） */
  text: string
  /** 还在流式产出：预览行带微光 */
  running?: boolean
  /** 第一次渲染就展开（当前轮用） */
  defaultOpen?: boolean
}): React.ReactNode {
  useLocaleSubscription()
  const [open, setOpen] = useState(defaultOpen)
  const preview = reasoningPreview(text)
  return (
    <div data-variant="think" data-state={running ? 'running' : 'ok'} data-expanded={open}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] leading-[22px] text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span aria-hidden="true" className="shrink-0 text-zinc-600">
          ◌
        </span>
        <span className="shrink-0">{t('ai.chat.reasoning')}</span>
        {!open && preview && (
          <span className={`min-w-0 truncate ${running ? 'animate-pulse' : ''}`}>{preview}</span>
        )}
        <span aria-hidden="true" className="ml-auto shrink-0 text-[10px] text-zinc-600">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="my-1 whitespace-pre-wrap break-words border-l border-zinc-800 pl-2 text-[12px] leading-5 text-zinc-400">
          {text}
        </div>
      )}
    </div>
  )
}
