// tests/main/services/ai/path-safety.test.ts
import { describe, it, expect } from 'vitest'
import { safeJoin } from '@main/services/ai/tools'
import { resolve } from 'path'

describe('safeJoin 路径校验', () => {
  const projectRoot = resolve('D:/projects/my-bot')

  it('允许项目内相对路径', () => {
    const result = safeJoin(projectRoot, 'src/main.py')
    expect(result).toBe(resolve(projectRoot, 'src/main.py'))
  })

  it('允许嵌套子目录', () => {
    const result = safeJoin(projectRoot, 'src/plugins/custom/__init__.py')
    expect(result).toBe(resolve(projectRoot, 'src/plugins/custom/__init__.py'))
  })

  it('拒绝路径穿越（..）', () => {
    expect(() => safeJoin(projectRoot, '../../../etc/passwd')).toThrow()
  })

  it('拒绝单层 .. 穿越', () => {
    expect(() => safeJoin(projectRoot, '../secret.txt')).toThrow()
  })

  it('拒绝项目外绝对路径', () => {
    expect(() => safeJoin(projectRoot, 'D:/other/file.txt')).toThrow()
  })

  it('拒绝 Unix 绝对路径', () => {
    expect(() => safeJoin(projectRoot, '/etc/passwd')).toThrow()
  })

  it('允许 .qqbat 隐藏目录', () => {
    expect(() => safeJoin(projectRoot, '.qqbat/flow.json')).not.toThrow()
  })

  it('允许项目根本身', () => {
    expect(() => safeJoin(projectRoot, '.')).not.toThrow()
  })
})
