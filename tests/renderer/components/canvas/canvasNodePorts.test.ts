// tests/renderer/components/canvas/canvasNodePorts.test.ts
// 折叠态端口 "+N" 计数：左右两侧各自统计，展开态归零。
//
// 背景：CanvasNode 折叠时只渲染前 COLLAPSED_PORT_LIMIT（=4）个端口，原来只给右侧
// 算了溢出数 —— 左侧被截断时画布上没有任何提示，用户会以为节点本来就没有那些输入端口。
import { describe, it, expect } from 'vitest'
import zhCN from '@renderer/i18n/zh-CN.json'
import enUS from '@renderer/i18n/en-US.json'
import { computeHiddenPortCount } from '@renderer/components/canvas/canvasNodeModel'

const LIMIT = 4

describe('computeHiddenPortCount', () => {
  it('展开态永远是 0（不再提示隐藏端口）', () => {
    expect(computeHiddenPortCount(0, true, LIMIT)).toBe(0)
    expect(computeHiddenPortCount(4, true, LIMIT)).toBe(0)
    expect(computeHiddenPortCount(30, true, LIMIT)).toBe(0)
  })

  it('折叠态未超出上限时为 0', () => {
    expect(computeHiddenPortCount(0, false, LIMIT)).toBe(0)
    expect(computeHiddenPortCount(1, false, LIMIT)).toBe(0)
    expect(computeHiddenPortCount(LIMIT, false, LIMIT)).toBe(0)
  })

  it('折叠态超出上限时返回超出部分', () => {
    expect(computeHiddenPortCount(LIMIT + 1, false, LIMIT)).toBe(1)
    expect(computeHiddenPortCount(9, false, LIMIT)).toBe(5)
    expect(computeHiddenPortCount(20, false, LIMIT)).toBe(16)
  })

  it('默认上限就是画布折叠态的 4 个端口', () => {
    expect(computeHiddenPortCount(4, false)).toBe(0)
    expect(computeHiddenPortCount(5, false)).toBe(1)
  })

  it('左右两侧互相独立（同一函数各算一次，数量不同）', () => {
    const leftPorts = 14 // channel_op 批量禁言：控制入口 + 十几个数据入口
    const rightPorts = 3
    expect(computeHiddenPortCount(leftPorts, false, LIMIT)).toBe(10)
    expect(computeHiddenPortCount(rightPorts, false, LIMIT)).toBe(0)
  })

  it('语言包里左/右两个提示键都在（缺一个 -> 胶囊 tooltip 退化成 key）', () => {
    const zh = zhCN as Record<string, any>
    const en = enUS as Record<string, any>
    for (const pack of [zh, en]) {
      expect(pack.canvas.node.hiddenLeftPorts).toContain('{count}')
      expect(pack.canvas.node.hiddenRightPorts).toContain('{count}')
    }
    // 旧的一把梭 key 已删除：留着会让孩子闸门把它当活键
    expect(zh.canvas.node.hiddenPorts).toBeUndefined()
    expect(en.canvas.node.hiddenPorts).toBeUndefined()
  })
})
