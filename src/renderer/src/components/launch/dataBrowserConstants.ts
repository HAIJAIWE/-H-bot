// src/renderer/src/components/launch/dataBrowserConstants.ts
//
// 「玩家数据」面板的对外入口（**barrel**）。
//
// 2026-10 把原来这个 2551 行的文件按"数据 / 逻辑"拆开（闸门 fileSize 早就登记了这个方向）：
//   · dataBrowserData.ts    —— 纯数据表（标签 / 类型 / enum / 簇 / 别名 / 战斗词典）
//   · fieldValues.ts        —— 值的读写与显示格式化
//   · fieldLabels.ts        —— 标签与说明的解析
//   · characterFields.ts    —— 角色卡字段提取 + 战斗判定
//
// **消费方一行都不用改**（仍从这里 import）：拆结构不该以"改一圈无关导入"为代价。
// 新代码请直接从具体的那个文件 import —— barrel 是给老调用点的兼容入口。

export * from './dataBrowserData';
export * from './fieldValues';
export * from './fieldLabels';
export * from './characterFields';
