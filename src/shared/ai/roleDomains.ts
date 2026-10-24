// src/shared/ai/roleDomains.ts
//
// **角色 × 作用对象**：谁在什么场景下，可以改哪一类东西。
//
// ## 规则只有一句话
//
// **读不分域，写才分域。** —— 这正是本仓库既有的原则：
// 「边界按**改什么**划，不按**能不能看**划：两个角色都能读流程与代码（自检、排查需要），
//   但写是互斥的」。
//
// 于是两个角色的差异被压缩成一行：
//   · 搭建者（低代码页）能**写界面**，不能写代码；
//   · 开发者（代码页）能**写代码**，不能写界面；
//   · 工程 / 数据 / 对外 / 观测 / 内部 —— 共享。
//
// ## 为什么要有它
//
// 在这之前，角色边界只体现在**30 个工具**上（手写数组），而**248 个能力**上没有任何边界：
// 站在低代码页的助手，一样可以提议 `plugin.setEnabled` 或 `customNode.fork`（都是"代码"域）。
// 手写数组还漂移过一次（加了 4 个工具却没进任何角色表）。
// 现在边界由**生成物**（DOMAIN_BY_NAMESPACE）派生 —— 新增能力自动获得正确的边界。
import { DOMAIN_BY_NAMESPACE } from './capabilityPolicy.generated';

/** 两个角色（页面）—— 与 `agents.ts` 同一份定义，避免两处各写一个 */
/**
 * 助手**模式**：低代码页 = 流程助手，代码页 = 代码助手。
 *
 * 放 shared 是因为**两边都要用**：主进程按它选工具集与提示词（见 agents.ts 的 roleForMode），
 * 渲染层按它显示当前身份、并按用户选择覆盖（2026-10-10 加）。
 */
/**
 * `duo` = **双向模式**（2026-10-10 用户提）：同一次对话里**流程与代码都能动**。
 *
 * 为什么需要它：造一个自定义节点 + 接进流程，本来就是一件事 ——
 * 但代码助手没有 add_node（造完接不上），流程助手没有 write_code（接上了改不了），
 * 于是要切两次页面、说两遍话。duo 就是给这种情况的显式出口。
 * ⚠️ 它**削弱了防串味**（改动可能同时出现在画布和代码里），所以只能是**用户显式选**，绝不做默认。
 */
/**
 * `creator` = **创作模式**（2026-10-15 用户提，参照 DSH 的 cordis 模式）：
 * **用对话给这个应用本身加新功能**（新节点 / 新面板 / 新能力）。
 *
 * 与前三档的本质区别：前三档改的是**用户的机器人项目**，这一档改的是**应用自己**。
 * 所以它有一条别处没有的前置条件 —— 必须先在界面里进入**框架工作区**
 * （见 services/devBackup：写前强制备份 + 回退点 + 顶栏徽标）。
 * 这条前置条件**不在这一层判**（这里只有类型），落在工具集/提示词（agents.ts）与
 * 渲染层的引导上；写权限真正由**主进程的框架开发模式**把关 —— 没开就是写不了。
 */
export type AgentMode = 'blocks' | 'code' | 'duo' | 'creator';

/**
 * `creator`（创作模式）也是**一个角色**（2026-10-15 P1-8）：
 * 它改的是**这个应用自己**（框架工作区里），而不是用户的机器人项目。
 * 与 duo 的区别：duo 是"流程+代码一次做完"（同一个项目内），
 * creator 是"给应用加功能"（跨到框架根，必须先由用户进工作区）。
 */
export type AgentRole = 'builder' | 'coder' | 'duo' | 'creator';

/**
 * **模式 → 角色**（唯一映射）。
 *
 * 为什么要放进 shared：主进程按它选工具/提示词，渲染层按它显示当前身份、
 * 并把用户选的预设翻译成角色按钮的高亮 —— 两边各写一份的话，加一档角色
 * 就会漂成"界面显示 A、主进程跑 B"（这类漂移在本仓库出现过两次）。
 */
export const ROLE_OF_MODE: Record<AgentMode, AgentRole> = {
  blocks: 'builder',
  code: 'coder',
  duo: 'duo',
  creator: 'creator',
};

/** 角色 → 它能从"页面"被推出来的模式（反查；用于把预设的角色回填到角色按钮） */
export const MODE_OF_ROLE: Record<AgentRole, AgentMode> = {
  builder: 'blocks',
  coder: 'code',
  duo: 'duo',
  creator: 'creator',
};

/** 人看的角色名（写进提示词/错误信息，不要只写 builder） */
export const ROLE_LABEL: Record<AgentRole, string> = {
  builder: '搭建者（低代码页）',
  coder: '开发者（代码页）',
  duo: '双向助手（流程 + 代码）',
  creator: '创作助手（给应用自己加功能）',
};

/**
 * **可写的工具域**（2026-10-18 归一）。
 *
 * 以前"这个角色能改什么"有两份写法：agents.ts 的工具子集、本文件的 writeDomains。
 * 两处都是手写的，改一处漏一处就会给出**互相矛盾**的结论
 * （典型：builder 手上有 create_ai_node 能写代码，但代码域的能力提案却被拦）。
 * 现在两边都从同一个 profile 派生 —— 加角色/改边界只动这一处。
 */
export type ToolArea = 'flow' | 'code-file' | 'code-gen';

export interface RoleWriteProfile {
  /** 可 proposal 的能力作用域（M 层） */
  writeDomains: readonly string[];
  /** 可用的工具域（与上面同一份认知：改流程 / 改代码文件 / 生成代码） */
  toolAreas: readonly ToolArea[];
}

/**
 * 角色 × 能改什么 —— **唯一真源**。
 *
 * ⚠️ 读不分域、写才分域（文件头那条原则）。只读工具的归属不在这里，在 agents.ts 的 SHARED。
 * ⚠️ creator 只给 code-file：它是给**应用自己**加功能，不碰用户项目的流程，
 *    也不生成用户项目的代码（generate_code / create_ai_node 那两个作用在用户项目上）。
 */
export const ROLE_WRITE_PROFILE: Record<AgentRole, RoleWriteProfile> = {
  builder: {
    writeDomains: ['界面', '工程', '数据', '对外', '观测', '内部'],
    toolAreas: ['flow', 'code-gen'],
  },
  coder: {
    writeDomains: ['代码', '工程', '数据', '对外', '观测', '内部'],
    toolAreas: ['code-file', 'code-gen'],
  },
  duo: {
    writeDomains: ['界面', '代码', '工程', '数据', '对外', '观测', '内部'],
    toolAreas: ['flow', 'code-file', 'code-gen'],
  },
  creator: {
    writeDomains: ['界面', '代码', '工程', '数据', '对外', '观测', '内部'],
    toolAreas: ['code-file'],
  },
};

/** 写允许的作用对象（由 profile 派生；保留导出名，调用方零改动） */
export const ROLE_WRITE_DOMAINS: Record<AgentRole, readonly string[]> = {
  builder: ROLE_WRITE_PROFILE.builder.writeDomains,
  coder: ROLE_WRITE_PROFILE.coder.writeDomains,
  duo: ROLE_WRITE_PROFILE.duo.writeDomains,
  creator: ROLE_WRITE_PROFILE.creator.writeDomains,
};

/** 这条能力碰的是什么（取命名空间的作用对象）；未登记返回 null */
export function domainOfCapability(capabilityId: string): string | null {
  return DOMAIN_BY_NAMESPACE[capabilityId.split('.')[0]] ?? null;
}

/** 当前角色能不能**改**这条能力（只读能力恒为 true，由调用方按层判断） */
export function mayRoleWrite(role: AgentRole, capabilityId: string): boolean {
  const domain = domainOfCapability(capabilityId);
  if (!domain) return false; // 未登记 = 不放行（fail-closed）
  return ROLE_WRITE_DOMAINS[role].includes(domain);
}

/** 越界时的说明：**要能指导下一步**，而不是只说"不行" */
export function roleBoundaryMessage(role: AgentRole, capabilityId: string): string {
  const domain = domainOfCapability(capabilityId) ?? '未登记';
  /**
   * "这是谁的活"：builder ↔ coder 互为对方；duo / creator 两边都能干（见 ROLE_WRITE_DOMAINS），
   * 所以这里对它们指向 coder —— 这只是**提示语**（真要触发只会在"未登记域"那种边缘情况），
   * 但它必须给一个可执行的下一步，而不是只说"不行"。
   */
  const other: AgentRole = role === 'coder' ? 'builder' : 'coder';
  return (
    `「${capabilityId}」属于「${domain}」作用域，而当前是${ROLE_LABEL[role]}的页面，不能改它。` +
    `这类改动是${ROLE_LABEL[other]}的活 —— 让用户切到那一页，或者换一个不越界的做法。`
  );
}

/**
 * **项目里的路径 → 作用对象**（与 DOMAIN_BY_NAMESPACE 同一套词：界面 / 代码 / 数据 / 对外 / 观测 / 内部 / 工程）。
 *
 * 为什么要它：能力层已经有 `domainOfCapability`（按命名空间），但**循环链路**的写工具是
 * 通用文件写（write_file），没有"命名空间"可查 —— 只有路径。两套口径不统一，
 * 同一个角色就会出现"文件能写、提案被拦"，或者反过来的自相矛盾。
 *
 * 只判**写**：读不分域（与文件头那条原则一致）—— 两个角色都能读流程和代码，那是自检要用的。
 *
 * 归类规则刻意**粗**（宁可少几档，不要一个永远对不齐的大表）：
 *   · `.qqbat/flow.json`、`.qqbat` 下的面板/模板/按钮 → **界面**（低代码页的产物）
 *   · `data/` → **数据**；`src/`、`plugins/` 与代码扩展名 → **代码**
 *   · `.env` / docker / compose / yml → **对外**（部署面）；日志/历史 → **观测**
 *   · 其余（含 package.json、docs、未知路径）→ **工程**
 */
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|py)$/i;

export function domainOfProjectPath(relPath: string): string {
  const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!p) return '工程';
  if (p === '.qqbat/flow.json') return '界面';
  if (p.startsWith('.qqbat/')) {
    const name = p.slice('.qqbat/'.length);
    if (/^(?:panel|template|button)/i.test(name)) return '界面';
    if (/\.(?:jsonl|log)$/i.test(name)) return '观测';
    return '内部';
  }
  if (p.startsWith('data/')) return '数据';
  if (p.startsWith('src/') || p.startsWith('plugins/')) return '代码';
  if (CODE_EXT.test(p)) return '代码';
  if (/^(?:\.env|\.env\.)|^(?:Dockerfile|docker-compose|compose)/i.test(p)) return '对外';
  if (/\.ya?ml$/i.test(p)) return '对外';
  return '工程';
}

/** 当前角色能不能**写**这个项目文件（读不受限） */
export function mayRoleWritePath(role: AgentRole, relPath: string): boolean {
  return ROLE_WRITE_DOMAINS[role].includes(domainOfProjectPath(relPath));
}

/**
 * 越界时的说明：与 `roleBoundaryMessage` 同一要求 —— **要能指导下一步**。
 * 循环链路里这句会变成工具失败的原因回灌给模型，所以必须给"怎么才能做"。
 */
export function rolePathBoundaryMessage(role: AgentRole, relPath: string): string {
  const domain = domainOfProjectPath(relPath);
  const other: AgentRole = role === 'coder' ? 'builder' : 'coder';
  return (
    `「${relPath}」属于「${domain}」作用域，当前是${ROLE_LABEL[role]}，不能写它。` +
    `这类改动是${ROLE_LABEL[other]}的活 —— 让用户切到那一页/换「双向」模式，或者换一个不越界的做法；` +
    '不要换个路径再试。'
  );
}
