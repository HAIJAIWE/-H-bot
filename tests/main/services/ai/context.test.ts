// tests/main/services/ai/context.test.ts
//
// 2026-10-24 恢复注：原用例按 v3 节点目录断言（on_message / send_message / if_branch，
// 以及「入口:[控制]in 出口:[控制]out」这种全端口罗列格式）。v4 目录已改名
// （message_received / message_send / branch_if），系统提示也改成只列「非默认」控制端口
// （全端口目录实测 13,338 字符，会把别的段挤出预算，见 context.ts:317 的注释）。
// 这里按当前提示的真实形状重写，仍守住三件事：节点在、一句话在、非默认出口标出来。
import { describe, it, expect, beforeEach } from 'vitest'
import { buildSystemMessage } from '@main/services/ai/context'
import { getNodeRegistry } from '@main/nodes/registry'
import { registerAllBuiltinNodes } from '@main/nodes/builtin'

const baseInfo = {
  name: 'test',
  qq: '',
  adapter: '',
  model: '',
  projectPath: '/test'
}

describe('buildSystemMessage', () => {
  beforeEach(() => {
    registerAllBuiltinNodes(getNodeRegistry())
  })

  it('包含可用节点列表（v4 节点名）', async () => {
    const msg = await buildSystemMessage(baseInfo)
    expect(msg.content).toContain('可用节点')
    expect(msg.content).toContain('message_received')
    expect(msg.content).toContain('message_send')
    // 旧名字不该再出现在目录里（改名后残留会误导模型写旧 kind）。
    // 注意 `send_message` 不能当旧 kind 断言了：2026-10-24 内部动作名统一成
    // `send_message` / `delete_message` 后，它是**协议动作名**，由 context.ts 的
    // `describeProtocolApis()` 正当地写进提示；旧 v3 节点 kind 是 `send_message`，
    // 与它同名 —— 所以这里只断言不撞名的旧 kind。
    expect(msg.content).not.toContain('on_message')
    expect(msg.content).not.toContain('if_branch')
    expect(msg.content).not.toContain('switch_case')
    expect(msg.content).not.toContain('ai_tool_call')
  })

  it('包含节点 summary（一句话说明）', async () => {
    const msg = await buildSystemMessage(baseInfo)
    expect(msg.content).toContain('当收到聊天消息时触发')
  })

  it('包含 tempRef 使用约定', async () => {
    const msg = await buildSystemMessage(baseInfo)
    expect(msg.content).toContain('new_')
    expect(msg.content).toContain('tempRef')
  })

  it('控制端口：只标非默认出口（branch_if 的 true/false）', async () => {
    const msg = await buildSystemMessage(baseInfo)
    expect(msg.content).toMatch(/branch_if.*出口:.*\[控制\]true.*\[控制\]false/)
    // 默认 in/out 不再逐行罗列（省预算）：提示里另有「默认入口是 in、默认出口是 out/next」一句
    expect(msg.content).toContain('默认入口是 in')
    expect(msg.content).not.toMatch(/message_send.*入口:\[控制\]in/)
  })

  it('模型被明确要求用 list_nodes 查单个节点的字段与端口（不凭记忆猜）', async () => {
    const msg = await buildSystemMessage(baseInfo)
    expect(msg.content).toContain('list_nodes')
    expect(msg.content).toContain('不要凭记忆猜')
  })
})