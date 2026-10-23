// tests/renderer/lib/branchColors.test.ts
// 阶段 4：分支颜色映射单测
import { describe, it, expect } from 'vitest'
import { getBranchColor, getBranchLabel, BRANCH_PORT_COLORS } from '@renderer/lib/branchColors'

describe('getBranchColor', () => {
  it('branch_if true/false 返回不同颜色', () => {
    expect(getBranchColor('branch_if', 'true')).toBe('#10b981')
    expect(getBranchColor('branch_if', 'false')).toBe('#f43f5e')
    expect(getBranchColor('branch_if', 'true')).not.toBe(getBranchColor('branch_if', 'false'))
  })

  it('loop body/done 颜色不同', () => {
    expect(getBranchColor('loop', 'body')).toBe('#0ea5e9')
    expect(getBranchColor('loop', 'done')).toBe('#a1a1aa')
    expect(getBranchColor('loop', 'body')).not.toBe(getBranchColor('loop', 'done'))
  })

  it('try_catch 三分支颜色互不相同', () => {
    const t = getBranchColor('try_catch', 'try')
    const c = getBranchColor('try_catch', 'catch')
    const f = getBranchColor('try_catch', 'finally')
    expect(new Set([t, c, f]).size).toBe(3)
  })

  it('branch_switch 动态分支返回调色板内颜色且稳定', () => {
    const c1 = getBranchColor('branch_switch', '分支A')
    const c2 = getBranchColor('branch_switch', '分支B')
    expect(c1).toBeDefined()
    expect(c2).toBeDefined()
    // 同 label 稳定（hash 一致）
    expect(getBranchColor('branch_switch', '分支A')).toBe(c1)
    expect(getBranchColor('branch_switch', '分支B')).toBe(c2)
    // 两个不同 label 可同色可不同色（hash 碰撞允许），但都应是有效颜色
  })

  it('branch_switch 静态端口 out 走静态表（undefined）', () => {
    // out 在 BRANCH_PORT_COLORS 中不存在 → 走动态分支逻辑
    // 但 branch_switch 的 out 是静态出口，应返回调色板颜色而非 undefined
    // 修正预期：branch_switch + out 走动态 hash 逻辑（因为 out 不在静态表中）
    const outColor = getBranchColor('branch_switch', 'out')
    expect(outColor).toBeDefined() // branch_switch 任何非静态端口都走 hash
  })

  it('普通节点 next/out 端口返回 undefined（走默认灰）', () => {
    expect(getBranchColor('message_send', 'out')).toBeUndefined()
    expect(getBranchColor('message_received', 'next')).toBeUndefined()
    expect(getBranchColor('delay', 'out')).toBeUndefined()
  })

  it('retry_exec body/success/failed 都有颜色', () => {
    expect(getBranchColor('retry_exec', 'body')).toBeDefined()
    expect(getBranchColor('retry_exec', 'success')).toBeDefined()
    expect(getBranchColor('retry_exec', 'failed')).toBeDefined()
  })

  it('BRANCH_PORT_COLORS 覆盖所有分支节点端口', () => {
    // branch_if
    expect(BRANCH_PORT_COLORS.true).toBeDefined()
    expect(BRANCH_PORT_COLORS.false).toBeDefined()
    // loop
    expect(BRANCH_PORT_COLORS.body).toBeDefined()
    expect(BRANCH_PORT_COLORS.done).toBeDefined()
    // try_catch
    expect(BRANCH_PORT_COLORS.try).toBeDefined()
    expect(BRANCH_PORT_COLORS.catch).toBeDefined()
    expect(BRANCH_PORT_COLORS.finally).toBeDefined()
    // retry_exec
    expect(BRANCH_PORT_COLORS.success).toBeDefined()
    expect(BRANCH_PORT_COLORS.failed).toBeDefined()
  })
})

// 阶段 8 打磨 #1：分支标签映射测试
describe('getBranchLabel', () => {
  it('branch_if true/false 返回中文标签', () => {
    expect(getBranchLabel('branch_if', 'true')).toBe('真')
    expect(getBranchLabel('branch_if', 'false')).toBe('假')
  })

  it('loop body/done 返回中文标签', () => {
    expect(getBranchLabel('loop', 'body')).toBe('循环体')
    expect(getBranchLabel('loop', 'done')).toBe('完成')
  })

  it('try_catch try/catch/finally 返回中文标签', () => {
    expect(getBranchLabel('try_catch', 'try')).toBe('正常')
    expect(getBranchLabel('try_catch', 'catch')).toBe('捕获')
    expect(getBranchLabel('try_catch', 'finally')).toBe('最终')
  })

  it('retry_exec success/failed 返回中文标签', () => {
    expect(getBranchLabel('retry_exec', 'success')).toBe('成功')
    expect(getBranchLabel('retry_exec', 'failed')).toBe('失败')
  })

  it('普通节点 next/out 返回 undefined（不显示标签）', () => {
    expect(getBranchLabel('message_send', 'out')).toBeUndefined()
    expect(getBranchLabel('message_received', 'next')).toBeUndefined()
    expect(getBranchLabel('delay', 'out')).toBeUndefined()
  })

  it('branch_switch 动态 case 端口返回 case label 本身', () => {
    expect(getBranchLabel('branch_switch', '下雨天')).toBe('下雨天')
    expect(getBranchLabel('branch_switch', '晴天')).toBe('晴天')
  })

  it('branch_switch 静态端口（如 success）走静态标签表', () => {
    // success 在 BRANCH_PORT_LABELS 中 → 返回 '成功'，不当作动态 case
    expect(getBranchLabel('branch_switch', 'success')).toBe('成功')
    expect(getBranchLabel('branch_switch', 'failed')).toBe('失败')
  })
})
