// src/shared/types/buttonPanel.ts
//
// 按钮面板（button_panels.json）的持久化形状。
// 一个项目一个面板库，面板里是一张 InlineKeyboard（行 → 按钮）；
// 定义依据 `src/main/services/buttonPanelService.ts` 的读写点与
// `src/shared/panels/builtinPanelTemplates.ts` 的模板实例化结果。

import type { InlineKeyboard } from './keyboard';

/** 单个按钮面板（可直接作为 keyboard 节点/消息按钮配置的数据源） */
export interface ButtonPanel {
  /** 形如 panel_<base36时间>_<随机6位>，创建后不变 */
  id: string;
  name: string;
  description: string;
  keyboard: InlineKeyboard;
  /** ISO 时间字符串 */
  createdAt: string;
  /** ISO 时间字符串；列表按它倒序 */
  updatedAt: string;
}

/** 项目级面板库文件（`.qqbat/button_panels.json`） */
export interface ButtonPanelLibrary {
  /** 库格式版本，当前为 1；读到无法识别的内容按空库处理 */
  version: number;
  panels: ButtonPanel[];
}
