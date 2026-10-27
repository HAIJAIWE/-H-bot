// src/main/services/project/projectPlatform.ts
//
// 读项目平台族：从 `<项目>/.qqbat/project.json` 的 `adapter` / `botType` 推导。
//
// 为什么要单独一个模块：`flow:validate`、`flow:save` 的收尾校验、`FlowRuntime.start`
// 三处都要同一份答案；判断逻辑本身在 shared 的 platform 注册表，这里只负责"读盘 + 兜底"。
// 读不到 / 坏 JSON 一律返回 `undefined`（= 不绑平台 → 不做平台校验），绝不因为项目文件
// 缺失就把整个项目判成有问题。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectPlatformFamily, type PlatformFamily } from '@shared/domain/platform/registry'

/** `project.json` 里与平台判断相关的字段 */
interface ProjectPlatformFields {
  adapter?: string | null
  botType?: string | null
}

/**
 * 项目当前属于哪个平台族。
 *
 * 返回 `undefined` 的情况：项目还没有 `project.json`、JSON 坏了、或没写平台字段。
 * 调用方拿到 `undefined` 时应跳过平台校验（历史项目要能照常打开）。
 */
export function readProjectPlatform(projectPath: string): PlatformFamily | undefined {
  try {
    const raw = readFileSync(join(projectPath, '.qqbat', 'project.json'), 'utf-8')
    const parsed = JSON.parse(raw) as ProjectPlatformFields
    return projectPlatformFamily(parsed)
  } catch {
    return undefined
  }
}
