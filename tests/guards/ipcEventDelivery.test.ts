// tests/guards/ipcEventDelivery.test.ts
//
// # 闸门：主进程 `webContents.send` 出去的通道，preload 必须有 `ipcRenderer.on`
//
// ## 为什么要有它（2026-10-06 审查抓到的 P0）
//
// 主进程有 5 处在发 `ai:error` / `ai:warning`（密钥错 / 断网 / 规划超时 / 已取消），
// 而 preload 里**一个监听都没有** —— 于是错误对用户完全不可见，界面还停在 streaming:true
// （输入框永久禁用）。既有的 `ipcReachability` 只查 `invoke` 方向的通道，
// **单向事件（send → on）从来没人对账**。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** 已知扫不到的发送方式（用变量拼通道名）—— 保持为空，否则等于给闸门开后门 */
const INVISIBLE_SENDERS: Record<string, string> = {};

/**
 * **有意双发、但已无 preload 监听**的旧事件名（迁移窗口内）。
 *
 * 与 `INVISIBLE_SENDERS` 的区别：那个是"闸门看不见"，这个是"我们**看得见**，故意留着"。
 * 每条都必须写清取代关系，并在**下一个 minor** 连同主进程的旧 emit 一起删。
 */
const LEGACY_DUAL_EMIT: Record<string, string> = {
  'official:statusChange': '5.3：旧名，新名为 official:statusChanged（主进程双发一个 minor）',
};

/**
 * preload 有监听、但主进程**扫不到字面量发送点**的通道（反向豁免表）。
 *
 * 与 INVISIBLE_SENDERS 的区别：那个是「发了但闸门看不见」，这个是「听了但闸门看不见有人发」。
 * 每条都必须写清理由与兜底，并在下一个 minor 收敛（要么补发送方，要么删监听）。
 */
const LISTENER_ONLY_OK: Record<string, string> = {
  // 通道名是运行时拼的：`${prefix}:${name}`，静态扫描的已知盲区
  'resourceMonitor:*': 'services/runner/resourceMonitor.ts 循环里拼通道名，静态扫描盲区（有 resourceMonitor 自身用例兜底）',
  // 状态推送已经统一到 botManager:statusChanged（src/main/ipc/botManager.ts:12）
  'official:statusChanged': '发送方已改名 botManager:statusChanged；旧监听保留一个 minor，下一个 minor 连同 preload 的 official.onStatusChange 一起删',
};

/** 通道是否落在反向豁免表里（支持 `前缀:*` 通配） */
export function listenerOnlyAllowed(channel: string): boolean {
  if (channel in LISTENER_ONLY_OK) return true;
  return Object.keys(LISTENER_ONLY_OK).some(
    (k) => k.endsWith(':*') && channel.startsWith(k.slice(0, -1)),
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** 扫主进程里字面量通道的发送点。
 *
 * 认四种形态（都要求通道是**字符串字面量**，变量拼名仍算盲区）：
 *   win.webContents.send('x', …)     —— 直接发
 *   win.webContents.send("x", …)     —— 同上，双引号（恢复树里大量是这种，原来的单引号正则全漏了）
 *   emit('x', payload)                —— 注入式 emit 包装（ipc/aiAgentCore 的 emit、toolApproval 的注入 emit）
 *   sendToXxx('x', …)                 —— 转发 helper
 *
 * ⚠️ 之前只匹配单引号，于是 ai:toolCall / ai:proposal / ai:agentStep 全被判成「没人发」，
 * 白名单越加越多 —— 那是扫描器坏了，不是代码坏了。
 */
/** 这些接收者的 emit 是**进程内 EventEmitter**，不是往窗口发（services/official/client.ts 的 emitter 就是这种） */
const IN_PROCESS_EMITTERS = new Set(['this', 'emitter', 'bus', 'hub', 'events', 'ee', 'eventEmitter']);

export function collectSentChannels(files: readonly string[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    const source = readFileSync(f, 'utf-8');
    // ① 窗口直发（单引号与双引号都算 —— 恢复树里大量是双引号）
    for (const m of source.matchAll(/webContents\s*\.\s*send\s*\(\s*['"]([^'"]+)['"]/g)) set.add(m[1]);
    // ② 注入式 emit 包装（ipc/aiAgentCore 的 `const emit = …`、toolApproval 的 `opts.emit`）。
    //    通道必须带 namespace 冒号；带接收者时排除进程内 EventEmitter（this.emit / emitter.emit）。
    for (const m of source.matchAll(/(?:([A-Za-z_$][\w$]*)\.)?emit\s*\(\s*['"]([A-Za-z][\w-]*:[^'"]+)['"]/g)) {
      const receiver = m[1];
      if (receiver && IN_PROCESS_EMITTERS.has(receiver)) continue;
      set.add(m[2]);
    }
    // ③ 转发 helper（sendToMain / sendToWindow …）
    for (const m of source.matchAll(/\bsendTo[A-Za-z]*\s*\(\s*['"]([A-Za-z][\w-]*:[^'"]+)['"]/g)) set.add(m[1]);
  }
  return [...set].sort();
}

/** preload 里注册了监听的通道 */
export function collectListeningChannels(source: string): string[] {
  const set = new Set<string>();
  for (const m of source.matchAll(/ipcRenderer\.on\('([^']+)'/g)) set.add(m[1]);
  return [...set].sort();
}

/** 发了但没人听 → 事件被静默丢弃 */
export function missingListeners(sent: readonly string[], listening: readonly string[]): string[] {
  return sent.filter((c) => !listening.includes(c));
}

describe('闸门：主进程事件通道 ↔ preload 监听', () => {
  const mainFiles = walk(join(ROOT, 'src', 'main'));
  const sent = collectSentChannels(mainFiles);
  const listening = collectListeningChannels(
    readFileSync(join(ROOT, 'src', 'preload', 'index.ts'), 'utf-8'),
  );

  it('主进程发的每个字面量通道，preload 都有人在听', () => {
    const missing = missingListeners(sent, listening).filter(
      (c) => !(c in INVISIBLE_SENDERS) && !(c in LEGACY_DUAL_EMIT),
    );
    expect(missing, `这些事件发出去没人接（渲染层永远收不到）：${missing.join(', ')}`).toEqual([]);
  });

  it('反向对照：把 ai:error 从监听里拿掉，闸门必须报错', () => {
    const without = listening.filter((c) => c !== 'ai:error');
    expect(missingListeners(sent, without)).toContain('ai:error');
  });

  it('preload 监听的通道必须真的有人发（或明确豁免）', () => {
    const noSender = listening.filter((c) => !sent.includes(c));
    const offenders = noSender.filter((c) => !listenerOnlyAllowed(c));
    expect(
      offenders,
      `这些监听永远等不到事件（窗口卸载残留？）：${offenders.join(', ')}。` +
        '若确实是运行时拼通道名、或发送方已改名，登记进 LISTENER_ONLY_OK 并写清理由与收敛计划。',
    ).toEqual([]);
  });

  it('反向豁免表不许有幽灵（登记了但 preload 根本没监听）', () => {
    const ghosts = Object.keys(LISTENER_ONLY_OK).filter(
      (k) => !k.endsWith(':*') && !listening.includes(k),
    );
    expect(
      ghosts,
      `这些豁免已过期（preload 里没有对应监听，删掉登记）：${ghosts.join(', ')}`,
    ).toEqual([]);
  });
});
