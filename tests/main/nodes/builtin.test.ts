import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerAllBuiltinNodes } from '@main/nodes/builtin'
import { NodeRegistry } from '@main/nodes/registry'
import { logger } from '@main/services/logger'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'

// 恢复说明（2026-10-23）：这份用例原本写死「52 个内置节点」和 `send_message`，
// 那是 v3 目录的说法。v4 的目录（@shared/nodes/builtinCatalog → NODE_CATALOG_V2）
// 已把 `send_message` 合进 `message_send`、`ai_tool_call` 合进 `agent_chat`，节点数也随
// 分片目录增长。这里改成「注册数 == 目录长度 + 用当前 kind 断言」——否则每次加节点都要改数字。
describe('registerAllBuiltinNodes', () => {
  let registry: NodeRegistry

  beforeEach(() => {
    registry = new NodeRegistry()
  })

  it('把 NODE_CATALOG_V2 全量注册进 registry（数量与目录一致）', () => {
    registerAllBuiltinNodes(registry)
    expect(registry.listAll()).toHaveLength(NODE_CATALOG_V2.length)
    expect(NODE_CATALOG_V2.length).toBeGreaterThan(40)
    expect(registry.isBuiltinInitialized()).toBe(true)
  })

  it('重复调用是幂等的：不重复注册、不覆盖、不再打告警', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    registerAllBuiltinNodes(registry)
    const first = registry.find('message_send')
    registerAllBuiltinNodes(registry)
    expect(registry.listAll()).toHaveLength(NODE_CATALOG_V2.length)
    expect(registry.find('message_send')).toBe(first)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('重复注册'))).toEqual([])
    warn.mockRestore()
  })

  it('message_send 注册成功且有 sideEffects', () => {
    registerAllBuiltinNodes(registry)
    const send = registry.find('message_send')
    expect(send).toBeDefined()
    expect(send!.sideEffects).toContain('message_send')
  })

  it('http_request 暴露给 AI 工具', () => {
    registerAllBuiltinNodes(registry)
    const http = registry.find('http_request')
    expect(http!.exposedAsTool).toBe(true)
  })

  it('getToolExposedNodes 返回所有 exposedAsTool=true 的节点', () => {
    registerAllBuiltinNodes(registry)
    const tools = registry.getToolExposedNodes()
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.some((t) => t.kind === 'message_send')).toBe(true)
    expect(tools.some((t) => t.kind === 'http_request')).toBe(true)
  })
})