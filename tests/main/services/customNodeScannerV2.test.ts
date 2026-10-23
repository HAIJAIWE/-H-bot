import { describe, it, expect } from 'vitest'
import { parseCustomNodesV2 } from '@main/services/customNodeScanner'

describe('parseCustomNodesV2', () => {
  it('从 @node 装饰器提取 v2 schema', () => {
    const code = `
from qqbat import node

@node(label="查询等级", group="游戏", icon="🎮",
      tags=["玩家", "查询"], sideEffects=["read_db"],
      summary="查询玩家等级", exposedAsTool=True, toolName="查等级")
async def query_level(qq: str) -> int:
    """查询指定 QQ 号玩家的当前等级，适用于游戏逻辑中需要判断玩家进度时"""
    return await db.get(qq)
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes).toHaveLength(1)
    const n = nodes[0]
    expect(n.kind).toBe('custom_query_level')
    expect(n.label).toBe('查询等级')
    expect(n.summary).toBe('查询玩家等级')
    expect(n.sideEffects).toContain('read_db')
    expect(n.exposedAsTool).toBe(true)
    expect(n.toolName).toBe('查等级')
    expect(n.handler.source).toBe('custom')
    // HandlerRef 是 discriminated union，需先收窄类型再访问 funcName 字段
    if (n.handler.source === 'custom') {
      expect(n.handler.funcName).toBe('query_level')
    }
  })

  it('从 docstring 提取 summary（无显式 summary 时）', () => {
    const code = `
from qqbat import node

@node(label="测试", group="游戏", icon="T")
async def test_func(x: int) -> str:
    """这是测试函数的摘要"""
    return str(x)
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes[0].summary).toBe('这是测试函数的摘要')
  })

  it('跳过 bot/event 参数', () => {
    const code = `
from qqbat import node

@node(label="测试", group="游戏", icon="T")
async def test_func(bot: Any, event: Any, qq: str) -> int:
    """测试"""
    return 1
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes[0].inputs).toHaveLength(1)
    expect(nodes[0].inputs[0].id).toBe('qq')
  })

  it('无返回值时 outputs 为空', () => {
    const code = `
from qqbat import node

@node(label="无返回", group="游戏", icon="T")
async def no_return(x: int) -> None:
    """无返回值"""
    pass
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes[0].outputs).toHaveLength(0)
  })

  // ===== 问题 2：docstring 与返回类型应可选 =====

  it('无 docstring 时仍能扫描到节点（C2 回归）', () => {
    const code = `
from qqbat import node

@node(label="无文档", summary="无docstring的节点", icon="T")
async def no_doc(bot, event, x: str) -> str:
    return x
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('custom_no_doc')
    // summary 回退到装饰器 summary
    expect(nodes[0].summary).toBe('无docstring的节点')
    // 有返回类型时 outputs 非空
    expect(nodes[0].outputs).toHaveLength(1)
    expect(nodes[0].outputs[0].dataType).toBe('string')
  })

  it('无返回类型注解时仍能扫描到节点（C2 回归）', () => {
    const code = `
from qqbat import node

@node(label="无类型", icon="T")
async def no_type(bot, event):
    """无返回类型注解"""
    pass
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('custom_no_type')
    // 无返回类型 → outputs 为空
    expect(nodes[0].outputs).toHaveLength(0)
    // docstring 仍作为 summary
    expect(nodes[0].summary).toBe('无返回类型注解')
  })

  it('无 docstring 且无返回类型时仍能扫描到节点（C2 回归）', () => {
    const code = `
from qqbat import node

@node(label="极简", icon="T")
async def minimal(bot, event):
    return 1
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].kind).toBe('custom_minimal')
    expect(nodes[0].outputs).toHaveLength(0)
  })

  // ===== 问题 9：参数化类型支持 =====

  it('支持 List[str] 参数类型（M3 回归）', () => {
    const code = `
from qqbat import node
from typing import List

@node(label="列表", icon="T")
async def list_func(bot, event, items: List[str]) -> str:
    """处理列表"""
    return ""
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes[0].inputs).toHaveLength(1)
    const input = nodes[0].inputs[0]
    expect(input.id).toBe('items')
    // List[str] → dataType: list
    expect(input.dataType).toBe('list')
  })

  it('支持 Optional[str] 参数类型并标记 required=false（M3 回归）', () => {
    const code = `
from qqbat import node
from typing import Optional

@node(label="可选", icon="T")
async def opt_func(bot, event, name: Optional[str]) -> str:
    """可选参数"""
    return ""
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes[0].inputs).toHaveLength(1)
    const input = nodes[0].inputs[0]
    expect(input.id).toBe('name')
    // Optional[str] → dataType: string, required: false
    expect(input.dataType).toBe('string')
    expect(input.required).toBe(false)
  })

  it('支持 Dict[str, int] 参数类型（M3 回归）', () => {
    const code = `
from qqbat import node
from typing import Dict

@node(label="字典", icon="T")
async def dict_func(bot, event, data: Dict[str, int]) -> str:
    """处理字典"""
    return ""
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes[0].inputs).toHaveLength(1)
    expect(nodes[0].inputs[0].dataType).toBe('object')
  })

  it('支持 List[str] 返回类型（M3 回归）', () => {
    const code = `
from qqbat import node
from typing import List

@node(label="返回列表", icon="T")
async def ret_list(bot, event) -> List[str]:
    """返回列表"""
    return []
`
    const nodes = parseCustomNodesV2(code)
    expect(nodes[0].outputs).toHaveLength(1)
    expect(nodes[0].outputs[0].dataType).toBe('list')
  })
})
