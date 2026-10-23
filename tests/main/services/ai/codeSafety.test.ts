// tests/main/services/ai/codeSafety.test.ts
import { describe, it, expect } from 'vitest'
import { assessCodeRisk } from '@main/services/ai/codeSafety'

describe('assessCodeRisk', () => {
  it('无危险调用返回 low', () => {
    expect(assessCodeRisk('async def hello(): return "hi"')).toBe('low')
  })

  it('有 os.system 返回 high', () => {
    expect(assessCodeRisk('import os; os.system("rm -rf /")')).toBe('high')
  })

  it('有 subprocess 返回 high', () => {
    expect(assessCodeRisk('import subprocess; subprocess.Popen(["ls"])')).toBe('high')
  })

  it('有 eval/exec 返回 high', () => {
    expect(assessCodeRisk('eval("1+1")')).toBe('high')
    expect(assessCodeRisk('exec("x=1")')).toBe('high')
  })

  it('有文件读写返回 medium', () => {
    expect(assessCodeRisk('open("test.txt", "w")')).toBe('medium')
  })

  it('有 __import__ 返回 high', () => {
    expect(assessCodeRisk('__import__("os")')).toBe('high')
  })

  // ====== 新增：绕过防护测试 ======

  it('getattr(os, "system") 绕过返回 high', () => {
    expect(assessCodeRisk('getattr(os, "system")("rm -rf /")')).toBe('high')
  })

  it('getattr 单引号 system 绕过返回 high', () => {
    expect(assessCodeRisk("getattr(os, 'system')('rm')")).toBe('high')
  })

  it('getattr(eval) 绕过返回 high', () => {
    expect(assessCodeRisk("getattr(builtins, 'eval')('1+1')")).toBe('high')
  })

  it('getattr(exec) 绕过返回 high', () => {
    expect(assessCodeRisk("getattr(builtins, 'exec')('x=1')")).toBe('high')
  })

  it('getattr(__import__) 绕过返回 high', () => {
    expect(assessCodeRisk("getattr(builtins, '__import__')('os')")).toBe('high')
  })

  it('getattr(popen) 绕过返回 high', () => {
    expect(assessCodeRisk("getattr(os, 'popen')('ls')")).toBe('high')
  })

  it('importlib 动态导入返回 high', () => {
    expect(assessCodeRisk('importlib.import_module("os")')).toBe('high')
  })

  it('importlib.reload 返回 high', () => {
    expect(assessCodeRisk('importlib.reload(os)')).toBe('high')
  })

  it('globals() 调用返回 high', () => {
    expect(assessCodeRisk('g = globals()')).toBe('high')
  })

  it('__builtins__ 访问返回 high', () => {
    expect(assessCodeRisk('__builtins__["eval"]("1+1")')).toBe('high')
  })

  it('正常 import 不误报', () => {
    expect(assessCodeRisk('import nonebot')).toBe('low')
    expect(assessCodeRisk('from nonebot import on_message')).toBe('low')
  })

  // ====== 字符串拼接绕过测试（v2 加固新增）======

  it('"sy" + "stem" 拼接危险字符串返回 high', () => {
    expect(assessCodeRisk("getattr(os, 'sy' + 'stem')('rm')")).toBe('high')
  })

  it('"sy" "stem" 相邻字符串拼接返回 high', () => {
    expect(assessCodeRisk("getattr(os, 'sy' 'stem')('rm')")).toBe('high')
  })

  it('chr() 拼接 + 危险字符串返回 high', () => {
    expect(assessCodeRisk('x = chr(115) + chr(121) + chr(115) + chr(116) + chr(101) + chr(109)')).toBe('high')
  })

  it('正常字符串拼接不误报', () => {
    expect(assessCodeRisk('x = "hello" + "world"')).toBe('low')
    expect(assessCodeRisk('name = "user" + str(123)')).toBe('low')
  })

  // ====== 扩展危险 API 覆盖 ======

  it('os.fork 返回 high', () => {
    expect(assessCodeRisk('pid = os.fork()')).toBe('high')
  })

  it('os.dup2 返回 high', () => {
    expect(assessCodeRisk('os.dup2(fd, 1)')).toBe('high')
  })

  it('multiprocessing.Process 返回 high', () => {
    expect(assessCodeRisk('import multiprocessing; multiprocessing.Process(target=x)')).toBe('high')
  })

  it('ctypes 调用返回 high', () => {
    expect(assessCodeRisk('import ctypes; ctypes.CDLL("libc.so")')).toBe('high')
  })

  it('pickle.loads 返回 high', () => {
    expect(assessCodeRisk('pickle.loads(data)')).toBe('high')
  })

  it('shutil.rmtree 返回 medium', () => {
    expect(assessCodeRisk('shutil.rmtree("/tmp")')).toBe('medium')
  })

  it('os.environ 访问返回 medium', () => {
    expect(assessCodeRisk('home = os.environ.get("HOME")')).toBe('medium')
  })

  it('threading.Thread with target 返回 high', () => {
    expect(assessCodeRisk('import threading; t = threading.Thread(target=run)')).toBe('high')
  })
})
