// src/main/mcp/targets.ts
//
// **MCP 要服务哪些项目 / 用哪些端口**（2026-10-18）。
//
// 从 main/index.ts 的启动流程里抽出来，只为可测：解析 env 的规则（默认值、去重、上限、
// 端口递增）不该靠"启动一次看看"验证。
//
// 规则：
//   · QQBAT_MCP_SSE_PORT 未设/非正数 ⇒ 不启动 MCP（保持原行为）；
//   · QQBAT_MCP_PROJECTS（逗号分隔）优先；没设则退到 QQBAT_MCP_PROJECT；都没有 = 进程工作目录；
//   · 每个项目一个端口，从 basePort 起递增；重复路径去重；
//   · 最多 MAX_MCP_PROJECTS 个（再多收益远小于"多开一堆端口"的风险面）。
import { MCP_SSE_PORT } from '@shared/config/ports';

export interface McpTarget {
  projectPath: string;
  port: number;
}

/** 一条 MCP 连接 = 一个项目；上限防止"配了 20 个路径、开 20 个端口" */
export const MAX_MCP_PROJECTS = 5;

/** `1`/`true` = 默认端口；其余按数字；非法 = 0（= 不启用） */
export function resolveMcpBasePort(raw: string | undefined): number {
  const value = String(raw ?? '').trim();
  if (!value) return 0;
  if (value === '1' || value.toLowerCase() === 'true') return MCP_SSE_PORT;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** 解析项目列表（去重、去空、封顶） */
export function resolveMcpProjects(input: {
  projects?: string | undefined;
  project?: string | undefined;
  cwd: string;
}): string[] {
  const fromList = String(input.projects ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const list = fromList.length > 0 ? fromList : [input.project?.trim() || input.cwd];
  const unique = [...new Set(list)];
  return unique.slice(0, MAX_MCP_PROJECTS);
}

/** 生成"项目 × 端口"表；端口非法返回空数组（= 不启动） */
export function resolveMcpTargets(input: {
  portRaw: string | undefined;
  projects?: string | undefined;
  project?: string | undefined;
  cwd: string;
}): McpTarget[] {
  const basePort = resolveMcpBasePort(input.portRaw);
  if (basePort <= 0) return [];
  return resolveMcpProjects(input).map((projectPath, index) => ({
    projectPath,
    port: basePort + index,
  }));
}
