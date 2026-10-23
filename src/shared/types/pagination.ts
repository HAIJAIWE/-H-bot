// src/shared/types/pagination.ts
// 分页相关共享常量

/**
 * 默认分页大小（条/页）
 * 适用于：审计日志、面板关联表、配置表编辑器、通用数据浏览等
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * 默认分页大小选项（供 UI 下拉选择）
 */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const;
