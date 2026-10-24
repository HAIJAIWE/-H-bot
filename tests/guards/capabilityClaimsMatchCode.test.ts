// tests/guards/capabilityClaimsMatchCode.test.ts
//
// # 闸门：能力清单里标 ✅ 的能力，**代码里必须真的有**
//
// ## 为什么（2026-10-05，被反复咬的那一类）
//
// 这一轮我一个人就修了 4~6 处「文档说已做、代码里没有」✗：
//   · 覆盖表写着「富媒体上传 ✅ URL 直链 **+ 本地文件分片上传**」—— 分片上传**从没实现** ✗
//   · 台账写着 9 个通知事件「已修」—— `git log -S` 证明**从没实现** ✗
//   · 面板文件头写着「能力自检**没接**」—— 实际早已注册 ✓（反向的过时也会误导）
//
// 这类问题的代价不是"文档错"，是**照着文档排期**的人（包括我）会做错决定 ✗。
//
// ## 判据
//
// 1. 清单里每个 ✅ 的**能力行**，都必须在下面的 `CLAIMS` 里登记
// 2. 登记的每个锚点，都必须能在 `src/` 里搜到（锚点消失 = 这一行在撒谎 → 红）
// 3. `CLAIMS` 里登记的 key，清单里必须还有那么一行（改了清单没同步这里 → 红）
//
// 也就是说：**改能力清单 = 同时改这张表**，想偷懒是不可能的 ✓
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DOC = join(ROOT, 'docs', 'platforms', 'QQ机器人官方能力清单.md');

/** 能力行（清单里第一列的稳定片段）→ 代码里必须存在的锚点 */
const CLAIMS: { row: string; anchors: string[] }[] = [
  // ── 覆盖表（§"已接入的 8 个接口 + 互动回调"）──
  { row: 'AccessToken 获取', anchors: ['getAppAccessToken'] },
  { row: 'WebSocket 网关', anchors: ['op: 2', 'op: 6'] },
  { row: '发送单聊 / 群聊消息', anchors: ['msg_type'] },
  { row: '流式消息', anchors: ['stream_messages'] },
  // ★ 就是这一行曾经撒谎：分片上传四步在代码里根本不存在
  { row: '富媒体上传', anchors: ['uploadLocalFileByParts', 'upload_part_finish'] },
  { row: '撤回消息', anchors: ['recallOfficialMessage'] },
  { row: 'keyboard 按钮', anchors: ['keyboard'] },
  { row: '引用回复', anchors: ['message_reference'] },
  { row: '互动回调', anchors: ['/interactions/'] },
  { row: 'QQ 群管理', anchors: ['restrict_chat_setting', 'batch_remove_members'] },
  { row: '群成员 · 入群申请 · 消息审核事件', anchors: ['GROUP_MEMBER_ADD', 'GROUP_JOIN_REQUEST'] },
  { row: '自定义菜单 / 指令面板', anchors: ['/v2/menu', '/v2/panels'] },
  { row: 'QQ 频道', anchors: ['send_channel_message', 'AT_MESSAGE_CREATE'] },
  // ── 覆盖表（§"2.4 频道私域 REST 家族"）：并入 channel_op 的 34 个模式，规格表与动作表同源 ──
  { row: '频道信息 · 机器人身份 · 接口权限', anchors: ['CHANNEL_REST_SPECS', 'api_permission/demand'] },
  { row: '身份组', anchors: ['/roles/', 'role_members'] },
  { row: '成员', anchors: ['member_list', 'member_remove'] },
  { row: '禁言（频道 / 成员 / 批量）', anchors: ['mute_seconds', 'mute_multi'] },
  { row: '子频道权限', anchors: ['member_perm_put', 'role_perm_put'] },
  { row: '频道私信', anchors: ['/users/@me/dms'] },
  { row: '日程', anchors: ['schedule_create', 'schedule_id'] },
  { row: '论坛帖子', anchors: ['thread_create', 'thread_id'] },
  { row: '消息详情', anchors: ['message_get'] },
  // ── 台账：事件层 ──
  { row: '✅ 已翻译', anchors: ['C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE'] },
  // 互动事件从「只翻一半」到端到端接通（10/24）：订阅位、翻译、回执 id 三处都要在
  { row: 'INTERACTION_CREATE', anchors: ['INTERACTION_CREATE', 'interaction_id'] },
  {
    row: '✅ 2026-10-04 补上',
    anchors: ['GROUP_ADD_ROBOT', 'SUBSCRIBE_MESSAGE_STATUS', 'GUILD_CREATE'],
  },
  // ── 台账：两个官方新参数 ──
  { row: 'force_verify_image_resource', anchors: ['force_verify_image_resource'] },
  { row: 'ark_type: picture', anchors: ['ark_type'] },
];

/** 所有 src 文件的文本（不按扩展名过滤 —— 上一轮吃过"漏扩展名"的亏 ✗） */
function readAllSrc(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      try {
        if (statSync(p).size > 3_000_000) continue;
        parts.push(readFileSync(p, 'utf-8'));
      } catch {
        /* 读不动就跳过（不因此让闸门红） */
      }
    }
  };
  walk(join(ROOT, 'src'));
  return parts.join('\n');
}

// 2026-10-23 恢复树说明：`docs/platforms/QQ机器人官方能力清单.md` 在 10/23 全盘清理里丢失，
// 磁带里也没有全文（只有局部读）。清单缺席时**跳过两条文档对账**，但**保留锚点对账** ——
// 它才是这条闸门的实质（文档说 ✅、代码里有没有），文档回来后再自动一并启用。
const HAS_DOC = existsSync(DOC);

describe('★ 能力清单的 ✅ 声明必须与代码一致', () => {
  const doc = HAS_DOC ? readFileSync(DOC, 'utf-8') : '';
  const src = readAllSrc();

  it.skipIf(!HAS_DOC)('每个登记的能力行，清单里都还找得到（改了清单要同步这里）', () => {
    const missing = CLAIMS.filter((c) => !doc.includes(c.row)).map((c) => c.row);
    expect(missing, '这些登记项在能力清单里已找不到 —— 清单改了，请同步 CLAIMS').toEqual([]);
  });

  it('★ 每个登记的锚点，都能在 src 里搜到（否则那一行在撒谎）', () => {
    const lies: string[] = [];
    for (const c of CLAIMS) {
      for (const a of c.anchors) {
        if (!src.includes(a)) lies.push(`${c.row} → 找不到锚点 "${a}"`);
      }
    }
    expect(lies, '能力清单标了 ✅，但代码里没有对应实现：\n' + lies.join('\n')).toEqual([]);
  });

  it.skipIf(!HAS_DOC)('★ 清单里每个 ✅ 的能力行都登记了（新增 ✅ 必须同时给锚点）', () => {
    /**
     * 只看三张**能力声明表** —— 用它们的**所在章节标题**定位，而不是"表头长什么样"。
     *
     * ⚠️ 第一版按表头匹配（`| 能力 |` 之类），结果把后面的"真机验证记录表"也吞进来了 ✗ ——
     * 那张表里的 ✅ 是**实测结果**（"机器人频道列表 ✅ 但返回数组[0]"），不是能力声明，
     * 不该要求它登记代码锚点。本章节的定位方式不会误伤 ✓
     */
    const SECTION_ANCHORS = [
      '已接入的 8 个接口 + 互动回调',
      '**事件层**',
      '两个官方新参数：已接上',
    ];
    const lines = doc.split('\n');
    const tables: string[] = [];
    for (const anchor of SECTION_ANCHORS) {
      const start = lines.findIndex((l) => l.includes(anchor));
      expect(start, `找不到章节：${anchor}`).toBeGreaterThan(-1);
      // 从该标题往下收表格行（跳过标题与表头/分隔行，遇到连续空行就停）
      let blank = 0;
      for (let j = start + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.startsWith('|')) {
          blank = 0;
          tables.push(line);
          continue;
        }
        if (line.trim() === '') {
          blank++;
          if (blank >= 2) break; // 表结束
          continue;
        }
        break; // 遇到正文 → 该表结束
      }
    }
    expect(tables.length, '一张目标表都没解析到（选择器失效了）').toBeGreaterThan(10);

    const uncovered = tables
      .filter((row) => row.includes('✅'))
      .filter((row) => !CLAIMS.some((c) => row.includes(c.row)))
      .map((row) => row.trim().slice(0, 90));
    expect(uncovered, '这些 ✅ 行没登记锚点：\n' + uncovered.join('\n')).toEqual([]);
  });

  it('防止空转：清单与锚点都足够多', () => {
    expect(CLAIMS.length).toBeGreaterThanOrEqual(15);
    if (HAS_DOC) expect(doc.length).toBeGreaterThan(5000);
    else expect(CLAIMS.length, '清单缺席时至少还有锚点对账').toBeGreaterThanOrEqual(15);
    expect(src.length).toBeGreaterThan(100000);
  });
});
