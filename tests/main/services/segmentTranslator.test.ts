// tests/main/services/segmentTranslator.test.ts
//
// 消息段翻译层（纯函数）。
//
// 这个文件守的是那条**静默失效**的回归：在它之前，image / record / face 等段
// 被 `extractText` 整段过滤掉，最后发出 `content: ''` 的空消息 —— 不报错、不告警。
// 所以下面的用例重点是「不能悄悄丢东西」：要么翻译成可发送的东西，要么进 unsupported。
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  translateSegments,
  normalizeSegments,
  attachmentsToSegments,
} from '../../../src/main/services/segmentTranslator'

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* 清理失败不影响断言 */
    }
  }
})

/** 造一个真实存在的临时文件，用于验证「本地文件被接受」的正向路径 */
function makeTempFile(name: string, content = 'x'): string {
  const dir = mkdtempSync(join(tmpdir(), 'qqbat-seg-'))
  tmpDirs.push(dir)
  const f = join(dir, name)
  writeFileSync(f, content)
  return f
}

const opts = {
  resolveOpenid: (uid: string) => (uid === '10001' ? 'OPENID_1' : undefined),
  resolveRefIdx: (v: string) => {
    if (v.startsWith('REFIDX_')) return v
    if (v === '100') return 'REFIDX_from_map'
    return ''
  },
}

describe('normalizeSegments', () => {
  it('数组原样返回', () => {
    const arr = [{ type: 'text', data: { text: 'a' } }]
    expect(normalizeSegments(arr, [])).toBe(arr)
  })

  it('单个段对象包成数组（message_op 的输出形状）', () => {
    const one = { type: 'image', data: { file: 'https://x/a.png' } }
    expect(normalizeSegments(one, [])).toEqual([one])
  })

  it('JSON 字符串解析成数组或单段', () => {
    expect(normalizeSegments('[{"type":"text","data":{"text":"a"}}]', [])).toHaveLength(1)
    expect(normalizeSegments('{"type":"text","data":{"text":"a"}}', [])).toHaveLength(1)
  })

  it('普通字符串当纯文本段', () => {
    expect(normalizeSegments('hello', [])).toEqual([{ type: 'text', data: { text: 'hello' } }])
  })

  it('看着像 JSON 但解析失败：降级为纯文本并留下 warning', () => {
    const warnings: string[] = []
    const out = normalizeSegments('{broken', warnings)
    expect(out).toEqual([{ type: 'text', data: { text: '{broken' } }])
    expect(warnings[0]).toContain('JSON 解析失败')
  })

  it('空值返回空数组', () => {
    expect(normalizeSegments(null, [])).toEqual([])
    expect(normalizeSegments('', [])).toEqual([])
    expect(normalizeSegments('   ', [])).toEqual([])
  })
})

describe('translateSegments：文本与 at', () => {
  it('text 段拼装', () => {
    const r = translateSegments(
      [
        { type: 'text', data: { text: '你好' } },
        { type: 'text', data: { text: '，世界' } },
      ],
      opts,
    )
    expect(r.text).toBe('你好，世界')
    expect(r.unsupported).toEqual([])
  })

  it('at 段映射到 openid 时输出 <@openid>', () => {
    const r = translateSegments([{ type: 'at', data: { qq: '10001' } }], opts)
    expect(r.text).toBe('<@OPENID_1>')
    expect(r.warnings).toEqual([])
  })

  it('at 段映射不到 openid 时降级为 @QQ号，并留下 warning（不静默）', () => {
    const r = translateSegments([{ type: 'at', data: { qq: '99999' } }], opts)
    expect(r.text).toBe('@99999')
    expect(r.warnings[0]).toContain('未映射到 openid')
  })

  it('at 段缺 qq 进 unsupported', () => {
    const r = translateSegments([{ type: 'at', data: {} }], opts)
    expect(r.unsupported[0]).toContain('at 段缺少 qq')
  })
})

describe('translateSegments：媒体段（BUG1 的核心）', () => {
  it('image 段翻译成 fileType=1 的媒体项', () => {
    const r = translateSegments([{ type: 'image', data: { file: 'https://x/a.png' } }], opts)
    expect(r.media).toEqual([{ fileType: 1, url: 'https://x/a.png' }])
    expect(r.unsupported).toEqual([])
  })

  it('record / video / file 各自映射到官方 file_type', () => {
    const r = translateSegments(
      [
        { type: 'record', data: { file: 'https://x/a.silk' } },
        { type: 'video', data: { file: 'https://x/a.mp4' } },
        { type: 'file', data: { file: 'https://x/a.zip', name: 'a.zip' } },
      ],
      opts,
    )
    expect(r.media).toEqual([
      { fileType: 3, url: 'https://x/a.silk' },
      { fileType: 2, url: 'https://x/a.mp4' },
      { fileType: 4, url: 'https://x/a.zip', fileName: 'a.zip' },
    ])
  })

  it('voice 是 record 的别名', () => {
    const r = translateSegments([{ type: 'voice', data: { file: 'https://x/a' } }], opts)
    expect(r.media[0].fileType).toBe(3)
  })

  it('真实存在的本地文件被接受（走分片上传，不再要求公网直链）', () => {
    const f = makeTempFile('a.png')
    const r = translateSegments([{ type: 'image', data: { file: f } }], opts)
    // 本地文件应当作为媒体进入发送队列，而不是被判为「发不出去」
    expect(r.unsupported).toEqual([])
    expect(r.media).toHaveLength(1)
    expect(r.media[0].fileType).toBe(1)
    expect(r.media[0].url).toBe(f)
  })

  it('不存在的本地路径进 unsupported 并说明两类合法来源', () => {
    // 关键：不能因为「看着像路径」就放行 —— 否则官方会拿一个拉不到的地址去转存，
    // 报回一个与真实原因无关的「下载原始文件失败」
    const r = translateSegments([{ type: 'image', data: { file: 'C:\\imgs\\a.png' } }], opts)
    expect(r.media).toEqual([])
    expect(r.unsupported[0]).toContain('http(s)')
    expect(r.unsupported[0]).toContain('本机存在')
  })

  it('媒体段缺 file/url 进 unsupported', () => {
    const r = translateSegments([{ type: 'image', data: {} }], opts)
    expect(r.unsupported[0]).toContain('缺少 file/url')
  })

  it('文本与图片混排：文本与媒体分开返回（官方一条消息装不下两种 msg_type）', () => {
    const r = translateSegments(
      [
        { type: 'text', data: { text: '看这个：' } },
        { type: 'image', data: { file: 'https://x/a.png' } },
      ],
      opts,
    )
    expect(r.text).toBe('看这个：')
    expect(r.media).toHaveLength(1)
  })
})

describe('translateSegments：引用与降级', () => {
  it('reply 段的 REFIDX 原样透传', () => {
    const r = translateSegments([{ type: 'reply', data: { id: 'REFIDX_abc' } }], opts)
    expect(r.reference).toBe('REFIDX_abc')
  })

  it('reply 段的消息 id 经映射表解析', () => {
    const r = translateSegments([{ type: 'reply', data: { id: '100' } }], opts)
    expect(r.reference).toBe('REFIDX_from_map')
  })

  it('reply 段解析不到 REFIDX 时进 unsupported（不能悄悄丢掉引用）', () => {
    const r = translateSegments([{ type: 'reply', data: { id: '404' } }], opts)
    expect(r.reference).toBe('')
    expect(r.unsupported[0]).toContain('找不到 REFIDX')
  })

  it('share 段降级为文本链接并留下 warning', () => {
    const r = translateSegments(
      [{ type: 'share', data: { url: 'https://x', title: '标题' } }],
      opts,
    )
    expect(r.text).toBe('标题 https://x')
    expect(r.warnings[0]).toContain('链接卡片')
  })

  it('face / poke / music / forward 进 unsupported', () => {
    const r = translateSegments(
      [
        { type: 'face', data: { id: '1' } },
        { type: 'poke', data: { qq: '1' } },
        { type: 'music', data: { type: '163', id: '1' } },
        { type: 'forward', data: { id: '1' } },
      ],
      opts,
    )
    expect(r.unsupported).toEqual(['face', 'poke', 'music', 'forward'])
    expect(r.text).toBe('')
    expect(r.media).toEqual([])
  })

  it('未知段类型进 unsupported', () => {
    const r = translateSegments([{ type: 'unknown_thing', data: {} }], opts)
    expect(r.unsupported).toEqual(['unknown_thing'])
  })

  it('非对象元素进 unsupported 而不是被丢掉', () => {
    const r = translateSegments(['plain-string'], opts)
    expect(r.unsupported).toHaveLength(1)
    expect(r.unsupported[0]).toContain('无法识别的段')
  })

  it('空数组返回空结果（调用方据此报「没有可发送的内容」）', () => {
    const r = translateSegments([], opts)
    expect(r).toEqual({ text: '', media: [], reference: '', unsupported: [], warnings: [] })
  })
})

describe('attachmentsToSegments', () => {
  it('按 content_type 前缀映射成对应段', () => {
    const segs = attachmentsToSegments([
      { contentType: 'image/png', url: 'https://x/a.png', width: 10, height: 20 },
      { contentType: 'video/mp4', url: 'https://x/a.mp4' },
      { contentType: 'voice', url: 'https://x/a.silk' },
      { contentType: 'file', url: 'https://x/a.zip', filename: 'a.zip', size: 9 },
    ])
    expect(segs.map((s) => s.type)).toEqual(['image', 'video', 'record', 'file'])
    expect(segs[0].data).toMatchObject({ file: 'https://x/a.png', width: 10, height: 20 })
    expect(segs[3].data).toMatchObject({ name: 'a.zip', size: 9 })
  })

  it('缺 url 的附件跳过（没有可用的下载地址）', () => {
    expect(attachmentsToSegments([{ contentType: 'image/png' }])).toEqual([])
  })

  it('非数组输入返回空', () => {
    expect(attachmentsToSegments(null)).toEqual([])
    expect(attachmentsToSegments('x')).toEqual([])
  })
})
