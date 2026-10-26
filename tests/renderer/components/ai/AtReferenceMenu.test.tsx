// tests/renderer/components/ai/AtReferenceMenu.test.tsx
//
// 候选浮层的**纯展示**约定：路径文本、目录后缀/图标、query 高亮、四种状态
// （加载/空/失败/不可表达）以及鼠标交互回调。键盘在 useAtReference 里，见
// ChatPanelAtReference.test.tsx 的真实链路用例。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { FileReference } from '@shared/ai/fileReference'
import { t } from '@renderer/i18n'
import { AtReferenceMenu } from '@renderer/components/ai/AtReferenceMenu'

afterEach(() => {
  cleanup()
})

const ITEMS: FileReference[] = [
  { path: 'src/renderer', kind: 'directory' },
  { path: 'src/main/index.ts', kind: 'file' },
]

function renderMenu(overrides: Partial<React.ComponentProps<typeof AtReferenceMenu>> = {}): void {
  render(
    <AtReferenceMenu
      items={ITEMS}
      activeIndex={0}
      loading={false}
      error={null}
      unsupported={false}
      query=""
      onHover={() => {}}
      onPick={() => {}}
      {...overrides}
    />,
  )
}

describe('AtReferenceMenu', () => {
  it('目录行带 / 后缀和文件夹图标；aria-selected 只标当前高亮项', () => {
    renderMenu()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
    expect(options[0].querySelector('svg')).not.toBeNull()
    expect(options[1].querySelector('svg')).toBeNull()
    expect(screen.getByText('src/renderer/')).toBeInTheDocument()
    expect(screen.getByText('src/main/index.ts')).toBeInTheDocument()
  })

  it('query 命中的一段用 <mark> 高亮（大小写不敏感）', () => {
    renderMenu({ query: 'MAI' })
    const mark = screen.getByText('mai')
    expect(mark.tagName).toBe('MARK')
    expect(mark.closest('[role="option"]')).toHaveTextContent('src/main/index.ts')
  })

  it('加载中显示 searching，不显示空态', () => {
    renderMenu({ items: [], loading: true })
    expect(screen.getByText(t('ai.at.searching'))).toBeInTheDocument()
    expect(screen.queryByText(t('ai.at.empty'))).not.toBeInTheDocument()
  })

  it('空候选显示空态', () => {
    renderMenu({ items: [] })
    expect(screen.getByText(t('ai.at.empty'))).toBeInTheDocument()
  })

  it('检索失败用 alert 报出来（含主进程给的 message）', () => {
    renderMenu({ items: [], error: 'boom' })
    expect(screen.getByRole('alert')).toHaveTextContent(t('ai.at.failed', { message: 'boom' }))
  })

  it('路径插不进来时给出原因', () => {
    renderMenu({ unsupported: true })
    expect(screen.getByRole('alert')).toHaveTextContent(t('ai.at.unsupported'))
  })

  it('鼠标悬停 / 点击把行号和动作交给父组件', () => {
    const onHover = vi.fn()
    const onPick = vi.fn()
    renderMenu({ onHover, onPick })

    fireEvent.mouseEnter(screen.getAllByRole('option')[1])
    expect(onHover).toHaveBeenCalledWith(1)

    fireEvent.click(screen.getAllByRole('option')[1])
    expect(onPick).toHaveBeenCalledWith(1)
  })
})
