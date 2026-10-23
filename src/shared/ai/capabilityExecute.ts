// src/shared/ai/capabilityExecute.ts
//
// 执行一条"能力调用"提案操作的**完整链路**（可测版）。
//
// ## 为什么抽到这里
//
// 这条链路的每一环原本散在渲染层的一个私有函数里：守卫 → 参数解析 → 找方法 → 调用 → 判失败。
// 它是整条链上**唯一既没有测试、又没法靠闸门覆盖**的一环（其余环节都有单测），
// 而它恰恰是"用户点确认之后真正发生什么"的那一步。
//
// 抽出来的写法：**把 `window.qqbat` 作为参数传进来** ——
// 于是可以用一个假 API 把成功、失败、方法不存在、参数顺序全部测掉，
// 不需要真窗口、也不需要人点鼠标。
//
// 渲染层只负责把 `window.qqbat` 递进来 + 把失败翻译成界面文案。
import { guardCapabilityAttempt, resolveCapabilityArgs } from './capabilityGuard';
import type { CapabilityGuardOptions } from './capabilityGuard';

/** 渲染层 IPC 桥的形状（只需能按下标取到函数） */
type AnyApi = Record<string, Record<string, unknown> | undefined>;

export type CapabilityExecuteResult =
  { ok: true; id: string; value: unknown } | { ok: false; id: string; reason: string };

/**
 * 执行一条能力调用。**永不抛错** —— 失败以 `{ ok: false, reason }` 返回，
 * 由调用方决定怎么呈现（渲染层翻成文案并抛给提案的失败分支）。
 *
 * @param id          能力 id（`命名空间.方法`）
 * @param args        模型给的具名参数
 * @param projectPath 当前项目路径（注入用；模型不许指定别的）
 * @param api         IPC 桥（渲染层传 `window.qqbat`）
 */
export async function executeCapability(
  id: string,
  args: unknown,
  projectPath: string,
  api: unknown,
  /** 用户侧的守卫设置（渲染层从 preload 暴露的 ai.guardOptions 取） */
  guardOptions: CapabilityGuardOptions = {},
): Promise<CapabilityExecuteResult> {
  // ── ① 执行期复检（fail-closed）────────────────────────────────
  // 不信任"这条 op 是主进程给的"：提案可能来自旧版本、手搓文件、或将来某个 bug。
  const verdict = guardCapabilityAttempt(id, args, 'proposal', guardOptions);
  if (!verdict.ok) return { ok: false, id, reason: verdict.reason };

  // ── ② 具名参数 → 位置参数（projectPath 注入，不取模型的） ──────
  const resolved = resolveCapabilityArgs(id, args, projectPath);
  if (!resolved.ok) return { ok: false, id, reason: resolved.reason };

  // ── ③ 找到真实方法（找不到 = 界面没暴露，不是"执行失败"） ──────
  const [ns, method] = id.split('.');
  const bridge = (api ?? {}) as AnyApi;
  const fn = bridge[ns]?.[method];
  if (typeof fn !== 'function') {
    return { ok: false, id, reason: '应用能力不存在或未暴露给界面' };
  }

  // ── ④ 调用（IPC 统一返回 { ok, data }，失败要如实抛出） ────────
  try {
    const value = await (fn as (...a: unknown[]) => Promise<unknown>)(...resolved.positional);
    if (value && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
      const err = (value as { error?: unknown }).error;
      return { ok: false, id, reason: typeof err === 'string' && err ? err : '执行失败' };
    }
    return { ok: true, id, value };
  } catch (e) {
    return { ok: false, id, reason: e instanceof Error ? e.message : String(e) };
  }
}
