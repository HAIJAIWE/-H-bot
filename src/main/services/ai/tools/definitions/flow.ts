// src/main/services/ai/tools/definitions/flow.ts
//
// **这一族工具的声明**（2026-10-15 从 registry.ts 拆出来）。
//
// 为什么拆：registry.ts 一度约 1,300 行、超过 fileSize 闸门的 1,200 ——
// 闸门注释里作者自己留了作业：「拆的路径很清楚：把各域声明按域拆出去（已有
// registeredXxxDefinitions 的先例），dispatch 表本身保持一处」。这里就是照那条做的。
//
// 声明与实现分开放：声明是**给模型看的契约**（改文案要过 tool-description-contract 闸门），
// 实现是主进程的行为 —— 两者改动频率不同，混在一个文件里容易互相踩着。
import type { AiToolDefinition } from '@shared/types/ai';

/**
 * 图编辑四件套（add_node / update_node / delete_node / connect_nodes）。
 *
 * 它们只**回一条指令** —— 真正落盘由渲染层（IPC + flowStore）做，和用户手拖节点
 * 走的是同一套代码路径。主进程里再写一套图编辑实现，才是真正的隐患。
 */
export const GRAPH_EDIT_DEFS: AiToolDefinition[] = [
  {
    name: 'add_node',
    description:
      '在流程中添加一个步骤节点。**nodeKind 必须是真实存在的节点类型**（如 message_received / ' +
      'message_send / branch_if），拿不准时先用 list_nodes 查 —— 那里是节点信息的唯一可信来源，' +
      '不要凭印象拼节点名。',
    parameters: {
      type: 'object',
      properties: {
        nodeKind: {
          type: 'string',
          // ⚠️ 这里原先写「如 on_message/send_message/trigger/action/condition/logic」——
          // 那串**全是假 kind**（真的是 message_received / message_send）。它在
          // `tools-selfcheck.test.ts` 那次专门修复里活了下来，因为那道闸门**只扫工具级描述**。
          // 现在由 `tool-description-contract.test.ts` 扫**所有 description 字符串**。
          // 教训：修「描述骗模型」时，扫描范围要覆盖「模型能读到的全部文字」。
          description: '节点类型（kind）。**不要凭印象拼** —— 先用 list_nodes 查真实存在的类型',
        },
        tempRef: {
          type: 'string',
          description:
            '临时引用名，必须以 "new_" 前缀开头（如 new_trigger、new_action），用于后续 connect_nodes 引用',
        },
        label: {
          type: 'string',
          description:
            '节点**显示名**（**可选**）。**建议留空** —— 留空就用节点类型名（例如「收到消息」），' +
            '那是画布上最好读的写法。只有确实需要区分两个同类型节点时才给，' +
            '而且别把指令/意图塞进来（那些写 description）。',
        },
        description: {
          type: 'string',
          description:
            '节点**备注**：这个节点是干什么的（例如「每天签到一次」「玩家点菜单时回菜单」）。' +
            '画布上显示在节点名**下方**一行，用户不用点开就能看懂 —— 意图写这里，别写标题。',
        },
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          description: '节点坐标',
        },
        config: { type: 'object', description: '节点配置参数（因类型而异）' },
      },
      required: ['nodeKind'],
    },
    category: 'mutation',
  },
  {
    name: 'update_node',
    // 原先只有 9 个字，被 `tool-description-contract.test.ts` 的「描述不能太短」断言抓出来。
    // 合并语义已核对两处实现，两边一致：
    //   · `pendingGraph.ts:189`  { ...(node.data?.config ?? {}), ...(op.config ?? {}) }
    //   · `flowStore.ts:773`     { ...n.data.config, ...config }
    description:
      '修改指定节点的配置。**config 是浅合并** —— 只给要改的字段即可，没提到的字段保持原值' +
      '（嵌套对象会整块替换：要改嵌套里的一个键，得把那一层写全）。' +
      'nodeRef 用 add_node 返回的 tempRef 或真实节点 id；不确定 id 时先用 read_flow 看结构索引。',
    parameters: {
      type: 'object',
      properties: {
        nodeRef: { type: 'string', description: '节点引用（节点 ID 或 add_node 返回的 tempRef）' },
        config: { type: 'object', description: '新的配置参数（可选：只改标题/备注时不用给）' },
        label: {
          type: 'string',
          description:
            '新的**显示名**。保持它是类型名本身，**别把意图塞进标题** —— 意图写 description。' +
            '另外：**不要为了改一个备注就去改标题**。',
        },
        description: {
          type: 'string',
          description:
            '新的**备注**（画布显示在节点名下方）。想说明「这个节点在流程里干什么」就写这里。',
        },
      },
      required: ['nodeRef'],
    },
    category: 'mutation',
  },
  {
    name: 'delete_node',
    description:
      '删除指定节点。**与它相连的连线会一起删掉，且不会自动重连** —— ' +
      '删掉链中间的一个节点后，要用 connect_nodes 自己把上下游补回来，' +
      '否则控制链会断在那里（不报错，只是后面的节点不再执行）。' +
      '⚠️ **不要「先删后建」**：一轮里可能因为额度用尽/报错/用户中断而**做不完**，' +
      '那样你就把用户原本能跑的东西删了却没补回来（2026-10-15 真机事故：助手删掉 /测试 的触发节点后，' +
      '准备重建时模型额度 403 中断，用户的指令就永久少了那个节点）。' +
      '正确顺序是**先建好后删旧**：新链建成并校验通过之后，再删不要的旧节点；' +
      '一次删多个就先别删，说明计划让用户确认。',
    parameters: {
      type: 'object',
      properties: { nodeRef: { type: 'string', description: '节点引用（节点 ID 或 tempRef）' } },
      required: ['nodeRef'],
    },
    category: 'mutation',
  },
  {
    name: 'connect_nodes',
    description:
      '连接两个节点的端口。控制流端口决定执行顺序：**节点只有挂在控制链上才会执行**，' +
      '所以新增的数据节点（如 get_context / expression_eval）也必须把控制端口接进链里，' +
      '否则它不会跑。一个控制出口**只能接一条线**（要分叉请用 branch_if 之类的多出口节点）；' +
      '数据端口用于传值，可以接多条。',
    parameters: {
      type: 'object',
      properties: {
        sourceRef: {
          type: 'string',
          description: '源节点引用（节点 ID 或 add_node 返回的 tempRef）',
        },
        sourcePortId: { type: 'string', description: '源端口 ID' },
        targetRef: { type: 'string', description: '目标节点引用（节点 ID 或 tempRef）' },
        targetPortId: { type: 'string', description: '目标端口 ID' },
      },
      required: ['sourceRef', 'targetRef'],
    },
    category: 'mutation',
  },
];
export const FLOW_TOOL_DEFS: AiToolDefinition[] = [
  {
    name: 'read_flow',
    description:
      '读取流程。**默认只回结构索引**（规模 + 每条指令一行控制链，不含配置值）；' +
      '要配置值请指定 nodeId（单个）或 nodeIds（批量）；要某条指令的概览请指定 group。' +
      '真实项目整份 flow.json 有上百万字符，**不要试图整份读**。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: '取该节点的完整配置值（这是唯一能拿到配置值的模式）',
        },
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: '批量取多个节点的完整配置；装不下的节点会在 omitted 里明确列出',
        },
        group: {
          type: 'string',
          description: '按分组名（如 /打怪）取控制链与"配了哪些键"，刻意不含配置值',
        },
      },
    },
    category: 'query',
  },
  {
    name: 'validate_flow',
    description:
      '读**磁盘上最新的**流程并给出问题清单（不执行流程）。改完流程后应当调它自检：' +
      '必填项为空、端口不存在、节点不可达之类都会列出来。issues 有上限，超出的会记在 truncated 里。',
    parameters: { type: 'object', properties: {} },
    category: 'query',
  },
  {
    name: 'preview_flow',
    description:
      '用**真解释器**跑一次流程做自检（副作用全部挡在临时克隆里，不会真的发消息）。' +
      '传入触发方式与内容，返回：触发是否命中、实际会发出什么（actions 的 summary 就是正文摘要）、' +
      '执行了多少节点、哪些节点挂了（带真实原因）。改完流程想确认"真的会这么发"时用它。',
    parameters: {
      type: 'object',
      properties: {
        triggerType: {
          type: 'string',
          description:
            '触发方式：command（指令）/ text（关键词）/ at_me（被@）/ button / scheduled / on_ready',
        },
        command: { type: 'string', description: 'command 模式的命令名（不含前缀，如 菜单）' },
        prefix: { type: 'string', description: 'command 模式的前缀，默认 /' },
        text: { type: 'string', description: 'text / at_me 模式的消息内容' },
      },
    },
    category: 'query',
  },
];
export const NODE_CATALOG_DEFS: AiToolDefinition[] = [
  {
    name: 'list_nodes',
    description:
      '查询节点目录（内置/自定义/AI 生成）。**这是节点信息的唯一可信来源** —— ' +
      '需要节点类型、端口名、**配置字段与可选值**时一律查这里，不要凭记忆猜。' +
      '⚠️ 不传参数会返回**全部 57 个节点**（实测 83,486 字符 ≈ 2 万 token，很贵）；' +
      '只想看某一个节点时**务必传 kind**（如 kind="message_send"）—— 实测单查中位数 948 字符、' +
      '最大 5,167（message_send），比全量小一个数量级以上。' +
      '⚠️ **别反复查**：同一轮里查过就够，要补查就一次把 kind 带全。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description:
            '可选。只要这一个节点类型的完整定义（含每个配置字段的说明与可选值）。不传则返回全部节点。',
        },
      },
    },
    category: 'query',
  },
];
