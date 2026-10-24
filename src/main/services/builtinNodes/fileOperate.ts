/**
 * 文件操作纯 TS 实现
 * 历史：由已移除的 Python 实现移植而来，现状以本文件为准
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveInProject } from './projectPath';

// ============================================================
// 常量与类型定义
// ============================================================

const MAX_READ_BYTES = 5 * 1024 * 1024; // 5MB

interface FileResult {
  result?: unknown;
  success: boolean;
  error: string;
  path?: string;
  size?: number;
  count?: number;
  exists?: boolean;
  is_file?: boolean;
  is_dir?: boolean;
}

interface FileOperateOptions {
  mode: 'read' | 'write' | 'copy' | 'move' | 'delete' | 'exists' | 'list_dir' | 'mkdir';
  file_path: string;
  dest_path?: string;
  content?: unknown;
  write_mode?: 'json' | 'text';
  encoding?: string;
  append?: boolean;
  /**
   * 当前项目目录（由运行时按 `HandlerContext.projectPath` 注入）。
   *
   * 相对路径一律相对**项目根**解析 —— 不是进程 cwd。历史上这里用
   * `path.resolve(filePath)` 直接按 cwd 解析，导致用户文件落到应用安装目录，
   * 并且预览隔离失效（详见 `projectPath.ts` 顶部说明）。
   */
  project_root?: string;
}

/**
 * 解析节点路径为项目内绝对路径。
 *
 * 统一走 `resolveInProject`：相对 → 项目根，绝对 → 必须在项目根内，
 * 越界抛错（由各 mode 的 try/catch 转成 `{success:false,error}`，用户能在
 * 画布节点上看到原因，而不是文件悄悄写到别处）。
 */
function resolvePath(filePath: string, root?: string): string {
  try {
    return resolveInProject(filePath, { injectedRoot: root, label: '文件路径' });
  } catch (e) {
    // 保持历史错误文案（测试与用户文档都引用它）
    if (errorMessage(e).includes('路径穿越')) {
      throw new Error('非法文件路径（路径穿越被拒绝）');
    }
    throw e;
  }
}

/** 从 catch 到的未知值取出错误文案（保持历史 `e.message` 的返回形状） */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 读取文件内容（文本）
 * 使用异步读取，避免阻塞事件循环
 */
async function _read(filePath: string, encoding: string = 'utf-8', root?: string): Promise<FileResult> {
  if (!filePath) {
    return { result: null, success: false, error: 'file_path 为空' };
  }

  // 修复：这里曾调用 validatePath() 后**丢弃返回值**，再用 path.resolve(filePath)
  // 按 cwd 重算 —— 校验形同虚设，且相对路径读到项目外的文件。
  let safePath: string;
  try {
    safePath = resolvePath(filePath, root);
  } catch (e) {
    return { result: null, success: false, error: errorMessage(e) || '非法文件路径（路径穿越被拒绝）' };
  }

  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
    return { result: null, success: false, error: `文件不存在: ${filePath}` };
  }

  // 大文件保护
  try {
    if (fs.statSync(safePath).size > MAX_READ_BYTES) {
      return {
        result: null,
        success: false,
        error: `文件超过读取上限 5MB: ${filePath}`
      };
    }
  } catch {
    // 统计失败继续尝试读取
  }

  try {
    const text = await fs.promises.readFile(safePath, encoding as BufferEncoding);
    return { result: text, success: true, error: '' };
  } catch (e) {
    return { result: null, success: false, error: errorMessage(e) };
  }
}

/**
 * 写入文件（json/text）
 */
async function _write(
  filePath: string, 
  content: unknown, 
  writeMode: 'json' | 'text' = 'json',
  _encoding: string = 'utf-8',
  append: boolean = false,
  root?: string
): Promise<FileResult> {
  if (!['json', 'text'].includes(writeMode)) {
    return {
      success: false,
      path: '',
      size: 0,
      error: `未知 write_mode: ${writeMode}（必须是 json 或 text 之一）`
    };
  }

  if (!filePath) {
    return { success: false, path: '', size: 0, error: 'file_path 为空' };
  }

  try {
    const safePath = resolvePath(filePath, root);
    
    // 自动创建父目录
    if (!fs.existsSync(path.dirname(safePath))) {
      await fs.promises.mkdir(path.dirname(safePath), { recursive: true });
    }

    const writeFlag = append ? 'a' : 'w';
    let payload: string;
    
    if (writeMode === 'json') {
      payload = JSON.stringify(content, null, 2);
    } else {
      payload = String(content);
    }

    // 追加模式：仅当目标文件存在且非空时才前置换行
    let payloadFinal = payload;
    if (append) {
      try {
        const exists = fs.existsSync(safePath);
        const size = exists ? fs.statSync(safePath).size : 0;
        if (exists && size > 0) {
          payloadFinal = '\n' + payload;
        }
      } catch {
        // 忽略统计错误
      }
    }

    await fs.promises.writeFile(safePath, payloadFinal, { encoding: 'utf-8', flag: writeMode === 'json' ? 'w' : writeFlag });
    
    const fileSize = fs.statSync(safePath).size;
    return { success: true, path: safePath, size: fileSize, error: '' };
  } catch (e) {
    return { success: false, path: '', size: 0, error: errorMessage(e) };
  }
}

/**
 * 复制文件（保留元数据）
 */
async function _copy(filePath: string, destPath: string, root?: string): Promise<FileResult> {
  if (!filePath || !destPath) {
    return { success: false, path: '', error: 'file_path 或 dest_path 为空' };
  }

  try {
    const src = resolvePath(filePath, root);
    const dst = resolvePath(destPath, root);
    
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      return { success: false, path: '', error: `源文件不存在: ${filePath}` };
    }

    // 目标父目录自动创建
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    // copy2 保留元数据
    fs.copyFileSync(src, dst);
    
    // 尝试保留元数据（原实现用未解析的 destPath，相对路径下等于给别的文件改时间）
    try {
      fs.utimesSync(dst, fs.statSync(src).atime, fs.statSync(src).mtime);
    } catch {}

    return { success: true, path: dst, error: '' };
  } catch (e) {
    return { success: false, path: '', error: errorMessage(e) };
  }
}

/**
 * 移动/重命名文件或目录
 */
async function _move(filePath: string, destPath: string, root?: string): Promise<FileResult> {
  if (!filePath || !destPath) {
    return { success: false, path: '', error: 'file_path 或 dest_path 为空' };
  }

  try {
    const src = resolvePath(filePath, root);
    const dst = resolvePath(destPath, root);
    
    if (!fs.existsSync(src)) {
      return { success: false, path: '', error: `源路径不存在: ${filePath}` };
    }

    // 目标父目录自动创建
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    fs.renameSync(src, dst);
    return { success: true, path: dst, error: '' };
  } catch (e) {
    return { success: false, path: '', error: errorMessage(e) };
  }
}

/**
 * 删除文件（仅普通文件，不删目录）
 */
async function _delete(filePath: string, root?: string): Promise<FileResult> {
  if (!filePath) {
    return { success: false, error: 'file_path 为空' };
  }

  try {
    const safePath = resolvePath(filePath, root);
    
    if (!fs.existsSync(safePath)) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }

    if (fs.statSync(safePath).isDirectory()) {
      return { success: false, error: '目标为目录，delete 模式仅删文件' };
    }

    fs.unlinkSync(safePath);
    return { success: true, error: '' };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}

/**
 * 检查文件/目录是否存在，返回类型信息
 */
async function _exists(filePath: string, root?: string): Promise<FileResult> {
  if (!filePath) {
    return { exists: false, is_file: false, is_dir: false, success: true, error: 'file_path 为空' };
  }

  try {
    const safePath = resolvePath(filePath, root);
    const exists = fs.existsSync(safePath);
    
    return {
      exists,
      is_file: exists && fs.statSync(safePath).isFile(),
      is_dir: exists && fs.statSync(safePath).isDirectory(),
      success: true,
      error: ''
    };
  } catch (e) {
    return { exists: false, is_file: false, is_dir: false, success: false, error: errorMessage(e) };
  }
}

/**
 * 列出目录内容
 */
async function _listDir(filePath: string, root?: string): Promise<FileResult> {
  if (!filePath) {
    return { result: [], count: 0, success: false, error: 'file_path 为空' };
  }

  try {
    const safePath = resolvePath(filePath, root);
    
    if (!fs.existsSync(safePath)) {
      return { result: [], count: 0, success: false, error: `目录不存在: ${filePath}` };
    }

    if (!fs.statSync(safePath).isDirectory()) {
      return { result: [], count: 0, success: false, error: `目标不是目录: ${filePath}` };
    }

    const entries = fs.readdirSync(safePath);
    
    // 排序：目录在前，文件在后，各自按名称排序
    const sorted = entries.sort((a, b) => {
      const aPath = path.join(safePath, a);
      const bPath = path.join(safePath, b);
      const aIsDir = fs.statSync(aPath).isDirectory();
      const bIsDir = fs.statSync(bPath).isDirectory();
      
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });

    return { result: sorted, count: sorted.length, success: true, error: '' };
  } catch (e) {
    return { result: [], count: 0, success: false, error: errorMessage(e) };
  }
}

/**
 * 创建目录（递归创建，已存在视为成功）
 */
async function _mkdir(filePath: string, root?: string): Promise<FileResult> {
  if (!filePath) {
    return { success: false, path: '', error: 'file_path 为空' };
  }

  try {
    const safePath = resolvePath(filePath, root);
    fs.mkdirSync(safePath, { recursive: true });
    return { success: true, path: safePath, error: '' };
  } catch (e) {
    return { success: false, path: '', error: errorMessage(e) };
  }
}

/**
 * 统一文件操作入口
 *
 * 相对路径一律相对项目根（见 `projectPath.ts`）；`options.project_root` 由运行时
 * 按当前项目注入，未注入时回退环境变量 / 应用目录 / cwd。
 */
export async function fileOperate(options: FileOperateOptions): Promise<FileResult> {
  try {
    const root = options.project_root;

    switch (options.mode) {
      case 'read':
        return await _read(options.file_path, options.encoding || 'utf-8', root);
      case 'write':
        return await _write(
          options.file_path, 
          options.content, 
          options.write_mode || 'json', 
          options.encoding || 'utf-8', 
          options.append || false,
          root
        );
      case 'copy':
        return await _copy(options.file_path, options.dest_path || '', root);
      case 'move':
        return await _move(options.file_path, options.dest_path || '', root);
      case 'delete':
        return await _delete(options.file_path, root);
      case 'exists':
        return await _exists(options.file_path, root);
      case 'list_dir':
        return await _listDir(options.file_path, root);
      case 'mkdir':
        return await _mkdir(options.file_path, root);
      default:
        return {
          success: false,
          error: `未知 mode: ${options.mode}（支持 read/write/copy/move/delete/exists/list_dir/mkdir）`
        };
    }
  } catch (e) {
    return { result: null, success: false, error: errorMessage(e) };
  }
}

export type { FileOperateOptions, FileResult };
