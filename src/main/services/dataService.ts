// 数据访问门面（兼容旧路径）
//
// 真正的实现在 `./project/dataService`（10/18 revision：连接池 + 测试钩子 + pragma 收在一处）。
// 这里曾经是一份**更早的独立实现**（少 30 个导出、没有 setDbCtorForTesting 等钩子），
// 与 project/dataService 并存 = 两份连接池、两份 LRU 缓存，同一个 db 文件会被打开两次，
// 于是"刚写进去的数据读不到"这类问题会时隐时现。
//
// 现在只保留这一个再导出：历史 import 路径（`@main/services/dataService`）继续可用，
// 但只有一份实现。新代码请直接 import `@main/services/project/dataService`。
export * from './project/dataService'
