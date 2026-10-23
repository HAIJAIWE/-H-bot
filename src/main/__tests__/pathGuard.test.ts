// src/main/__tests__/pathGuard.test.ts
// 验证 pathGuard 路径校验函数，覆盖 launchTransfer 安全修复的校验逻辑。
//
// 测试目标：
//   - assertPathWithinBase：严格校验（cwd 内 + 白名单后缀）
//   - assertExternalPathSafe：宽松校验（任意用户目录 + 拒绝系统目录 + 白名单后缀）
//   - assertWithinProject / joinSafe：原有函数回归

import { describe, it, expect } from 'vitest'
import { resolve, join } from 'path'
import {
  isWithinProject,
  assertWithinProject,
  joinSafe,
  assertPathWithinBase,
  assertExternalPathSafe,
  assertExecutablePathSafe,
  assertPythonPathSafe
} from '../services/pathGuard'

describe('assertPathWithinBase', () => {
  const base = process.cwd()
  const allowedExts = ['.db', '.sqlite']

  it('接受 cwd 内的 .db 文件', () => {
    expect(() => assertPathWithinBase(base, join(base, 'data', 'test.db'), allowedExts)).not.toThrow()
  })

  it('接受 cwd 内的 .sqlite 文件', () => {
    expect(() => assertPathWithinBase(base, join(base, 'data', 'players.sqlite'), allowedExts)).not.toThrow()
  })

  it('接受大小写后缀（.DB）', () => {
    expect(() => assertPathWithinBase(base, join(base, 'data', 'test.DB'), allowedExts)).not.toThrow()
  })

  it('拒绝空路径', () => {
    expect(() => assertPathWithinBase(base, '', allowedExts)).toThrow('文件路径不能为空')
    expect(() => assertPathWithinBase(base, undefined as unknown as string, allowedExts)).toThrow('文件路径不能为空')
  })

  it('拒绝相对路径', () => {
    expect(() => assertPathWithinBase(base, 'data/test.db', allowedExts)).toThrow('必须是绝对路径')
  })

  it('拒绝 cwd 外的路径（路径穿越）', () => {
    // 构造一个指向 cwd 之外的绝对路径
    const outside = resolve(base, '..', 'evil.db')
    expect(() => assertPathWithinBase(base, outside, allowedExts)).toThrow('路径越界')
  })

  it('拒绝非白名单后缀', () => {
    expect(() => assertPathWithinBase(base, join(base, 'data', 'evil.txt'), allowedExts)).toThrow('不支持的文件类型')
    expect(() => assertPathWithinBase(base, join(base, 'data', 'evil.exe'), allowedExts)).toThrow('不支持的文件类型')
  })

  it('拒绝伪装后缀（evil.db.txt）', () => {
    expect(() => assertPathWithinBase(base, join(base, 'data', 'evil.db.txt'), allowedExts)).toThrow('不支持的文件类型')
  })
})

describe('assertExternalPathSafe', () => {
  const exportExts = ['.json', '.csv']

  it('接受用户目录的 .json 文件', () => {
    // 用 os.homedir() 模拟用户选择的导出位置
    const { homedir } = require('os')
    const userPath = join(homedir(), 'Desktop', 'export.json')
    expect(() => assertExternalPathSafe(userPath, exportExts)).not.toThrow()
  })

  it('接受用户目录的 .csv 文件', () => {
    const { homedir } = require('os')
    const userPath = join(homedir(), 'Downloads', 'export.csv')
    expect(() => assertExternalPathSafe(userPath, exportExts)).not.toThrow()
  })

  it('接受 cwd 内的导出路径', () => {
    expect(() => assertExternalPathSafe(join(process.cwd(), 'export.json'), exportExts)).not.toThrow()
  })

  it('接受 cwd 外的合法用户路径（关键：允许导出到任意位置）', () => {
    const { homedir } = require('os')
    const userPath = join(homedir(), 'Documents', 'data.csv')
    expect(() => assertExternalPathSafe(userPath, exportExts)).not.toThrow()
  })

  it('拒绝空路径', () => {
    expect(() => assertExternalPathSafe('', exportExts)).toThrow('文件路径不能为空')
  })

  it('拒绝相对路径', () => {
    expect(() => assertExternalPathSafe('export.json', exportExts)).toThrow('必须是绝对路径')
  })

  it('拒绝非白名单后缀', () => {
    const { homedir } = require('os')
    expect(() => assertExternalPathSafe(join(homedir(), 'evil.exe'), exportExts)).toThrow('不支持的文件类型')
    expect(() => assertExternalPathSafe(join(homedir(), 'evil.txt'), exportExts)).toThrow('不支持的文件类型')
  })

  it('拒绝系统关键目录（跨平台）', () => {
    // 根据平台选择系统目录
    const sysDir = process.platform === 'win32' ? 'C:\\Windows\\System32\\evil.json' : '/etc/evil.json'
    expect(() => assertExternalPathSafe(sysDir, exportExts)).toThrow('禁止访问系统目录')
  })

  it('拒绝系统目录本身（非子目录）', () => {
    const sysDir = process.platform === 'win32' ? 'C:\\Windows' : '/etc'
    expect(() => assertExternalPathSafe(sysDir + (process.platform === 'win32' ? '\\config.json' : '/passwd.json'), exportExts)).toThrow('禁止访问系统目录')
  })
})

describe('原有 pathGuard 函数回归', () => {
  const projectRoot = process.cwd()

  it('isWithinProject 正确判断项目内路径', () => {
    expect(isWithinProject(projectRoot, join(projectRoot, 'data', 'x.db'))).toBe(true)
    expect(isWithinProject(projectRoot, join(projectRoot, '..', 'evil.db'))).toBe(false)
  })

  it('assertWithinProject 越界抛错', () => {
    expect(() => assertWithinProject(projectRoot, join(projectRoot, '..', 'evil.db'))).toThrow('路径越界')
  })

  it('joinSafe 返回规范化路径', () => {
    const result = joinSafe(projectRoot, 'data/test.db')
    expect(result).toBe(resolve(projectRoot, 'data', 'test.db'))
  })

  it('joinSafe 越界抛错', () => {
    expect(() => joinSafe(projectRoot, '../../../evil.db')).toThrow('路径越界')
  })
})

describe('assertExecutablePathSafe', () => {
  const { homedir } = require('os')

  it('接受用户目录下的可执行文件路径', () => {
    const userBin = join(homedir(), 'tools', 'napcat.exe')
    expect(() => assertExecutablePathSafe(userBin)).not.toThrow()
  })

  it('接受无扩展名的 POSIX 可执行文件', () => {
    const userBin = join(homedir(), '.local', 'bin', 'python3')
    expect(() => assertExecutablePathSafe(userBin)).not.toThrow()
  })

  it('接受 .bat / .cmd 脚本路径', () => {
    const batPath = join(homedir(), 'napcat', 'napcat.bat')
    expect(() => assertExecutablePathSafe(batPath)).not.toThrow()
  })

  it('拒绝空路径', () => {
    expect(() => assertExecutablePathSafe('')).toThrow('路径不能为空')
  })

  it('拒绝相对路径', () => {
    expect(() => assertExecutablePathSafe('python.exe')).toThrow('必须是绝对路径')
  })

  it('拒绝系统关键目录下的可执行文件', () => {
    const sysBin = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\cmd.exe'
      : '/bin/sh'
    expect(() => assertExecutablePathSafe(sysBin)).toThrow('系统目录')
  })

  it('requireExists=true 时拒绝不存在的路径', () => {
    const nonExistent = join(homedir(), 'not-exist-executable-' + Date.now() + '.exe')
    expect(() => assertExecutablePathSafe(nonExistent, true)).toThrow('路径不存在')
  })
})

describe('assertPythonPathSafe', () => {
  const { homedir } = require('os')

  it('接受系统 Python 路径 /usr/bin/python3', () => {
    expect(() => assertPythonPathSafe('/usr/bin/python3')).not.toThrow()
  })

  it('接受 Windows 自定义 Python 路径', () => {
    expect(() => assertPythonPathSafe('C:\\Python312\\python.exe')).not.toThrow()
  })

  it('接受 py launcher 路径', () => {
    expect(() => assertPythonPathSafe('C:\\Windows\\py.exe')).not.toThrow()
  })

  it('拒绝空路径', () => {
    expect(() => assertPythonPathSafe('')).toThrow('路径不能为空')
  })

  it('拒绝相对路径', () => {
    expect(() => assertPythonPathSafe('python3')).toThrow('必须是绝对路径')
  })

  it('拒绝非 Python 可执行文件', () => {
    expect(() => assertPythonPathSafe('C:\\Program Files\\node\\node.exe')).toThrow('Python 解释器文件名')
  })

  it('拒绝伪装成 Python 的系统 shell', () => {
    expect(() => assertPythonPathSafe('C:\\Windows\\System32\\cmd.exe')).toThrow('系统 shell')
    expect(() => assertPythonPathSafe('/bin/bash')).toThrow('系统 shell')
  })
})
