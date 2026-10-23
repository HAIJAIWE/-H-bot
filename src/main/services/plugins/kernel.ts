// src/main/services/plugins/kernel.ts
//
// **插件内核（Cordis 的最小内核）**（2026-10-20）：
// 服务容器 + 依赖注入 + effect 生命周期。DSH 的模块系统是 Cordis，这一版只借它的
// **四条语义**，不照抄实现：
//
//   1. **服务（service）**：插件可以 ctx.provide('tools', …)，别的插件按名字取，
//      不 import 具体模块 —— "换实现不用改 import" 的前提；
//   2. **按可用性激活**：插件声明 inject: ['tools']，依赖没就绪就**不激活**
//      （不是报错崩掉，而是待命；服务出现后自动激活）——DSH 的 activation 语义；
//   3. **effect**：activate 期间所有注册都登记成 effect，卸载时**逆序回收**；
//   4. **依赖级联卸载**：提供服务的插件被卸载/停用时，依赖它的插件先卸载。
//
// 刻意不做的（DSH 有、我们没有多壳需求）：HMR、profile patch 组合应用内核、
// 跨进程服务网关。内核只服务主进程内的树内插件与运行时插件。

export interface PluginKernelContext {
  readonly pluginId: string;
  /** 取服务；不存在直接抛（调用方必然已声明 inject，属于编程错误） */
  requireService<T>(serviceId: string): T;
  /** 提供/覆盖服务（本插件生命周期内有效，卸载自动移除） */
  provideService<T>(serviceId: string, value: T): void;
  /** 登记一个卸载时要执行的回调（注册即副作用，卸载即回收） */
  effect(dispose: () => void): void;
}

export interface KernelPlugin {
  id: string;
  /** 依赖的服务名：全部可用才激活 */
  inject?: readonly string[];
  activate: (ctx: PluginKernelContext) => void | (() => void);
}

interface Entry {
  plugin: KernelPlugin;
  enabled: boolean;
  active: boolean;
  /** 当前缺哪些服务（未激活的原因；面板/诊断用） */
  missing: string[];
  /** 本插件提供的服务名（卸载时移除） */
  services: string[];
  /** 激活期间登记的清理函数（逆序执行） */
  disposers: Array<() => void>;
}

export interface KernelPluginInfo {
  id: string;
  inject: string[];
  enabled: boolean;
  active: boolean;
  missing: string[];
}

const clone = <T>(value: T): T => value;

export class PluginKernel {
  private services = new Map<string, unknown>();
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  /** 宿主自己提供的服务（不属于任何插件） */
  provide<T>(serviceId: string, value: T): () => void {
    if (this.services.has(serviceId)) throw new Error('service already provided: ' + serviceId);
    this.services.set(serviceId, clone(value));
    this.refresh();
    return () => {
      this.removeService(serviceId);
    };
  }

  hasService(serviceId: string): boolean {
    return this.services.has(serviceId);
  }

  requireService<T>(serviceId: string): T {
    if (!this.services.has(serviceId)) throw new Error('service not available: ' + serviceId);
    return this.services.get(serviceId) as T;
  }

  /** 注册插件；enabled=false 时只登记不激活（兼容性/用户停用） */
  register(plugin: KernelPlugin, options?: { enabled?: boolean }): void {
    if (!plugin.id?.trim()) throw new Error('plugin requires an id');
    if (this.entries.has(plugin.id)) throw new Error('plugin already registered: ' + plugin.id);
    this.entries.set(plugin.id, {
      plugin,
      enabled: options?.enabled ?? true,
      active: false,
      missing: [...(plugin.inject ?? [])],
      services: [],
      disposers: [],
    });
    this.refresh();
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('plugin not found: ' + id);
    if (entry.enabled === enabled) return;
    entry.enabled = enabled;
    if (enabled) this.refresh();
    else this.deactivate(entry);
    this.notify();
  }

  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.deactivate(entry);
    this.entries.delete(id);
    this.notify();
  }

  list(): KernelPluginInfo[] {
    return [...this.entries.values()].map((e) => ({
      id: e.plugin.id,
      inject: [...(e.plugin.inject ?? [])],
      enabled: e.enabled,
      active: e.active,
      missing: [...e.missing],
    }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * 激活所有"已启用 + 依赖已就绪"的插件。循环到稳定：一个插件的激活可能提供新服务，
   * 从而满足下一个插件的依赖（顺序无关，与 DSH 的 service-availability 驱动一致）。
   */
  private refresh(): void {
    let changed = true;
    let guard = 0;
    while (changed && guard < 100) {
      changed = false;
      guard += 1;
      for (const entry of this.entries.values()) {
        if (!entry.enabled || entry.active) continue;
        const missing = (entry.plugin.inject ?? []).filter((s) => !this.services.has(s));
        entry.missing = missing;
        if (missing.length > 0) continue;
        this.activate(entry);
        changed = true;
      }
    }
    this.notify();
  }

  private activate(entry: Entry): void {
    const servicesBefore = new Set(this.services.keys());
    const ctx: PluginKernelContext = {
      pluginId: entry.plugin.id,
      requireService: (id) => this.requireService(id),
      provideService: (id, value) => {
        if (this.services.has(id)) throw new Error('service already provided: ' + id);
        this.services.set(id, value);
        entry.services.push(id);
      },
      effect: (dispose) => {
        entry.disposers.push(dispose);
      },
    };
    try {
      const cleanup = entry.plugin.activate(ctx);
      if (typeof cleanup === 'function') entry.disposers.push(cleanup);
      entry.active = true;
      entry.missing = [];
    } catch (error) {
      // 激活失败回滚：已登记的 effect 全部执行，已提供的服务移除，不留半截
      for (const dispose of entry.disposers.reverse()) safely(dispose);
      entry.disposers = [];
      for (const id of entry.services) {
        if (!servicesBefore.has(id)) this.services.delete(id);
      }
      entry.services = [];
      entry.missing = [...(entry.plugin.inject ?? [])];
      entry.active = false;
      throw error;
    }
  }

  /** 卸载一个插件：先卸载依赖它的插件（递归），再逆序回收自己的 effect */
  private deactivate(entry: Entry): void {
    if (!entry.active) {
      // 未激活也要清掉可能残留的 missing 状态
      entry.missing = [...(entry.plugin.inject ?? [])];
      return;
    }
    for (const other of [...this.entries.values()]) {
      if (other === entry || !other.active) continue;
      if (other.plugin.inject?.some((s) => entry.services.includes(s))) this.deactivate(other);
    }
    for (const dispose of entry.disposers.reverse()) safely(dispose);
    entry.disposers = [];
    for (const id of entry.services) this.services.delete(id);
    entry.services = [];
    entry.active = false;
    entry.missing = [...(entry.plugin.inject ?? [])];
  }

  private removeService(serviceId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.active && entry.services.includes(serviceId)) {
        this.deactivate(entry);
      }
    }
    this.services.delete(serviceId);
    this.refresh();
  }
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // 清理失败不能中断其它清理（与主流插件容器一致：一个坏插件不拖垮宿主）
  }
}

/** 进程内共享内核（主进程只有一个；测试可 new PluginKernel 隔离） */
export const kernel = new PluginKernel();
