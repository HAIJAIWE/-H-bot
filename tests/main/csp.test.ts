// tests/main/csp.test.ts
// CSP 策略字符串构建测试
//
// 验证 buildCsp 输出的策略包含必要指令，确保新增指令不被意外移除。
// 这些测试用于防止回归：开发模式下放开 unsafe-eval 以兼容 Vite HMR，
// 生产模式下严格 self；同时确保 frame-src、worker-src 等新指令存在。
import { describe, it, expect } from 'vitest'
import { buildCsp } from '@main/window'

describe('buildCsp', () => {
  it('生产模式：script-src 仅允许 self', () => {
    const csp = buildCsp(false)
    // 提取 script-src 指令单独验证
    const scriptSrcMatch = csp.match(/script-src [^;]+/)
    expect(scriptSrcMatch).toBeTruthy()
    expect(scriptSrcMatch![0]).toBe("script-src 'self'")
    expect(scriptSrcMatch![0]).not.toContain('unsafe-eval')
    expect(scriptSrcMatch![0]).not.toContain('unsafe-inline')
  })

  it('开发模式：script-src 放开 unsafe-eval/unsafe-inline（Vite HMR）', () => {
    const csp = buildCsp(true)
    expect(csp).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'")
  })

  it('两种模式都包含 default-src self', () => {
    expect(buildCsp(true)).toContain("default-src 'self'")
    expect(buildCsp(false)).toContain("default-src 'self'")
  })

  it('两种模式都包含 style-src unsafe-inline（Tailwind）', () => {
    expect(buildCsp(true)).toContain("style-src 'self' 'unsafe-inline'")
    expect(buildCsp(false)).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('两种模式都包含 img-src self data blob', () => {
    expect(buildCsp(true)).toContain("img-src 'self' data: blob:")
    expect(buildCsp(false)).toContain("img-src 'self' data: blob:")
  })

  it('connect-src 包含 ws/wss/http/https', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("connect-src 'self' ws: wss: http: https:")
  })

  it('frame-src 允许 http/https（嵌入浏览器 webui）', () => {
    const csp = buildCsp(false)
    expect(csp).toContain('frame-src http: https:')
  })

  it('worker-src 允许 self blob（Monaco editor）', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("worker-src 'self' blob:")
  })

  it('media-src 允许 self blob', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("media-src 'self' blob:")
  })

  it('manifest-src 仅允许 self', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("manifest-src 'self'")
  })

  it('font-src 仅允许 self', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("font-src 'self'")
  })

  it('object-src none：禁用插件', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("object-src 'none'")
  })

  it('base-uri self：禁止 base 标签劫持', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("base-uri 'self'")
  })

  it('form-action self：禁止表单外部提交', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("form-action 'self'")
  })

  it('frame-ancestors none：禁止被嵌入', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('生产模式策略中不包含 inline script 白名单', () => {
    const csp = buildCsp(false)
    // 'unsafe-inline' 仅应出现在 style-src 中
    const scriptSrcMatch = csp.match(/script-src [^;]+/)
    expect(scriptSrcMatch).toBeTruthy()
    expect(scriptSrcMatch![0]).not.toContain('unsafe-inline')
  })

  it('策略以分号分隔（无尾部分号）', () => {
    const csp = buildCsp(false)
    expect(csp.endsWith(';')).toBe(false)
    // 每条指令间应是 '; ' 分隔
    expect(csp.split('; ').length).toBeGreaterThan(10)
  })
})
