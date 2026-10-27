// tests/main/services/agent-core/terminalTools.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TERMINAL_TOOLS, killAllAgentTerminals } from '@main/services/agent-core/terminalTools'
import { mkdtemp as realMkdtemp } from 'node:fs/promises'

interface FakeToolContext {
  workspace: string
}

async function fakeRun(
  toolName: string,
  args: Record<string, unknown>,
  ctx: FakeToolContext,
): Promise<string> {
  const tool = TERMINAL_TOOLS.find(t => t.name === toolName)
  if (!tool) throw new Error(`工具未找到：${toolName}`)
  const result = await tool.run(args, ctx as any)
  if (typeof result === 'string') return result
  // ToolRunOutcome 形状：{ text, ok?, error? }
  return (result as any).text || (result as any).output || JSON.stringify(result)
}

describe.skipIf(process.platform !== 'win32')('★ terminalTools', () => {
  let testTmpDir: string

  beforeEach(async () => {
    testTmpDir = await realMkdtemp(join(tmpdir(), 'qqbat-tools-test-'))
  })

  afterEach(async () => {
    killAllAgentTerminals()
    // 清理测试目录
    try {
      await rm(testTmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('open→send→read→close 全链路', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    const openResult = await fakeRun('terminal_open', { cwd: '.', name: 'test1' }, ctx)
    expect(openResult).toContain('已打开')
    // Format: "会话 test1（term-t8p5be）已打开" - find term- followed by alphanumeric
    const match = openResult.match(/term-[a-zA-Z0-9]+/)
    const sessionId = match ? match[0] : null
    if (!sessionId) throw new Error(`Could not extract sessionId from open result: ${openResult}`)

    const sendResult = await fakeRun(
      'terminal_send',
      { sessionId, text: 'Write-Output "hello"' },
      ctx,
    )
    expect(sendResult).toContain('hello')

    const readResult = await fakeRun('terminal_read', { sessionId, cursor: 0 }, ctx)
    expect(readResult).toContain('hello')

    const closeResult = await fakeRun('terminal_close', { sessionId }, ctx)
    expect(closeResult).toContain('已关闭')

    // 再次访问应报 NO_SESSION
    const verifyClose = await fakeRun('terminal_send', { sessionId, text: 'echo test' }, ctx)
    expect(verifyClose).toContain('NO_SESSION')
  }, 25000)

  it('open 一个 cwd 越界（../..）→ 返回字符串含 OPEN_FAILED，不抛', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    const result = await fakeRun('terminal_open', { cwd: '../..' }, ctx)
    expect(result).toContain('OPEN_FAILED')
    // 会话数不应增加
    const list = await fakeRun('terminal_list', {}, ctx)
    expect(list).not.toContain('已打开')
  })

  it('会话超过 4 个 → 第 5 个返回 TOO_MANY_SESSIONS', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    for (let i = 0; i < 4; i++) {
      await fakeRun('terminal_open', { cwd: '.', name: `sess-${i}` }, ctx)
    }

    const fifth = await fakeRun('terminal_open', { cwd: '.', name: 'too-many' }, ctx)
    expect(fifth).toContain('TOO_MANY_SESSIONS')
  })

  it('terminal_read 未给 cursor 从 0 读、给了 cursor 只读增量', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    const openResult = await fakeRun('terminal_open', { cwd: '.', name: 'read-test' }, ctx)
    // Format: "会话 read-test（term-xxxxx）已打开" - find term- followed by alphanumeric
    const sessionId = openResult.match(/term-[a-zA-Z0-9]+/)?.[0]!

    const send1 = await fakeRun('terminal_send', { sessionId, text: 'Write-Output "first"' }, ctx)
    expect(send1).toContain('first')

    const readStart = await fakeRun('terminal_read', { sessionId }, ctx)
    expect(readStart).toContain('first')

    const send2 = await fakeRun('terminal_send', { sessionId, text: 'Write-Output "second"' }, ctx)
    expect(send2).toContain('second')

    const readAfter = await fakeRun('terminal_read', { sessionId, cursor: 0 }, ctx)
    expect(readAfter).toContain('first')
    expect(readAfter).toContain('second')
  }, 15000)

  it('terminal_list 前后：空 → 当前没有打开的终端会话。；开一个后含会话名与 id', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    const listEmpty = await fakeRun('terminal_list', {}, ctx)
    expect(listEmpty).toContain('当前没有打开的终端会话')

    const openResult = await fakeRun('terminal_open', { cwd: '.', name: 'list-test' }, ctx)
    const sessionId = openResult.match(/term-[a-z0-9]+/)?.[0]!

    const listWithOne = await fakeRun('terminal_list', {}, ctx)
    expect(listWithOne).toContain('list-test')
    expect(listWithOne).toContain(sessionId)
  }, 15000)

  it('不存在的 sessionId → NO_SESSION', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    const result = await fakeRun('terminal_read', { sessionId: 'non-existent-12345' }, ctx)
    expect(result).toContain('NO_SESSION')
  })

  it('别的 workspace 拿同一个 id → FOREIGN_SESSION', async () => {
    const workspace1 = await mkdtemp(join(testTmpDir, 'proj1-'))
    const workspace2 = await mkdtemp(join(testTmpDir, 'proj2-'))
    const ctx1: FakeToolContext = { workspace: workspace1 }
    const ctx2: FakeToolContext = { workspace: workspace2 }

    const openResult = await fakeRun('terminal_open', { cwd: '.', name: 'foreign-test' }, ctx1)
    const sessionId = openResult.match(/term-[a-z0-9]+/)?.[0]!

    const foreignResult = await fakeRun('terminal_send', { sessionId, text: 'echo test' }, ctx2)
    expect(foreignResult).toContain('FOREIGN_SESSION')
  }, 15000)

  it('terminal_close 后再 send → NO_SESSION', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    const openResult = await fakeRun('terminal_open', { cwd: '.', name: 'close-test' }, ctx)
    const sessionId = openResult.match(/term-[a-z0-9]+/)?.[0]!

    await fakeRun('terminal_close', { sessionId }, ctx)

    const afterClose = await fakeRun('terminal_send', { sessionId, text: 'echo test' }, ctx)
    expect(afterClose).toContain('NO_SESSION')
  }, 15000)

  it('输出超 MAX_RESULT_BYTES 被截断', async () => {
    const workspace = await mkdtemp(join(testTmpDir, 'proj-'))
    const ctx: FakeToolContext = { workspace }

    const openResult = await fakeRun('terminal_open', { cwd: '.', name: 'big-output' }, ctx)
    const sessionId = openResult.match(/term-[a-z0-9]+/)?.[0]!

    // 循环打大输出（注意不要太慢）
    const largeCmd = '$i = 0; while ($i -lt 4000) { $i++ ; Write-Output ("x" * 100) }'
    // 给足够长的超时和 idleMs，让命令真正跑完输出
    const bigResult = await fakeRun('terminal_send', { sessionId, text: largeCmd }, ctx)
    expect(bigResult).toContain('…（输出超过 256 KB，已截断）')
  }, 30000)

  it('approval(): terminal_open 返回 {kind:"tool"}、terminal_send 返回 {kind:"command"} 且 command 是 text 第一行', async () => {
    const ctx: FakeToolContext = { workspace: await mkdtemp(join(testTmpDir, 'proj-')) }

    const openApproval = TERMINAL_TOOLS.find(t => t.name === 'terminal_open')!.approval!
    const openReq = openApproval({ cwd: '.', name: 'test' }, ctx)
    expect(openReq).toEqual({
      kind: 'tool',
      tool: 'terminal_open',
      args: { cwd: '.', name: 'test' },
    })

    const sendApproval = TERMINAL_TOOLS.find(t => t.name === 'terminal_send')!.approval!
    const sendReq = sendApproval({ sessionId: 's1', text: 'Set-Location C:\\temp' }, ctx)
    expect(sendReq).toEqual({ kind: 'command', command: 'Set-Location C:\\temp' })
  })
})
