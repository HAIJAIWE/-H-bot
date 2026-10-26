// tests/shared/ai/fileReference.test.ts
//
// 第 58 批：`@` 文件引用的纯文本口径（对照 DSH `dsh-file-reference`）。
// 钉住：只在光标正好落在 @token 末尾时触发；邮箱不触发；插入只插路径、不插内容；
// 目录的引号故意不闭合（要继续下钻）；路径含引号/控制字符时宁可不插。
import { describe, it, expect } from 'vitest'
import {
  FILE_REFERENCE_MAX_RESULTS,
  FILE_REFERENCE_PROMPT,
  applyFileReferencePick,
  findActiveFileReferenceQuery,
  formatFileReferenceMention,
  parseFileReferenceMentions,
} from '@shared/ai/fileReference'

describe('findActiveFileReferenceQuery：光标处有没有 @token', () => {
  it('行首的裸形态', () => {
    expect(findActiveFileReferenceQuery('@src/a', 6)).toEqual({
      query: 'src/a',
      start: 0,
      quoted: false,
    })
  })

  it('空白之后的裸形态（前面有正文也行）', () => {
    const text = '看看 @src/a'
    expect(findActiveFileReferenceQuery(text, text.length)).toEqual({
      query: 'src/a',
      start: 3,
      quoted: false,
    })
  })

  it('刚打一个 @：query 是空串（要能列出当前目录）', () => {
    expect(findActiveFileReferenceQuery('@', 1)).toEqual({ query: '', start: 0, quoted: false })
  })

  it('邮箱不触发（@ 前面不是空白）', () => {
    expect(findActiveFileReferenceQuery('me@example.com', 14)).toBeNull()
  })

  it('光标不在 token 末尾 → 不触发（改中间一个字不该弹菜单）', () => {
    expect(findActiveFileReferenceQuery('@src/foo/bar.ts', 6)).toBeNull()
  })

  it('引号形态允许空格，未闭合也算合法', () => {
    // 未闭合：`@"旧的项目/a b` —— 还在输入中，必须能命中
    const text = '读 @"旧的项目/a b'
    expect(findActiveFileReferenceQuery(text, text.length)).toEqual({
      query: '旧的项目/a b',
      start: 2,
      quoted: true,
    })
  })

  it('引号形态里光标不在末尾 → 不触发', () => {
    const text = '读 @"a b.ts"'
    expect(findActiveFileReferenceQuery(text, 4)).toBeNull()
  })

  it('越界 / 非整数 caret 返回 null', () => {
    expect(findActiveFileReferenceQuery('@a', -1)).toBeNull()
    expect(findActiveFileReferenceQuery('@a', 9)).toBeNull()
    expect(findActiveFileReferenceQuery('@a', 1.5)).toBeNull()
  })
})

describe('formatFileReferenceMention：一条候选写进输入框的文本', () => {
  it('无空格文件 → @path', () => {
    expect(formatFileReferenceMention({ path: 'src/a.ts', kind: 'file' })).toBe('@src/a.ts')
  })

  it('有空格文件 → @"a b.ts"（成对闭合）', () => {
    expect(formatFileReferenceMention({ path: 'src/a b.ts', kind: 'file' })).toBe('@"src/a b.ts"')
  })

  it('目录带尾斜杠；有空格时引号故意不闭合', () => {
    expect(formatFileReferenceMention({ path: 'src', kind: 'directory' })).toBe('@src/')
    expect(formatFileReferenceMention({ path: '旧 目录', kind: 'directory' })).toBe('@"旧 目录/')
  })

  it('用户本来就打了引号 → 保持引号形态', () => {
    expect(formatFileReferenceMention({ path: 'src/a.ts', kind: 'file' }, true)).toBe('@"src/a.ts"')
  })

  it('路径含引号 / 控制字符 / 空 → null（不转义、不猜）', () => {
    expect(formatFileReferenceMention({ path: 'a"b.ts', kind: 'file' })).toBeNull()
    expect(formatFileReferenceMention({ path: 'a\u0007b.ts', kind: 'file' })).toBeNull()
    expect(formatFileReferenceMention({ path: '', kind: 'file' })).toBeNull()
  })
})

describe('applyFileReferencePick：替换 token 并算新光标', () => {
  it('settle 文件：补一个空格，光标在空格后', () => {
    const text = '看看 @src/a 再说'
    const active = { query: 'src/a', start: 3, quoted: false }
    const out = applyFileReferencePick(text, active, { path: 'src/abc.ts', kind: 'file' })
    expect(out).toEqual({ text: '看看 @src/abc.ts 再说', caret: 15, drill: false })
  })

  it('drill 目录：不补空格、菜单继续开', () => {
    const out = applyFileReferencePick(
      '@sr',
      { query: 'sr', start: 0, quoted: false },
      {
        path: 'src',
        kind: 'directory',
      },
      'drill',
    )
    expect(out).toEqual({ text: '@src/', caret: 5, drill: true })
  })

  it('settle 目录：不补空格（落定后通常直接发消息）', () => {
    const out = applyFileReferencePick(
      '@',
      { query: '', start: 0, quoted: false },
      {
        path: 'src',
        kind: 'directory',
      },
    )
    expect(out).toEqual({ text: '@src/', caret: 5, drill: false })
  })

  it('引号态：整个 @"..." 一起替换', () => {
    const text = '读 @"a b'
    const active = { query: 'a b', start: 2, quoted: true }
    const out = applyFileReferencePick(text, active, { path: 'a b.ts', kind: 'file' })
    expect(out?.text).toBe('读 @"a b.ts" ')
    expect(out?.caret).toBe(out?.text.length)
  })

  it('候选无法表达 → null（调用层保持原样）', () => {
    expect(
      applyFileReferencePick(
        '@a',
        { query: 'a', start: 0, quoted: false },
        {
          path: 'a"b',
          kind: 'file',
        },
      ),
    ).toBeNull()
  })
})

describe('parseFileReferenceMentions：已插入的 mention 再解析回来', () => {
  it('裸形态剥掉尾随中英标点', () => {
    expect(parseFileReferenceMentions('看 @src/a.ts，然后 @src/b.ts.')).toEqual([
      { path: 'src/a.ts', kind: 'file' },
      { path: 'src/b.ts', kind: 'file' },
    ])
  })

  it('尾斜杠 = 目录（path 不带尾斜杠）', () => {
    expect(parseFileReferenceMentions('@src/renderer/ 里有什么')).toEqual([
      { path: 'src/renderer', kind: 'directory' },
    ])
  })

  it('引号形态允许空格', () => {
    expect(parseFileReferenceMentions('@"旧 项目/a b.ts" 看一下')).toEqual([
      { path: '旧 项目/a b.ts', kind: 'file' },
    ])
  })

  it('邮箱不算 mention', () => {
    expect(parseFileReferenceMentions('me@example.com')).toEqual([])
  })
})

describe('FILE_REFERENCE_PROMPT / 上限', () => {
  it('插文件不插内容：说明里明确要模型自己 read_file', () => {
    expect(FILE_REFERENCE_PROMPT).toContain('use the read_file tool')
    expect(FILE_REFERENCE_PROMPT).toContain('do not claim to have inspected it')
  })

  it('上限与上游一致（20）', () => {
    expect(FILE_REFERENCE_MAX_RESULTS).toBe(20)
  })
})
