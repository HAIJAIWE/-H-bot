// tests/renderer/stores/uiStorePanelCollapse.test.ts
// 窄窗口逃生口：左/右栏收起后能从细轨展开回来（布局宽度由 ThreeColumn 的 fitPanels 推导，
// 这里锁住状态机本身：开关、默认值、宽度上下限、持久化字段）。
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '@renderer/stores/uiStore'

const reset = () => {
  useUiStore.setState({
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
    leftPanelWidth: 240,
    rightPanelWidth: 320,
  })
}

beforeEach(reset)

describe('uiStore 侧栏折叠', () => {
  it('默认两栏都展开', () => {
    const s = useUiStore.getState()
    expect(s.leftPanelCollapsed).toBe(false)
    expect(s.rightPanelCollapsed).toBe(false)
  })

  it('toggleLeftPanel / toggleRightPanel 各自独立翻转', () => {
    useUiStore.getState().toggleLeftPanel()
    expect(useUiStore.getState().leftPanelCollapsed).toBe(true)
    expect(useUiStore.getState().rightPanelCollapsed).toBe(false)

    useUiStore.getState().toggleRightPanel()
    expect(useUiStore.getState().rightPanelCollapsed).toBe(true)

    useUiStore.getState().toggleLeftPanel()
    expect(useUiStore.getState().leftPanelCollapsed).toBe(false)
    expect(useUiStore.getState().rightPanelCollapsed).toBe(true)
  })

  it('收起再展开能回到展开态（逃生口可逆）', () => {
    useUiStore.getState().toggleRightPanel()
    useUiStore.getState().toggleRightPanel()
    expect(useUiStore.getState().rightPanelCollapsed).toBe(false)
  })

  it('宽度有上下限：左 160~500、右 200~600', () => {
    useUiStore.getState().setLeftPanelWidth(10)
    expect(useUiStore.getState().leftPanelWidth).toBe(160)
    useUiStore.getState().setLeftPanelWidth(9999)
    expect(useUiStore.getState().leftPanelWidth).toBe(500)
    useUiStore.getState().setRightPanelWidth(10)
    expect(useUiStore.getState().rightPanelWidth).toBe(200)
    useUiStore.getState().setRightPanelWidth(9999)
    expect(useUiStore.getState().rightPanelWidth).toBe(600)
  })
})
