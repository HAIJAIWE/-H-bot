// src/shared/files/readOnlyPaths.ts
//
// 「应用自己管理的文件」清单：编辑器里只读、AI 写入通道拒绝。
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js 的 //#region），逻辑与线上一致。
//
// 只有**会被应用整体覆盖**的文件才锁 —— 其余（history/ 快照、日志、备份、data/…）
// 改了不会被应用冲掉，没有必要锁。

/** 以 / 结尾 = 目录前缀；其余 = 精确匹配（与 shared/files/securityCriticalPaths.ts 同一套约定） */
export const READ_ONLY_PATHS: readonly string[] = [
  '.qqbat/flow.json',
  '.qqbat/button_panels.json',
  '.qqbat/project.json',
  'src/plugins/generated/',
  'src/plugins/exported/',
];

export function isAppManagedReadOnly(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, '/');
  return READ_ONLY_PATHS.some((prefix) =>
    prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix,
  );
}
