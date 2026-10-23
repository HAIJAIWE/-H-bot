// src/main/ipc/_shared.ts
import { z } from 'zod';

/**
 * 从任意错误对象中提取错误消息字符串
 * - Error 实例：返回 .message
 * - 其他类型：返回 String(e)
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 统一的 IPC 响应类型（成功） */
export interface IpcOk<T> {
  ok: true;
  data: T;
}

/** 统一的 IPC 响应类型（失败） */
export interface IpcErr {
  ok: false;
  error: string;
}

/** 统一的 IPC 响应类型 */
export type IpcResult<T> = IpcOk<T> | IpcErr;

/**
 * 同步 IPC 包装器：自动捕获异常并转换为 IpcResult。
 *
 * @example
 * // 替换前：
 * try { return { ok: true, data: listDataSources(projectPath) } }
 * catch (e) { return { ok: false, error: errMsg(e) } }
 *
 * // 替换后：
 * return tryIpc(() => listDataSources(projectPath))
 */
export function tryIpc<T>(fn: () => T): IpcResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * 异步 IPC 包装器：自动捕获 Promise 异常并转换为 IpcResult。
 *
 * @example
 * // 替换前：
 * try { return { ok: true, data: await fetchSomething() } }
 * catch (e) { return { ok: false, error: errMsg(e) } }
 *
 * // 替换后：
 * return tryIpcAsync(() => fetchSomething())
 */
export async function tryIpcAsync<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * IPC 三层防御标准模板：参数校验 → 权限检查 → 业务逻辑
 *
 * 用法示例：
 * ipcMain.handle('channel', (event, args) => ipcHandle({
 *   schema: mySchema,
 *   args,
 *   guard: () => assertPathSafe(projectPath),  // 可选
 *   execute: () => doSomething(parsed.data),
 * }))
 */
export async function ipcHandle<T>(opts: {
  schema: z.ZodType<unknown>;
  args: unknown;
  guard?: () => void | Promise<void>;
  execute: () => T | Promise<T>
}): Promise<IpcResult<T>> {
  // Layer 1: 参数校验
  const parsed = opts.schema.safeParse(opts.args)
  if (!parsed.success) {
    return { ok: false, error: `参数校验失败: ${parsed.error.message}` }
  }

  // Layer 2: 权限检查（可选）
  if (opts.guard) {
    try {
      await opts.guard()
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  }

  // Layer 3: 业务逻辑
  return tryIpcAsync(() => opts.execute())
}
