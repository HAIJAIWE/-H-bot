// tests/shared/ai/threadExport.test.ts
//
// 第 57 批：线程导出 Markdown 的纯函数。
// 钉住三件事：文件名在 Windows 上真的能存、正文不会被内容里的 markdown 破坏、
// 「不该导出的东西」真的没被导出（reasoning / 工具参数）。
import { describe, it, expect } from 'vitest'
import {
  THREAD_EXPORT_MAX_ENTRIES,
  THREAD_EXPORT_MAX_ENTRY_CHARS,
  exportThreadFileName,
  renderThreadMarkdown,
} from '@shared/ai/threadExport'

const base = {
  title: '第五十七批探针',
  threadId: 'probe57-abc',
  projectName: '还原验证项目',
  exportedAtLabel: '2026-10-27 10:00:00',
}

describe('exportThreadFileName：Windows 上真的能存下来', () => {
  it('把 \\ / : * ? " < > | 换成下划线，并带线程 id 前 6 位', () => {
    expect(exportThreadFileName('a/b\\c:d*e?f"g<h>i|j', 'abc123def')).toBe(
      'a_b_c_d_e_f_g_h_i_j-abc123对话记录.md',
    )
  })

  it('标题为空 → 用「对话」兜底', () => {
    expect(exportThreadFileName('   ', 'abc123def')).toBe('对话-abc123对话记录.md')
  })

  it('标题以点/空格结尾时被去掉（Windows 不允许）', () => {
    expect(exportThreadFileName('标题... ', 'abc123def')).toBe('标题-abc123对话记录.md')
  })

  it('超长标题按码点截到 40', () => {
    const out = exportThreadFileName('标'.repeat(60), 'abc123def')
    expect(Array.from(out.split('-')[0]).length).toBe(40)
  })
})

describe('renderThreadMarkdown：结构与内容', () => {
  it('头信息带会话标识、项目、导出时间与规模', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好，有什么可以帮你' },
      ],
    })
    expect(md).toContain('# 第五十七批探针')
    expect(md).toContain('- 会话：`probe57-abc`')
    expect(md).toContain('- 项目：还原验证项目')
    expect(md).toContain('- 导出时间：2026-10-27 10:00:00')
    expect(md).toContain('- 规模：1 轮 · 2 条消息')
  })

  it('每一条用户消息开启新的一轮，助手消息跟着当前轮', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' },
        { role: 'user', content: '第二问' },
        { role: 'assistant', content: '第二答' },
      ],
    })
    expect(md).toContain('## 第 1 轮')
    expect(md).toContain('## 第 2 轮')
    expect(md.indexOf('第一答')).toBeLessThan(md.indexOf('## 第 2 轮'))
    expect(md.indexOf('第二答')).toBeGreaterThan(md.indexOf('## 第 2 轮'))
  })

  it('正文进引用块：内容里的 ## / - 不会变成文档结构', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [{ role: 'user', content: '## 这不是标题\n- 这不是列表' }],
    })
    expect(md).toContain('> ## 这不是标题')
    expect(md).toContain('> - 这不是列表')
  })

  it('正文里的空行也带 >（否则引用块会被切断）', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [{ role: 'user', content: '第一行\n\n第三行' }],
    })
    expect(md).toContain('> 第一行\n>\n> 第三行')
  })

  it('助手耗时以秒显示；工具行只写名称与状态', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [
        { role: 'user', content: '改一下' },
        {
          role: 'assistant',
          content: '改好了',
          turnMs: 12345,
          trace: [
            { name: 'read_file', status: 'done' },
            { name: 'write_file', status: 'error' },
          ],
        },
      ],
    })
    expect(md).toContain('**助手**（用时 12.3 秒）')
    expect(md).toContain('- 工具：read_file ✓ · write_file ✗')
  })

  it('attempt 行导出成明确的"没跑完"警告，并带原因', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [
        { role: 'user', content: '跑一下' },
        { role: 'attempt', content: '', reason: 'provider 超时' },
      ],
    })
    expect(md).toContain('> ⚠️ 这一轮没有跑完：provider 超时')
  })

  it('超长正文截断并标出「已截断」', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [{ role: 'user', content: '字'.repeat(THREAD_EXPORT_MAX_ENTRY_CHARS + 5) }],
    })
    expect(md).toContain('…（已截断）')
  })

  it(`超过 ${THREAD_EXPORT_MAX_ENTRIES} 条时截断并留尾注`, () => {
    const many = Array.from({ length: THREAD_EXPORT_MAX_ENTRIES + 3 }, () => ({
      role: 'user',
      content: '一句话',
    }))
    const md = renderThreadMarkdown({ ...base, entries: many })
    expect(md).toContain(`> 还有 3 条没有导出（单次上限 ${THREAD_EXPORT_MAX_ENTRIES} 条）。`)
  })

  it('空会话有明确说明，不是空文件', () => {
    const md = renderThreadMarkdown({ ...base, entries: [] })
    expect(md).toContain('> 这条会话还没有任何消息。')
  })

  it('reasoning 与工具参数不进导出（内部过程不外流）', () => {
    const md = renderThreadMarkdown({
      ...base,
      entries: [
        {
          role: 'assistant',
          content: '答案',
          // 故意塞进来：真实条目里有这些字段，导出必须看不见它们
          reasoning: '我先把 read_file 的参数拼出来……',
          trace: [
            {
              name: 'read_file',
              status: 'done',
              args: { path: 'C:\\secret.txt' },
              result: '机密内容',
            },
          ],
        } as never,
      ],
    })
    expect(md).not.toContain('我先把')
    expect(md).not.toContain('secret.txt')
    expect(md).not.toContain('机密内容')
    expect(md).toContain('- 工具：read_file ✓')
  })
})
