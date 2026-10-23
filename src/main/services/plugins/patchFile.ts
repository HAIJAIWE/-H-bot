// src/main/services/plugins/patchFile.ts
//
// 覆盖层落盘：`.qqbat/plugins.patch.json`（Phase A）。
// 容错读取：坏文件 = 空覆盖（回默认），永远不抛 —— 手改坏的配置不该让应用起不来。
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { PluginLayerEntry } from './layers';

const PATCH_FILE = 'plugins.patch.json';

/**
 * @param baseDir **应用级**插件数据目录（userData/plugins），不是项目目录。
 * 宿主插件是宿主能力，配置跟应用走；节点包才是项目资产（{项目}/plugins）。
 */
function patchPath(baseDir: string): string {
  return join(baseDir, PATCH_FILE);
}

export async function readPluginPatch(baseDir: string): Promise<PluginLayerEntry[]> {
  try {
    const raw = await readFile(patchPath(baseDir), 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: PluginLayerEntry[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      if (typeof m.id !== 'string' || !m.id) continue;
      if (m.disabled === undefined) {
        out.push({ id: m.id });
      } else if (typeof m.disabled === 'boolean') {
        out.push({ id: m.id, disabled: m.disabled });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function writePluginPatch(
  baseDir: string,
  overrides: readonly PluginLayerEntry[],
): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  const body = overrides.map((o) => (o.disabled === undefined ? { id: o.id } : o));
  await writeFile(patchPath(baseDir), JSON.stringify(body, null, 2) + '\n', 'utf-8');
}
