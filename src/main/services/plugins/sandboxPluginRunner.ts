// src/main/services/plugins/sandboxPluginRunner.ts
//
// 兼容门面：真实现只有一份，在 ./sandboxPluginActivator（带 api.handleTool —— 函数留在沙箱、
// 调用时经 inbound 派发）。此前这里另有一份**缺 handleTool** 的副本：activate 能贡献工具描述，
// 但调用时沙箱里没有对应函数，表现为"工具出现了、一调就超时"。
export { activateSandboxPlugin } from './sandboxPluginActivator';
