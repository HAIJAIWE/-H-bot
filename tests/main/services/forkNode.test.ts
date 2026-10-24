// tests/main/services/forkNode.test.ts
// 「复制内置节点」= 在项目 plugins/ 下生成一个 JS 插件包（10/18 基线形态）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { forkBuiltinNode } from '@main/services/flow/forkNode'

describe('forkBuiltinNode（JS 插件包）', () => {
  let projectPath: string

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'qqbat-fork-'))
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('从内置节点生成 plugins/plugin_custom-<名>_<名>/ 包', async () => {
    const res = await forkBuiltinNode(projectPath, 'message_send', 'my_send')

    expect(res.success).toBe(true)
    expect(res.newKind).toBe('plugin_custom-my_send_my_send')

    const dir = join(projectPath, 'plugins', 'custom-my_send')
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true)
    const indexJs = readFileSync(join(dir, 'index.js'), 'utf-8')
    // 节点 kind 必须是裸名：加载链会再拼一次包名前缀
    expect(indexJs).toContain("kind: \"my_send\"")
    // handler 是源码字符串，落在 index.js 里时内层引号被 JSON 转义
    expect(indexJs).toContain('ctx.callBuiltin(\\"message_send\\"')
  })

  it('newName 非法时报错且不落盘', async () => {
    const res = await forkBuiltinNode(projectPath, 'message_send', 'Bad-Name')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/newName|小写/)
    expect(existsSync(join(projectPath, 'plugins'))).toBe(false)
  })

  it('newName 是 JS 保留字时报错', async () => {
    const res = await forkBuiltinNode(projectPath, 'message_send', 'class')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/保留字/)
  })

  it('builtinKind 不存在时报错', async () => {
    const res = await forkBuiltinNode(projectPath, 'no_such_node', 'my_send')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/不存在/)
  })

  it('同一节点不能复制两次（包已存在）', async () => {
    const first = await forkBuiltinNode(projectPath, 'message_send', 'my_send')
    expect(first.success).toBe(true)
    const second = await forkBuiltinNode(projectPath, 'message_send', 'my_send')
    expect(second.success).toBe(false)
    expect(second.error).toMatch(/已存在/)
  })
})
