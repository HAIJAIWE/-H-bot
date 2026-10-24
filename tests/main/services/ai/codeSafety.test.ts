// tests/main/services/ai/codeSafety.test.ts
import { describe, it, expect } from 'vitest'
import { assessScriptRisk } from '@main/services/ai/codeSafety'

describe('assessScriptRisk（只有 JS/TS 一套栈）', () => {
  it('普通沙箱 handler 返回 low', () => {
    expect(assessScriptRisk('async (ctx) => ({ text: "hi" })')).toBe('low')
    expect(assessScriptRisk('const now = new Date().toISOString()')).toBe('low')
  })

  it('动态构造代码返回 high', () => {
    expect(assessScriptRisk('const f = new Function("return 1")')).toBe('high')
    expect(assessScriptRisk('eval("1+1")')).toBe('high')
  })

  it('碰 Node 逃生口返回 high', () => {
    expect(assessScriptRisk('const { exec } = require("child_process")')).toBe('high')
    expect(assessScriptRisk('process.exit(1)')).toBe('high')
    expect(assessScriptRisk('process.env.SECRET')).toBe('high')
    expect(assessScriptRisk('vm.runInNewContext("1")')).toBe('high')
  })

  it('写文件 / 动态 import 返回 medium', () => {
    expect(assessScriptRisk('fs.writeFileSync("a.txt", "x")')).toBe('medium')
    expect(assessScriptRisk('await import("./mod")')).toBe('medium')
  })
})
