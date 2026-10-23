// 通用对话框焦点管理 hook：为非 <Modal> 渲染的对话框/抽屉/浮层提供 a11y 焦点能力。
//
// 解决 P0-D2：PropertyDrawer / CanvasNode AI 推荐浮层等自定义容器缺少
// role/aria/焦点陷阱/Esc 关闭/焦点回归的问题。
//
// 行为与 <Modal>（components/ui/Modal.tsx）保持一致：
// - 打开时保存触发元素焦点 → 聚焦到对话框容器
// - Esc 关闭；Tab 在容器内循环（焦点陷阱）
// - 关闭后焦点回归到触发元素
//
// 与 Modal 的 focusStack 互不干扰：每个 hook 实例各自保存「打开时的 activeElement」，
// 嵌套场景（抽屉内再开 Modal）下 LIFO 顺序天然正确：
//   抽屉打开(存触发) → Modal 打开(存抽屉内元素) → Modal 关(回抽屉) → 抽屉关(回触发)
//
// 注意：onClose 用 ref 持有，避免父组件传内联箭头函数时 effect 反复重跑
// （与 Modal.tsx 的 C1 修复同理）。

import { useEffect, useId, useRef } from 'react'

/** 可聚焦元素选择器（与 Modal.tsx 保持一致） */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * @param open 是否打开
 * @param onClose 关闭回调（用 ref 持有，不进入 effect 依赖，避免内联函数导致反复重绑）
 * @param options.labelledBy 可选；若提供则使用调用方传入的 id 作为 aria-labelledby，
 *                           否则用 hook 内部生成的 id（调用方需将该 id 绑定到标题元素）
 * @returns ref 绑定到对话框容器；同时返回 titleId 供 aria-labelledby 与标题元素共用
 */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  options?: { labelledBy?: string },
) {
  const ref = useRef<T>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const generatedTitleId = useId()
  const titleId = options?.labelledBy ?? generatedTitleId

  useEffect(() => {
    if (!open) {
      // 关闭：恢复触发元素焦点
      const prev = previousFocusRef.current
      if (prev && typeof prev.focus === 'function') {
        prev.focus()
      }
      previousFocusRef.current = null
      return
    }
    // 打开：保存当前焦点，聚焦到对话框容器
    previousFocusRef.current = document.activeElement as HTMLElement | null

    const dialog = ref.current
    if (!dialog) return
    dialog.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    // 捕获阶段监听，确保早于其它 keydown 处理（如画布快捷键）
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      // 卸载/关闭时回归焦点
      const prev = previousFocusRef.current
      if (prev && typeof prev.focus === 'function') {
        prev.focus()
      }
      previousFocusRef.current = null
    }
  }, [open])

  return { ref, titleId }
}
