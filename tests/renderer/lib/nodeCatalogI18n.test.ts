// tests/renderer/lib/nodeCatalogI18n.test.ts
//
// P2「运行时语言打通」的闸门：证明切语言后 renderer 侧真的拿到新语言目录，
// 且**契约字段不受影响**。
//
// 这条链路容易被写成"看起来通了实际没通"：目录在 shared 层、locale 只在 renderer，
// 中间靠 `nodeCatalog.ts` 的语言桥（setCatalogLocale + bumpCatalog）连接。
// 只测 buildCatalog('en-US') 是不够的 —— 那只证明组装函数能跑，
// 不证明"用户点了 English 之后界面会变"。所以这里走真实的 i18n setLocale。
import { describe, it, expect, afterEach } from 'vitest';
import {
  findSpec,
  getAllSpecs,
  groupByGroup,
  getGroupDisplayName,
  getCatalogVersion,
  subscribeCatalog,
} from '@renderer/lib/nodeCatalog';
import { setLocale, getLocale } from '@renderer/i18n';
import { getFieldOptions } from '@shared/nodes/portOptions';
import { getCatalog } from '@shared/nodes/catalog/registry';
import type { NodeSpecV2 } from '@shared/types/nodeV2';

/** 取 V2 规格（findSpec 返回的是老的 NodeSpec 类型，没有 toolName/handler 等字段） */
function specV2(kind: string): NodeSpecV2 {
  const spec = getCatalog().find((s) => s.kind === kind);
  if (!spec) throw new Error(`目录里没有 ${kind}`);
  return spec;
}

afterEach(() => {
  // 每个用例后复位，避免污染同进程内的其它测试（目录语言是模块级状态）
  setLocale('zh-CN');
});

describe('运行时语言切换：renderer 目录随 locale 变化', () => {
  it('默认中文：message_send 显示中文名', () => {
    expect(getLocale()).toBe('zh-CN');
    expect(findSpec('message_send')?.label).toBe('发消息');
  });

  it('切到 English 后 findSpec 返回英文文案', () => {
    setLocale('en-US');
    const spec = findSpec('message_send');
    expect(spec?.label).toBe('Send message');
    // 端口名与端口说明也必须是英文（画布与属性面板直接显示它们）
    expect(spec?.inputs.find((p) => p.id === 'text')?.name).toBe('Text content');
    expect(spec?.description).not.toMatch(/[\u4e00-\u9fa5]/);
  });

  it('切到 English 后 toolName 保持中文（AI 工具调用契约不能翻译）', () => {
    setLocale('en-US');
    expect(specV2('message_send').toolName).toBe('发消息');
    expect(specV2('http_request').toolName).toBe('HTTP 请求');
  });

  it('切到 English 后 handler / defaultConfig / 选项 value 不变', () => {
    const zh = specV2('message_send');
    const zhHandler = zh.handler;
    const zhDefault = JSON.stringify(zh.defaultConfig);
    const zhValues = getFieldOptions('message_send', 'mode')!.map((o) => o.value);

    setLocale('en-US');

    const en = specV2('message_send');
    expect(en.handler).toEqual(zhHandler);
    expect(JSON.stringify(en.defaultConfig)).toBe(zhDefault);
    expect(getFieldOptions('message_send', 'mode')!.map((o) => o.value)).toEqual(zhValues);
  });

  it('切到 English 后 getFieldOptions 的 label 变英文（模块级索引按语言失效重建）', () => {
    expect(getFieldOptions('message_send', 'mode')!.map((o) => o.label)).toEqual([
      '纯文本',
      'Markdown / 按钮',
      '富媒体',
      '流式消息',
      '输入中状态（仅单聊）',
      '结构化卡片（仅频道）',
      'Embed 卡片（仅频道）',
      '消息段',
    ]);

    setLocale('en-US');

    expect(getFieldOptions('message_send', 'mode')!.map((o) => o.label)).toEqual([
      'Plain text',
      'Markdown / Button',
      'Rich media',
      'Stream message',
      'Typing state (private chat only)',
      'Structured card (channel only)',
      'Embed card (channel only)',
      'Message segment',
    ]);
    // 触发器没有输入端口，走 configFieldOptions 分支，也要跟着切
    expect(getFieldOptions('message_received', 'match')!.map((o) => o.label)).toContain(
      'Any message',
    );
  });

  it('分组键保持中文稳定键（NodePalette 图标判断/GROUP_ORDER 排序依赖它），显示名走查表', () => {
    setLocale('en-US');
    const groups = Object.keys(groupByGroup());
    // 键必须是稳定键：不能因为切英文就把 '消息' 变成 'Messages'，否则排序与图标判断全失效
    expect(groups).toContain('消息');
    expect(groups).not.toContain('Messages');
    expect(getGroupDisplayName('消息')).toBe('Messages');
    expect(getGroupDisplayName('触发器')).toBe('Triggers');
  });

  it('语言切换会通知目录订阅者（bumpCatalog 被触发）', () => {
    let notified = 0;
    const unsub = subscribeCatalog(() => {
      notified += 1;
    });
    const before = getCatalogVersion();

    setLocale('en-US');

    expect(getCatalogVersion()).toBeGreaterThan(before);
    expect(notified).toBeGreaterThan(0);
    unsub();
  });

  it('切回中文后完全恢复', () => {
    setLocale('en-US');
    expect(findSpec('message_send')?.label).toBe('Send message');

    setLocale('zh-CN');

    expect(findSpec('message_send')?.label).toBe('发消息');
    expect(getFieldOptions('message_send', 'mode')![0].label).toBe('纯文本');
  });

  it('getAllSpecs 的节点数与 kind 集合不随语言变化', () => {
    const zhKinds = getAllSpecs().map((s) => s.kind);
    setLocale('en-US');
    expect(getAllSpecs().map((s) => s.kind)).toEqual(zhKinds);
    // 76 个内置节点里有 5 个已弃用（getAllSpecs 会过滤），列表可见 71 个
    expect(zhKinds).toHaveLength(71);
  });
});
