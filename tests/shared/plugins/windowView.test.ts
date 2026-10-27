// tests/shared/plugins/windowView.test.ts
//
// 第 74 批：可执行窗口的视图协议。宿主只认白名单节点，且深度/数量/文本都有上限——
// 这些断言钉的是"第三方 worker 失控时宿主不会跟着失控"。
import { describe, expect, it } from 'vitest'
import {
  WINDOW_VIEW_MAX_DEPTH,
  WINDOW_VIEW_MAX_NODES,
  WINDOW_VIEW_MAX_TEXT,
  validateWindowView,
} from '../../../src/shared/plugins/windowView'

describe('validateWindowView（第 74 批）', () => {
  it('合法的标题 + 文本 + 列表视图原样通过', () => {
    const result = validateWindowView({
      root: {
        type: 'stack',
        gap: 'md',
        children: [
          { type: 'header', title: '标题', subtitle: '副标题', 未知字段: '丢弃' },
          { type: 'text', content: '正文', muted: true },
          {
            type: 'list',
            items: [
              { title: '一项', detail: '细节', active: true },
              { title: '二项', command: 'select-thread', payload: 't1' },
            ],
          },
          { type: 'divider' },
        ],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.view.root).toEqual({
      type: 'stack',
      gap: 'md',
      children: [
        { type: 'header', title: '标题', subtitle: '副标题' },
        { type: 'text', content: '正文', muted: true },
        {
          type: 'list',
          items: [
            { title: '一项', detail: '细节', active: true },
            { title: '二项', command: 'select-thread', payload: 't1' },
          ],
        },
        { type: 'divider' },
      ],
    })
  })

  it('根节点类型不认识 → 整体拒绝（给出 issues）', () => {
    const result = validateWindowView({ root: { type: 'script', content: 'alert(1)' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.join('\n')).toContain('未知节点类型')
  })

  it('子节点里的未知类型被丢掉，视图其余部分照画（不白屏）', () => {
    const result = validateWindowView({
      root: {
        type: 'stack',
        children: [
          { type: 'text', content: '留下' },
          { type: 'iframe', src: 'x' },
        ],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.view.root).toEqual({
      type: 'stack',
      children: [{ type: 'text', content: '留下' }],
    })
  })

  it('嵌套超过上限 → 深出的节点被丢弃', () => {
    let node: Record<string, unknown> = { type: 'text', content: '底' }
    for (let i = 0; i <= WINDOW_VIEW_MAX_DEPTH; i += 1) {
      node = { type: 'stack', children: [node] }
    }
    const result = validateWindowView({ root: node })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.join('\n')).toContain('嵌套超过')
  })

  it('节点数超过上限 → 记 issue 并停住（不再往深处展开）', () => {
    const children = Array.from({ length: WINDOW_VIEW_MAX_NODES + 10 }, (_, i) => ({
      type: 'text',
      content: '第 ' + i + ' 条',
    }))
    const result = validateWindowView({ root: { type: 'stack', children } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.join('\n')).toContain('节点数超过')
  })

  it('文本超长 → 截断到上限并记 issue（而不是整棵视图作废）', () => {
    const long = 'x'.repeat(WINDOW_VIEW_MAX_TEXT + 50)
    const result = validateWindowView({ root: { type: 'text', content: long } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.join('\n')).toContain('超过')
    if (result.view.root.type !== 'text') throw new Error('unexpected')
    expect(result.view.root.content.length).toBe(WINDOW_VIEW_MAX_TEXT)
  })

  it('按钮里的未知命令 → 该节点被丢弃', () => {
    const result = validateWindowView({
      root: { type: 'button', label: '危险', command: 'exec-shell' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.join('\n')).toContain('未知动作')
  })

  it('不是对象 → 明确拒绝', () => {
    expect(validateWindowView('view').ok).toBe(false)
    expect(validateWindowView(null).ok).toBe(false)
  })
})
