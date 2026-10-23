// 通用按钮组件：基于 buttonStyles.ts 的变体封装成 React 组件

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { buttonClass, type ButtonVariant, type ButtonSize } from './buttonStyles';
import { Spinner } from './Spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 按钮变体：primary/secondary/danger/ghost/success */
  variant?: ButtonVariant;
  /** 按钮尺寸：sm/md/lg */
  size?: ButtonSize;
  /** 加载中：显示 Spinner 并禁用按钮 */
  loading?: boolean;
  /** 左侧图标 */
  leftIcon?: ReactNode;
  /** 右侧图标 */
  rightIcon?: ReactNode;
  /** 子节点 */
  children?: ReactNode;
}

/** 通用按钮：支持变体、尺寸、加载态与左右图标 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  leftIcon,
  rightIcon,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      className={buttonClass(
        variant,
        size,
        `inline-flex items-center justify-center gap-1.5 ${className}`.trim(),
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size={size === 'lg' ? 'md' : 'sm'} />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
