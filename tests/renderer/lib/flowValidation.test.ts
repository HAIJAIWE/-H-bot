// tests/renderer/lib/flowValidation.test.ts
import { describe, it, expect } from 'vitest'
import { canConnect } from '@renderer/lib/canvas/flowValidation'
import { NODE_CATALOG_V2 } from '@renderer/lib/nodeCatalog'

// kind 以契约层为准（10/18 起是 message_received / message_send；
// message_received / message_send 是更早的 Python 节点名，目录里已经查不到）
const onMessage = NODE_CATALOG_V2.find((s) => s.kind === 'message_received')!
const sendMessage = NODE_CATALOG_V2.find((s) => s.kind === 'message_send')!

describe('flowValidation', () => {
  it('控制流端口可连控制流端口', () => {
    expect(
      canConnect(
        { nodeId: 'n1', port: onMessage.outputs[0] },
        { nodeId: 'n2', port: sendMessage.inputs[0] }
      )
    ).toBe(true)
  })

  it('控制流端口不能连数据流端口', () => {
    expect(
      canConnect(
        { nodeId: 'n1', port: onMessage.outputs[0] },
        { nodeId: 'n2', port: sendMessage.inputs[1] }
      )
    ).toBe(false)
  })

  it('数据流端口可连同类型数据流端口', () => {
    // onMessage.outputs[1] = event (data); sendMessage.inputs[1] = text (data)
    expect(
      canConnect(
        { nodeId: 'n1', port: onMessage.outputs[1] },
        { nodeId: 'n2', port: sendMessage.inputs[1] }
      )
    ).toBe(true)
  })

  it('数据输入端口只能接收一条连线', () => {
    // 按 id 取端口：inputs 顺序会随节点配置项增减而变，写死下标会让用例悄悄测错端口
    const textInput = sendMessage.inputs.find((p) => p.id === 'text')!
    // existing 已占用 n2.text，再连应被拒绝
    const existing = [
      { id: 'e1', source: 'n1', sourcePort: 'event', target: 'n2', targetPort: 'text' }
    ]
    expect(
      canConnect(
        { nodeId: 'n3', port: onMessage.outputs[1] },
        { nodeId: 'n2', port: textInput },
        existing
      )
    ).toBe(false)
  })

  it('不能自连', () => {
    expect(
      canConnect(
        { nodeId: 'n1', port: onMessage.outputs[0] },
        { nodeId: 'n1', port: sendMessage.inputs[0] }
      )
    ).toBe(false)
  })
})
