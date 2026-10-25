// tests/renderer/components/ai/reasoningBubble.test.tsx
//
// **思考的两种形态**（2026-10-25 按 DSH 重排）：
// 历史轮的思考在 `ReasoningRow`（折叠一行、点开全文），运行中的思考也在 `ReasoningRow`（在 TurnProcess 里）。
// 流式正文 `StreamingBubble` 只管正文 + 光标 —— 思考不再由它渲染，否则"跑的时候"和"跑完以后"排版不一致。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { StreamingBubble } from '@renderer/components/ai/MessageBubble'
import { ReasoningRow } from '@renderer/components/ai/ReasoningRow'

afterEach(cleanup)

describe('★ 思考行（ReasoningRow）', () => {
  it('折叠时只有一行：标题 + 首行预览（点开才是全文）', () => {
    render(<ReasoningRow text={'第一行想法\n第二行细节'} />)
    expect(screen.getByText('思考')).toBeTruthy()
    expect(screen.getByText('第一行想法')).toBeTruthy()
    expect(screen.queryByText(/第二行细节/)).toBeNull()
  })

  it('点开显示全文', () => {
    render(<ReasoningRow text={'第一行想法\n第二行细节'} defaultOpen />)
    expect(screen.getByText(/第二行细节/)).toBeTruthy()
  })

  it('预览去掉 markdown 粗体标记（一行里不该出现 **）', () => {
    render(<ReasoningRow text={'**先确认**再动手'} />)
    expect(screen.getByText('先确认再动手')).toBeTruthy()
  })
})

describe('★ 流式正文（StreamingBubble）', () => {
  it('只渲染正文；思考由 TurnProcess 那一层出', () => {
    render(<StreamingBubble text="答案" />)
    expect(screen.getByText('答案')).toBeTruthy()
    expect(screen.queryByText('思考')).toBeNull()
  })
})
