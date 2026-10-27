// src/renderer/src/components/ai/builtinAgentSurface.tsx
//
// 第 68 批起这里是「默认窗口」的注册入口：import 即生效，保证注册表里至少有一个窗口。
// 第 72 批把两个内置窗口搬进**渲染层插件系统**（`plugins/agentWindows.tsx`，`window` 权限）后，
// 本文件只保留挂载点：RightPanel 继续 import 它，窗口由插件 activate 时贡献。
//
// 为什么还留这个文件：注册表必须**早于 RightPanel 首次渲染**就有窗口，
// 否则会先白屏一帧；而 main.tsx 的 `import './plugins'` 负责整份树内插件清单（含 enter-hint）。
import '../../plugins/agentWindows'
