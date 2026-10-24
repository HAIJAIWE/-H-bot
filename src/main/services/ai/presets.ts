// src/main/services/ai/presets.ts
//
// **会话预设**（2026-10-19）：`.qqbat/agent-presets.json` —— 名字 → 这一轮怎么跑。
//
// 最初只有工具白名单；2026-10-24 对齐 DSH 的 `agent-preset` 语义后多两件事：
//   · `role`   —— 这一轮用哪个**角色**（缺省 = 跟着页面走，见 shared/ai/roleDomains.ts）；
//   · `prompt` —— 这个预设的**附加要求**（拼进系统提示的角色强调句之后）。
//
// 仍然是"约束这一轮"，不存模型参数：模型是用户在设置里选的，预设不该偷偷换掉它。
// 工具表依旧是**权限边界**（提示词里写"别用某工具"是劝告，不是边界）——
// `prompt` 只是补充说明，真正越不越界看 `allowedTools` / `plugins` / 角色写域这三道闸。
//
// 文件格式（数组，容错读取）：
//   [{ "name": "只读巡检", "role": "coder", "prompt": "只读不改",
//      "allowedTools": ["read_file", "list_dir"], "description": "..." }]
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AgentRole } from '@shared/ai/roleDomains';

/** 角色值域（与 shared/ai/roleDomains 的 AgentRole 同源；这里只做运行时校验） */
const ROLES: readonly AgentRole[] = ['builder', 'coder', 'duo', 'creator'];
/** 附加要求的长度上限：太长会把角色强调句挤成背景噪声（提示词预算也是钱） */
const PROMPT_MAX = 2000;

export interface AgentPreset {
  name: string;
  /**
   * 这一轮的角色。缺省 = 跟着页面走（低代码页 builder / 代码页 coder）。
   * 显式写死才用，因为"切了页面角色不变"本身是个会让人困惑的行为。
   */
  role?: AgentRole;
  /** 附加要求（进系统提示；只在提示层，不是权限边界） */
  prompt?: string;
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

/** 角色字段容错：不认识的值当没写（拼错不该让整条预设失效，但也不能猜） */
function normalizeRole(value: unknown): AgentRole | undefined {
  return ROLES.find((r) => r === value);
}

/** 附加要求容错：去空白、截断到上限；空串当没写 */
function normalizePrompt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > PROMPT_MAX ? text.slice(0, PROMPT_MAX) : text;
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
      const role = normalizeRole(m.role);
      const prompt = normalizePrompt(m.prompt);
      out.push({
        name,
        ...(role ? { role } : {}),
        ...(prompt ? { prompt } : {}),
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
    const role = normalizeRole(p.role);
    const prompt = normalizePrompt(p.prompt);
    byName.set(name, {
      name,
      ...(role ? { role } : {}),
      ...(prompt ? { prompt } : {}),
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
