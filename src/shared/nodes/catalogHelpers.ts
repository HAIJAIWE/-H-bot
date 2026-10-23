// src/shared/nodes/catalogHelpers.ts
//
// # 目录里的 6 个 `showWhen` 判定辅助函数
//
// 从 `builtinCatalog.ts` 抽出来（2026-10-03 目录按 group 拆分）：**按 group 分文件之后，
// 每个文件都要用它们**（`inModes` 在目录里被用 199 次），单独一个文件才能避免环形依赖 ——
// 本文件**不 import 任何 group**，只被 group 引用。
//
// 规则本身没变（下面注释是原文）：

/**
 * 「某字段等于其中某个值时显示」的通用判定（`mode` / `segment_type` 等切换字段都适用）。
 *
 * 背景：`showWhen` 过去只写在**输出端口**上，输入端口一个都没有 —— 于是属性面板把
 * 15 个参数全渲染出来，用户选「禁言」时还得面对「名片/头衔/文件路径…」一整屏无关字段。
 * 现在每个参数都声明自己属于哪些取值，面板默认只显示当前模式用得上的（见
 * `src/shared/nodes/fieldVisibility.ts`：用户填过值或有校验错的字段仍会显示，不会被藏掉）。
 */
export const whenFieldIn =
  (field: string, ...values: string[]) =>
  (config: Record<string, unknown>): boolean =>
    values.includes(String(config[field] ?? ''));

/** 该字段为空时显示（用于"二选一"的输入，如 按钮 / 按钮(JSON)） */
export const whenFieldEmpty =
  (field: string) =>
  (config: Record<string, unknown>): boolean =>
    String(config[field] ?? '').trim() === '';

/** 模版里用到 `{varN}` 时才显示那一路变量口（format_text 用）—— 按需显示，不是全挂 */
export const whenTemplateUses =
  (n: number) =>
  (config: Record<string, unknown>): boolean =>
    String(config.template ?? '').includes(`{var${n}}`);

/** 该字段填了才显示（用于"进阶子项"，如填了页码才显示每页条数） */
export const whenFieldFilled =
  (field: string) =>
  (config: Record<string, unknown>): boolean =>
    String(config[field] ?? '').trim() !== '';

/** 按 `config.mode` 判定：`showWhen: inModes('ban', 'kick')` */
export const inModes = (...modes: string[]) => whenFieldIn('mode', ...modes);

/** 取反版本：`showWhen: notInModes('approve_friend')` */
export const notInModes =
  (...modes: string[]) =>
  (config: Record<string, unknown>): boolean =>
    !modes.includes(String(config.mode ?? ''));
