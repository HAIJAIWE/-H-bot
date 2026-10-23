// src/main/services/aiGeneratedScanner.ts
import { readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { parseCustomNodesV2 } from './customNodeScanner'
import type { NodeSpecV2 } from '@shared/types/nodeV2'

/**
 * 扫描 src/plugins/ai_generated/*.py 中的 @node 装饰器函数，
 * 生成 NodeSpecV2 列表。机制类似 customNodeScanner，但：
 * - 遍历整个 ai_generated 目录（而非单个 __init__.py）
 * - kind 前缀为 ai_generated_，handler.source 为 'ai_generated'
 *
 * 扫描完成后自动写入 __init__.py 重导出所有节点函数（方案 B），
 * 使 emitterV2 的 `from ..ai_generated import <funcName>` 能正确解析。
 *
 * 目录不存在时返回空数组。
 */
export async function scanAiGeneratedNodes(projectPath: string): Promise<NodeSpecV2[]> {
  const aiGenDir = join(projectPath, 'src', 'plugins', 'ai_generated')
  if (!existsSync(aiGenDir)) return []

  const files = await readdir(aiGenDir)
  const pyFiles = files.filter((f) => f.endsWith('.py') && f !== '__init__.py')

  const allNodes: NodeSpecV2[] = []
  // 问题 C1：记录 sourceFile/funcName 用于写入 __init__.py 重导出
  const reexports: { sourceFile: string; funcName: string }[] = []
  for (const file of pyFiles) {
    const content = await readFile(join(aiGenDir, file), 'utf-8')
    const nodes = parseCustomNodesV2(content)
    const sourceFile = file.replace(/\.py$/, '')
    for (const node of nodes) {
      // 问题 M4：锚定开头，避免 funcName 含 custom_ 子串时被误删
      const funcName = node.kind.replace(/^custom_/, '')
      reexports.push({ sourceFile, funcName })
      allNodes.push({
        ...node,
        kind: `ai_generated_${funcName}`,
        // 问题 H4：不再把整个文件 content（可能几 KB）塞进 handler.code
        // emitterV2 用相对导入，完全不读 handler.code
        handler: { source: 'ai_generated', code: '' }
      })
    }
  }

  // 问题 C1 方案B：扫描完成后写入 __init__.py 重新导出所有节点函数
  // 使 `from ..ai_generated import <funcName>` 能从 __init__.py 解析到子模块中的函数
  if (reexports.length > 0) {
    const initContent =
      reexports.map((r) => `from .${r.sourceFile} import ${r.funcName}`).join('\n') + '\n'
    await writeFile(join(aiGenDir, '__init__.py'), initContent, 'utf-8')
  }

  return allNodes
}
