// tests/main/... 共用的"跑一遍流程图"助手
//
// 为什么需要：绝大多数节点测试关心的是"图跑完后发出了哪些动作、变量变成了什么"，
// 而不关心 Electron、WS 连接、真实 QQ。`runFlowGraph` 把这件事收成一个 await。
//
// 实现照 `src/main/runtime/previewRunner.ts` 的预览链路（同一套 FlowInterpreter + fake bot），
// 但更薄：
// - 不克隆项目、不写 out/、不注册进程级监听；
// - 只有 `process.env.QQBOT_PROJECT_ROOT` 未被测试自己设置时，才把它指到临时目录 ——
//   `file_operate` / 数据库类节点按"项目根"解析相对路径，不能让它们写进仓库。
//
// 用法：
//   const r = await runFlowGraph(graph)                        // 默认一条群消息 /测试
//   const r = await runFlowGraph(graph, { event: { raw_message: '/技能' } })
//
// 返回 `{ actions, variables, matched }`：
//   actions   — 依次调用的适配器接口（`{ api, params, seq }`）
//   variables — 链执行结束时的变量快照（来自 FlowInterpreter.onChainContext）
//   matched   — 是否有触发器命中

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowInterpreter } from '@main/runtime/FlowInterpreter'

/** 一次适配器调用（fake bot 收集） */
export interface FlowAction {
  api: string
  params: Record<string, unknown>
}

export interface RunFlowGraphResult {
  actions: FlowAction[]
  variables: Record<string, unknown>
  matched: boolean
}

/** 触发器事件（覆盖项，其余字段由默认事件补齐） */
export interface FlowEventOverride {
  raw_message?: string
  message?: string
  message_id?: number | string
  user_id?: number | string
  group_id?: number | string
  message_type?: string
  get_message?: () => string
  [key: string]: unknown
}

export interface RunFlowGraphOptions {
  /** 覆盖默认事件字段（默认：群聊、user 12345 / group 67890、消息 "/测试"、message_id 1） */
  event?: FlowEventOverride
  /** 超时（毫秒），默认 15s；`delay` / `wait_input` 类节点要留足 */
  timeoutMs?: number
  /**
   * 覆盖某个适配器接口的返回/抛错。
   *
   * 用来测"第 N 片流式消息失败""接口报错时节点怎么收尾"这类分支：
   * 返回 undefined 表示交回默认桩。
   */
  callApi?: (api: string, params: Record<string, unknown>) => unknown
}

/**
 * 默认事件。
 *
 * 与 previewRunner.synthesizeEvent 形状一致（OneBot v11 消息事件），但数值固定成
 * 测试里用得最多的那组：get_context 的 user_id=12345 / group_id=67890 /
 * message_text="/测试" / message_ref=1 都依赖它们。
 */
function defaultEvent(override: FlowEventOverride = {}) {
  const rawMessage = override.raw_message ?? override.message ?? '/测试'
  return {
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    time: Math.floor(Date.now() / 1000),
    self_id: 10000,
    message_id: 1,
    user_id: 12345,
    group_id: 67890,
    raw_message: rawMessage,
    message: rawMessage,
    sender: { user_id: 12345, nickname: '测试用户' },
    get_message: () => rawMessage,
    ...override,
  }
}

/**
 * 常见 action 的桩返回。
 *
 * 只覆盖"下游节点会读返回字段"的接口：发消息要拿到 message_id（流式消息、撤回、编辑
 * 都靠它串起来），取用户/群信息要拿到对象形状。其余给 `{status:'ok'}` 即可。
 *
 * 固定返回 `message_id: 'test-msg-1'`：多回流式测试断言 `stream_msg_id === 'test-msg-1'`。
 */
function stubResponse(api: string, params: Record<string, unknown>): unknown {
  if (api.includes('login_info')) return { user_id: 10000, nickname: '测试机器人' }
  if (api.includes('group_list')) return []
  if (api.includes('friend_list')) return []
  if (api.includes('stranger_info')) {
    return { user_id: Number(params.user_id) || 0, nickname: '测试用户' }
  }
  if (api.includes('group_member_info')) {
    return { user_id: Number(params.user_id) || 0, nickname: '测试用户', role: 'member' }
  }
  if (api.includes('group_member_list')) return []
  if (api.includes('get_msg')) {
    return { message_id: params.message_id ?? 1, message: '测试消息', sender: { user_id: 12345 } }
  }
  if (api.includes('send')) {
    return { message_id: 'test-msg-1', data: { message_id: 'test-msg-1' } }
  }
  return { status: 'ok', retcode: 0 }
}

/**
 * 把流程图写到临时项目里跑一遍。
 *
 * @param graph 流程图（`{ nodes, edges }`）；直接 JSON 落到 `.qqbat/flow.json`
 */
export async function runFlowGraph(
  graph: unknown,
  options: RunFlowGraphOptions = {},
): Promise<RunFlowGraphResult> {
  const root = mkdtempSync(join(tmpdir(), 'qqbat-flow-'))
  const actions: FlowAction[] = []
  let variables: Record<string, unknown> = {}
  const prevRoot = process.env.QQBOT_PROJECT_ROOT
  // 测试自己设了项目根（数据库相关用例）时尊重它；没设才兜底到临时目录
  const ownsRoot = !prevRoot

  try {
    mkdirSync(join(root, '.qqbat'), { recursive: true })
    writeFileSync(join(root, '.qqbat', 'flow.json'), JSON.stringify(graph), 'utf-8')
    if (ownsRoot) process.env.QQBOT_PROJECT_ROOT = root

    const fakeBot = {
      self_id: 10000,
      projectPath: root,
      callApi: async (api: string, params: Record<string, unknown> = {}) => {
        actions.push({ api, params })
        // 测试显式接管时优先；它返回 undefined 视为"这条用默认桩"（要抛错请自己 throw）
        const custom = options.callApi?.(api, params)
        return custom === undefined ? stubResponse(api, params) : custom
      },
    }

    const interpreter = new FlowInterpreter(root, {
      isPreview: true,
      onChainContext: (ctx) => {
        variables = { ...ctx.variables }
      },
    })

    const timeoutMs = options.timeoutMs ?? 15_000
    const matched = await Promise.race([
      interpreter.handleEvent(fakeBot as never, defaultEvent(options.event) as never),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`runFlowGraph 超时（${timeoutMs}ms）`)), timeoutMs),
      ),
    ])

    return { actions, variables, matched: matched === true }
  } finally {
    if (ownsRoot) delete process.env.QQBOT_PROJECT_ROOT
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows 上 sqlite 句柄可能还没释放；临时目录留给系统清理，不影响断言
    }
  }
}