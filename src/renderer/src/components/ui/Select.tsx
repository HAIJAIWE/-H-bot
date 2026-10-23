import { Dropdown } from './Dropdown'

interface SelectOption<T extends string | number = string> {
  value: T
  label: string
}

interface SelectProps<T extends string | number = string> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  className?: string
  placeholder?: string
  disabled?: boolean
  /** 可访问名称（透传给 Dropdown） */
  ariaLabel?: string
}

// 通用下拉框组件：使用自定义 div 下拉列表，修复 Windows 原生 select option 不可见的问题
// 支持泛型值类型（string | number），如 <Dropdown<number> value={0} options={[{value:0, label:'...'}]} />
export function Select<T extends string | number = string>({ value, onChange, options, className = '', placeholder, disabled, ariaLabel }: SelectProps<T>) {
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      options={options}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      ariaLabel={ariaLabel}
    />
  )
}
