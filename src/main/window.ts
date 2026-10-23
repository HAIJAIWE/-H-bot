// src/main/window.ts
import { BrowserWindow, shell, dialog, session, app } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'node:url'
import { logger } from './services/logger'

/**
 * 构建 Content-Security-Policy 策略字符串。
 *
 * 设计原则：
 *   - 默认拒绝（default-src 'self'），逐项放开必要权限
 *   - 生产模式严格 self；开发模式为兼容 Vite HMR 放开 unsafe-eval/unsafe-inline
 *   - 末尾不加分号（符合 CSP 规范，多个指令间用 '; ' 分隔）
 *
 * 各指令用途：
 *   - default-src 'self'：兜底，仅允许本地资源
 *   - script-src：禁止内联/外部脚本（开发模式需 unsafe-eval 支持 Vite HMR）
 *   - style-src 'self' 'unsafe-inline'：允许内联样式（Tailwind/组件库需要）
 *   - img-src 'self' data: blob:：允许 data/blob URI 图片
 *   - connect-src：允许 IPC、WebSocket、HTTP/HTTPS API 请求
 *   - frame-src http: https:：嵌入浏览器 webui 加载远程页面
 *   - worker-src 'self' blob:：Monaco editor Web Worker
 *   - media-src 'self' blob:：本地媒体资源
 *   - manifest-src 'self'：PWA manifest
 *   - font-src 'self'：本地字体
 *   - object-src 'none'：禁用 Flash/Java 等插件
 *   - base-uri 'self'：禁止 base 标签劫持
 *   - form-action 'self'：禁止表单外部提交
 *   - frame-ancestors 'none'：禁止被嵌入（防 clickjacking）
 *
 * @param isDev 是否开发模式（true 时放开 unsafe-eval/unsafe-inline）
 * @returns CSP 策略字符串
 */
export function buildCsp(isDev: boolean): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self'"
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss: http: https:",
    'frame-src http: https:',
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
}

/** 归一化文件系统路径，用于「是否位于某目录内」的判断（Windows 大小写不敏感） */
export function normalizeFsPath(p: string): string {
  const unified = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

/**
 * 主框架（main frame）是否允许导航到这个 URL。
 *
 * ## 为什么必须拦
 *
 * `setWindowOpenHandler` 只管 `window.open` / `target=_blank`，**管不住主框架自身导航**。
 * 渲染层里一个普通的 `<a href="https://evil">` 被点击，窗口就会换成远端页面；
 * 而 preload 脚本对**每个新文档**都会执行 ⇒ 远端页面直接拿到整份 `window.qqbat`
 * （含 `terminal.*` 这类等于任意命令执行的能力）。所以这是安全边界，不是体验优化。
 *
 * ## 放行规则（默认拒绝）
 *
 * - 开发模式：Vite dev server 的**同源**页面（HMR 会整页刷新）；
 * - 生产模式：**应用自带的 renderer 目录内**的 file:// 页面。
 *
 * 其余一律拒绝 —— 包括 `javascript:` / `data:` / `about:blank` / 外部 http(s) / 任意
 * 本地文件（后者同样危险：一个本地 HTML 一样能拿到桥）。外链请走「用系统浏览器打开」。
 *
 * @param url 目标 URL
 * @param opts.devServerUrl Vite dev server 地址（开发模式）
 * @param opts.rendererDir 应用自带 renderer 产物目录（生产模式）
 */
export function isAllowedNavigationUrl(
  url: string,
  opts: { devServerUrl?: string; rendererDir?: string } = {}
): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (opts.devServerUrl) {
    try {
      if (parsed.origin === new URL(opts.devServerUrl).origin) return true
    } catch {
      /* devServerUrl 非法时按未配置处理 */
    }
  }
  if (parsed.protocol === 'file:' && opts.rendererDir) {
    try {
      const target = normalizeFsPath(fileURLToPath(parsed))
      const root = normalizeFsPath(opts.rendererDir)
      return target === root || target.startsWith(`${root}/`)
    } catch {
      return false
    }
  }
  return false
}

export function createMainWindow(): BrowserWindow {
  // 设置 CSP：限制资源加载来源，防止 XSS 注入（详见 buildCsp JSDoc）
  const isDev = !app.isPackaged
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(isDev)]
      }
    })
  })

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'H Bot 制造',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // P0 安全：硬化配置
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 主框架导航拦截（默认拒绝）：外链必须走系统浏览器，见 isAllowedNavigationUrl 的 JSDoc
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isAllowedNavigationUrl(url, {
      ...(process.env['ELECTRON_RENDERER_URL']
        ? { devServerUrl: process.env['ELECTRON_RENDERER_URL'] }
        : {}),
      rendererDir: join(__dirname, '../renderer')
    })
    if (!allowed) {
      event.preventDefault()
      logger.warn('[window] 拒绝主框架导航:', url)
    }
  })

  // 外链用系统浏览器打开 — 仅放行 http/https，防止 file:// 等协议触发本地文件执行
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url)
      } else {
        logger.warn('[window] 拒绝打开非 http(s) 协议外链:', url)
      }
    } catch {
      logger.warn('[window] 拒绝打开非法 URL:', url)
    }
    return { action: 'deny' }
  })

  // 嵌入浏览器下载处理
  win.webContents.session.on('will-download', (_event, item) => {
    const filename = item.getFilename()
    dialog.showSaveDialog(win, {
      defaultPath: filename,
      title: '下载文件'
    }).then(({ canceled, filePath }) => {
      if (!canceled && filePath) {
        item.setSavePath(filePath)
        item.resume()
      } else {
        item.cancel()
      }
    })
  })

  // 开发环境自动打开 DevTools
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
