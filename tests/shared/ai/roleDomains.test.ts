// tests/shared/ai/roleDomains.test.ts
//
// # 角色 × 路径：循环链路的写域口径
//
// 能力层早就有 `domainOfCapability`（按命名空间），但循环链路的写工具是**通用文件写**，
// 手上没有命名空间、只有路径。两套口径不齐，同一个角色就会"文件能写、提案被拦"。
// 这里把路径归类钉死，并把四个角色的允许/拒绝矩阵钉死。
import { describe, it, expect } from 'vitest'
import {
  ROLE_WRITE_DOMAINS,
  domainOfProjectPath,
  mayRoleWritePath,
  rolePathBoundaryMessage,
  type AgentRole,
} from '@shared/ai/roleDomains'
import { AGENT_ROLE_HINT } from '@shared/ai/roleHints'

describe('★ 项目路径 → 作用对象（与能力层同一套词）', () => {
  const cases: Array<[string, string]> = [
    ['.qqbat/flow.json', '界面'],
    ['.qqbat/panel-main.json', '界面'],
    ['.qqbat/template-cards.json', '界面'],
    ['.qqbat/buttons.json', '界面'],
    ['.qqbat/agent-presets.json', '内部'],
    ['.qqbat/project.json', '内部'],
    ['.qqbat/chat.jsonl', '观测'],
    ['.qqbat/run.log', '观测'],
    ['data/players.json', '数据'],
    ['src/main/index.ts', '代码'],
    ['src/shared/ai/roleDomains.ts', '代码'],
    ['plugins/my-plugin/index.js', '代码'],
    ['scripts/build.mjs', '代码'],
    ['a.ts', '代码'],
    ['node_modules/.bin/x.py', '代码'],
    ['.env', '对外'],
    ['.env.local', '对外'],
    ['Dockerfile', '对外'],
    ['docker-compose.yml', '对外'],
    ['compose.prod.yaml', '对外'],
    ['deploy.yaml', '对外'],
    ['package.json', '工程'],
    ['docs/ai/x.md', '工程'],
    ['', '工程'],
  ]

  for (const [path, domain] of cases) {
    it(`${path || '(空)'} → ${domain}`, () => {
      expect(domainOfProjectPath(path)).toBe(domain)
    })
  }

  it('Windows 分隔符与 ./ 前缀不影响归类（主进程拿到的是 path.join 的结果）', () => {
    expect(domainOfProjectPath('src\\main\\index.ts')).toBe('代码')
    expect(domainOfProjectPath('.qqbat\\flow.json')).toBe('界面')
    expect(domainOfProjectPath('./data/x.json')).toBe('数据')
  })
})

describe('★ 角色 × 路径：写矩阵', () => {
  /** 每个角色只在"自己的产物"上有差别，其余共享 —— 差异全在这两格里 */
  const matrix: Array<[AgentRole, string, boolean]> = [
    // 搭建者：能写界面，不能写代码
    ['builder', '.qqbat/flow.json', true],
    ['builder', 'data/players.json', true],
    ['builder', 'package.json', true],
    ['builder', 'src/main/index.ts', false],
    ['builder', 'plugins/x/index.js', false],
    ['builder', 'a.ts', false],
    // 开发者：能写代码，不能写界面
    ['coder', 'src/main/index.ts', true],
    ['coder', 'a.ts', true],
    ['coder', '.qqbat/agent-presets.json', true],
    ['coder', '.qqbat/flow.json', false],
    ['coder', '.qqbat/panel-main.json', false],
    // 双向 / 创作：两边都动
    ['duo', '.qqbat/flow.json', true],
    ['duo', 'src/main/index.ts', true],
    ['creator', 'src/main/index.ts', true],
  ]

  for (const [role, path, allowed] of matrix) {
    it(`${role} ${allowed ? '可以写' : '不能写'} ${path}`, () => {
      expect(mayRoleWritePath(role, path)).toBe(allowed)
    })
  }

  it('读不分域：四个角色对同一条路径的结论只取决于它是"界面"还是"代码"', () => {
    // 只有 builder / coder 在这两类上相反；duo / creator 两边都放行
    expect(ROLE_WRITE_DOMAINS.builder).toContain('界面')
    expect(ROLE_WRITE_DOMAINS.builder).not.toContain('代码')
    expect(ROLE_WRITE_DOMAINS.coder).toContain('代码')
    expect(ROLE_WRITE_DOMAINS.coder).not.toContain('界面')
    for (const role of ['duo', 'creator'] as const) {
      expect(ROLE_WRITE_DOMAINS[role]).toContain('界面')
      expect(ROLE_WRITE_DOMAINS[role]).toContain('代码')
    }
  })
})

describe('★ 越界说明要给下一步（它会变成工具失败原因回灌给模型）', () => {
  it('点名路径、作用域、当前角色，并指向另一个角色', () => {
    const msg = rolePathBoundaryMessage('builder', 'src/main/index.ts')
    expect(msg).toContain('src/main/index.ts')
    expect(msg).toContain('代码')
    expect(msg).toContain('搭建者')
    expect(msg).toContain('开发者')
  })

  it('明说"别换个路径再试"——否则模型会拿别的路径重刷目录', () => {
    expect(rolePathBoundaryMessage('coder', '.qqbat/flow.json')).toContain('不要换个路径再试')
  })
})

describe('★ 角色说明（提示词层）', () => {
  it('四个角色都有非空说明，且互不相同（不能复制粘贴串味）', () => {
    const roles: AgentRole[] = ['builder', 'coder', 'duo', 'creator']
    const texts = roles.map(r => AGENT_ROLE_HINT[r])
    for (const t of texts) expect(t.length).toBeGreaterThan(40)
    expect(new Set(texts).size).toBe(4)
  })
})
