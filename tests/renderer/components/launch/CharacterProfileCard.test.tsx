// tests/renderer/components/launch/CharacterProfileCard.test.tsx
//
// 重写说明（2026-10-24，恢复工程）：原文件测的是「按 botType 分簇 + HP 进度条」的旧卡片模型
// （props 传 playerTables，44 例全部挂在 fields.find 上）。现在的卡片（10/20 缓存里的真身）
// 只吃取数层组装好的 fields，且**不做血条/进度条**（见 docs/game/player-data-cards-design.md
// 与组件头注释「用户明确不要」）。因此按现契约重建用例：
//   取数用 playerFieldsModel.buildPlayerFields（主进程推导玩家 schema 用同一套语义），
//   断言只看渲染层行为。
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CharacterProfileCard } from '@renderer/components/launch/CharacterProfileCard'
import {
  buildPlayerFields,
  type FieldUsage,
  type PlayerField,
} from '@renderer/components/launch/playerFieldsModel'
import { buildConfigTable } from '@renderer/components/launch/playerItemsModel'
import type { FieldCategory } from '@shared/types/launch'

/** 存档里的值是原样存的（取数层在真实链路里用 unwrapPersistentValue） */
const unwrap = (raw: unknown) => raw

function usage(key: string, modes: string[] = ['save']): FieldUsage {
  return { key, modes: new Set(modes), nodeCount: 1, scope: 'user' }
}

interface BuildOpts {
  /** 存档里真实存在的字段（key -> 值） */
  values?: Record<string, unknown>
  /** 流程声明了、但玩家可能还没有值的字段 */
  declared?: string[]
  /** 自定义显示名/分类（等价项目自己的 player.schema.json 契约） */
  labels?: Record<string, { label: string; category?: FieldCategory }>
  /** key -> 读写模式（用于断言「可增减」这类注释） */
  modes?: Record<string, string[]>
}

function makeFields(opts: BuildOpts = {}): PlayerField[] {
  const usages = new Map<string, FieldUsage>()
  for (const key of opts.declared ?? []) usages.set(key, usage(key, opts.modes?.[key]))
  const rows = Object.entries(opts.values ?? {}).map(([key, value]) => ({
    key: 'user_1001:' + key,
    value,
  }))
  const schema = new Map<string, { label: string; category: FieldCategory }>()
  for (const [key, meta] of Object.entries(opts.labels ?? {})) {
    schema.set(key, { label: meta.label, category: meta.category ?? 'stats' })
  }
  return buildPlayerFields(usages, rows, unwrap, schema)
}

function renderCard(fields: PlayerField[]) {
  return render(<CharacterProfileCard fields={fields} foundPlayerQQ="1001" />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CharacterProfileCard - 空状态', () => {
  it('一个字段都没有时显示「暂无角色数据」和说明', () => {
    renderCard([])
    expect(screen.getByText('暂无角色数据')).toBeInTheDocument()
    expect(screen.getByText('该玩家可能尚未注册或没有存档数据')).toBeInTheDocument()
  })

  it('流程声明了字段但玩家还没有值 —— 不算空', () => {
    // 面板只说「现在有什么」，但「流程要什么」要给一个弱化入口，不能整块变成空状态
    renderCard(makeFields({ declared: ['gold'], labels: { gold: { label: '金币' } } }))
    expect(screen.queryByText('暂无角色数据')).toBeNull()
    expect(screen.getByText(/UID: 1001/)).toBeInTheDocument()
  })
})

describe('CharacterProfileCard - 头部', () => {
  it('显示昵称首字母、昵称与 UID', () => {
    renderCard(
      makeFields({
        values: { nickname: '测试玩家' },
        labels: { nickname: { label: '昵称' } },
      }),
    )
    expect(screen.getByText('测')).toBeInTheDocument()
    // 头部与数值网格各一处（昵称也是「有值的业务字段」）
    expect(screen.getAllByText('测试玩家').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/UID: 1001/)).toBeInTheDocument()
  })

  it('没有昵称时给「未命名玩家」，UID 缺失给破折号', () => {
    // 留一个声明字段，避免整块走「暂无角色数据」空状态
    render(
      <CharacterProfileCard
        fields={makeFields({ declared: ['gold'], labels: { gold: { label: '金币' } } })}
        foundPlayerQQ={null}
      />,
    )
    expect(screen.getByText('未命名玩家')).toBeInTheDocument()
    expect(screen.getByText('UID: —')).toBeInTheDocument()
  })

  it('引擎基础数据的昵称优先于业务字段 nickname', () => {
    // 基础数据是运行时写的（官方渠道事件带昵称时才写），比玩家手填的 nickname 新
    renderCard(
      makeFields({
        values: { __sys_nickname: '引擎昵称', nickname: '手填昵称' },
        labels: {
          __sys_nickname: { label: '昵称缓存', category: 'status' },
          nickname: { label: '昵称' },
        },
      }),
    )
    expect(screen.getByText('引擎昵称')).toBeInTheDocument()
    // 基础数据里的昵称只进头部，不重复出现在「基础数据」块里
    expect(screen.queryByText('昵称缓存')).toBeNull()
  })

  it('onEditPlayer 存在时渲染编辑按钮并在点击时回调', () => {
    const onEditPlayer = vi.fn()
    render(
      <CharacterProfileCard
        fields={makeFields({ values: { gold: 10 }, labels: { gold: { label: '金币' } } })}
        foundPlayerQQ="1001"
        onEditPlayer={onEditPlayer}
      />,
    )
    fireEvent.click(screen.getByText('编辑'))
    expect(onEditPlayer).toHaveBeenCalledTimes(1)
  })
})

describe('CharacterProfileCard - 基础属性网格', () => {
  it('标量字段显示「名称 + 值」，等级排在最前', () => {
    const { container } = renderCard(
      makeFields({
        values: { gold: 1000, level: 10 },
        labels: {
          gold: { label: '金币', category: 'economy' },
          level: { label: '等级', category: 'level' },
        },
      }),
    )
    expect(screen.getByText('金币')).toBeInTheDocument()
    expect(screen.getByText('1000')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    // GRID_ORDER 把 level 放最前，economy 在后
    const text = container.textContent ?? ''
    expect(text.indexOf('等级')).toBeLessThan(text.indexOf('金币'))
  })

  it('布尔显示「是 / 否」，空值显示破折号', () => {
    renderCard(
      makeFields({
        values: { notify: true, banned: false, remark: '' },
        labels: {
          notify: { label: '通知开关', category: 'status' },
          banned: { label: '封禁状态', category: 'status' },
          remark: { label: '备注' },
        },
      }),
    )
    expect(screen.getByText('是')).toBeInTheDocument()
    expect(screen.getByText('否')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('流程里可增减的字段标注「可增减」', () => {
    renderCard(
      makeFields({
        values: { exp: 30 },
        declared: ['exp'],
        labels: { exp: { label: '经验', category: 'level' } },
        modes: { exp: ['increment'] },
      }),
    )
    expect(screen.getByText('可增减')).toBeInTheDocument()
  })

  it('集合类字段不进数值网格（只出卡片）', () => {
    renderCard(
      makeFields({
        values: { bag: [{ name: '金创药', count: 9 }] },
        labels: { bag: { label: '背包', category: 'collection' } },
      }),
    )
    expect(screen.getAllByText('背包')).toHaveLength(1)
    expect(screen.queryByText(/^\[/)).toBeNull()
  })
})

describe('CharacterProfileCard - 基础数据', () => {
  it('引擎基础数据单独成块并标「引擎自动维护」', () => {
    renderCard(
      makeFields({
        values: { __sys_msg_count: 12, gold: 5 },
        labels: {
          __sys_msg_count: { label: '消息数', category: 'status' },
          gold: { label: '金币', category: 'economy' },
        },
      }),
    )
    expect(screen.getByText('基础数据')).toBeInTheDocument()
    expect(screen.getByText('引擎自动维护')).toBeInTheDocument()
    expect(screen.getByText('消息数')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('金币')).toBeInTheDocument()
  })
})

describe('CharacterProfileCard - 引擎状态', () => {
  it('运行状态默认折叠，点开才看得到原文', () => {
    renderCard(
      makeFields({
        values: { log: '你使用【普攻】，对 野狼 造成 24 点伤害' },
        labels: { log: { label: '战斗日志', category: 'status' } },
      }),
    )
    expect(screen.getByText('引擎状态（1）')).toBeInTheDocument()
    expect(screen.queryByText(/野狼/)).toBeNull()
    fireEvent.click(screen.getByText('引擎状态（1）'))
    expect(screen.getByText(/野狼/)).toBeInTheDocument()
    expect(screen.getByText('战斗日志')).toBeInTheDocument()
  })
})

describe('CharacterProfileCard - 缺值字段', () => {
  it('弱化展示「N 个字段还没数据」，点开列出字段名', () => {
    renderCard(
      makeFields({
        declared: ['gold', 'level'],
        labels: {
          gold: { label: '金币', category: 'economy' },
          level: { label: '等级', category: 'level' },
        },
      }),
    )
    expect(screen.getByText('2 个字段还没数据')).toBeInTheDocument()
    // 折叠时不上屏，避免把不存在的东西画成一堆空格
    expect(screen.queryByText('金币')).toBeNull()
    fireEvent.click(screen.getByText('2 个字段还没数据'))
    expect(screen.getByText('金币')).toBeInTheDocument()
    expect(screen.getByText('等级')).toBeInTheDocument()
  })
})

describe('CharacterProfileCard - 集合卡片', () => {
  it('空集合显示「（空）」', () => {
    renderCard(
      makeFields({
        values: { bag: [] },
        labels: { bag: { label: '背包', category: 'collection' } },
      }),
    )
    expect(screen.getByText('（空）')).toBeInTheDocument()
  })

  it('道具列表显示「名称 ×数量」，配置表里没有时如实标注', () => {
    renderCard(
      makeFields({
        values: { bag: [{ name: '金创药', count: 9 }] },
        labels: { bag: { label: '背包', category: 'collection' } },
      }),
    )
    expect(screen.getByText('金创药')).toBeInTheDocument()
    expect(screen.getByText('×9')).toBeInTheDocument()
    expect(screen.getByText('1 种 · 共 9 件')).toBeInTheDocument()
    // 铁律：查不到就说查不到，不猜属性
    expect(screen.getByText('配置表里没有')).toBeInTheDocument()
  })

  it('查得到配置表时列出属性与说明', () => {
    const itemConfig = buildConfigTable(
      'items',
      ['id', 'name', 'type', 'heal', 'price', 'desc'],
      [
        {
          id: 1,
          name: '金创药',
          type: 'potion',
          heal: 30,
          price: 20,
          desc: '恢复少量生命',
        },
      ],
    )
    render(
      <CharacterProfileCard
        fields={makeFields({
          values: { bag: [{ name: '金创药', count: 2 }] },
          labels: { bag: { label: '背包', category: 'collection' } },
        })}
        foundPlayerQQ="1001"
        itemConfig={itemConfig}
      />,
    )
    expect(screen.getByText('💊')).toBeInTheDocument()
    expect(screen.getByText(/回血 30/)).toBeInTheDocument()
    expect(screen.getByText(/价格 20/)).toBeInTheDocument()
    expect(screen.getByText(/恢复少量生命/)).toBeInTheDocument()
  })

  it('「原始 JSON」可展开看到原样内容', () => {
    const { container } = renderCard(
      makeFields({
        values: { bag: [{ name: '金创药', count: 2 }] },
        labels: { bag: { label: '背包', category: 'collection' } },
      }),
    )
    expect(container.textContent ?? '').not.toContain('"count":2')
    fireEvent.click(screen.getByText('原始 JSON'))
    expect(container.textContent ?? '').toContain('"count":2')
  })
})