// src/renderer/src/components/blocks/ConfigFieldRow.tsx
//
// 配置字段"行外壳"组件 —— 属性面板字段渲染拆组件（docs/ai/pending-design.md 五步的第 2 步）
// 的**第一步：只搬外壳与标签，控件 JSX 由调用方以 children 传入**。
//
// ## 为什么先只搬外壳
//
// `PropertyDrawer` 里渲染配置字段的是一个约 880 行的 `.map()`，`{fieldLabel}` 散落 **9 处**
// 分支（数字/下拉/多行/JSON/文本/专属编辑器各一套）。一次脚本批量替换曾误伤 9 处、
// 8 处 JSX 损坏（只能 git checkout 回滚）。所以拆解顺序是：
//   ① 先补渲染层断言（已完成：tests/renderer/components/blocks/propertyDrawerFields.test.tsx）
//   ② **本文件**：搬外壳 + 标签（不碰 9 个控件分支）
//   ③ 再逐分支把控件搬进来
//
// 组件渲染的内容与原内联代码**逐字对应**（wrapper 的 data-field-key、highlight ring、
// label 的 `*`、HelpIcon 插槽、labelExtra 插槽、必填错误提示），因此接线时不应有任何视觉变化。

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { t } from '../../i18n';
import { useLocaleSubscription } from '../../stores/i18nStore';

export interface ConfigFieldRowProps {
  /** 字段 key（渲染契约：`data-field-key`，渲染层测试按它断言） */
  fieldKey: string;
  /** 字段标签（调用方负责取 CONFIG_LABELS 等来源） */
  label: string;
  /** label 的 title 提示（原内联代码用 CONFIG_HINTS） */
  hint?: string;
  /** 必填（在标签前显示红色 *） */
  required?: boolean;
  /** 错误修复跳转时高亮本行 */
  highlighted?: boolean;
  /** 帮助图标插槽（调用方传 `<HelpIcon text={...} />`，避免本组件依赖其实现） */
  helpIcon?: React.ReactNode;
  /** 标签行右侧的额外操作（如 database_write 的「浏览」按钮） */
  labelExtra?: React.ReactNode;
  /** 是否显示"此项必填"错误（调用方判断：required && 空值 && 非 boolean） */
  showRequiredError?: boolean;
  /** 控件本体 */
  children: React.ReactNode;
}

export const ConfigFieldRow = React.memo(function ConfigFieldRow({
  fieldKey,
  label,
  hint,
  required,
  highlighted,
  helpIcon,
  labelExtra,
  showRequiredError,
  children,
}: ConfigFieldRowProps) {
  useLocaleSubscription();
  return (
    <div
      data-field-key={fieldKey}
      className={`space-y-1 rounded p-1 -m-1 transition-shadow ${
        highlighted ? 'ring-2 ring-red-400 bg-red-500/5' : ''
      }`}
    >
      <label className="text-xs text-zinc-300 flex items-center gap-1" title={hint}>
        {required && <span className="text-red-400">*</span>}
        {label}
        {helpIcon}
        {labelExtra}
      </label>
      {children}
      {showRequiredError && (
        <div className="text-xs text-red-400 flex items-center gap-1" role="alert">
          <AlertTriangle aria-hidden="true" className="w-3 h-3 shrink-0" />
          <span>{t('drawer.requiredField')}</span>
        </div>
      )}
    </div>
  );
});
