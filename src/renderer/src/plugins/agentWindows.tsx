// src/renderer/src/plugins/agentWindows.tsx
//
// **第 72 批：智能体窗口走渲染层插件系统**。
//
// 对齐 DSH 的形状：DSH 的界面（对话、审批条、插件市场、设置页…）每个都是带
// `dsh.client` 清单的 npm 包，由 renderer 包按 slots 装配。我们缩到渲染层能做的
// 第一类 UI：一个插件可以贡献**整个智能体窗口**（`window` 权限）。
//
// 两个内置窗口从「模块 import 即注册」改成「插件 activate 时贡献」的好处：
//   · 启停统一：设置里停用插件 = 窗口从下拉里消失、选中它的用户自动回落默认；
//   · 清单可见：InstalledPluginsList 里能看到"这个窗口是谁提供的、要什么权限"；
//   · 第三方窗口按同一份形状写，不用改内核。
//
// ⚠️ 窗口 id 是**全局持久化 id**（`uiStore.agentSurfaceId`），不能带插件前缀：
// 这里 chat/compact 必须保持与第 69 批一致，否则用户选过的窗口升级后会失效。
import { definePlugin, registerPlugin } from '../lib/plugins/api'
import { ChatPanel } from '../components/ai/ChatPanel'
import { CompactAgentSurface } from '../components/ai/compactAgentSurface'
import { t } from '../i18n'

registerPlugin(
  definePlugin({
    manifest: {
      id: 'builtin.agent-window.chat',
      // name/description 用英文：渲染层 i18n 闸门不允许硬编码中文文案（清单也是文案）
      name: 'Agent window: chat',
      version: '0.1.0',
      description: 'The default chat window for the right-hand agent panel',
      permissions: ['window'],
    },
    activate(api) {
      api.contributeAgentWindow({
        id: 'chat',
        order: 1000,
        label: () => t('settings.aiProvider.agentSurface.builtin'),
        render: () => <ChatPanel />,
      })
    },
  }),
)

registerPlugin(
  definePlugin({
    manifest: {
      id: 'builtin.agent-window.compact',
      name: 'Agent window: compact',
      version: '0.1.0',
      description: 'Minimal example window that only consumes the agent surface contract',
      permissions: ['window'],
    },
    activate(api) {
      api.contributeAgentWindow({
        id: 'compact',
        order: 2000,
        label: () => t('settings.aiProvider.agentSurface.compact'),
        render: context => <CompactAgentSurface context={context} />,
      })
    },
  }),
)
