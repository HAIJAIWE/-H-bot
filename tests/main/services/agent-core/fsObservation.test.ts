// tests/main/services/agent-core/fsObservation.test.ts
//
// # 文件观察门（2026-10-26，第 55 批，对齐上游 fs/fs-observation-policy）
//
// 判定表（设计文档 §5.3）：
//   · 这一轮没读过 + 文件存在 → 拒绝
//   · 读过 + 读完之后没再变   → 允许
//   · 读过 + 读完之后又变了   → 拒绝
//   · 文件不存在              → 允许（新建/重建）
// 门外（默认关）必须保持第 54 批以前的既有行为：不读也能覆盖。
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FsObservationGate,
  NOT_OBSERVED_MESSAGE,
  STALE_OBSERVATION_MESSAGE,
} from '@main/services/agent-core/fsObservation'
import { CORE_TOOLS, runAgentLoop, type ToolCall } from '@main/services/agent-core/core'

let ws: string
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'qqbat-fsgate-'))
})

const gateOf = () => new FsObservationGate()

describe('★ FsObservationGate：判定表（单元）', () => {
  it('没读过 + 文件存在 → 拒绝', async () => {
    const file = join(ws, 'exists.txt')
    await writeFile(file, 'old', 'utf-8')
    const gate = gateOf()
    expect(gate.versionOf(file)).toBeUndefined()
    await expect(gate.assertWritable(file)).rejects.toThrow(NOT_OBSERVED_MESSAGE)
  })

  it('没读过 + 文件不存在 → 允许（新建）', async () => {
    await expect(gateOf().assertWritable(join(ws, 'new.txt'))).resolves.toBeUndefined()
  })

  it('读过 + 没再变 → 允许；版本被记下来', async () => {
    const file = join(ws, 'read.txt')
    await writeFile(file, 'old', 'utf-8')
    const gate = gateOf()
    await gate.noteRead(file)
    expect(gate.versionOf(file)?.size).toBe(3)
    await expect(gate.assertWritable(file)).resolves.toBeUndefined()
  })

  it('读过 + 读完之后又变了 → 拒绝（不许盖掉后来的改动）', async () => {
    const file = join(ws, 'stale.txt')
    await writeFile(file, 'old', 'utf-8')
    const gate = gateOf()
    await gate.noteRead(file)
    await writeFile(file, 'old + 用户在外面补了一段', 'utf-8')
    await expect(gate.assertWritable(file)).rejects.toThrow(STALE_OBSERVATION_MESSAGE)
  })

  it('noteWrite 更新版本：一次运行里可以连续写同一个文件', async () => {
    const file = join(ws, 'twice.txt')
    await writeFile(file, 'v1', 'utf-8')
    const gate = gateOf()
    await gate.noteRead(file)
    await writeFile(file, 'v2', 'utf-8')
    await gate.noteWrite(file)
    await expect(gate.assertWritable(file)).resolves.toBeUndefined()
  })
})

describe('★ 循环集成：write_file 与观察门', () => {
  /** 依次执行 scripts 里的每轮工具调用；轮空 = 收尾 */
  async function runScript(
    scripts: Array<Array<{ name: string; args: Record<string, unknown> }>>,
    fsObservation: boolean,
  ) {
    let round = 0
    return runAgentLoop({
      workspace: ws,
      tools: CORE_TOOLS,
      gate: async () => true,
      ...(fsObservation ? { fsObservation: true } : {}),
      model: async () => {
        const calls = scripts[round] ?? []
        round += 1
        if (calls.length === 0) return { text: 'done' }
        return {
          calls: calls.map((c, i) => ({
            id: `c${round}-${i}`,
            name: c.name,
            args: c.args,
          })) as ToolCall[],
        }
      },
      maxRounds: scripts.length + 1,
    })
  }

  it('★ 默认关：不读也能覆盖（第 54 批以前的既有行为）', async () => {
    const file = join(ws, 'x.txt')
    await writeFile(file, 'old', 'utf-8')
    const res = await runScript(
      [[{ name: 'write_file', args: { path: 'x.txt', content: 'new' } }]],
      false,
    )
    expect(res.toolResults[0].output).toContain('已写入')
    expect(await readFile(file, 'utf-8')).toBe('new')
  })

  it('★ 开启后：没读过就覆盖 → 拒绝，磁盘一字未动', async () => {
    const file = join(ws, 'x.txt')
    await writeFile(file, 'old', 'utf-8')
    const res = await runScript(
      [[{ name: 'write_file', args: { path: 'x.txt', content: 'new' } }]],
      true,
    )
    expect(res.toolResults[0].output).toContain(NOT_OBSERVED_MESSAGE)
    expect(await readFile(file, 'utf-8')).toBe('old')
  })

  it('★ 开启后：先读再写 → 成功', async () => {
    const file = join(ws, 'x.txt')
    await writeFile(file, 'old', 'utf-8')
    const res = await runScript(
      [
        [{ name: 'read_file', args: { path: 'x.txt' } }],
        [{ name: 'write_file', args: { path: 'x.txt', content: 'new' } }],
      ],
      true,
    )
    expect(res.toolResults[1].output).toContain('已写入')
    expect(await readFile(file, 'utf-8')).toBe('new')
  })

  it('★ 开启后：读完之后被外部改过 → 拒绝，外部改动保留', async () => {
    const file = join(ws, 'x.txt')
    await writeFile(file, 'old', 'utf-8')
    let round = 0
    const res = await runAgentLoop({
      workspace: ws,
      tools: CORE_TOOLS,
      gate: async () => true,
      fsObservation: true,
      model: async () => {
        round += 1
        if (round === 1)
          return { calls: [{ id: 'c1', name: 'read_file', args: { path: 'x.txt' } }] }
        if (round === 2) {
          // 模拟用户在两次工具调用之间手改了文件
          await writeFile(file, '用户在外面改的', 'utf-8')
          return {
            calls: [{ id: 'c2', name: 'write_file', args: { path: 'x.txt', content: 'new' } }],
          }
        }
        return { text: 'done' }
      },
      maxRounds: 3,
    })
    expect(res.toolResults[1].output).toContain(STALE_OBSERVATION_MESSAGE)
    expect(await readFile(file, 'utf-8')).toBe('用户在外面改的')
  })

  it('★ 开启后：写新文件不需要事先读', async () => {
    const file = join(ws, 'brand-new.txt')
    const res = await runScript(
      [[{ name: 'write_file', args: { path: 'brand-new.txt', content: 'hello' } }]],
      true,
    )
    expect(res.toolResults[0].output).toContain('已写入')
    expect(await readFile(file, 'utf-8')).toBe('hello')
  })
})
