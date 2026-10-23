import { describe, it, expect } from 'vitest'
import { getHandler } from '@main/runtime/handlerRegistry'
import { PARAM_KEYS } from '@main/runtime/handlers/registry'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'

// 为什么有这个闸门（2026-10-24）：
// 目录（NODE_CATALOG_V2）、画布、注册表测试全绿，但运行期 `handlerRegistry` 是一份手写的
// 旧组合根，只装了 18 个节点 —— 另外 22 个（官方能力 7 + 文件 2 + 玩家数据 7 + 时间 3 +
// 上下文 3）在真跑时全是「找不到节点实现」。原有 builtin.test.ts 只断言 `NodeRegistry` 的
// 条数，抓不到「目录里有、运行期没有」这一类失配。
//
// 所以这里**直接对着目录逐节点问 getHandler**：目录说 execution==='handler' 的，运行期必须答得出。
describe('运行期 handler 覆盖（目录 ⇄ 组合根一致性）', () => {
  const handlerKinds = NODE_CATALOG_V2.filter((n) => n.execution === 'handler').map((n) => n.kind)

  it('目录里每个 execution=handler 的节点都能在运行期解析到 handler', () => {
    const missing = handlerKinds.filter((kind) => !getHandler(kind))
    expect(missing, `这些节点在目录里、运行期却没有 handler：${missing.join(', ')}`).toEqual([])
  })

  it('覆盖数量不塌方（防止组合根被换成空壳还显示全绿）', () => {
    expect(handlerKinds.length).toBeGreaterThan(50)
  })

  // 22 个曾经缺失的节点逐一点名 —— 少一个都会让这条用例变红（比只查总数更容易定位）。
  it('曾经漏装的 22 个节点逐个可解析', () => {
    for (const kind of [
      // 官方能力 / 互动
      'bot_info', 'join_approval', 'menu_config', 'panel_config', 'channel_op',
      'answer_interaction', 'battle_panel',
      // 文件
      'file_read', 'file_write',
      // 玩家数据
      'load_variable', 'save_variable', 'incr_variable', 'update_if_variable',
      'append_variable', 'delete_variable', 'exists_variable',
      // 时间
      'time_read', 'time_check', 'time_calc',
      // 上下文
      'get_ids', 'get_message', 'get_profile',
    ]) {
      expect(getHandler(kind), `节点 ${kind} 没有 handler`).not.toBeNull()
    }
  })

  // 参数键表就是「端口 id → 位置参数」的顺序；旧表停在旧签名上，
  // agent_chat 的 mode/history/max_rounds/confirm_high_risk 会被静默丢掉，
  // check_permission 则用了一个不存在的 permission 键（群管理员越权通过）。
  it('位置参数键表与节点签名对齐（agent_chat / check_permission）', () => {
    expect(PARAM_KEYS['agent_chat']).toEqual([
      'prompt', 'system_prompt', null, 'temperature', null, 'tools',
      'mode', 'history', 'max_rounds', 'confirm_high_risk',
    ])
    expect(PARAM_KEYS['check_permission']).toEqual(['role'])
  })
})
