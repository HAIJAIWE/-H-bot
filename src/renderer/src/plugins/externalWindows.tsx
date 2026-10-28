// src/renderer/src/plugins/externalWindows.ts
//
// **外部窗口包的加载器**（第 73 批，P4 加载器 v1）。
//
// 流程：启动时调 `plugin:listWindows`（主进程扫 `<userData>/plugins/windows/*/manifest.json`）
// → 每个合法清单注册成一个 `window` 权限插件 → 插件的 activate 里 `contributeAgentWindow`。
// 这样外部窗口和内置窗口走**同一条注册路径**（第 72 批的纪律：窗口必须经插件层），
// 但清单来自磁盘，不是编译期代码。
//
// 窗口 id 用 `external.<包 id>` 前缀：包 id 是用户可改的目录内容，加前缀避免撞上
// 内置的 `chat` / `compact`；`uiStore.agentSurfaceId` 持久化，删包后选中项自动回落默认。
//
// 失败策略：加载失败（IPC 挂了 / 清单坏）**不抛**、不阻塞界面 —— 窗口少一个比启动不了强。
import type { WindowPackageInfo, WindowPackageScanResult } from '@shared/plugins/windowPackage'
import { windowPackageIsExecutable } from '@shared/plugins/windowPackage'
import { definePlugin, registerPlugin } from '../lib/plugins/api'
import { DeclarativeAgentSurface } from '../components/ai/declarativeAgentSurface'
import { ExecutableAgentSurface } from '../components/ai/executableAgentSurface'

/** 外部窗口 id 的前缀（写进 uiStore 的持久化 id 也是这个形状） */
export const EXTERNAL_WINDOW_PREFIX = 'external.'

/** 包 id → 窗口 id */
export function externalWindowIdOf(packageId: string): string {
  return EXTERNAL_WINDOW_PREFIX + packageId
}

/**
 * 幂等交给注册表：同一包重复 bootstrap 时 `registerPlugin` 会因重名抛，被单个包
 * 的 try/catch 记成 issue —— 不需要模块级"只跑一次"开关（那会让测试之间互相污染）。
 */

/** 把一个窗口包注册成插件（导出给测试；正常只由 bootstrap 调） */
export function registerExternalWindowPackage(spec: WindowPackageInfo): void {
  registerPlugin(
    definePlugin({
      manifest: {
        id: 'builtin.external-window.' + spec.id,
        // 清单里是英文名：渲染层 i18n 闸门不允许硬编码中文文案（插件清单也是文案）
        name: 'External window: ' + spec.id,
        version: spec.version,
        description: spec.description ?? 'Declarative window package',
        permissions: ['window'],
      },
      activate(api) {
        api.contributeAgentWindow({
          id: externalWindowIdOf(spec.id),
          // 清单里的 order 决定它在下拉里的位置：想当默认就写比 1000 更小的数
          ...(spec.order !== undefined ? { order: spec.order } : {}),
          label: () => spec.name,
          render: context =>
            windowPackageIsExecutable(spec) ? (
              // 带 entry 的包：源码在主进程读出来，这里用 Blob worker 跑（第 74 批）
              <ExecutableAgentSurface
                context={context}
                spec={spec}
                loadEntry={id => window.qqbat.plugin.readWindowEntry(id)}
              />
            ) : (
              <DeclarativeAgentSurface context={context} spec={spec} />
            ),
        })
      },
    }),
  )
}

export interface ExternalWindowBootstrapResult {
  registered: number
  issues: number
}

/**
 * 从主进程拉清单并注册。`fetchPackages` 由调用方注入（main.tsx 传桥；测试传假的），
 * 这样本模块不直接依赖 `window.qqbat`，node 环境下也能测。
 */
export async function bootstrapExternalWindowPlugins(
  fetchPackages: () => Promise<{ ok: boolean; data?: WindowPackageScanResult }>,
): Promise<ExternalWindowBootstrapResult> {
  let result: Awaited<ReturnType<typeof fetchPackages>>
  try {
    result = await fetchPackages()
  } catch {
    return { registered: 0, issues: 1 }
  }
  if (!result.ok || !result.data) return { registered: 0, issues: 1 }

  let registered = 0
  let issues = result.data.issues.length
  for (const spec of result.data.packages) {
    /**
     * 用户禁用的包（第 75 批）：**不注册**，但也不删 —— 设置页里还能看到它、
     * 一键启用。扫描侧照常返回它（带 `disabled: true`），跳过发生在这里，
     * 这样"禁用"是个可撤销的动作，而不是一场静默的删除。
     */
    if (spec.disabled) continue
    try {
      registerExternalWindowPackage(spec)
      registered += 1
    } catch {
      // 单个包注册失败（重名等）：记一条 issue，继续装别的
      issues += 1
    }
  }
  return { registered, issues }
}

/** 生产入口：用 preload 暴露的 `window.qqbat.plugin.listWindows` */
export function bootstrapExternalWindowPluginsFromBridge(): Promise<ExternalWindowBootstrapResult> {
  return bootstrapExternalWindowPlugins(() => window.qqbat.plugin.listWindows())
}
