// tests/main/services/triggerMatcherButton.test.ts
//
// button_clicked 触发器的输出契约。
// 官方 INTERACTION_CREATE 现在由 eventBus 翻译成 notice:interaction，
// 但「按钮响应」节点要靠 interaction_id 回执 —— 匹配器不把这个键吐出来，
// 画布上接好线也是空值（这正是之前互动链路看起来"接了一半"的原因）。
import { describe, it, expect } from 'vitest'
import { matchTrigger } from '@main/runtime/triggerMatcher'

function node(config: Record<string, unknown> = {}) {
  return {
    id: 'trg-1',
    type: 'trigger',
    data: { nodeKind: 'button_clicked', config },
  } as never
}

function interactionEvent(over: Record<string, unknown> = {}) {
  return {
    post_type: 'notice',
    notice_type: 'interaction',
    sub_type: '11',
    user_id: '10001',
    group_id: 'group-openid-1',
    interaction_id: 'interaction-abc',
    interaction_type: 11,
    button_id: 'btn-1',
    button_data: '/签到',
    ...over,
  } as never
}

describe('button_clicked：interaction_id 必须透出', () => {
  it('按 button_data 命中时带 interaction_id', () => {
    const out = matchTrigger(node({ button_data: '/签到' }), interactionEvent())
    expect(out).toMatchObject({
      interaction_id: 'interaction-abc',
      button_id: 'btn-1',
      button_data: '/签到',
      user_id: '10001',
      group_id: 'group-openid-1',
    })
  })

  it('按 button_id 命中时也带 interaction_id', () => {
    const out = matchTrigger(node({ button_data: 'btn-1' }), interactionEvent())
    expect(out?.interaction_id).toBe('interaction-abc')
  })

  it('按钮不匹配 → null', () => {
    expect(matchTrigger(node({ button_data: '/别的' }), interactionEvent())).toBeNull()
  })
})
