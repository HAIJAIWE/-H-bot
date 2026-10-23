// src/shared/plugins/version.ts
//
// **插件版本范围**（2026-10-18）：渲染层插件与主进程插件共用同一份判定。
//
// 为什么放 shared：两边都在答"这个插件能不能在这版宿主上用"，写两份判据迟早出现
// "界面说兼容、主进程拒绝加载"这种自相矛盾。解析与比较都很小，共享是划算的。
//
// 支持：>=x.y.z / <=x.y.z / ^x.y.z（同主版本）/ ~x.y.z（同主次）/ 精确 x.y.z。
// 看不懂的范围一律 **不兼容**（fail-closed）—— 宁拒不半新半旧地用坏。
export type PluginVersion = [number, number, number];

export function parsePluginVersion(v: string): PluginVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a: PluginVersion, b: PluginVersion): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function satisfiesPluginRange(hostVersion: string, range: string | undefined): boolean {
  if (!range || range.trim() === '') return true;
  const m = /^(>=|<=|\^|~|=)?\s*(\d+\.\d+\.\d+)$/.exec(range.trim());
  if (!m) return false;
  const op = m[1] ?? '=';
  const target = m[2];
  const host = parsePluginVersion(hostVersion);
  const want = parsePluginVersion(target);
  if (!host || !want) return false;
  const cmp = compare(host, want);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '^':
      return cmp >= 0 && host[0] === want[0];
    case '~':
      return cmp >= 0 && host[0] === want[0] && host[1] === want[1];
    default:
      return cmp === 0;
  }
}
