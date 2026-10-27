// tests/shared/plugins/windowPackage.test.ts
//
// 第 73 批：窗口包清单的纯校验。这是外部输入的第一道闸——坏清单必须在进注册表之前挡住，
// 而且每条错误要**指到字段**（用户按报错改 JSON 就行）。
import { describe, expect, it } from 'vitest'
import {
  WINDOW_PACKAGE_ORDER_MAX,
  validateWindowPackage,
  windowPackageIsExecutable,
  windowPackagePartEnabled,
  type WindowPackageManifest,
} from '../../../src/shared/plugins/windowPackage'

const base = (): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'demo.compact',
  name: 'Demo compact',
  version: '0.1.0',
  layout: 'compact',
})

function expectIssues(raw: unknown, fields: string[]): void {
  const result = validateWindowPackage(raw)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.issues.map(i => i.field)).toEqual(expect.arrayContaining(fields))
}

describe('validateWindowPackage（第 73 批）', () => {
  it('最小合法清单通过，并按契约补齐默认字段', () => {
    const result = validateWindowPackage(base())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      schemaVersion: 1,
      id: 'demo.compact',
      name: 'Demo compact',
      version: '0.1.0',
      layout: 'compact',
    })
  })

  it('完整清单透传 order/parts/description，未知顶层字段丢弃', () => {
    const result = validateWindowPackage({
      ...base(),
      order: 1200,
      parts: { header: false, messages: true, composer: false },
      description: '只读窗口',
      futureField: 'ignore me',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.order).toBe(1200)
    expect(result.value.parts).toEqual({ header: false, messages: true, composer: false })
    expect(result.value.description).toBe('只读窗口')
    expect('futureField' in result.value).toBe(false)
  })

  it('schemaVersion 必须是 1', () => {
    expectIssues({ ...base(), schemaVersion: 2 }, ['schemaVersion'])
  })

  it('id 规则：小写字母开头、3–48 字符', () => {
    expectIssues({ ...base(), id: 'Bad_Id' }, ['id'])
    expectIssues({ ...base(), id: 'ab' }, ['id'])
    expect(validateWindowPackage({ ...base(), id: 'a1-2.3' }).ok).toBe(true)
  })

  it('version 必须形如 1.0.0；layout 必须合法', () => {
    expectIssues({ ...base(), version: '1.0' }, ['version'])
    expectIssues({ ...base(), layout: 'huge' }, ['layout'])
  })

  it('order 可选，但给了就必须是范围内的整数', () => {
    expect(validateWindowPackage({ ...base(), order: 0 }).ok).toBe(true)
    expect(validateWindowPackage({ ...base(), order: WINDOW_PACKAGE_ORDER_MAX }).ok).toBe(true)
    expectIssues({ ...base(), order: -1 }, ['order'])
    expectIssues({ ...base(), order: 1.5 }, ['order'])
  })

  it('parts 只认三个部件，值必须是布尔', () => {
    expectIssues({ ...base(), parts: { sidebar: true } }, ['parts.sidebar'])
    expectIssues({ ...base(), parts: { header: 'yes' } }, ['parts.header'])
    expectIssues({ ...base(), parts: [] }, ['parts'])
  })

  it('description 可选，最多 200 字符', () => {
    expectIssues({ ...base(), description: 'x'.repeat(201) }, ['description'])
  })

  it('非对象输入直接报一条空字段问题', () => {
    expectIssues([], [''])
    expectIssues(null, [''])
  })

  it('windowPackagePartEnabled：省略即开，显式 false 才关', () => {
    const manifest: WindowPackageManifest = {
      schemaVersion: 1,
      id: 'x.y',
      name: 'x',
      version: '1.0.0',
      layout: 'full',
      parts: { header: false },
    }
    expect(windowPackagePartEnabled(manifest, 'header')).toBe(false)
    expect(windowPackagePartEnabled(manifest, 'messages')).toBe(true)
    expect(windowPackagePartEnabled(manifest, 'composer')).toBe(true)
  })
})

describe('可执行窗口的清单扩展（第 74 批）', () => {
  const exec = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...base(),
    entry: 'entry.js',
    ...extra,
  })

  it('带 entry 的最小清单通过：layout 缺省 compact，entry 原样透传', () => {
    const raw = exec()
    delete raw.layout
    const result = validateWindowPackage(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.layout).toBe('compact')
    expect(result.value.entry).toBe('entry.js')
    expect(windowPackageIsExecutable(result.value)).toBe(true)
  })

  it('capabilities 只保留声明过的动作，未知动作指到下标', () => {
    const ok = validateWindowPackage(exec({ capabilities: ['send-message', 'stop', 'send-message'] }))
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.value.capabilities).toEqual(['send-message', 'stop'])

    expectIssues(exec({ capabilities: ['send-message', 'exec-shell'] }), ['capabilities[1]'])
  })

  it('entry 不能带目录、不能带 ..，也不能不是 .js/.mjs', () => {
    expectIssues(exec({ entry: '../evil.js' }), ['entry'])
    expectIssues(exec({ entry: 'sub/entry.js' }), ['entry'])
    expectIssues(exec({ entry: 'entry.ts' }), ['entry'])
  })

  it('声明式窗口写 capabilities → 报错（没有 entry 就没有可执行动作）', () => {
    expectIssues({ ...base(), capabilities: ['stop'] }, ['capabilities'])
  })

  it('windowPackageIsExecutable：只有 entry 包返回 true', () => {
    const declarative = validateWindowPackage(base())
    expect(declarative.ok).toBe(true)
    if (!declarative.ok) return
    expect(windowPackageIsExecutable(declarative.value)).toBe(false)
  })
})
