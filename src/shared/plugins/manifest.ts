// src/shared/plugins/manifest.ts
//
// **插件身份的共享契约**（2026-10-19）：id / name / version / description / permissions / requires。
//
// 三个地方都在用这组字段：渲染层插件、主进程插件、以及外部插件清单的校验。
// 之前各写一份校验，规则已经开始不一致（比如 id 字符集）。这里只统一"身份"，
// 不统一"能力语义"—— 渲染层只认 slot，主进程只认 tool/prompt，各自收窄。
export interface PluginIdentity<P extends string = string> {
  /** 全局唯一；建议 <作者>.<名字>；只允许字母数字与 . _ - */
  id: string;
  name: string;
  /** x.y.z */
  version: string;
  description?: string;
  /** 能力声明（语义由宿主解释） */
  permissions?: P[];
  /** 兼容性范围（如 >=0.1.0）；缺省 = 不限 */
  requires?: string;
}

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
export const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export type PluginIdentityResult<P extends string = string> =
  | { ok: true; value: PluginIdentity<P> }
  | { ok: false; error: string };

/**
 * 校验插件身份字段（清单的共同部分）。
 * 错误文案用英文：它会被渲染层/主进程共用，渲染层那边有"不许硬编码中文界面文案"的闸门。
 */
export function validatePluginIdentity<P extends string = string>(
  raw: unknown,
): PluginIdentityResult<P> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'manifest must be an object' };
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !PLUGIN_ID_PATTERN.test(m.id)) {
    return { ok: false, error: 'manifest.id is missing or has invalid characters' };
  }
  if (typeof m.name !== 'string' || m.name.trim() === '') {
    return { ok: false, error: 'manifest.name is required' };
  }
  if (typeof m.version !== 'string' || !PLUGIN_VERSION_PATTERN.test(m.version)) {
    return { ok: false, error: 'manifest.version must be x.y.z' };
  }
  const permissions: string[] = [];
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) return { ok: false, error: 'manifest.permissions must be an array' };
    for (const p of m.permissions) {
      if (typeof p !== 'string') return { ok: false, error: 'manifest.permissions must be strings' };
      permissions.push(p);
    }
  }
  return {
    ok: true,
    value: {
      id: m.id,
      name: m.name.trim(),
      version: m.version,
      ...(typeof m.description === 'string' ? { description: m.description } : {}),
      ...(permissions.length > 0 ? { permissions: permissions as P[] } : {}),
      ...(typeof m.requires === 'string' ? { requires: m.requires } : {}),
    },
  };
}
