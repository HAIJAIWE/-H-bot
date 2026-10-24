// src/renderer/src/components/ai/agentModes.ts
//
// 角色（`AgentMode`）在渲染层的**唯一一处枚举表**：图标 / 文案 key / 悬停说明。
//
// 为什么单独成文件：角色按钮原来写在 ChatPanel 里（2,000+ 行的热文件），
// 测试要验「四档都在、点了回调收到哪个」就得把整个 ChatPanel 连同 aiStore /
// flowStore / IPC 全 mock 一遍 —— 于是没人写。拆出来之后 RoleChips 是纯组件，
// 直接 render 就能验（tests/renderer/components/ai/RoleChips.test.tsx）。
//
// ⚠️ 这张表**必须穷尽 `AgentMode`** —— 2026-10-15 加 `duo` 时漏改主进程 schema，
// 结果双向模式发送被 zod 静默拒绝（界面一直转圈、日志里一条请求都没有）。
// 那是"三处不一致"，所以这里做成 **Record<AgentMode, …>**：
// 以后往共享类型里加一档却忘了加按钮，**tsc 直接红**（不用等真机才发现）。
import type { AgentMode } from '@shared/ai/roleDomains';

const AI_MODE_COVERAGE: Record<AgentMode, { icon: string; labelKey: string; hintKey: string }> = {
  blocks: { icon: '🧩', labelKey: 'ai.mode.builder', hintKey: 'ai.mode.builderHint' },
  code: { icon: '📝', labelKey: 'ai.mode.coder', hintKey: 'ai.mode.coderHint' },
  duo: { icon: '🔀', labelKey: 'ai.mode.duo', hintKey: 'ai.mode.duoHint' },
  // 创作模式：顺序放在最后（它是最"重"的一档，要先进框架工作区）
  creator: { icon: '✨', labelKey: 'ai.mode.creator', hintKey: 'ai.mode.creatorHint' },
};

/** 按钮表（顺序 = 声明顺序）；测试直接断言它对每一档都有条目 */
export const AI_MODE_BUTTONS = (Object.keys(AI_MODE_COVERAGE) as AgentMode[]).map((mode) => ({
  mode,
  ...AI_MODE_COVERAGE[mode],
}));
