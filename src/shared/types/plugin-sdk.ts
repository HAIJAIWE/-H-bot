
// 插件 SDK 类型：manifest.json / index.js 导出 / 扫描结果
import type { NodeType } from './flow';

/** 命令触发器：用户发 /cmd 时触发 handlers[name] */
export interface PluginCommandTrigger {
  type: 'command';
  /** 命令名（不含前缀斜杠） */
  command: string;
  description?: string;
}

/** 事件触发器：协议端推送某类事件时触发 */
export interface PluginEventTrigger {
  type: 'event';
  /** 事件名，如 group_message / friend_add */
  event: string;
  description?: string;
}

/** 定时触发器：按间隔或 cron 触发 */
export interface PluginTimerTrigger {
  type: 'timer';
  /** 间隔毫秒（与 cron 二选一） */
  intervalMs?: number;
  /** 5 段 cron（与 intervalMs 二选一） */
  cron?: string;
  description?: string;
}

/** 插件节点的输入/输出端口 */
export interface PluginNodePort {
  id: string;
  name: string;
  kind: 'control' | 'data';
  dataType?: string;
  required?: boolean;
  description?: string;
}

/** 插件声明的自定义节点（加载后转换成画布的 NodeSpec） */
export interface PluginNode {
  /** 节点内的唯一 key（最终 kind = plugin_<包名>_<kind>） */
  kind: string;
  type: NodeType;
  label: string;
  group?: string;
  icon?: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  inputs?: PluginNodePort[];
  outputs?: PluginNodePort[];
}

/** 扫描/加载后给界面看的插件摘要（不含包内代码） */
export interface PluginInfo {
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** 插件声明的节点数（扫描阶段未加载代码时为 0） */
  nodeCount: number;
  enabled: boolean;
  /** 入口文件是否存在（扫描阶段） */
  loaded: boolean;
  /** 插件目录绝对路径 */
  path: string;
}

/** 插件可声明的一种触发器 */
export type PluginTrigger = PluginCommandTrigger | PluginEventTrigger | PluginTimerTrigger;

/**
 * 插件包（index.js 导出格式）
 *
 * ⚠️ `nodes` 现在是**可选**的：纯代码插件只提供 `triggers` + `handlers`。
 * 但三者不能全空 —— 一个既不提供节点、也不提供可触发能力的包不是有效插件。
 */
export interface PluginPackage {
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** 节点（可选；纯代码插件可以不写） */
  nodes?: PluginNode[];
  /** 声明式触发器：类型 + 参数 + handler 名 */
  triggers?: PluginTrigger[];
  /** handler 名 → 函数源码字符串（async (ctx) => { ... }，与节点 handler 同一套沙箱） */
  handlers?: Record<string, string>;
  /**
   * 生效的权限白名单。
   *
   * **唯一权威是 manifest.json**：pluginScanner 加载时用 `manifest.permissions`
   * **覆盖**这里 —— index.js 里自己写的 permissions 不生效（插件代码不能给自己授权）。
   *
   * 权限名（见 runtime/pluginPermissions.ts，唯一实现）：
   *   · `message.send`      → 允许发消息（bot.callApi 的 send_* 系列 + 内置节点 message_send）
   *   · `api.<name>`       → 允许调某个协议端 API，如 `api.get_group_list`
   *   · `builtin.<kind>`   → 允许调某个内置节点，如 `builtin.database_write`
   * 没声明的能力 → 运行时**拒绝**并给出可读错误（不是警告）。
   */
  permissions?: string[];
}

/** manifest.json 格式（**通用**：name / version / entry / description / permissions，无「节点」字样） */
export interface PluginManifest {
  name: string;
  version: string;
  /** 入口文件（相对插件目录），如 index.js */
  entry: string;
  description?: string;
  /** 权限白名单（唯一权威；覆盖 index.js 里的 permissions） */
  permissions?: string[];
}
