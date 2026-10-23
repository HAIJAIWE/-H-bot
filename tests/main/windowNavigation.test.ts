// tests/main/windowNavigation.test.ts
//
// 主框架导航拦截（安全边界）：preload 对每个新文档都会执行，主框架一旦被导航到
// 远端页面，对方就拿到了整份 window.qqbat（含终端能力）。这里锁住放行规则：
// 开发模式只放行 Vite dev server 同源，生产模式只放行应用自带 renderer 目录内的 file://。
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAllowedNavigationUrl, normalizeFsPath } from '@main/window'

const rendererDir = join(process.cwd(), 'out', 'renderer')
const devServerUrl = 'http://localhost:5173'

describe('normalizeFsPath', () => {
  it('统一分隔符并去掉尾部斜杠', () => {
    expect(normalizeFsPath('E:\\app\\out\\renderer\\')).toBe(
      process.platform === 'win32' ? 'e:/app/out/renderer' : 'E:/app/out/renderer'
    )
  })

  it('Windows 下大小写不敏感', () => {
    const unified = normalizeFsPath('E:/App/Out/Renderer')
    expect(unified).toBe(process.platform === 'win32' ? 'e:/app/out/renderer' : 'E:/App/Out/Renderer')
  })
})

describe('isAllowedNavigationUrl', () => {
  it('开发模式放行 dev server 同源页面', () => {
    expect(isAllowedNavigationUrl('http://localhost:5173/index.html', { devServerUrl })).toBe(true)
  })

  it('开发模式拒绝其它端口 / 仿冒主机', () => {
    expect(isAllowedNavigationUrl('http://localhost:5174/', { devServerUrl })).toBe(false)
    expect(isAllowedNavigationUrl('http://localhost:5173.evil.com/', { devServerUrl })).toBe(false)
  })

  it('生产模式放行 renderer 目录内的 file:// 页面', () => {
    const url = pathToFileURL(join(rendererDir, 'index.html')).href
    expect(isAllowedNavigationUrl(url, { rendererDir })).toBe(true)
  })

  it('生产模式拒绝 renderer 目录之外的文件', () => {
    const url = pathToFileURL(join(rendererDir, '..', 'evil.html')).href
    expect(isAllowedNavigationUrl(url, { rendererDir })).toBe(false)
  })

  it('前缀相同的兄弟目录不算“在目录内”', () => {
    const url = pathToFileURL(join(rendererDir + '-evil', 'index.html')).href
    expect(isAllowedNavigationUrl(url, { rendererDir })).toBe(false)
  })

  it('未配置 devServerUrl/rendererDir 时一律拒绝', () => {
    expect(isAllowedNavigationUrl(pathToFileURL(join(rendererDir, 'index.html')).href)).toBe(false)
    expect(isAllowedNavigationUrl('http://localhost:5173/', {})).toBe(false)
  })

  it('拒绝危险协议与外部站点', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'about:blank',
      'https://example.com/',
      'file:///etc/passwd'
    ]) {
      expect(isAllowedNavigationUrl(url, { devServerUrl, rendererDir })).toBe(false)
    }
  })

  it('非法 URL 返回 false 而不是抛错', () => {
    expect(isAllowedNavigationUrl('not a url', { rendererDir })).toBe(false)
  })
})
