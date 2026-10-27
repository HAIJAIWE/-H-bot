// src/shared/plugins/windowPackage.ts
//
// **外部窗口包（window package）的清单形状与纯校验**（第 73 批，P4 加载器 v1）。
//
// 背景：第 72 批让窗口能由渲染层插件贡献（`window` 权限），但插件是**树内编译期模块**，
// 生态装不进来。本批做「磁盘上的窗口包」：目录 `<userData>/plugins/windows/<id>/manifest.json`
// 声明一个窗口，宿主渲染层按清单**声明式**画出来。
//
// ⚠️ v1 **不执行第三方代码**：清单只能描述布局/部件开关/文案，不能带 JS。
// 这是有意的边界——渲染层进程里 eval 第三方代码等于把整个应用交出去（`sandbox: true`
// 也挡不住同进程的 React 树）。可执行窗口等沙箱宿主（P4b），届时用独立的 worker +
// 消息桥，而不是把代码塞进渲染层。
//
// 本文件必须保持纯 TS（可被 node 直跑）：不 import electron、fs、React。
import { z } from 'zod'

/** 清单格式版本：不兼容的未来格式用更高数字，宿主拒绝加载而不是猜 */
export const WINDOW_PACKAGE_SCHEMA_VERSION = 1

/** 两种声明式布局：compact = 紧凑单列；full = 常规间距（数据一样，只是排版差异） */
export const WINDOW_PACKAGE_LAYOUTS = ['compact', 'full'] as const
export type WindowPackageLayout = (typeof WINDOW_PACKAGE_LAYOUTS)[number]

/** 包 id 规则：小写字母开头，小写字母/数字/点/横线，3–48 字符（会成为目录名与窗口 id 后缀） */
export const WINDOW_PACKAGE_ID_RE = /^[a-z][a-z0-9.-]{2,47}$/

/** order 允许范围：与内置窗口同域（内置 chat=1000 / compact=2000） */
export const WINDOW_PACKAGE_ORDER_MIN = 0
export const WINDOW_PACKAGE_ORDER_MAX = 100_000

/** 包内可关掉的部件（省略 = 全开）；v1 只有这三件 */
export interface WindowPackageParts {
  header?: boolean
  messages?: boolean
  composer?: boolean
}

/** 一份合法的窗口包清单（校验通过后的形状） */
export interface WindowPackageManifest {
  schemaVersion: number
  id: string
  /** 给人看的名字（会出现在设置页的下拉里，不做 i18n —— 插件自己的文案自己负责） */
  name: string
  version: string
  order?: number
  layout: WindowPackageLayout
  parts?: WindowPackageParts
  description?: string
}

/** 一条校验问题：`field` 用 JSON 路径，方便用户对着清单改 */
export interface WindowPackageIssue {
  field: string
  message: string
}

export type WindowPackageValidation =
  { ok: true; value: WindowPackageManifest } | { ok: false; issues: WindowPackageIssue[] }

const PART_KEYS = ['header', 'messages', 'composer'] as const

/**
 * 校验一份清单。只做形状/取值，不读盘、不判断目录是否存在 —— 那是调用方的事。
 *
 * 未知字段不报错但**不会透传**：清单是外部输入，多出来的字段一律丢弃，
 * 免得未来版本里的字段被旧宿主误当成有效配置。
 */
export function validateWindowPackage(raw: unknown): WindowPackageValidation {
  const issues: WindowPackageIssue[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [{ field: '', message: '清单必须是 JSON 对象' }] }
  }
  const m = raw as Record<string, unknown>

  if (m.schemaVersion !== WINDOW_PACKAGE_SCHEMA_VERSION) {
    issues.push({
      field: 'schemaVersion',
      message: `只支持 ${WINDOW_PACKAGE_SCHEMA_VERSION}（收到 ${String(m.schemaVersion)}）`,
    })
  }

  const id = m.id
  if (typeof id !== 'string' || !WINDOW_PACKAGE_ID_RE.test(id)) {
    issues.push({
      field: 'id',
      message: '必填，小写字母开头，只含小写字母/数字/点/横线，3–48 字符',
    })
  }

  const name = m.name
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 60) {
    issues.push({ field: 'name', message: '必填，1–60 字符' })
  }

  const version = m.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    issues.push({ field: 'version', message: '必填，形如 1.0.0' })
  }

  let order: number | undefined
  if (m.order !== undefined) {
    if (
      typeof m.order !== 'number' ||
      !Number.isInteger(m.order) ||
      m.order < WINDOW_PACKAGE_ORDER_MIN ||
      m.order > WINDOW_PACKAGE_ORDER_MAX
    ) {
      issues.push({
        field: 'order',
        message: `可选，整数 ${WINDOW_PACKAGE_ORDER_MIN}–${WINDOW_PACKAGE_ORDER_MAX}`,
      })
    } else {
      order = m.order
    }
  }

  let layout: WindowPackageLayout | undefined
  if (
    typeof m.layout !== 'string' ||
    !WINDOW_PACKAGE_LAYOUTS.includes(m.layout as WindowPackageLayout)
  ) {
    issues.push({ field: 'layout', message: `必填，${WINDOW_PACKAGE_LAYOUTS.join(' / ')}` })
  } else {
    layout = m.layout as WindowPackageLayout
  }

  let parts: WindowPackageParts | undefined
  if (m.parts !== undefined) {
    if (m.parts === null || typeof m.parts !== 'object' || Array.isArray(m.parts)) {
      issues.push({ field: 'parts', message: '可选，对象 { header/messages/composer: 布尔 }' })
    } else {
      const rawParts = m.parts as Record<string, unknown>
      for (const key of Object.keys(rawParts)) {
        if (!PART_KEYS.includes(key as (typeof PART_KEYS)[number])) {
          issues.push({
            field: `parts.${key}`,
            message: '未知部件（可关：header/messages/composer）',
          })
        } else if (typeof rawParts[key] !== 'boolean') {
          issues.push({ field: `parts.${key}`, message: '必须是布尔' })
        }
      }
      if (issues.length === 0) {
        const picked: WindowPackageParts = {}
        for (const key of PART_KEYS) {
          const value = rawParts[key]
          if (typeof value === 'boolean') picked[key] = value
        }
        parts = picked
      }
    }
  }

  let description: string | undefined
  if (m.description !== undefined) {
    if (typeof m.description !== 'string' || m.description.length > 200) {
      issues.push({ field: 'description', message: '可选，最多 200 字符' })
    } else {
      description = m.description
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion: WINDOW_PACKAGE_SCHEMA_VERSION,
      id: id as string,
      name: (name as string).trim(),
      version: version as string,
      ...(order !== undefined ? { order } : {}),
      layout: layout as WindowPackageLayout,
      ...(parts !== undefined ? { parts } : {}),
      ...(description !== undefined ? { description } : {}),
    },
  }
}

/** 这个部件是否要画（省略即默认画） */
export function windowPackagePartEnabled(
  manifest: WindowPackageManifest,
  part: keyof WindowPackageParts,
): boolean {
  return manifest.parts?.[part] !== false
}

/** 扫描出来的一条窗口包：清单 + 它所在的绝对路径（排查问题用） */
export interface WindowPackageInfo extends WindowPackageManifest {
  dir: string
}

/** 一条扫描问题：`file` 是 manifest 的绝对路径（给人看的） */
export interface WindowPackageScanIssue {
  file: string
  message: string
}

/** `plugin:listWindows` 的返回：装了什么 + 哪些坏在哪 */
export interface WindowPackageScanResult {
  packages: WindowPackageInfo[]
  issues: WindowPackageScanIssue[]
}
