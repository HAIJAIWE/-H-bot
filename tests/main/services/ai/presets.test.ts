// tests/main/services/ai/presets.test.ts
//
// 会话预设 = `.qqbat/agent-presets.json` + `.qqbat/agent-preset-default.json`。
// 第 48 批起用户表是**注册表**：坏条目给 `broken`、被忽略的字段给 `notes`、`order` 排序；
// 第 51 批起注册表还包含**内置预设**（不可覆盖）和**默认预设**标记，运行时按名字查不到/
// 查到的坏了/默认值坏了都 fail-closed。
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parsePresetRoster,
  readPresetDefault,
  readPresetRoster,
  resolveDefaultPreset,
  resolvePresetForRun,
  writePresetDefault,
  writePresets,
} from '@main/services/ai/presets'
import type { AgentPresetRoster } from '@shared/ai/presetRoster'

async function project(withFile?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-presets-'))
  if (withFile !== undefined) {
    await mkdir(join(dir, '.qqbat'), { recursive: true })
    await writeFile(join(dir, '.qqbat', 'agent-presets.json'), JSON.stringify(withFile), 'utf-8')
  }
  return dir
}

async function projectRaw(raw: string) {
  const dir = await mkdtemp(join(tmpdir(), 'qqbat-presets-raw-'))
  await mkdir(join(dir, '.qqbat'), { recursive: true })
  await writeFile(join(dir, '.qqbat', 'agent-presets.json'), raw, 'utf-8')
  return dir
}

async function writeDefaultRaw(dir: string, raw: string) {
  await mkdir(join(dir, '.qqbat'), { recursive: true })
  await writeFile(join(dir, '.qqbat', 'agent-preset-default.json'), raw, 'utf-8')
}

/** 用户文件里的行（内置那两条永远在，断言用户内容时先滤掉） */
function userRows(roster: AgentPresetRoster) {
  return roster.presets.filter(p => !p.builtin)
}

describe('★ 会话预设注册表（.qqbat/agent-presets.json）', () => {
  it('★ 写入后可读回；重名后者覆盖前者、工具去重', async () => {
    const dir = await project()
    await writePresets(dir, [
      { name: '只读', allowedTools: ['read_file', 'read_file', 'list_dir'] },
      { name: '只读', allowedTools: ['read_file'] },
      { name: '  ' },
    ])
    const roster = await readPresetRoster(dir)
    expect(userRows(roster)).toHaveLength(1)
    expect(userRows(roster)[0]).toMatchObject({ name: '只读', allowedTools: ['read_file'] })
  })

  it('文件不存在 → 只有内置两条（不是错误）；顶层不是数组 → fileProblem（永不抛）', async () => {
    const missing = await mkdtemp(join(tmpdir(), 'qqbat-presets-empty-'))
    const empty = await readPresetRoster(missing)
    expect(empty.presets.map(p => p.name)).toEqual(['标准', '最小只读'])
    expect(empty.presets.every(p => p.builtin)).toBe(true)
    expect(empty.defaultPreset).toBeNull()
    expect(empty.fileProblem).toBeUndefined()

    const dir = await project({ not: 'an array' })
    const roster = await readPresetRoster(dir)
    expect(userRows(roster)).toEqual([])
    expect(roster.fileProblem).toContain('顶层不是数组')
    // 用户表坏了，内置兜底仍在
    expect(roster.presets.map(p => p.name)).toEqual(['标准', '最小只读'])
  })

  it('坏 JSON → fileProblem（整份读不了，不是"一条坏了"）', async () => {
    const dir = await projectRaw('{oops')
    const roster = await readPresetRoster(dir)
    expect(userRows(roster)).toEqual([])
    expect(roster.fileProblem).toContain('JSON 解析失败')
  })

  it('★ role / prompt：写时归一（不认识的角色当没写、附加要求去空白并截断）', async () => {
    const dir = await project()
    await writePresets(dir, [
      { name: '巡检', role: 'coder', prompt: '  只读不改  ' },
      { name: '瞎写', role: 'nope' as never, prompt: 42 as never },
      { name: '超长', prompt: 'x'.repeat(2100) },
      { name: '空附加', prompt: '   ' },
    ])
    const byName = new Map(userRows(await readPresetRoster(dir)).map(p => [p.name, p]))
    expect(byName.get('巡检')).toMatchObject({ role: 'coder', prompt: '只读不改' })
    // 拼错的角色不能猜，也不能让整条预设失效
    expect(byName.get('瞎写')).toEqual({ name: '瞎写' })
    expect(byName.get('超长')?.prompt).toHaveLength(2000)
    expect(byName.get('空附加')).toEqual({ name: '空附加' })
  })

  it('★ 读也归一：手写的坏 role / 坏 prompt 只丢字段并记 notes，不丢整条预设', async () => {
    const dir = await project([
      { name: 'a', role: 'Builder', prompt: ' 帮我  ' },
      { name: 'b', role: ['coder'], prompt: { text: 'x' } },
    ])
    const rows = userRows(await readPresetRoster(dir))
    expect(rows[0]).toMatchObject({
      name: 'a',
      prompt: '帮我',
      notes: ['role 不认识，已忽略'],
    })
    expect(rows[1]).toMatchObject({
      name: 'b',
      notes: ['role 不认识，已忽略'],
    })
    expect(rows[1].prompt).toBeUndefined()
  })

  it('★ permissionMode：只认 ask / full，写读两处都归一（拼错的不猜）', async () => {
    const dir = await project()
    await writePresets(dir, [
      { name: '无人值守', permissionMode: 'full' },
      { name: '还是问我', permissionMode: 'ask' },
      { name: '写错', permissionMode: 'yolo' as never },
      { name: '没写' },
    ])
    const byName = new Map(userRows(await readPresetRoster(dir)).map(p => [p.name, p]))
    expect(byName.get('无人值守')).toMatchObject({ permissionMode: 'full' })
    expect(byName.get('还是问我')).toMatchObject({ permissionMode: 'ask' })
    // 不认识的口径当没写：不能猜成 full（那等于把审批关了）
    expect(byName.get('写错')).toEqual({ name: '写错' })
    expect(byName.get('没写')).toEqual({ name: '没写' })

    // 手写的坏值同理（读路径也要归一 + notes）
    const hand = await project([{ name: 'h', permissionMode: 1 }])
    expect(userRows(await readPresetRoster(hand))[0]).toEqual({
      name: 'h',
      notes: ['permissionMode 不认识，已忽略'],
    })
  })

  it('★ 坏条目：没名字 / 不是对象 / 名字超长 / 重名 —— 带原因留下，不静默消失', () => {
    const roster = parsePresetRoster([
      { name: '好的一条' },
      null,
      { title: '没名字' },
      { name: 'x'.repeat(41) },
      { name: '好的一条' },
    ])
    expect(roster.fileProblem).toBeUndefined()
    expect(roster.presets.map(p => p.name)).toEqual([
      '好的一条',
      '第 2 条',
      '第 3 条',
      'x'.repeat(40),
      '好的一条',
    ])
    expect(roster.presets[0].broken).toBeUndefined()
    expect(roster.presets[1].broken).toContain('不是对象')
    expect(roster.presets[2].broken).toContain('没有名字')
    expect(roster.presets[3].broken).toContain('名字超过 40 个字')
    expect(roster.presets[4].broken).toContain('重名')
  })

  it('order：有 order 的按它排，没写的排后面仍按文件顺序', () => {
    const roster = parsePresetRoster([
      { name: 'c' },
      { name: 'b', order: 2 },
      { name: 'a', order: 1 },
      { name: 'd' },
    ])
    expect(roster.presets.map(p => p.name)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('白名单/插件项里的非法值：归一并记 notes（不连坐整条）', () => {
    const roster = parsePresetRoster([
      { name: '脏表', allowedTools: ['read_file', 42, '  '], plugins: ['p1', null] },
      { name: '不是数组', allowedTools: 'read_file' },
    ])
    expect(roster.presets[0].allowedTools).toEqual(['read_file'])
    expect(roster.presets[0].plugins).toEqual(['p1'])
    expect(roster.presets[0].notes?.join('；')).toContain('工具白名单里有 2 项')
    expect(roster.presets[1].notes?.join('；')).toContain('工具白名单不是数组')
  })

  it('★ 内置预设不可覆盖：同名的那条用户行是 broken，内置那条仍可用', async () => {
    const dir = await project([{ name: '标准', prompt: '想顶掉内置' }])
    const roster = await readPresetRoster(dir)
    const sameName = roster.presets.filter(p => p.name === '标准')
    expect(sameName).toHaveLength(2)
    expect(sameName.some(p => p.builtin && !p.broken)).toBe(true)
    const broken = sameName.find(p => p.broken)
    expect(broken?.broken).toContain('与内置预设「标准」重名')

    await expect(writePresets(dir, [{ name: '最小只读' }])).rejects.toThrow('内置预设名')
  })

  it('★ resolvePresetForRun：找不到 / 坏了都 fail-closed，并说清原因', async () => {
    const dir = await project([{ name: '只读', allowedTools: ['read_file'] }, { name: '只读' }])
    const ok = await resolvePresetForRun(dir, '只读')
    expect(ok).toEqual({ ok: true, preset: { name: '只读', allowedTools: ['read_file'] } })

    const missing = await resolvePresetForRun(dir, '不存在')
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error).toContain('找不到预设「不存在」')
      expect(missing.error).toContain('这一轮没有开始')
    }

    const broken = await resolvePresetForRun(dir, '只读')
    expect(broken.ok).toBe(true) // 第一条可用，重名的不影响按名字命中第一条

    const onlyBroken = await project([null])
    const bad = await resolvePresetForRun(onlyBroken, '第 1 条')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('不可用：不是对象')
  })

  it('★ resolvePresetForRun：整份文件坏了也要把 fileProblem 带进错误里', async () => {
    const dir = await projectRaw('{oops')
    const res = await resolvePresetForRun(dir, '只读')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('找不到预设「只读」')
      expect(res.error).toContain('JSON 解析失败')
    }
  })

  it('★ 默认预设：写入后 registry 标记 isDefault，运行时解析得出名字；null 等于删掉记录', async () => {
    const dir = await project([{ name: '只读巡检', allowedTools: ['read_file'] }])
    await writePresetDefault(dir, '只读巡检')
    const roster = await readPresetRoster(dir)
    expect(roster.defaultPreset).toBe('只读巡检')
    expect(roster.presets.find(p => p.name === '只读巡检')?.isDefault).toBe(true)
    expect(await readPresetDefault(dir)).toEqual({ value: '只读巡检' })
    expect(await resolveDefaultPreset(dir)).toEqual({ ok: true, preset: '只读巡检' })

    await writePresetDefault(dir, null)
    const after = await readPresetRoster(dir)
    expect(after.defaultPreset).toBeNull()
    expect(after.presets.some(p => p.isDefault)).toBe(false)
    expect(await resolveDefaultPreset(dir)).toEqual({ ok: true, preset: null })
  })

  it('★ 默认预设坏了 fail-closed：指向不存在的名字 / 文件不是对象', async () => {
    const dir = await project([{ name: '只读巡检' }])
    await writeDefaultRaw(dir, JSON.stringify({ default: '不存在' }))
    const roster = await readPresetRoster(dir)
    expect(roster.defaultProblem).toContain('默认预设「不存在」不存在或不可用')
    const res = await resolveDefaultPreset(dir)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('默认预设不可用')
      expect(res.error).toContain('这一轮没有开始')
    }

    const bad = await project()
    await writeDefaultRaw(bad, '{oops')
    const badRoster = await readPresetRoster(bad)
    expect(badRoster.defaultProblem).toContain('JSON 解析失败')
    expect((await resolveDefaultPreset(bad)).ok).toBe(false)
  })

  it('★ writePresetDefault：不存在的名字 / 坏条目都拒绝写', async () => {
    const dir = await project([{ name: '好的' }, { name: '好的' }])
    await expect(writePresetDefault(dir, '不存在')).rejects.toThrow('不是可用的预设')
  })
})
