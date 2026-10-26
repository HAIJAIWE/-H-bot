// tests/main/services/ai/fileReference.test.ts
//
// 第 58 批：`@` 文件引用的检索（主进程侧）。
// 钉住三条：①含 `/` 走 live 列目录、不含走有界索引；②排除目录/隐藏项/符号链接的边界；
// ③打分完全确定（同输入同顺序），且目录在同分时优先。
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describeMissingFileReferences,
  invalidateFileReferenceIndex,
  searchFileReferences,
} from '@main/services/ai/fileReference'
import { writeProjectFile } from '@main/services/fileOps'

async function touch(dir: string, rel: string): Promise<void> {
  const absolute = join(dir, rel)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, 'x', 'utf-8')
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-file-ref-'))
  await mkdir(join(dir, 'src', 'main'), { recursive: true })
  await mkdir(join(dir, 'docs'), { recursive: true })
  await mkdir(join(dir, 'lib'), { recursive: true })
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(join(dir, 'dist'), { recursive: true })
  await mkdir(join(dir, '.hidden'), { recursive: true })
  await touch(dir, 'src/a.ts')
  await touch(dir, 'src/b.ts')
  await touch(dir, 'src/main/index.ts')
  await touch(dir, 'docs/readme.md')
  await touch(dir, 'lib.ts')
  await touch(dir, 'my notes.txt')
  await touch(dir, 'node_modules/pkg/evil.js')
  await touch(dir, 'dist/bundle.js')
  await touch(dir, '.hidden/secret.ts')
  await touch(dir, '.env')
  invalidateFileReferenceIndex()
  return dir
}

let project = ''

beforeEach(async () => {
  project = await makeProject()
})

describe('空 query / 目录形态：live 列目录', () => {
  it('刚打 @（空 query）：列根目录，目录在前，排除 node_modules / dist / 隐藏项', async () => {
    const refs = await searchFileReferences(project, '')
    const paths = refs.map(r => r.path)
    expect(paths).toContain('src')
    expect(paths).toContain('docs')
    expect(paths).toContain('lib')
    expect(paths).toContain('lib.ts')
    expect(paths).not.toContain('node_modules')
    expect(paths).not.toContain('dist')
    expect(paths).not.toContain('.hidden')
    // 目录在前：第一个一定是目录
    expect(refs[0].kind).toBe('directory')
  })

  it('`src/`：列出 src 下、目录在前、kind 正确', async () => {
    const refs = await searchFileReferences(project, 'src/')
    expect(refs.map(r => [r.path, r.kind])).toEqual([
      ['src/main', 'directory'],
      ['src/a.ts', 'file'],
      ['src/b.ts', 'file'],
    ])
  })

  it('`src/m`：前缀过滤', async () => {
    const refs = await searchFileReferences(project, 'src/m')
    expect(refs.map(r => r.path)).toEqual(['src/main'])
  })

  it('隐藏项只在用户自己打了 `.` 之后出现', async () => {
    await expect(searchFileReferences(project, '.')).resolves.toContainEqual({
      path: '.hidden',
      kind: 'directory',
    })
    await expect(searchFileReferences(project, '.env')).resolves.toContainEqual({
      path: '.env',
      kind: 'file',
    })
  })

  it('越界（..）什么都不给，不抛', async () => {
    await expect(searchFileReferences(project, '../')).resolves.toEqual([])
    await expect(searchFileReferences(project, '../../etc/')).resolves.toEqual([])
  })

  it('有空格的文件名原样返回（插入时才加引号）', async () => {
    const refs = await searchFileReferences(project, 'my')
    expect(refs.map(r => r.path)).toContain('my notes.txt')
  })

  it('limit 生效（夹在 1..50）', async () => {
    await expect(searchFileReferences(project, 'src/', 1)).resolves.toHaveLength(1)
    await expect(searchFileReferences(project, 'src/', 0 as never)).resolves.toHaveLength(1)
  })
})

describe('全局 query：有界索引 + 五档打分', () => {
  it('basename 全等拿 1000 档，排最前', async () => {
    const refs = await searchFileReferences(project, 'a.ts')
    expect(refs[0].path).toBe('src/a.ts')
  })

  it('前缀/包含/全路径包含按档位排（确定性）', async () => {
    const first = await searchFileReferences(project, 'readme')
    const second = await searchFileReferences(project, 'readme')
    expect(first.map(r => r.path)).toEqual(second.map(r => r.path))
    expect(first[0].path).toBe('docs/readme.md')
  })

  it('同分时目录优先', async () => {
    const refs = await searchFileReferences(project, 'lib')
    expect(refs.slice(0, 2).map(r => [r.path, r.kind])).toEqual([
      ['lib', 'directory'],
      ['lib.ts', 'file'],
    ])
  })

  it('排除目录里的文件不参与全局检索', async () => {
    const refs = await searchFileReferences(project, 'evil')
    expect(refs).toEqual([])
    const dist = await searchFileReferences(project, 'bundle')
    expect(dist).toEqual([])
  })

  it('隐藏目录只在 query 自己带 `.` 时才可见', async () => {
    await expect(searchFileReferences(project, 'secret')).resolves.toEqual([])
    const hit = await searchFileReferences(project, '.hidden/secret')
    expect(hit.map(r => r.path)).toEqual(['.hidden/secret.ts'])
  })

  it('子序列命中（300 档）也能搜到', async () => {
    const refs = await searchFileReferences(project, 'srca')
    expect(refs.map(r => r.path)).toContain('src/a.ts')
  })
})

describe('索引缓存与护栏', () => {
  it('3 秒内复用快照：新建文件默认搜不到，invalidate 之后能搜到', async () => {
    await expect(searchFileReferences(project, 'brandnew')).resolves.toEqual([])
    await touch(project, 'brandnew.ts')
    await expect(searchFileReferences(project, 'brandnew')).resolves.toEqual([])
    invalidateFileReferenceIndex(project)
    const refs = await searchFileReferences(project, 'brandnew')
    expect(refs.map(r => r.path)).toEqual(['brandnew.ts'])
  })

  it('baseDir 给了就越界校验（项目在基准之外 → 抛）', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'qqbat-file-ref-outside-'))
    await expect(searchFileReferences(outside, '', 20, project)).rejects.toThrow()
  })

  /**
   * 写盘是索引失效的**唯一**口子：模型刚建完文件、用户紧接着 `@` 它，
   * 菜单里必须立刻有 —— 否则看起来像"没建成"。
   */
  it('writeProjectFile 写完立刻失效索引（不用调用方自己清）', async () => {
    await expect(searchFileReferences(project, 'justwritten')).resolves.toEqual([])
    await writeProjectFile(project, 'justwritten.ts', 'export const a = 1')
    const refs = await searchFileReferences(project, 'justwritten')
    expect(refs.map(r => r.path)).toEqual(['justwritten.ts'])
  })
})

describe('describeMissingFileReferences（@ 了不存在的路径先说一句）', () => {
  it('存在的路径不吭声；拼错的路径按行列出，并给出"先说找不到"的交代', () => {
    const note = describeMissingFileReferences(project, '把 @src/a.ts 和 @src/utl.ts 合一下')
    expect(note).toContain('- src/utl.ts')
    expect(note).not.toContain('src/a.ts')
    expect(note).toContain('不存在')
    expect(note).toContain('不要凭猜读别的文件当成它')
  })

  it('一个 @ 都没有 → 空串（系统提示里不会多出一个空段）', () => {
    expect(describeMissingFileReferences(project, '给机器人加个定时提醒')).toBe('')
  })

  it('全都在磁盘上 → 空串', () => {
    expect(describeMissingFileReferences(project, '看下 @src/a.ts')).toBe('')
  })

  it('越界路径不当"缺失"报（那种情况交给 read_file 的护栏，别像在教绕过）', () => {
    expect(describeMissingFileReferences(project, '看下 @../outside.ts')).toBe('')
  })

  it('最多列 max 条，且同一路径去重', () => {
    const text = '@a1.ts @a2.ts @a3.ts @a1.ts'
    const note = describeMissingFileReferences(project, text, 2)
    expect(note.split('\n').filter(line => line.startsWith('- '))).toHaveLength(2)
    expect(note).toContain('- a1.ts')
    expect(note).toContain('- a2.ts')
    expect(note).not.toContain('- a3.ts')
  })
})
