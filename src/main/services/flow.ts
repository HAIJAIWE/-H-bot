// src/main/services/flow.ts
//
// 门面：真正的 FlowService 在 ./flow/flow（10/18 打包产物还原，311 行，含
// preserveReferencedPorts / collectReferencedPorts / 版本迁移与 git 自动提交）。
//
// 这里原本还有一份 234 行的早期实现，与 flow/flow 各自定义了一个 FlowService：
// 服务容器（services/runner/serviceContainer.ts:86）实例化的是 flow/flow 的那个，
// 而 ipc/flow.ts、ipc/launchPanel.ts 拿这个文件当类型来源 —— 于是"类型上说的"
// 和"实际跑的对象"不是同一个类（saveFlow 一个收 reason、一个不收）。
// 现在只保留一份实现，本文件只做再导出。
export * from './flow/flow'
