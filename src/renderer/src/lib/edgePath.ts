// src/renderer/src/lib/edgePath.ts
//
// 边的路径几何。抽成纯函数是为了**能测** —— 路径字符串对不对，
// 靠肉眼看画布是发现不了的（尤其"往回走"那种边）。
//
// ## 为什么需要"回退边绕行"
//
// 列表式布局是**一条链一行、从左往右**（见 `autoLayout.ts`）。但图里存在语义上
// **真的往回走**的边 —— 例如：
//
//     branch_if ──true──► rpg_bag     （rpg_bag 在第 2 个节点，branch_if 在第 15 个）
//
// 这不是布局算错，是**循环/重算**。真机实测最长的一条往回退了 **5070px**。
//
// 问题在于：这类边如果走一条贝塞尔，就是**几乎水平的一条直线，横穿中间所有节点**
// （用户原话：「为啥有红线呢…就是觉得这样的角度太奇怪了」）。
//
// 所以回退边改走**行下方的正交 U 形**：从源端口往右探一点 → 下潜到两节点下方 →
// 往左走 → 从目标端口的左边升上来。读者一眼能看出"这是绕回去的"，
// 而且**完全不压节点**。

/** 回退判定阈值：目标比源靠左超过这个像素数，就算"往回走" */
export const BACKWARD_MIN_DX = 40;

/** 从端口横向探出的长度（避免线贴着节点边框起步） */
const STUB = 28;

/**
 * 下潜深度（画布坐标）。
 *
 * 节点高约 98（`estimateNodeHeight`），端口分布在其内部，所以
 * `max(sourceY, targetY)` 至少已经到了节点中部。再下潜 64 就落到节点下方；
 * 而同一行到下一行的间距是 `NODE_HEIGHT_COLLAPSED(80) + LIST_BLOCK_GAP(140) = 220`，
 * 所以 64 也不会撞到下一行的节点。
 */
const DIP = 64;

/** 圆角半径（正交折线的拐角） */
const RADIUS = 10;

export interface EdgeGeometry {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

/**
 * 这条边是不是"往回走"（目标明显在源的左边）？
 *
 * 用**阈值**而不是 `targetX < sourceX`：同一列上上下对齐的两个节点
 * （dx 很小）不该被当成回退边绕一大圈。
 */
export function isBackwardEdge(g: EdgeGeometry): boolean {
  return g.targetX < g.sourceX - BACKWARD_MIN_DX;
}

/**
 * 回退边的绕行路径（正交 U 形，带圆角）。
 *
 * 形状示意（源在右、目标在左）：
 *
 * ```
 *   源 ●──┐                        ┌──● 目标
 *         └────────────────────────┘
 * ```
 *
 * @returns `path` 给 `<path d>`；`labelX/labelY` 是标签（分支名）的落点 ——
 *          放在 **U 形底部的中点**，而不是"两端连线中点"（那会落在节点上）
 */
export function buildBackwardEdgePath(g: EdgeGeometry): {
  path: string;
  labelX: number;
  labelY: number;
} {
  const { sourceX, sourceY, targetX, targetY } = g;
  // 源在右：往右探出；目标在左：从它的左边进来
  const xRight = sourceX + STUB;
  const xLeft = targetX - STUB;
  const yBottom = Math.max(sourceY, targetY) + DIP;

  const r = Math.min(RADIUS, Math.abs(xRight - xLeft) / 2);
  const path = [
    `M ${sourceX},${sourceY}`,
    `L ${xRight - r},${sourceY}`,
    `Q ${xRight},${sourceY} ${xRight},${sourceY + r}`,
    `L ${xRight},${yBottom - r}`,
    `Q ${xRight},${yBottom} ${xRight - r},${yBottom}`,
    `L ${xLeft + r},${yBottom}`,
    `Q ${xLeft},${yBottom} ${xLeft},${yBottom - r}`,
    `L ${xLeft},${targetY + r}`,
    `Q ${xLeft},${targetY} ${xLeft + r},${targetY}`,
    `L ${targetX},${targetY}`,
  ].join(' ');

  return {
    path,
    labelX: (xRight + xLeft) / 2,
    labelY: yBottom,
  };
}
