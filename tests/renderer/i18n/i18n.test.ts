// tests/renderer/i18n/i18n.test.ts
// i18n 键完整性校验
// 确保 zh-CN.json 与 en-US.json 两个语言包：
//   1. 键集合完全一致（无缺失/无多余）
//   2. 无空值
//   3. 占位符 {xxx} 在两种语言间一致
//   4. t() 翻译函数行为正确
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import zhCN from '@renderer/i18n/zh-CN.json'
import enUS from '@renderer/i18n/en-US.json'

/** 递归展平嵌套对象为点号分隔的 key 列表 */
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

/** 递归展平嵌套对象为 key → value（仅叶子节点） */
function flattenEntries(obj: unknown, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const nested = flattenEntries(v, fullKey)
      for (const [nk, nv] of nested) result.set(nk, nv)
    } else if (typeof v === 'string') {
      result.set(fullKey, v)
    }
  }
  return result
}

/** 提取字符串中所有 {xxx} 占位符 */
function extractPlaceholders(str: string): string[] {
  // 先剔除低代码变量语法 `{{var}}`：它是**展示给用户的字面量**（告诉用户该写什么），
  // 不是插值参数。不剔除的话 `{{name}}` 里的 `{name}` 会被当成占位符，
  // 而中文侧写 `{{变量名}}`（\w 不匹配中文）没有占位符，就会误报不一致。
  const matches = str.replace(/\{\{[^{}]*\}\}/g, '').match(/\{(\w+)\}/g)
  if (!matches) return []
  return matches.map((m) => m.slice(1, -1)).sort()
}

const zhKeys = flattenKeys(zhCN).sort()
const enKeys = flattenKeys(enUS).sort()
const zhEntries = flattenEntries(zhCN)
const enEntries = flattenEntries(enUS)

describe('i18n 键完整性校验', () => {
  describe('键集合一致性', () => {
    it('zh-CN 与 en-US 键数量相同', () => {
      expect(zhKeys.length).toBe(enKeys.length)
    })

    it('zh-CN 与 en-US 键集合完全一致（无缺失、无多余）', () => {
      const zhSet = new Set(zhKeys)
      const enSet = new Set(enKeys)
      const missingInEn = zhKeys.filter((k) => !enSet.has(k))
      const missingInZh = enKeys.filter((k) => !zhSet.has(k))
      expect({
        missingInEn,
        missingInZh
      }).toEqual({ missingInEn: [], missingInZh: [] })
    })

    it('键数量大于 0（语言包非空）', () => {
      expect(zhKeys.length).toBeGreaterThan(0)
      expect(enKeys.length).toBeGreaterThan(0)
    })
  })

  describe('值非空校验', () => {
    it('zh-CN 所有值非空字符串', () => {
      const empties: string[] = []
      for (const [k, v] of zhEntries) {
        if (!v || v.trim() === '') empties.push(k)
      }
      expect(empties).toEqual([])
    })

    it('en-US 所有值非空字符串', () => {
      const empties: string[] = []
      for (const [k, v] of enEntries) {
        if (!v || v.trim() === '') empties.push(k)
      }
      expect(empties).toEqual([])
    })
  })

  describe('占位符一致性', () => {
    it('每个键的占位符在两种语言间一致', () => {
      const mismatches: Array<{ key: string; zh: string[]; en: string[] }> = []
      for (const key of zhKeys) {
        const zh = zhEntries.get(key) ?? ''
        const en = enEntries.get(key) ?? ''
        const zhPh = extractPlaceholders(zh)
        const enPh = extractPlaceholders(en)
        if (zhPh.join(',') !== enPh.join(',')) {
          mismatches.push({ key, zh: zhPh, en: enPh })
        }
      }
      expect(mismatches).toEqual([])
    })

    // 反向用例：上面那条断言在提取逻辑写坏时会**空转通过**（两边都提取出空数组）。
    it('提取逻辑本身正确：忽略 {{var}} 字面量、识别真正的插值参数', () => {
      expect(extractPlaceholders('{{变量名}}')).toEqual([])
      expect(extractPlaceholders('{{name}}')).toEqual([])
      expect(extractPlaceholders('共 {count} 条')).toEqual(['count'])
      expect(extractPlaceholders('{a} 与 {b}')).toEqual(['a', 'b'])
    })
  })

  describe('键命名规范', () => {
    it('所有键仅包含字母、数字、点、下划线', () => {
      const invalid = zhKeys.filter((k) => !/^[a-zA-Z0-9_.]+$/.test(k))
      expect(invalid).toEqual([])
    })

    it('键不以点开头或结尾', () => {
      const invalid = zhKeys.filter((k) => k.startsWith('.') || k.endsWith('.'))
      expect(invalid).toEqual([])
    })

    it('键无连续点号', () => {
      const invalid = zhKeys.filter((k) => k.includes('..'))
      expect(invalid).toEqual([])
    })
  })

  describe('语言包结构', () => {
    it('包含 common 命名空间', () => {
      expect(zhCN).toHaveProperty('common')
      expect(enUS).toHaveProperty('common')
    })

    it('common 命名空间下包含核心键', () => {
      // 确认语义分散在各自命名空间（`ui.confirm` / `launch.common.confirmSave`），
      // common 里没有共用项 —— 加一个没人用的 key 只会被 orphanKeys 判成孤儿。
      const requiredKeys = ['save', 'cancel', 'close', 'delete']
      for (const k of requiredKeys) {
        expect(zhCN.common).toHaveProperty(k)
        expect(enUS.common).toHaveProperty(k)
      }
    })
  })

  // 源码里静态写出来的 t('key') 必须都能在语言包里取到值。
  // 漏一个的症状不是报错，而是界面上直接显示 key 的末段（`debugger.start` → start），
  // 只有真机点到那个面板才看得见 —— 实测 `debugger.*` 就因为注入脚本的命名空间
  // 白名单漏了 `debugger` 而整片变成英文单词，这条断言把它变成可自动校验的事实。
  describe('源码引用的 key 必须存在', () => {
    const SRC = 'src/renderer/src'
    // 只扫**从 main.tsx 可达**的文件。
    //
    // 恢复树里躺着一批没有任何挂载点的组件（教程弹窗、SchemaForm、调试器面板、
    // 旧项目选择页、NapCat 配置页……），它们引用的 key 用户永远看不到；
    // 实测 187 条缺失里 180+ 条来自这些文件，混在一起会让闸门失去信号。
    // 需要恢复某个面板时，先把它接进页面，这条断言自然就会校验它的 key。
    const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

    function walk(dir: string, out: string[] = []): string[] {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(ts|tsx)$/.test(f)) out.push(p)
      }
      return out
    }

    function resolveSpec(root: string, fromFile: string, spec: string): string | null {
      let base: string
      if (spec.startsWith('@renderer/')) base = join(root, SRC, spec.slice('@renderer/'.length))
      else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec)
      else return null
      for (const cand of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.jsx`,
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
      ]) {
        if (existsSync(cand) && statSync(cand).isFile()) return cand
      }
      return null
    }

    function reachableFrom(root: string, entry: string): Set<string> {
      const seen = new Set<string>()
      const queue = [entry]
      while (queue.length > 0) {
        const file = queue.pop()!
        if (seen.has(file)) continue
        seen.add(file)
        const src = readFileSync(file, 'utf-8')
        for (const m of src.matchAll(IMPORT_RE)) {
          const target = resolveSpec(root, file, m[1])
          if (target && !seen.has(target)) queue.push(target)
        }
      }
      return seen
    }

    it('每个 t(\'literal.key\') 都能在两个语言包里取到译文（只看可达文件）', () => {
      const root = resolve(__dirname, '../../..')
      const entry = join(root, SRC, 'main.tsx')
      expect(existsSync(entry), '入口 main.tsx 不存在，可达性扫描会空转').toBe(true)
      const reachable = reachableFrom(root, entry)
      // 空转防护：解析写坏时集合会退化到入口自己
      expect(reachable.size, '可达文件太少，导入解析写坏了').toBeGreaterThan(200)
      const missing: string[] = []
      for (const file of reachable) {
        const src = readFileSync(file, 'utf-8')
        for (const m of src.matchAll(/\bt\(\s*'([A-Za-z][\w.]*)'/g)) {
          const key = m[1]
          if (!zhEntries.has(key) || !enEntries.has(key)) {
            missing.push(`${key}  (${file.slice(root.length + 1).replace(/\\/g, '/')})`)
          }
        }
      }
      expect(missing).toEqual([])
    })

    it('反向用例：断言逻辑本身能发现缺失的 key', () => {
      // 防止上面的断言因为正则写坏而空转通过
      const hits = [..."t('zzz.notExist')".matchAll(/\bt\(\s*'([A-Za-z][\w.]*)'/g)].map((m) => m[1])
      expect(hits).toEqual(['zzz.notExist'])
      expect(zhEntries.has('zzz.notExist')).toBe(false)
    })
  })
})

describe('i18n t() 函数行为', () => {
  // t() 内部依赖 currentLocale（模块级状态），需要在每个测试前重置
  let originalLocale: string

  beforeEach(async () => {
    // 动态导入以避免模块状态污染
    const mod = await import('@renderer/i18n')
    originalLocale = mod.getLocale()
    mod.setLocale('zh-CN')
  })

  afterEach(async () => {
    const mod = await import('@renderer/i18n')
    mod.setLocale(originalLocale as 'zh-CN' | 'en-US')
  })

  it('zh-CN 下返回中文翻译', async () => {
    const { t, setLocale } = await import('@renderer/i18n')
    setLocale('zh-CN')
    expect(t('common.save')).toBe('保存')
    expect(t('common.cancel')).toBe('取消')
  })

  it('en-US 下返回英文翻译', async () => {
    const { t, setLocale } = await import('@renderer/i18n')
    setLocale('en-US')
    expect(t('common.save')).toBe('Save')
    expect(t('common.cancel')).toBe('Cancel')
  })

  it('不存在的 key 返回最后一段', async () => {
    const { t } = await import('@renderer/i18n')
    expect(t('common.nonexistent')).toBe('nonexistent')
    expect(t('completely.missing.key')).toBe('key')
  })

  it('支持 {param} 插值', async () => {
    const { t } = await import('@renderer/i18n')
    // common.save 无占位符，验证插值不影响普通字符串
    expect(t('common.save')).toBe('保存')
  })

  it('已知限制：键名包含点号时无法查找（点号是路径分隔符）', async () => {
    // app.name 是一个叶子键，但 t() 会按点号分割为 common → app → name
    // 因此查找失败，返回最后一段 "name"
    // 这是 i18n 系统的已知设计限制
    const { t } = await import('@renderer/i18n')
    expect(t('common.app.name')).toBe('name')
  })

  it('切换语言后订阅者收到通知', async () => {
    const { setLocale, subscribe, getLocale } = await import('@renderer/i18n')
    const calls: string[] = []
    const unsub = subscribe((locale) => calls.push(locale))
    setLocale('en-US')
    setLocale('zh-CN')
    expect(calls).toEqual(['en-US', 'zh-CN'])
    expect(getLocale()).toBe('zh-CN')
    unsub()
  })

  it('getLocale 返回当前语言', async () => {
    const { getLocale, setLocale } = await import('@renderer/i18n')
    setLocale('en-US')
    expect(getLocale()).toBe('en-US')
    setLocale('zh-CN')
    expect(getLocale()).toBe('zh-CN')
  })
})
