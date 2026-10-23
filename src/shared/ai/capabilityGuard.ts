// src/shared/ai/capabilityGuard.ts
//
// 能力执行的**共享守卫**：主进程（提案期）与渲染层（执行期）必须调**同一个函数**。
//
// ## 为什么必须共享（2026-10-08 自查发现的真洞）
//
// 上一版把 fail-closed 白名单**只放在主进程**：主进程构造提案时校验，渲染层则
// 「拿到什么 op 就调什么」。于是一条手工构造的 `capability` op（例如 terminal.create）
// 可以直接穿过渲染层落到 IPC 上 —— 这就是"批准之后仍然不受限"的具体形态。
//
// 现在两个时点都过这道守卫，且读**同一份**白名单
// （`capabilityPolicy.generated.ts`，由文档附录 A/B/C 生成）。
//
// ## 判据（全部 fail-closed）
//
// 1. F 层（明确禁止）→ 一律拒绝，两个时点都是；
// 2. `direct`（直接调用）→ 必须在附录 B 白名单；
// 3. `proposal`（走提案）→ 必须在附录 C 白名单；
// 4. 参数里不许出现绝对路径 / 上级目录（纵深防御：目前白名单里的能力用不到，
//    但白名单一扩展它就是真正的护栏 —— 所以现在就钉住，别等出事再加）。
import {
  DESTRUCTIVE_CAPABILITIES,
  DESTRUCTIVE_OPTIONAL,
  DESTRUCTIVE_SIGNATURES,
  DESTRUCTIVE_TARGETS,
  DIRECT_CALL_SAFE,
  FORBIDDEN_CAPABILITIES,
  PROPOSABLE_CAPABILITIES,
  DIRECT_OPTIONAL,
  PROPOSABLE_OPTIONAL,
  PROPOSABLE_SIGNATURES,
  DIRECT_SIGNATURES,
} from './capabilityPolicy.generated';

/**
 * 调用方的**用户侧**设置。
 *
 * 为什么单独作为参数传进来、而不是在库里读环境变量：
 * 主进程与渲染层各有一份环境（渲染层读的是 preload 那一刻的 process.env），
 * 由调用方各自提供，库里就只负责**判据**这一件事。
 */
export interface CapabilityGuardOptions {
  /** 用户是否显式放行高危能力（★★★）。默认 false = 一条都提不出来。 */
  allowDestructive?: boolean;
  /** 目标白名单（例如允许发消息的会话）。**空数组 = 一律拒绝**，不是"不限制"。 */
  allowedTargets?: string[];
}

/** 两个调用时点：主进程构造提案 / 渲染层真正执行 */
export type CapabilityAttempt = 'direct' | 'proposal';

export type CapabilityGuardResult = { ok: true } | { ok: false; reason: string };

/** 绝对路径：Windows 盘符、UNC、POSIX 根 */
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\|\/)/;

/**
 * 参数里出现的"看起来像路径"的字符串逐个体检。
 *
 * ⚠️ **`projectPath` 必须跳过**（2026-10-08 实测抓到的 bug）：
 * 它是**绝对路径**且由调用方注入，如果这里也查，模型即使**原样回传当前项目路径**
 * 也会被以"不允许绝对路径"拒掉 —— 理由还是错的（真正该说的是"只作用于当前项目"）。
 * 这个参数由 `resolveCapabilityArgs` 单独管（注入 + 跨项目拒绝）。
 */
function inspectStringArgs(args: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(args)) {
    if (key === 'projectPath') continue;
    if (typeof value !== 'string') continue;
    if (ABSOLUTE_PATH_RE.test(value)) return `参数 ${key} 不允许绝对路径`;
    if (value.split(/[\\/]/).includes('..')) return `参数 ${key} 不允许上级目录`;
  }
  return null;
}

/**
 * 判断一次能力调用是否被允许。
 *
 * @param id      能力 id（`命名空间.方法`）
 * @param args    传给该能力的参数对象
 * @param attempt 调用时点：主进程构造提案用 `proposal`，直接调用用 `direct`
 */
export function guardCapabilityAttempt(
  id: string,
  args: unknown,
  attempt: CapabilityAttempt,
  opts: CapabilityGuardOptions = {},
): CapabilityGuardResult {
  if (!id) return { ok: false, reason: '能力 id 不能为空' };

  if (FORBIDDEN_CAPABILITIES.includes(id)) {
    return { ok: false, reason: `${id} 被明确禁止模型调用（等价于交出主机），两个时点都不放行` };
  }

  const isDestructive = DESTRUCTIVE_CAPABILITIES.includes(id);
  const allowList =
    attempt === 'direct'
      ? DIRECT_CALL_SAFE
      : [...PROPOSABLE_CAPABILITIES, ...DESTRUCTIVE_CAPABILITIES];
  if (!allowList.includes(id)) {
    return {
      ok: false,
      reason:
        attempt === 'direct'
          ? `${id} 不在"可直接调用"白名单里（可能因为它会写文件/联网/需要用户界面）`
          : `${id} 不在"可提议"白名单里`,
    };
  }

  // ── 高危能力（附录 D）：两道闸门，缺一不可 ──────────────────────
  if (isDestructive && attempt === 'proposal') {
    if (opts.allowDestructive !== true) {
      return {
        ok: false,
        reason:
          `${id} 是**高危能力**（退不回去），默认禁用。` +
          '要开放它，需要你（用户）显式设置环境变量 QQBAT_AI_ALLOW_DESTRUCTIVE=1 后重启应用。',
      };
    }
    const targetArg = DESTRUCTIVE_TARGETS[id];
    if (targetArg) {
      const list = opts.allowedTargets ?? [];
      if (list.length === 0) {
        return {
          ok: false,
          reason:
            `${id} 需要目标白名单，但 QQBAT_AI_ALLOWED_TARGETS 是空的。` +
            '**空 = 一律拒绝**（不是不限制）：请先写明允许的目标。',
        };
      }
      const provided = (
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {}
      )[targetArg];
      if (typeof provided !== 'string' || !list.includes(provided)) {
        return {
          ok: false,
          reason: `${id} 的目标 ${targetArg}=${String(provided)} 不在允许列表里`,
        };
      }
    }
  }

  if (args !== undefined && args !== null) {
    if (typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, reason: '参数必须是一个对象' };
    }
    const bad = inspectStringArgs(args as Record<string, unknown>);
    if (bad) return { ok: false, reason: bad };
  }

  return { ok: true };
}

export type CapabilityArgsResult =
  { ok: true; positional: unknown[] } | { ok: false; reason: string };

/**
 * 把模型给的**具名参数**翻译成调用该 IPC 方法所需的**位置参数**。
 *
 * 为什么需要这一步：IPC 方法的签名五花八门（`fn(a, b)` / `fn(obj)`），
 * 而模型给的是具名对象。与其要求所有方法都改成单对象签名（那是改造 200+ 个 handler），
 * 不如在附录 C 里**逐条声明调用约定**（`- id (a, b)`），这里按表取值。
 *
 * ## `projectPath` 是特殊参数（硬约束）
 *
 * 它**不从模型给的参数里取**，而是注入**当前项目路径** —— 否则模型可以提议去改
 * **另一个项目**（本仓库已经出过一次「一个项目的图写进了另一个项目」的事故）。
 * 如果模型显式给了一个**不同**的 projectPath，直接拒绝并说明原因：
 * 那要么是它搞错了，要么是在试探边界，两种情况都该让它看见。
 */
export function resolveCapabilityArgs(
  id: string,
  args: unknown,
  /**
   * 当前项目路径；**提案期还不知道**时传 `null` —— 那时只查"其它参数齐不齐"，
   * 不注入也不做跨项目校验（真正的注入与校验发生在渲染层执行期）。
   */
  projectPath: string | null,
  /** 调用时点：决定读哪张调用约定表（附录 B 还是附录 C） */
  attempt: CapabilityAttempt = 'proposal',
): CapabilityArgsResult {
  const table =
    attempt === 'direct'
      ? DIRECT_SIGNATURES
      : { ...PROPOSABLE_SIGNATURES, ...DESTRUCTIVE_SIGNATURES };
  const signature = table[id];
  if (!signature) {
    return { ok: false, reason: `${id} 没有登记调用约定（附录 C 要求每条都写参数表）` };
  }
  const provided = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<
    string,
    unknown
  >;

  if (
    projectPath !== null &&
    'projectPath' in provided &&
    typeof provided.projectPath === 'string' &&
    provided.projectPath &&
    provided.projectPath !== projectPath
  ) {
    return { ok: false, reason: '不允许指定其它项目：这个能力只能作用于当前打开的项目' };
  }

  // 附录 C 里写作 `参数?` 的是可选参数：模型省略就传 undefined（方法自己有默认行为）
  const optionalTable =
    attempt === 'direct' ? DIRECT_OPTIONAL : { ...PROPOSABLE_OPTIONAL, ...DESTRUCTIVE_OPTIONAL };
  const optional = new Set(optionalTable[id] ?? []);

  const positional: unknown[] = [];
  for (const param of signature) {
    if (param === 'projectPath') {
      positional.push(projectPath);
      continue;
    }
    if (!(param in provided) || provided[param] === undefined) {
      if (optional.has(param)) {
        positional.push(undefined);
        continue;
      }
      const required = signature.filter((p) => p !== 'projectPath' && !optional.has(p));
      return {
        ok: false,
        reason: `缺少参数 ${param}（${id} 的必填参数：${required.join(', ')}）`,
      };
    }
    positional.push(provided[param]);
  }
  return { ok: true, positional };
}
