// src/main/codegen/topo.ts
import type { FlowGraph, FlowNode, FlowEdge } from '@shared/types/flow'

export interface CompiledChain {
  trigger: FlowNode
  /** 按控制流 BFS 顺序排列的节点（含触发器） */
  sequence: FlowNode[]
}

/**
 * 从节点图编译出执行链。
 * 每个触发器产生一条独立的链，沿控制流边 BFS 遍历。
 * 同时自动补充链中节点通过数据边引用的数据源节点（无控制输入端口）。
 * @throws 如果控制流中存在循环依赖则抛出错误
 */
export function compileChains(graph: FlowGraph): CompiledChain[] {
  const triggers = graph.nodes.filter((n) => n.type === 'trigger')
  return triggers.map((trigger) => {
    if (detectCycle(trigger, graph)) {
      throw new Error(
        `触发器 "${trigger.data.label}" 的控制流中存在循环依赖，请检查画布连接`
      )
    }
    const ctrlSeq = traverseControlFlow(trigger, graph)
    const dataSources = findReferencedDataSources(ctrlSeq, graph)
    return {
      trigger,
      sequence: [...dataSources, ...ctrlSeq]
    }
  })
}

/**
 * 查找控制流链中节点通过数据边引用的数据源节点。
 * 数据源节点：没有控制输入端口的节点，可以零依赖执行。
 */
function findReferencedDataSources(sequence: FlowNode[], graph: FlowGraph): FlowNode[] {
  const seqIds = new Set(sequence.map((n) => n.id))
  const dataSources: Map<string, FlowNode> = new Map()

  for (const edge of graph.edges) {
    if (seqIds.has(edge.target)) {
      const sourceNode = graph.nodes.find((n) => n.id === edge.source)
      if (sourceNode && !seqIds.has(sourceNode.id)) {
        const hasControlInput = sourceNode.data.inputs.some((p) => p.kind === 'control')
        if (!hasControlInput && !dataSources.has(sourceNode.id)) {
          dataSources.set(sourceNode.id, sourceNode)
        }
      }
    }
  }

  // 按 ID 排序确保确定性顺序
  return Array.from(dataSources.values()).sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * 从起始节点沿控制流边 BFS 遍历，返回执行序列。
 * 控制流边：source 端口的 kind === 'control'
 */
function traverseControlFlow(start: FlowNode, graph: FlowGraph): FlowNode[] {
  const sequence: FlowNode[] = [start]
  const visited = new Set<string>([start.id])
  const queue: string[] = [start.id]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const controlOutEdges = graph.edges.filter(
      (e) => e.source === currentId && isControlEdge(e, graph)
    )
    for (const edge of controlOutEdges) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target)
        const targetNode = graph.nodes.find((n) => n.id === edge.target)
        if (targetNode) {
          sequence.push(targetNode)
          queue.push(edge.target)
        }
      }
    }
  }

  return sequence
}

function isControlEdge(edge: FlowEdge, graph: FlowGraph): boolean {
  const sourceNode = graph.nodes.find((n) => n.id === edge.source)
  if (!sourceNode) return false
  // 端口定义丢失（outputs 为空数组）时，所有输出边回退视为控制流边
  if (sourceNode.data.outputs.length === 0) return true
  const sourcePort = sourceNode.data.outputs.find((p) => p.id === edge.sourcePort)
  return sourcePort?.kind === 'control'
}

/**
 * 检测从起始节点出发的控制流子图中是否存在循环依赖。
 * 使用 DFS + 递归栈标记（inStack）检测有向环。
 */
function detectCycle(start: FlowNode, graph: FlowGraph): boolean {
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visited.add(nodeId)
    inStack.add(nodeId)

    const controlOutEdges = graph.edges.filter(
      (e) => e.source === nodeId && isControlEdge(e, graph)
    )
    for (const edge of controlOutEdges) {
      if (dfs(edge.target)) return true
    }

    inStack.delete(nodeId)
    return false
  }

  return dfs(start.id)
}

/**
 * 获取节点某个控制流输出端口连接的**全部**下一个节点。
 *
 * 与 nextNode 的区别：nextNode 取第一条出边（唯一后继的常见情形）；
 * loop 节点的 done 端口允许接多条（每条都要生成一段代码），所以需要复数版。
 * 见 controlFlowEmitter.ts:68 `nextNodes(current, 'done', graph)`。
 */
export function nextNodes(
  currentNode: FlowNode,
  portId: string,
  graph: FlowGraph
): FlowNode[] {
  return graph.edges
    .filter((e) => e.source === currentNode.id && e.sourcePort === portId)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is FlowNode => n !== undefined)
}

/** 获取节点某个控制流输出端口连接的下一个节点 */
export function nextNode(
  currentNode: FlowNode,
  portId: string,
  graph: FlowGraph
): FlowNode | null {
  const edge = graph.edges.find(
    (e) => e.source === currentNode.id && e.sourcePort === portId
  )
  if (!edge) return null
  return graph.nodes.find((n) => n.id === edge.target) ?? null
}
