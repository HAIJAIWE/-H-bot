// src/main/services/botManager.ts
//
// **兼容门面**：真正的 BotManager 实现在 `./bot/botManager`（按 10/18 产物复原的那份）。
//
// 这里原本还有一份更早的实现（NapCat 时代：bot.py + 旧翻译器 + 自己一套 baseDir）。
// 两份都 `new BotManager()` 导出单例，于是「服务容器配置的实例」和「IPC 查询的实例」不是同一个：
// 磁盘上明明有项目，`botManager:list` 却永远返回 []（顶栏一直显示「未选择」）。
// 现在只保留一份实现，本文件仅做再导出，任何导入路径拿到的都是同一个单例。
export { BotManager, botManager } from './bot/botManager'