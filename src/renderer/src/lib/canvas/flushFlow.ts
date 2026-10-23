// src/renderer/src/lib/canvas/flushFlow.ts
//
// # 架构：**读盘前先冲刷**（单一事实源的屏障）
//
// ## 问题（2026-10-01 架构评估）
//
// 流程状态存在**三份**：磁盘 `.qqbat/flow.json` · 主进程内存 · 渲染层 `flowStore`。
// 编辑期的权威在**渲染层**（用户眼前的画布），而主进程有一批能力是**读磁盘**的：
//
// · AI 链：上下文组装 / 预览图 / 提案校验基线 / `read_flow`
// · 数据模板：按 flow.json 里 `variable_persist` 的声明取**权威 key**
// · 面板注册表：面板配置来自 flow.json 的 `admin_panel` 节点
//
// 而自动保存有 **1.5s 防抖** —— 于是所有"改完立刻用"的路径都可能读到**旧图**：
//
//     改完画布立刻问 AI / 开数据面板 / 看面板列表
//     → 主进程按上次保存时的图办事（提案基线错、新 key 看不到、新面板不显示）
//
// **不报错、不崩溃**，只是"结果和你眼前的东西对不上"。
//
// ## 做法
//
// 所有这类入口在调用主进程前，先 `await flushFlow(projectPath)`。
// 用**非 force** 的 `saveNow` 是刻意的：
// · 干净时是 no-op（返回 true，不写盘）
// · 有改动才写
// · **加载失败时拒绝落盘**（防"用空画布覆盖作品"）、空画布也有保护
// —— 不会为了"同步"引入新的数据丢失风险。
//
// ## 边界（诚实说明）
//
// 这是"**读前冲刷**"，不是"一个权威"。真正的单源要主进程不再直接读盘、改由渲染层推送状态；
// 那是更大的迁移（15 个读盘点）。在那之前，这条屏障 + `flowReadBarrier` 闸门是**够用且可验证**的形态。
import { useFlowStore } from '@renderer/stores/flowStore';

/**
 * 把渲染层的画布冲刷到磁盘，让随后主进程的读盘看到**用户眼前的那张图**。
 *
 * @returns 磁盘是否已与内存一致（失败返回 false，但**不抛** —— 调用方不该因为同步失败而做不了事）
 */
export async function flushFlow(projectPath: string | undefined): Promise<boolean> {
  if (!projectPath) return false;
  try {
    return await useFlowStore.getState().saveNow(projectPath);
  } catch (e) {
    // 冲刷失败不阻断用户操作（他还是要用这个功能），但必须留痕
    console.error('[flushFlow] 画布冲刷失败（主进程可能读到旧图）', e);
    return false;
  }
}
