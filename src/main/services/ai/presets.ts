// src/main/services/ai/presets.ts
//
// **会话预设**（2026-10-19）：`.qqbat/agent-presets.json` —— 名字 → 工具白名单。
//
// 预设只约束**这一轮能用哪些工具**，不存提示词、不存模型参数：
// 工具表就是权限边界（提示词里写"别用某工具"是劝告，不是边界）。
//
// 文件格式（数组，容错读取）：
//   [{ "name": "只读巡检", "allowedTools": ["read_file", "list_dir"], "description": "..." }]
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface AgentPreset {
  name: string;
  /** 工具名白名单；缺省 = 不限制（等价于不传 allowedTools） */
  allowedTools?: string[];
  /**
   * 会话级插件集：只有这里列出的插件贡献的工具才进这一轮的工具表。
   * 缺省/空 = 不按插件限定（内置工具不受影响）。语义见 `services/plugins/scoping.ts`。
   */
  plugins?: string[];
  description?: string;
}

const PRESETS_FILE = 'agent-presets.json';
const NAME_MAX = 40;

function presetsPath(projectPath: string): string {
  return join(projectPath, '.qqbat', PRESETS_FILE);
}

/** 读预设：容错（坏文件 = 空表；坏条目跳过），永不抛 */
export async function readPresets(projectPath: string): Promise<AgentPreset[]> {
  try {
    const raw = await readFile(presetsPath(projectPath), 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: AgentPreset[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      if (!name || name.length > NAME_MAX) continue;
      const tools = Array.isArray(m.allowedTools)
        ? m.allowedTools.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : undefined;
      const plugins = Array.isArray(m.plugins)
        ? m.plugins.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : undefined;
      out.push({
        name,
        ...(tools && tools.length > 0 ? { allowedTools: [...new Set(tools)] } : {}),
        ...(plugins && plugins.length > 0 ? { plugins: [...new Set(plugins)] } : {}),
        ...(typeof m.description === 'string' ? { description: m.description } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 按名字取预设的工具白名单。
 * 找不到 / 预设没有白名单 → undefined（= 不限制）。
 */
export async function resolvePresetTools(
  projectPath: string,
  name: string,
): Promise<string[] | undefined> {
  const presets = await readPresets(projectPath);
  return presets.find((p) => p.name === name)?.allowedTools;
}

/** 按名字取整条预设（插件集等字段要用；找不到 = undefined） */
export async function readPreset(
  projectPath: string,
  name: string,
): Promise<AgentPreset | undefined> {
  const presets = await readPresets(projectPath);
  return presets.find((p) => p.name === name);
}

/** 写预设（整表覆盖；名字去重，后者覆盖前者） */
export async function writePresets(
  projectPath: string,
  presets: AgentPreset[],
): Promise<void> {
  const byName = new Map<string, AgentPreset>();
  for (const p of presets) {
    const name = String(p.name ?? '').trim();
    if (!name || name.length > NAME_MAX) continue;
    byName.set(name, {
      name,
      ...(p.allowedTools && p.allowedTools.length > 0
        ? { allowedTools: [...new Set(p.allowedTools.filter((t) => typeof t === 'string' && t))] }
        : {}),
      ...(p.plugins && p.plugins.length > 0
        ? { plugins: [...new Set(p.plugins.filter((t) => typeof t === 'string' && t))] }
        : {}),
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
    });
  }
  const dir = join(projectPath, '.qqbat');
  await mkdir(dir, { recursive: true });
  await writeFile(
    presetsPath(projectPath),
    JSON.stringify([...byName.values()], null, 2) + '\n',
    'utf-8',
  );
}
