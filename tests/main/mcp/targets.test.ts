// tests/main/mcp/targets.test.ts
//
// # MCP 多项目：项目 × 端口 的解析规则
//
// 这是"多链接"的地基：每个项目一个 SSE 端点、各自 token。
// 规则必须可测（不能靠启动一次看看）。
import { describe, it, expect } from 'vitest';
import { MCP_SSE_PORT } from '@shared/config/ports';
import {
  MAX_MCP_PROJECTS,
  resolveMcpBasePort,
  resolveMcpProjects,
  resolveMcpTargets,
} from '@main/mcp/targets';

describe('★ MCP 多项目：端口与项目解析', () => {
  it('端口：1/true = 默认；显式数字照用；空/非法 = 不启用', () => {
    expect(resolveMcpBasePort(undefined)).toBe(0);
    expect(resolveMcpBasePort('')).toBe(0);
    expect(resolveMcpBasePort('1')).toBe(MCP_SSE_PORT);
    expect(resolveMcpBasePort('true')).toBe(MCP_SSE_PORT);
    expect(resolveMcpBasePort('5000')).toBe(5000);
    expect(resolveMcpBasePort('abc')).toBe(0);
    expect(resolveMcpBasePort('-1')).toBe(0);
  });

  it('项目：逗号分隔、去重、去空、封顶', () => {
    expect(resolveMcpProjects({ projects: ' /a , /b ,/a ', cwd: '/c' })).toEqual(['/a', '/b']);
    expect(resolveMcpProjects({ project: '/one', cwd: '/c' })).toEqual(['/one']);
    expect(resolveMcpProjects({ cwd: '/cwd' })).toEqual(['/cwd']);
    const many = Array.from({ length: 8 }, (_, i) => '/p' + i).join(',');
    expect(resolveMcpProjects({ projects: many, cwd: '/c' })).toHaveLength(MAX_MCP_PROJECTS);
  });

  it('★ 每个项目一个端口（basePort 起递增）；端口非法 ⇒ 空表', () => {
    expect(
      resolveMcpTargets({ portRaw: '43190', projects: '/a,/b', cwd: '/c' }),
    ).toEqual([
      { projectPath: '/a', port: 43190 },
      { projectPath: '/b', port: 43191 },
    ]);
    expect(resolveMcpTargets({ portRaw: '', projects: '/a', cwd: '/c' })).toEqual([]);
  });
});
