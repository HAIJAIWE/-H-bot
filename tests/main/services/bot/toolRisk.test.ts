// tests/main/services/bot/toolRisk.test.ts
//
// **工具风险闸门**的纯函数闸门（2026-10-18 P0 修复的回归）。
//
// 守的是这次致命漏洞的三个前提，缺一条漏洞就会回来：
//   ① `http_request` 声明 `sideEffects: []` 却会向任意 URL 发 HTTP —— 所以默认集
//       **不能**再按目录元数据推导，只能是显式白名单；
//   ② 显式放开 `http_request` 时，风险判据必须把它判成"网络外呼"并要求确认；
//   ③ 只读节点（不产生对外 I/O）不需要确认 —— 闸门按**能力类别**判，不搞"一律要确认"。
//
// 这里**不发起任何真实网络请求**：全部走 `defaultToolKinds` / `buildBotToolSpecs` /
// `riskClassOf` / `requiresConfirmation` 这些纯函数或只读目录。
import { describe, it, expect } from 'vitest';
import {
  EXPOSED_BY_DEFAULT,
  NETWORK_CAPABLE_KINDS,
  buildBotToolSpecs,
  defaultToolKinds,
  requiresConfirmation,
  riskClassLabel,
  riskClassOf,
} from '@main/services/bot/tools';

/** 从目录编译出某个 kind 的 spec（不存在时返回 undefined） */
function specOf(kind: string) {
  return buildBotToolSpecs([kind])[0];
}

describe('★ 默认工具集：显式白名单，不是元数据推导', () => {
  it('http_request 不在默认集里（旧推导规则会把它放进来）', () => {
    expect(defaultToolKinds()).not.toContain('http_request');
    expect(buildBotToolSpecs([]).map((s) => s.kind)).not.toContain('http_request');
  });

  it('默认集 == EXPOSED_BY_DEFAULT（注释里的白名单就是实现，不是两份说法）', () => {
    expect(defaultToolKinds()).toEqual([...EXPOSED_BY_DEFAULT]);
    expect(buildBotToolSpecs([]).map((s) => s.kind)).toEqual([...EXPOSED_BY_DEFAULT]);
  });

  it('★ 默认集里没有任何 kind 属于 net / api / msg / 写库 / 写文件类', () => {
    // 纯函数断言：不触网、不执行工具
    const risky = buildBotToolSpecs([])
      .map((s) => ({ kind: s.kind, risk: riskClassOf(s) }))
      .filter((x) => x.risk !== 'none');
    expect(risky, `默认集里混进了有风险能力的工具：${JSON.stringify(risky)}`).toEqual([]);
  });

  it('默认集里每个工具都不需要确认（默认即安全）', () => {
    for (const spec of buildBotToolSpecs([])) {
      expect(requiresConfirmation(spec), `${spec.kind} 在默认集里却要求确认`).toBe(false);
    }
  });
});

describe('★ http_request：元数据不可信，能力类别说了算', () => {
  it('它在目录里真的声明了 sideEffects: []（漏洞成因，防止被"修"回去）', () => {
    const spec = specOf('http_request');
    expect(spec, 'http_request 不在目录里了？那要重新核对 NETWORK_CAPABLE_KINDS').toBeTruthy();
    expect(spec!.sideEffects).toEqual([]);
  });

  it('★ 显式放开时判为网络外呼，必须确认', () => {
    const spec = specOf('http_request')!;
    expect(riskClassOf(spec)).toBe('net');
    expect(requiresConfirmation(spec)).toBe(true);
    expect(riskClassLabel('net').length).toBeGreaterThan(0);
  });

  it('其它"声明无副作用、实际能外呼"的 kind 也不漏（get_profile / AI 节点）', () => {
    for (const kind of ['get_profile', 'agent_chat', 'intent_classify', 'embedding']) {
      const spec = specOf(kind);
      if (!spec) continue; // 目录变了就跳过，不假装通过
      expect(riskClassOf(spec), `${kind} 能外呼却不算风险`).toBe('net');
      expect(requiresConfirmation(spec)).toBe(true);
    }
  });

  it('NETWORK_CAPABLE_KINDS 里的每个 kind 都真实存在（拼错会让防护静默失效）', () => {
    const unknown: string[] = [];
    const specs = buildBotToolSpecs([...NETWORK_CAPABLE_KINDS], (m) => unknown.push(m));
    // 目录里没有的 kind 会被静默忽略 —— 那样"外呼类必须确认"的名单就形同虚设
    expect(unknown, `这些 kind 在目录里查不到：${unknown.join(', ')}`).toEqual([]);
    expect(specs.length).toBe(NETWORK_CAPABLE_KINDS.length);
    for (const spec of specs) expect(riskClassOf(spec), `${spec.kind} 在名单里却不是 net`).toBe('net');
  });
});

describe('★ 只读节点不需要确认（闸门按能力类别判，不是"一律要确认"）', () => {
  it('riskClassLabel 每类都有中文说明（提示文案不许空）', () => {
    for (const risk of ['none', 'net', 'msg', 'write'] as const) {
      expect(riskClassLabel(risk).length, risk).toBeGreaterThan(0);
    }
  });

  it('写数据/写文件的 kind 判成 write，要确认', () => {
    for (const kind of ['db_write', 'persistent_op', 'file_operate']) {
      const spec = specOf(kind);
      if (!spec) continue; // 目录变了就跳过，不假装通过
      expect(['write', 'msg'], `${kind} 会落盘却不算风险`).toContain(riskClassOf(spec));
      expect(requiresConfirmation(spec)).toBe(true);
    }
  });

  it('发消息类判成 msg（发出去就撤不回）', () => {
    for (const kind of ['message_send', 'message_op']) {
      const spec = specOf(kind);
      if (!spec) continue;
      expect(riskClassOf(spec)).toBe('msg');
      expect(requiresConfirmation(spec)).toBe(true);
    }
  });

  it('纯数据拼装的节点是 none（否则用户会对所有工具条件反射点同意）', () => {
    const spec = specOf('message_compose');
    expect(spec, 'message_compose 不在目录里？默认白名单就空了').toBeTruthy();
    expect(riskClassOf(spec!)).toBe('none');
    expect(requiresConfirmation(spec!)).toBe(false);
  });

  it('默认集两条都判成 none（默认即安全，不能只靠注释声称）', () => {
    const risky = buildBotToolSpecs([])
      .map((s) => ({ kind: s.kind, risk: riskClassOf(s) }))
      .filter((x) => x.risk !== 'none');
    expect(risky, `默认集里混进了有风险能力的工具：${JSON.stringify(risky)}`).toEqual([]);
  });
});
