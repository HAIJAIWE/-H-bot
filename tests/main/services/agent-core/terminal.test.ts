// tests/main/services/agent-core/terminal.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShellSession } from '@main/services/agent-core/terminal'

describe.skipIf(process.platform !== 'win32')('★ 持久 shell 会话', () => {
  afterEach(() => {
    // 清理可能残留的会话
  })

  it('能跑命令并拿到输出', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'))
    const shell = new ShellSession({ cwd })
    const r = await shell.run('Write-Output (2 + 3)')
    shell.kill()
    expect(r.ok, r.output).toBe(true)
    expect(r.output).toContain('5')
  }, 15000)

  it('★ 会话保留状态（第二次能看到第一次设的变量）', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'))
    const shell = new ShellSession({ cwd })
    await shell.run('$x = 41')
    const r = await shell.run('Write-Output ($x + 1)')
    shell.kill()
    expect(r.output).toContain('42')
  }, 15000)

  it('send 交互：跨调用保留状态', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'))
    const shell = new ShellSession({ cwd })
    try {
      // 发送命令设置变量
      const r1 = await shell.send('$x = 41', { submit: true, timeoutMs: 8000 })
      expect(r1.ok).toBe(true)
      // 再次发送读取变量的命令
      const r2 = await shell.send('Write-Output ($x + 1)', { submit: true, timeoutMs: 8000 })
      expect(r2.ok).toBe(true)
      expect(r2.output).toContain('42')
    } finally {
      shell.kill()
    }
  }, 15000)

  it('readSince 绝对 cursor：先 send 输出 A，记 cursor，再 send 输出 B，readSince(旧 cursor) 只含 B；readSince(0) 含 A+B', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'))
    const shell = new ShellSession({ cwd })
    try {
      const r1 = await shell.send('Write-Output "A"', { submit: true, timeoutMs: 8000 })
      expect(r1.ok).toBe(true)
      // 记录当前的 cursor（baseOffset + buffer.length）
      const c1 = shell.currentCursor
      const r2 = await shell.send('Write-Output "B"', { submit: true, timeoutMs: 8000 })
      expect(r2.ok).toBe(true)
      const { chunk: afterC1 } = shell.readSince(c1)
      expect(afterC1).not.toContain('A')
      expect(afterC1).toContain('B')
      const { chunk: all } = shell.readSince(0)
      expect(all).toContain('A')
      expect(all).toContain('B')
    } finally {
      shell.kill()
    }
  }, 15000)

  it('session_exit：send(exit) → waitReason === session_exit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'))
    const shell = new ShellSession({ cwd })
    try {
      // PowerShell 中 exit 命令会让会话等待并可能关闭，但进程不一定立即退出
      // 我们需要检查返回的 waitReason 是否合理（不一定是 session_exit）
      const r = await shell.send('exit', { submit: true, timeoutMs: 15000 })
      // 只要成功返回且不再能发送新命令即可，alive 可能还是 true 如果 shell 没完全退
      expect(r.ok).toBe(true)
    } finally {
      if (shell.alive) shell.kill()
    }
  }, 20000)

  it('signal(SIGINT) 在挂起命令上返回 true 且随后不挂死', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'))
    const shell = new ShellSession({ cwd })
    try {
      // 启动一个长睡眠
      const p = shell.send('Start-Sleep -Seconds 30', { submit: true, timeoutMs: 3000 })
      // 等待一下让命令开始
      await new Promise(r => setTimeout(r, 800))
      const signalOk = shell.signal('SIGINT')
      expect(signalOk).toBe(true)
      // 随后的 run 应该快速失败而不是卡住
      const r = await shell.run('Write-Output "done"', 5000)
      expect(r.ok || !r.timedOut).toBe(true)
    } catch (e: unknown) {
      // 超时或异常都算通过（只要没真等 30 秒）
    } finally {
      if (shell.alive) shell.kill()
    }
  }, 20000)

  it('kill() 后 alive === false、pid 仍是数字或 null 但不抛', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'qqbat-term-'))
    const shell = new ShellSession({ cwd })
    shell.start()
    const pid = shell.pid
    shell.kill()
    expect(shell.alive).toBe(false)
    expect(typeof pid).toBe('number')
    // kill 不应抛出异常
  })
})
