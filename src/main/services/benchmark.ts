// src/main/services/benchmark.ts
// 性能基准测试服务

import { mkdir, writeFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { generateCode } from '../codegen/generator'
import type { FlowGraph, FlowNode, FlowEdge } from '@shared/types/flow'

export interface BenchmarkResult {
  /** 代码生成速度(ms) */
  codegenMs: number
  /** 文件读写速度(ms) — 10 次 IO 操作总耗时 */
  fileIOMs: number
  /** AI 上下文组装速度(ms) — 10 次总耗时 */
  aiContextMs: number
  /** 基准测试时间戳 */
  timestamp: string
}

/**
 * 构建一个 5 节点示例流程图用于基准测试
 */
function buildSampleFlow(): FlowGraph {
  const makePort = (id: string, name: string, kind: 'control' | 'data' = 'control') => ({ id, name, kind })

  const nodes: FlowNode[] = [
    {
      id: 'n1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { label: 'Receive Message', nodeKind: 'on_message', config: {}, inputs: [], outputs: [makePort('out', 'output')] }
    },
    {
      id: 'n2',
      type: 'logic',
      position: { x: 250, y: 0 },
      data: { label: 'Condition Branch', nodeKind: 'if_branch', config: {}, inputs: [makePort('in', 'input')], outputs: [makePort('true', 'true'), makePort('false', 'false')] }
    },
    {
      id: 'n3',
      type: 'action',
      position: { x: 500, y: -100 },
      data: { label: 'LLM Chat', nodeKind: 'llm_chat', config: { prompt: 'Hello' }, inputs: [makePort('in', 'input')], outputs: [makePort('out', 'output')] }
    },
    {
      id: 'n4',
      type: 'action',
      position: { x: 500, y: 100 },
      data: { label: 'HTTP Request', nodeKind: 'http_request', config: { url: 'https://example.com' }, inputs: [makePort('in', 'input')], outputs: [makePort('out', 'output')] }
    },
    {
      id: 'n5',
      type: 'action',
      position: { x: 750, y: 0 },
      data: { label: 'Send Message', nodeKind: 'send_message', config: {}, inputs: [makePort('in', 'input')], outputs: [] }
    }
  ]

  const edges: FlowEdge[] = [
    { id: 'e1', source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'in' },
    { id: 'e2', source: 'n2', sourcePort: 'true', target: 'n3', targetPort: 'in', sourceHandle: 'true' },
    { id: 'e3', source: 'n2', sourcePort: 'false', target: 'n4', targetPort: 'in', sourceHandle: 'false' },
    { id: 'e4', source: 'n3', sourcePort: 'out', target: 'n5', targetPort: 'in' },
    { id: 'e5', source: 'n4', sourcePort: 'out', target: 'n5', targetPort: 'in' }
  ]

  return {
    systems: [],
    nodes,
    edges,
    schemaVersion: '1.0',
    variables: [],
    metadata: {
      name: 'benchmark',
      version: '1.0',
      runtime: 'typescript',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }
}

/**
 * 基准测试：代码生成速度
 * 对一个 5 节点流程图运行代码生成，测量耗时
 */
function benchmarkCodegen(): number {
  const flow = buildSampleFlow()
  const start = performance.now()
  for (let i = 0; i < 10; i++) {
    generateCode(flow)
  }
  const end = performance.now()
  // 返回单次平均耗时
  return Math.round((end - start) / 10)
}

/**
 * 基准测试：文件读写速度
 * 在 .qqbat/tmp_benchmark/ 目录下执行 10 次写入+读取+删除操作
 */
async function benchmarkFileIO(projectPath: string): Promise<number> {
  const tmpDir = join(projectPath, '.qqbat', 'tmp_benchmark')
  await mkdir(tmpDir, { recursive: true })

  const start = performance.now()
  for (let i = 0; i < 10; i++) {
    const filePath = join(tmpDir, `bench_${i}.tmp`)
    await writeFile(filePath, `benchmark data ${i} - ${'x'.repeat(1024)}`, 'utf-8')
    await readFile(filePath, 'utf-8')
    await unlink(filePath)
  }
  const end = performance.now()

  // 清理目录
  try {
    await unlink(tmpDir).catch(() => {})
  } catch { /* ignore */ }

  return Math.round(end - start)
}

/**
 * 基准测试：AI 上下文组装速度
 * 模拟 10 次上下文组装操作
 */
async function benchmarkAIContext(projectPath: string): Promise<number> {
  // 动态导入避免循环依赖
  const { buildSystemMessage } = await import('./ai/context.js')

  const info = {
    name: 'benchmark-project',
    qq: '123456789',
    adapter: 'official',
    model: 'glm-4',
    projectPath
  }

  const start = performance.now()
  for (let i = 0; i < 10; i++) {
    await buildSystemMessage(info)
  }
  const end = performance.now()

  return Math.round(end - start)
}

/**
 * 运行完整基准测试
 * @param projectPath 项目路径
 * @returns 基准测试结果
 */
export async function runBenchmark(projectPath: string): Promise<BenchmarkResult> {
  const codegenMs = benchmarkCodegen()
  const fileIOMs = await benchmarkFileIO(projectPath)
  const aiContextMs = await benchmarkAIContext(projectPath)

  const result: BenchmarkResult = {
    codegenMs,
    fileIOMs,
    aiContextMs,
    timestamp: new Date().toISOString()
  }

  // 保存结果
  const qqbatDir = join(projectPath, '.qqbat')
  await mkdir(qqbatDir, { recursive: true })
  await writeFile(
    join(qqbatDir, 'benchmark.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  )

  return result
}
