// src/main/templates/rpgButtonPanelExtension.ts
// RPG 按钮面板扩展模板 — 为现有 RPG 游戏添加按钮面板 UI
//
// 功能：
//   1. /菜单 → 读取玩家属性 → 显示主菜单面板（角色/背包/战斗/商店/探索/签到/公会/帮助）
//   2. 主菜单按钮点击后触发对应子面板
//   3. 角色面板：检查注册 → 批量读取属性 → 格式化为表格 → 显示面板
//   4. 背包面板：检查注册 → 读取背包 → 统计数量 → 显示面板
//   5. 商店面板：静态商品列表
//   6. 所有子面板"返回菜单"按钮 → 按钮 action.data='/菜单' 自然触发 /菜单 指令（无需额外节点）
//
// 使用方式：
//   1. 先创建项目时选择「RPG 游戏模板」（包含 19 条指令系统）
//   2. 在流程中导入「RPG 按钮面板扩展」模板
//   3. 在 QQ 群发送 /菜单 即可看到按钮面板

import type { FlowTemplate } from '@shared/types/template'
import type { FlowNode, FlowEdge } from '@shared/types/flow'
import type { InlineKeyboard, Button } from '@shared/types/keyboard'

/** 创建按钮 */
function btn(id: string, label: string, data: string, style: 0 | 1 = 1): Button {
  return {
    id,
    render_data: { label, style },
    action: {
      type: 2, // @机器人
      permission: { type: 2 }, // 所有人
      data,
    },
  }
}

/** 行 */
function row(...buttons: Button[]): { buttons: Button[] } {
  return { buttons }
}

/** 主菜单面板 keyboard */
const MAIN_MENU_KB: InlineKeyboard = {
  rows: [
    row(
      btn('profile', '👤 角色', '/profile'),
      btn('inventory', '🎒 背包', '/背包'),
      btn('battle', '⚔ 战斗', '/battle')
    ),
    row(
      btn('shop', '🏪 商店', '/shop'),
      btn('explore', '🌍 探索', '/探索'),
      btn('signin', '📅 签到', '/sign')
    ),
    row(
      btn('rank', '🏆 排行', '/排行'),
      btn('guild', '🏠 公会', '/公会'),
      btn('help', '❓ 帮助', '/帮助')
    ),
    row(
      btn('upgrade', '⬆ 升级', '/升级'),
      btn('equip', '🗡 装备', '/装备'),
      btn('close', '✖ 关闭', '/关闭菜单', 0)
    ),
  ],
}

/** 商店面板 keyboard */
const SHOP_KB: InlineKeyboard = {
  rows: [
    row(
      btn('buy_potion', '💊 药水 50金', '/buy 药水'),
      btn('buy_sword', '🗡 铁剑 200金', '/buy 铁剑'),
      btn('buy_shield', '🛡 铁盾 150金', '/buy 铁盾')
    ),
    row(btn('back_shop', '← 返回菜单', '/菜单')),
  ],
}

/** 背包面板 keyboard */
const INVENTORY_KB: InlineKeyboard = {
  rows: [
    row(
      btn('equip_item', '🗡 装备', '/装备 铁剑'),
      btn('use_item', '💊 使用', '/使用 药水'),
      btn('sell_item', '💰 出售', '/出售 铁盾')
    ),
    row(btn('back_inv', '← 返回菜单', '/菜单')),
  ],
}

/** 角色面板 keyboard */
const PROFILE_KB: InlineKeyboard = {
  rows: [
    row(
      btn('upgrade_ap', '⬆ 升级', '/升级'),
      btn('class_change', '🔄 转职', '/转职'),
      btn('add_point', '📊 加点', '/加点')
    ),
    row(btn('back_profile', '← 返回菜单', '/菜单')),
  ],
}

/** 构建节点 */
function n(
  id: string,
  kind: string,
  label: string,
  type: FlowNode['type'],
  x: number,
  y: number,
  config?: Record<string, unknown>
): FlowNode {
  return {
    id,
    type,
    position: { x, y },
    data: {
      label,
      nodeKind: kind,
      config: config ?? {},
      inputs: [],
      outputs: [],
    },
  }
}

/** 构建边 */
function e(
  source: string,
  target: string,
  sourcePort: string,
  targetPort: string = 'in'
): FlowEdge {
  return {
    id: `e-${source}-${sourcePort}-${target}`,
    source,
    sourcePort,
    target,
    targetPort,
  }
}

// ════════════ 文本模板 ════════════

/** 主菜单模板：用 persistent_op (batch_load) 读取 level/gold/hp 后填充 */
const MENU_TEMPLATE = `## 🎮 游戏主菜单\n\n> 📊 等级 {level} | 💰 金币 {gold} | ❤️ HP {hp}\n\n请选择操作：\n\n👤 角色 | 🎒 背包 | ⚔ 战斗\n🏪 商店 | 🌍 探索 | 📅 签到\n🏆 排行 | 🏠 公会 | ❓ 帮助`

/** 角色面板模板：用 persistent_op (batch_load) 读取 level/exp/gold/hp/mp/atk/def 后填充 */
const PROFILE_TEMPLATE = `## 👤 角色信息\n\n| 属性 | 数值 |\n|------|------|\n| 📈 等级 | {level} |\n| ✨ 经验 | {exp} |\n| 💰 金币 | {gold} |\n| ❤️ 生命 | {hp} |\n| 🔵 魔法 | {mp} |\n| ⚔️ 攻击 | {atk} |\n| 🛡️ 防御 | {def} |\n\n点击下方按钮进行角色操作：`

/** 背包面板模板：用 expression_eval 计算 len(inventory) 后填充 {var1} */
const INVENTORY_TEMPLATE = `## 🎒 背包\n\n背包中有 **{var1}** 件物品\n\n点击下方按钮操作物品：`

/** 商店面板静态文本 */
const SHOP_PANEL_MD = `## 🏪 商店\n商品列表：\n- 💊 药水 50金币（回血）\n- 🗡 铁剑 200金币（+5攻击）\n- 🛡 铁盾 150金币（+3防御）`

/** 未注册提示 */
const NOT_REGISTERED_MD = `⚠️ 你还没有注册角色\n\n请先发送 **/注册** 创建角色，然后再查看面板。`

export const RPG_BUTTON_PANEL_EXTENSION: FlowTemplate = {
  id: 'rpg-button-panel-extension',
  botCategory: 'game',
  name: 'RPG 按钮面板扩展',
  description: '为 RPG 游戏添加按钮面板 UI：/菜单 → 主菜单面板（含玩家状态）→ 点击按钮触发对应系统。角色/背包面板含注册检查，返回菜单复用 /菜单 指令。需要先导入「RPG 游戏模板」。',
  category: '其他',
  tags: ['RPG', '按钮', '面板', '菜单', 'UI', 'keyboard'],
  author: '内置',
  createdAt: '2026-07-07',
  version: '1.1',
  nodes: [
    // ════════════ /菜单 → 主菜单面板（含玩家状态）════════════
    n('mm0', 'on_message', '菜单指令', 'trigger', 0, 0, { match: 'command', command: '菜单', prefix: '/' }),
    n('mm_load', 'persistent_op', '读取玩家状态', 'data', 0, 50, {
      mode: 'batch_load',
      scope: 'user',
      keys: '["level","gold","hp"]',
    }),
    n('mm_fmt', 'format_text', '格式化主菜单', 'logic', 0, 100, {
      template: MENU_TEMPLATE,
    }),
    n('mm1', 'send_message', '主菜单面板', 'action', 0, 150, {
      mode: 'keyboard',
      markdown: '',
      keyboard: MAIN_MENU_KB,
      panelId: '',
    }),

    // ════════════ /关闭菜单 ════════════
    n('cm0', 'on_message', '关闭菜单', 'trigger', 300, 0, { match: 'command', command: '关闭菜单', prefix: '/' }),
    n('cm1', 'format_text', '关闭提示', 'logic', 300, 100, { template: '菜单已关闭。需要时随时发送 /菜单 重新打开。' }),
    n('cm2', 'send_message', '发送', 'action', 300, 200, { mode: 'text', text: '' }),

    // ════════════ 主菜单 → 角色面板（注册检查 + 动态数据）════════════
    // 1) 检查是否已注册（level 是否存在）
    n('pp_check', 'persistent_op', '检查已注册', 'data', 600, 0, {
      mode: 'exists',
      key: 'level',
      scope: 'user',
    }),
    n('pp_if', 'if_branch', '已注册？', 'logic', 600, 50, { expression: 'value' }),

    // 2a) 已注册 → 批量读取属性 → 格式化 → 发送面板
    n('pp_load', 'persistent_op', '读取角色属性', 'data', 600, 150, {
      mode: 'batch_load',
      scope: 'user',
      keys: '["level","exp","gold","hp","mp","atk","def"]',
    }),
    n('pp_fmt', 'format_text', '格式化角色信息', 'logic', 600, 200, {
      template: PROFILE_TEMPLATE,
    }),
    n('pp1', 'send_message', '角色面板', 'action', 600, 250, {
      mode: 'keyboard',
      markdown: '',
      keyboard: PROFILE_KB,
      panelId: '',
    }),
    // 2b) 未注册 → 提示注册
    n('pp_not_reg', 'send_message', '未注册提示', 'action', 750, 150, {
      mode: 'text',
      text: NOT_REGISTERED_MD,
    }),

    // 角色面板"返回菜单"按钮：action.data='/菜单' 自然触发 mm0 菜单指令，无需额外节点

    // ════════════ 主菜单 → 背包面板（注册检查 + 动态数据）════════════
    // 1) 检查是否已注册
    n('ip_check', 'persistent_op', '检查已注册', 'data', 900, 0, {
      mode: 'exists',
      key: 'level',
      scope: 'user',
    }),
    n('ip_if', 'if_branch', '已注册？', 'logic', 900, 50, { expression: 'value' }),

    // 2a) 已注册 → 读取背包 → 统计数量 → 格式化 → 发送面板
    n('ip_load', 'persistent_op', '读取背包', 'data', 900, 150, {
      mode: 'load',
      key: 'inventory',
      scope: 'user',
    }),
    n('ip_count', 'expression_eval', '统计物品数量', 'logic', 900, 200, {
      expression: 'len(v1)',
    }),
    n('ip_fmt', 'format_text', '格式化背包', 'logic', 900, 250, {
      template: INVENTORY_TEMPLATE,
    }),
    n('ip1', 'send_message', '背包面板', 'action', 900, 300, {
      mode: 'keyboard',
      markdown: '',
      keyboard: INVENTORY_KB,
      panelId: '',
    }),
    // 2b) 未注册 → 提示注册
    n('ip_not_reg', 'send_message', '未注册提示', 'action', 1050, 150, {
      mode: 'text',
      text: NOT_REGISTERED_MD,
    }),

    // 背包面板"返回菜单"按钮：action.data='/菜单' 自然触发 mm0 菜单指令，无需额外节点

    // ════════════ 主菜单 → 商店面板（静态商品列表）════════════
    n('sp1', 'send_message', '商店面板', 'action', 1200, 100, {
      mode: 'keyboard',
      markdown: SHOP_PANEL_MD,
      keyboard: SHOP_KB,
      panelId: '',
    }),
    // 商店面板"返回菜单"按钮：action.data='/菜单' 自然触发 mm0 菜单指令，无需额外节点
  ],
  edges: [
    // ════════════ 主菜单触发 → 读取状态 → 格式化 → 发送面板 ════════════
    e('mm0', 'mm_load', 'next'),
    e('mm_load', 'mm_fmt', 'out'),
    e('mm_fmt', 'mm1', 'out'),
    // 数据流：persistent_op.values → format_text.variables_json
    e('mm_load', 'mm_fmt', 'values', 'variables_json'),
    // 数据流：format_text.result → send_message.markdown
    e('mm_fmt', 'mm1', 'result', 'markdown'),

    // ════════════ 关闭菜单 ════════════
    e('cm0', 'cm1', 'next'),
    e('cm1', 'cm2', 'out'),

    // ════════════ 主菜单 btn_profile → 角色面板（注册检查 + 动态数据）════════════
    // 控制流：按钮 → 检查注册 → 条件分支
    e('mm1', 'pp_check', 'btn_profile'),
    e('pp_check', 'pp_if', 'out'),
    // 数据流：persistent_op.exists → if_branch.value
    e('pp_check', 'pp_if', 'exists', 'value'),

    // 已注册分支（true）：读取属性 → 格式化 → 发送面板
    e('pp_if', 'pp_load', 'true'),
    e('pp_load', 'pp_fmt', 'out'),
    e('pp_fmt', 'pp1', 'out'),
    // 数据流：persistent_op.values → format_text.variables_json
    e('pp_load', 'pp_fmt', 'values', 'variables_json'),
    // 数据流：format_text.result → send_message.markdown
    e('pp_fmt', 'pp1', 'result', 'markdown'),

    // 未注册分支（false）：发送提示
    e('pp_if', 'pp_not_reg', 'false'),

    // 角色面板"返回菜单"按钮：action.data='/菜单' 自然触发 mm0，无需连线

    // ════════════ 主菜单 btn_inventory → 背包面板（注册检查 + 动态数据）════════════
    // 控制流：按钮 → 检查注册 → 条件分支
    e('mm1', 'ip_check', 'btn_inventory'),
    e('ip_check', 'ip_if', 'out'),
    // 数据流：persistent_op.exists → if_branch.value
    e('ip_check', 'ip_if', 'exists', 'value'),

    // 已注册分支（true）：读取背包 → 统计数量 → 格式化 → 发送面板
    e('ip_if', 'ip_load', 'true'),
    e('ip_load', 'ip_count', 'out'),
    e('ip_count', 'ip_fmt', 'out'),
    e('ip_fmt', 'ip1', 'out'),
    // 数据流：persistent_op.result → expression_eval.v1
    e('ip_load', 'ip_count', 'result', 'v1'),
    // 数据流：expression_eval.result → format_text.var1
    e('ip_count', 'ip_fmt', 'result', 'var1'),
    // 数据流：format_text.result → send_message.markdown
    e('ip_fmt', 'ip1', 'result', 'markdown'),

    // 未注册分支（false）：发送提示
    e('ip_if', 'ip_not_reg', 'false'),

    // 背包面板"返回菜单"按钮：action.data='/菜单' 自然触发 mm0，无需连线

    // ════════════ 主菜单 btn_shop → 商店面板（静态）════════════
    e('mm1', 'sp1', 'btn_shop'),
    // 商店面板"返回菜单"按钮：action.data='/菜单' 自然触发 mm0，无需连线
  ],
}
