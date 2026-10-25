// tests/main/services/agent-core/toolRetention.test.ts
//
// 工具回执的省略提示：算法来自上游 retainer，措辞是本项目的（见 toolRetention.ts）。
// 关键的几条：省了多少要是真数、命令输出**留结尾**（报错在那）、提示不能凭空出现。
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retainEntries, streamOmittedNote } from '@main/services/agent-core/toolRetention'
import { CORE_TOOLS } from '@main/services/agent-core/core'

const tmpDirs: string[] = []
afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(tmpDirs.map(d => rm(d, { recursive: true, force: true })))
})

async function ws(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'qqbat-ret-'))
  tmpDirs.push(d)
  return d
}

describe('retainEntries：条目上限 + 精确省略数', () => {
  it('空表给空串（调用方自己决定"空目录"怎么说）', () => {
    expect(retainEntries([], 3)).toBe('')
  })

  it('没超上限：原样拼，不许多一句提示', () => {
    expect(retainEntries(['b/', 'a.txt'], 5)).toBe('b/\na.txt')
  })

  it('超上限：留前 N 个，提示里是**真数**（不是拿未过滤的条目数瞎减）', () => {
    expect(retainEntries(['a', 'b', 'c', 'd'], 2)).toBe(
      'a\nb\n…（还有 2 个没列；要看就再列那个子目录）',
    )
  })
})

describe('streamOmittedNote：命令输出被裁时把话说清', () => {
  it('没省略就没有提示', () => {
    expect(streamOmittedNote({ ok: true, code: 0, stdout: 'x', stderr: '' })).toBe('')
  })

  it('哪一路少了、少了多少字节、怎么拿中间那段', () => {
    const note = streamOmittedNote({
      ok: false,
      code: 1,
      stdout: 'a',
      stderr: 'b',
      stdoutOmitted: { kind: 'exact', count: 12000 },
      stderrOmitted: { kind: 'exact', count: 5 },
    })
    expect(note).toContain('stdout 省了 12000 字节')
    expect(note).toContain('stderr 省了 5 字节')
    expect(note).toContain('只保留开头与结尾')
    expect(note).toContain('收窄')
  })
})

describe('★ 真跑一条刷屏命令：留结尾、内存有界、提示接在工具回执后面', () => {
  it('20000 字节的 stdout/stderr：两头都在，中间被省，且说明白了', async () => {
    const dir = await ws()
    // 不许用 node -e（禁元字符），所以写个脚本再 node 它
    await writeFile(
      join(dir, 'big.js'),
      "process.stdout.write('H'.repeat(16000) + 'TAIL')\n" +
        "process.stderr.write('E'.repeat(16000) + 'ERRTAIL')\n",
      'utf-8',
    )
    const tool = CORE_TOOLS.find(t => t.name === 'run_command')!
    const out = String(
      await tool.run({ command: 'node big.js' }, { workspace: dir, gate: async () => true }),
    )
    // 开头与结尾都在（旧实现只有开头）
    expect(out.startsWith('H')).toBe(true)
    expect(out).toContain('TAIL')
    expect(out).toContain('ERRTAIL')
    // 中间确实被省了，而且说清了省多少
    expect(out).toContain('stdout 省了')
    expect(out).toContain('stderr 省了')
    // 没被整段塞进来（8000 字节窗口 + 提示，远小于 32k）
    expect(out.length).toBeLessThan(20000)
  })
})
