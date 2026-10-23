// src/main/services/agent-core/model.ts
//
// 旧入口，只为兼容按 `agent-core/model` 导入的调用方（测试与少量历史引用）。
//
// 真实现是 ./modelAdapter：多做了两件 model.ts 早期版本没做的事 ——
//   ① 工具定义带上各自的 `parameters`（第一版写死空 properties，等于让模型猜参数）；
//   ② onToolCalls 结果过 `normalizeToolCalls`（provider 回的是 OpenAI 原始形状，
//      不归一就变成 `{name: undefined, args: {}}`）。
// 两份实现并存 = 两份行为，改一份忘一份，所以这里只做再导出。
export * from './modelAdapter';