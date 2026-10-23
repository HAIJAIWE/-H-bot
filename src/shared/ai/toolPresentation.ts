// src/shared/ai/toolPresentation.ts
//
// **工具呈现契约**（2026-10-19）：main / preload / renderer 共用一份形状。
// 只是渲染提示：不参与权限、不参与执行、也不进给模型的上下文。
export interface ToolPresentation {
  /** 人话标签；缺省时渲染层按工具名回退（复用 @shared/ai/toolLabels） */
  label?: string;
  /** 结果呈现方式（缺省 = 纯文本） */
  resultKind?: 'text' | 'diff' | 'files' | 'json';
  /**
   * **自定义呈现器名**（渲染层 registerToolPresenter 注册的名字），优先于 resultKind。
   * 工具作者可为自己的结果提供专属渲染（表格/缩略图…），核心组件不用为每种工具改。
   */
  presenter?: string;
  /** 图标（短符号/emoji，渲染层原样显示） */
  icon?: string;
}

export type ToolResultKind = NonNullable<ToolPresentation['resultKind']>;
