// tests/main/services/plugins/kernel.test.ts
//
// 插件内核（Cordis 最小内核）的语义契约：服务驱动激活、依赖级联卸载、effect 逆序回收。
import { describe, it, expect } from 'vitest';
import { PluginKernel } from '@main/services/plugins/kernel';

describe('★ 插件内核（服务容器）', () => {
  it('消费者先注册：依赖缺失时待命（不激活、不报错），服务出现后自动激活', () => {
    const kernel = new PluginKernel();
    const order: string[] = [];
    kernel.register({
      id: 'consumer',
      inject: ['tools'],
      activate: () => {
        order.push('consumer');
      },
    });
    expect(kernel.list().find((p) => p.id === 'consumer')).toMatchObject({
      active: false,
      missing: ['tools'],
    });
    kernel.provide('tools', { ok: true });
    expect(order).toEqual(['consumer']);
    expect(kernel.list().find((p) => p.id === 'consumer')?.active).toBe(true);
  });

  it('提供者卸载 → 服务消失 + 依赖它的插件级联卸载（先卸载依赖者）', () => {
    const kernel = new PluginKernel();
    const order: string[] = [];
    kernel.register({
      id: 'provider',
      activate: (ctx) => {
        ctx.provideService('tools', {});
        ctx.effect(() => order.push('provider:down'));
      },
    });
    kernel.register({
      id: 'consumer',
      inject: ['tools'],
      activate: (ctx) => {
        ctx.effect(() => order.push('consumer:down'));
      },
    });
    expect(kernel.requireService('tools')).toBeTruthy();
    kernel.unregister('provider');
    expect(order).toEqual(['consumer:down', 'provider:down']);
    expect(() => kernel.requireService('tools')).toThrow(/not available/);
  });

  it('effect 逆序回收（后注册的先清理）', () => {
    const kernel = new PluginKernel();
    const order: string[] = [];
    kernel.register({
      id: 'p',
      activate: (ctx) => {
        ctx.effect(() => order.push('first'));
        ctx.effect(() => order.push('second'));
      },
    });
    kernel.setEnabled('p', false);
    expect(order).toEqual(['second', 'first']);
  });

  it('★ 激活抛错 → 已提供的服务/已登记的 effect 全部回滚，不留半截', () => {
    const kernel = new PluginKernel();
    const cleaned: string[] = [];
    expect(() =>
      kernel.register({
        id: 'broken',
        activate: (ctx) => {
          ctx.provideService('half', {});
          ctx.effect(() => cleaned.push('cleanup'));
          throw new Error('boom');
        },
      }),
    ).toThrow(/boom/);
    expect(() => kernel.requireService('half')).toThrow(/not available/);
    expect(cleaned).toEqual(['cleanup']);
    expect(kernel.list()[0]).toMatchObject({ active: false });
  });

  it('重复提供同名服务直接拒绝（两个插件不许悄悄抢同一个名字）', () => {
    const kernel = new PluginKernel();
    kernel.provide('tools', {});
    expect(() => kernel.provide('tools', {})).toThrow(/already provided/);
  });
});
