// 从 BlockEditor.tsx 拆分而来（P0 批次 7）
// 右键菜单渲染组件：节点右键菜单 + 画布空白右键菜单
import { memo } from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

interface BlockContextMenuProps {
  /** 节点右键菜单位置（null = 关闭） */
  contextMenu: { x: number; y: number } | null;
  /** 节点右键菜单项 */
  contextMenuItems: ContextMenuItem[];
  /** 画布空白右键菜单位置（null = 关闭） */
  paneContextMenu: { x: number; y: number } | null;
  /** 画布空白右键菜单项 */
  paneContextMenuItems: ContextMenuItem[];
  /** 关闭节点右键菜单 */
  onCloseContextMenu: () => void;
  /** 关闭画布空白右键菜单 */
  onClosePaneContextMenu: () => void;
}

export const BlockContextMenu = memo(function BlockContextMenu({
  contextMenu,
  contextMenuItems,
  paneContextMenu,
  paneContextMenuItems,
  onCloseContextMenu,
  onClosePaneContextMenu,
}: BlockContextMenuProps) {
  return (
    <>
      {/* 节点右键菜单 */}
      {contextMenu && contextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={onCloseContextMenu}
        />
      )}

      {/* 画布空白右键菜单 */}
      {paneContextMenu && paneContextMenuItems.length > 0 && (
        <ContextMenu
          x={paneContextMenu.x}
          y={paneContextMenu.y}
          items={paneContextMenuItems}
          onClose={onClosePaneContextMenu}
        />
      )}
    </>
  );
});
