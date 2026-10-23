// tests/main/runtime/configApiRuntime.probe.test.ts
//
// 【探针】验证：配置表绑定（__config_api__ 边）在 **TS 运行时**（FlowInterpreter）里
// 到底能不能把配置数据送进节点的输入端口。
//
// 背景：`tests/main/codegen/config-api-binding.test.ts` 的头注写明"改由 TS 运行时
// （resolveConfigApiValue）在执行期按绑定边查询配置库"，且断言"生成器不再注入查询"。
// 也就是说：代码生成侧已交棒，运行时侧必须真的查得到——这个探针就是验证交棒有没有接住。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { databaseWrite, setDbOpenerForTesting } from '@main/services/builtinNodes/databaseWrite'
import { setDbCtorForTesting, closeAllConnectionsForTesting } from '@main/services/dataService'
import { createConfigTable } from '@main/services/configService'
import { makeSqliteShim } from '../../helpers/sqliteShim'
import { runFlowGraph } from '../../helpers/runFlowGraph'
import { NODE_CATALOG_V2 } from '@shared/nodes/builtinCatalog'

const ShimDatabase = makeSqliteShim()

const specOf = (kind: string) => NODE_CATALOG_V2.find((s) => s.kind === kind)!
const node = (id: string, kind: string, config: Record<string, unknown>) => {
  const spec = specOf(kind)
  return {
    id,
    type: spec.type,
    position: { x: 0, y: 0 },
    data: { label: spec.label, nodeKind: kind, config, inputs: spec.inputs, outputs: spec.outputs },
  }
}
const edge = (id: string, s: string, sp: string, t: string, tp: string) => ({
  id,
  source: s,
  sourcePort: sp,
  target: t,
  targetPort: tp,
})

let root: string
const DB_REL = 'data/config/skills.db'

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'qqbat-cfgapi-'))
  mkdirSync(join(root, 'data', 'config'), { recursive: true })
  // 数据库路径相对"项目根"解析 → 靠 QQBOT_PROJECT_ROOT 指到这个临时目录
  process.env.QQBOT_PROJECT_ROOT = root
  // 本机 better-sqlite3 只有 electron ABI，Node 测试进程加载不了 → 注入等价 shim
  setDbOpenerForTesting((filePath) => new ShimDatabase(filePath))
  setDbCtorForTesting(ShimDatabase as never)

  // 用与界面「新建表」同一条路径建表（表名取拼音，文件为 <表名>.db）
  createConfigTable(root, 'skills', [
    { name: 'name', type: 'text', label: '技能名' },
    { name: 'power', type: 'integer', label: '威力' },
  ] as never)

  const ins = await databaseWrite({
    mode: 'insert',
    table: 'skills',
    db_path: DB_REL,
    data: { name: '火球术', power: 30 },
  })
  console.log('[探针] 建表+插入结果 =', JSON.stringify(ins))
})

afterAll(() => {
  setDbOpenerForTesting(null)
  setDbCtorForTesting(null)
  closeAllConnectionsForTesting()
  delete process.env.QQBOT_PROJECT_ROOT
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结论 */
  }
})

describe('配置表绑定在 TS 运行时的取值', () => {
  it('先证明库确实写进去了（配置表本身没问题）', async () => {
    const r = await databaseWrite({
      mode: 'select',
      table: 'skills',
      db_path: DB_REL,
      condition: 'power >= ?',
      where_params: [10],
      result_field: 'name',
      limit: 1,
    })
    expect(r.success).toBe(true)
    expect(r.value).toBe('火球术')
  })

  it('【探针】节点输入端口的配置绑定能否取到值', async () => {
    const graph = {
      nodes: [
        node('t', 'message_received', {
          match: 'command',
          command: '技能',
          prefix: '/',
          message_type: 'any',
        }),
        // 用一个"不需要上游"的节点，把它的数据端口绑到配置表字段上
        node('f', 'format_text', { template: '技能={var1}' }),
        node('s', 'message_send', { mode: 'text', text: '' }),
      ],
      edges: [
        edge('e1', 't', 'next', 'f', 'in'),
        edge('e2', 'f', 'out', 's', 'in'),
        edge('e3', 'f', 'result', 's', 'text'),
        // 关键：var1 不接上游节点，而是绑到配置表 skills.name
        {
          id: 'e4',
          source: '__config_api__',
          sourcePort: '__api__',
          target: 'f',
          targetPort: 'var1',
          configApi: {
            table: 'skills',
            field: 'name',
            dbPath: DB_REL,
            where: 'power >= ?',
            whereParamRef: { nodeId: '', portId: '', literalValue: 10 },
          },
        },
      ],
    }

    const r = await runFlowGraph(graph, {
      event: { raw_message: '/技能', message: '/技能', get_message: () => '/技能' },
    })

    const sent = r.actions.filter((a) => a.api === 'send_msg').map((a) => a.params.message)
    console.log('[探针] 实际发出的内容 =', JSON.stringify(sent))
    console.log('[探针] 变量快照 =', JSON.stringify(r.variables))
    expect(sent).toEqual(['技能=火球术'])
  })
})
