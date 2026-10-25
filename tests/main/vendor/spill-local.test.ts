import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { sweepSpillRoots } from '@main/vendor/dsh/spill-local/cleanup'
import { saveTextFile } from '@main/vendor/dsh/spill-local/store'

// 溢出落盘与清扫的机械行为（搬自 DSH spill-local，见 docs/ai/agent-core-wiring.md §44）。
// 这里只钉算法边界：私密权限、名字中和、独占写入、只删过期普通文件、从不跟随链接。

const DAY = 24 * 60 * 60 * 1000

let base = ''
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'qqbat-spill-vendor-'))
})
afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('saveTextFile：一个会话一个目录、私密权限、独占写入', () => {
  it('★ 写进 session-<12 hex> 子目录，返回路径与 UTF-8 字节数', async () => {
    const root = join(base, 'a')
    const saved = await saveTextFile({
      root,
      sessionId: 'project-one',
      suggestedName: 'out.txt',
      content: '你好世界',
    })
    expect(await readFile(saved.path, 'utf8')).toBe('你好世界')
    expect(saved.bytes).toBe(Buffer.byteLength('你好世界', 'utf8'))
    expect(basename(dirname(saved.path))).toMatch(/^session-[0-9a-f]{12}$/)
    expect(dirname(saved.path).startsWith(root)).toBe(true)
  })

  it('同一个会话/同一个建议名写两次 → 两个不同文件（随机前缀 + wx 不覆盖）', async () => {
    const root = join(base, 'b')
    const one = await saveTextFile({
      root,
      sessionId: 'p',
      suggestedName: 'same.txt',
      content: '1',
    })
    const two = await saveTextFile({
      root,
      sessionId: 'p',
      suggestedName: 'same.txt',
      content: '2',
    })
    expect(one.path).not.toBe(two.path)
    expect(await readFile(one.path, 'utf8')).toBe('1')
    expect(await readFile(two.path, 'utf8')).toBe('2')
  })

  it('不同会话 id → 不同子目录（项目之间不串）', async () => {
    const root = join(base, 'c')
    const one = await saveTextFile({ root, sessionId: 'p1', suggestedName: 'x.txt', content: '1' })
    const two = await saveTextFile({ root, sessionId: 'p2', suggestedName: 'x.txt', content: '2' })
    expect(dirname(one.path)).not.toBe(dirname(two.path))
  })

  it('★ 名字里的 ../ 与绝对路径被压成一个平面文件名（不留分隔符、不是 . / ..）', async () => {
    const root = join(base, 'd')
    const saved = await saveTextFile({
      root,
      sessionId: 'p',
      suggestedName: '../../etc/passwd',
      content: 'x',
    })
    expect(dirname(dirname(saved.path))).toBe(root)
    expect(basename(saved.path)).not.toContain('/')
    // 分段里的 `.` 是允许字符，所以 `..` 会原样留在名字里；关键是**分隔符**被编码，
    // 整段仍是一个平面文件名（上一条已断言它就在会话目录里）。
    expect(basename(saved.path).slice(13)).toBe('..~002F..~002Fetc~002Fpasswd')
    const dot = await saveTextFile({ root, sessionId: 'p', suggestedName: '..', content: 'x' })
    expect(basename(dot.path)).toMatch(/^[0-9a-f]{12}-/)
  })

  it('POSIX 上目录 0700、文件 0600（内容可能含凭据）', async () => {
    if (process.platform === 'win32') return
    const root = join(base, 'e')
    const saved = await saveTextFile({ root, sessionId: 'p', suggestedName: 'x.txt', content: 'x' })
    const dirMode = (await stat(dirname(saved.path))).mode & 0o777
    const fileMode = (await stat(saved.path)).mode & 0o777
    expect(dirMode).toBe(0o700)
    expect(fileMode).toBe(0o600)
  })
})

describe('sweepSpillRoots：只删过期的普通文件，从不跟随链接', () => {
  it('★ 30 天前的文件删掉、刚写的保留；清空后的会话目录删掉，但根目录不动', async () => {
    const root = join(base, 'f')
    const old = await saveTextFile({
      root,
      sessionId: 'keep',
      suggestedName: 'old.txt',
      content: 'old',
    })
    const oldDate = new Date(Date.now() - 30 * DAY)
    await utimes(old.path, oldDate, oldDate)
    const fresh = await saveTextFile({
      root,
      sessionId: 'keep',
      suggestedName: 'fresh.txt',
      content: 'new',
    })

    await sweepSpillRoots({
      roots: [{ path: root, pruneWhenEmpty: false }],
      cutoffMs: Date.now() - 7 * DAY,
      warn: () => {},
    })

    expect(await exists(old.path)).toBe(false)
    expect(await exists(fresh.path)).toBe(true)
    expect(await exists(root)).toBe(true)
  })

  it('会话目录被清空后删掉；根目录里无关的 session-backup 与散落文件一律不碰', async () => {
    const root = join(base, 'g')
    await mkdir(join(root, 'session-0123456789ab'), { recursive: true })
    const stray = join(root, 'session-0123456789ab', 'stale.txt')
    await writeFile(stray, 'stale', 'utf8')
    const oldDate = new Date(Date.now() - 30 * DAY)
    await utimes(stray, oldDate, oldDate)
    await mkdir(join(root, 'session-backup'), { recursive: true })
    const backup = join(root, 'session-backup', 'keep.txt')
    await writeFile(backup, 'keep', 'utf8')
    await utimes(backup, oldDate, oldDate)
    const loose = join(root, 'loose.txt')
    await writeFile(loose, 'loose', 'utf8')
    await utimes(loose, oldDate, oldDate)

    await sweepSpillRoots({
      roots: [{ path: root, pruneWhenEmpty: false }],
      cutoffMs: Date.now() - 7 * DAY,
      warn: () => {},
    })

    expect(await exists(stray)).toBe(false)
    expect(await exists(join(root, 'session-0123456789ab'))).toBe(false)
    expect(await exists(backup)).toBe(true)
    expect(await exists(loose)).toBe(true)
    expect(await exists(root)).toBe(true)
  })

  it('会话目录里的符号链接既不删也不跟随（链接目标活着）', async () => {
    const root = join(base, 'h')
    const session = join(root, 'session-aaaaaaaaaaaa')
    await mkdir(session, { recursive: true })
    const target = join(base, 'h-target.txt')
    await writeFile(target, 'target', 'utf8')
    const oldDate = new Date(Date.now() - 30 * DAY)
    await utimes(target, oldDate, oldDate)
    try {
      await symlink(target, join(session, 'link.txt'))
    } catch {
      return // Windows 没开开发者模式时建不了链接：跳过而不是假绿
    }

    await sweepSpillRoots({
      roots: [{ path: root, pruneWhenEmpty: false }],
      cutoffMs: Date.now() - 7 * DAY,
      warn: () => {},
    })

    expect(await exists(join(session, 'link.txt'))).toBe(true)
    expect(await exists(target)).toBe(true)
  })

  it('根还不存在时静默返回，不创建目录、不抛错', async () => {
    const root = join(base, 'nope', 'ai-spill')
    await expect(
      sweepSpillRoots({
        roots: [{ path: root, pruneWhenEmpty: false }],
        cutoffMs: Date.now(),
        warn: () => {},
      }),
    ).resolves.toBeUndefined()
    expect(await exists(root)).toBe(false)
  })
})
