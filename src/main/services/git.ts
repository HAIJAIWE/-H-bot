// src/main/services/git.ts
//
// 门面：真正的 GitService 在 ./ops/git（10/18 打包产物还原，839 行：包含
// 读档/清空历史/历史改写/版本标签等 12 个通道所需的全部方法）。
//
// 这里原本还有一份 174 行的早期实现（只有 init/autoCommit/log/diff/status），
// 与 ops/git 各自 new 了一个单例 —— 两份实例意味着「自动提交」和「读档」
// 可能落在不同对象上，且面板要用的方法在早期版本里根本不存在。
// 现在只保留一份：ipc/git.ts 从这里 import，flow/flow.ts 与 flow/codegen.ts
// 直接 import ../ops/git，指向同一个 gitService 单例。
export * from './ops/git'
