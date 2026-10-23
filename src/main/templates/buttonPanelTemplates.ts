// src/main/templates/buttonPanelTemplates.ts
// 按钮面板示例流程模板 — 演示如何用 send_message 按钮UI + 流程连接实现菜单系统
//
// 模板包含：
//   1. /菜单 trigger → send_message(主菜单面板)
//   2. btn_角色 → persistent_op (load) + format_text + send_message(角色信息)
//   3. btn_背包 → send_message(背包面板)
//   4. btn_技能 → send_message(技能面板)
//   5. btn_商店 → send_message(商店面板)
//   6. btn_签到 → persistent_op(increment 经验/金币) + send_message(签到结果)
//
// 使用方式：
//   - 在流程中导入此模板
//   - 导入预置面板到面板库
//   - 在 send_message 节点引用对应面板
//   - 根据需要修改按钮和下游节点

import type { FlowTemplate } from '@shared/types/template'
import type { FlowNode, FlowEdge } from '@shared/types/flow'
import { BUILTIN_PANEL_TEMPLATES } from '@shared/panels/builtinPanelTemplates'

// 获取预置面板的 keyboard 配置
function getPanelKeyboard(templateId: string) {
  const tpl = BUILTIN_PANEL_TEMPLATES.find((t) => t.templateId === templateId)
  if (!tpl) throw new Error(`面板模板不存在: ${templateId}`)
  return JSON.parse(JSON.stringify(tpl.keyboard))
}

// 获取面板中某个按钮的端口 ID（btn_<buttonId>）
function getBtnPort(templateId: string, buttonId: string): string {
  return `btn_${buttonId}`
}

// 主菜单面板的按钮 ID 常量
const MENU_BUTTONS = {
  character: 'btn_character',
  inventory: 'btn_inventory',
  skills: 'btn_skills',
  shop: 'btn_shop',
  quest: 'btn_quest',
  signin: 'btn_signin',
  gacha: 'btn_gacha',
  close: 'btn_close',
}

// 子面板的返回按钮端口
const BACK_PORT = 'btn_back'

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

/** Markdown 文本 */
const MENU_MD = `## 🎮 游戏主菜单\n欢迎来到游戏！请选择操作：`
const INVENTORY_MD = `## 🎒 背包\n你的物品列表：\n- 药水 x5\n- 铁剑 x1\n- 铁盾 x1`
const SKILLS_MD = `## ⚡ 技能列表\n你的技能：\n- 火球术 Lv.1\n- 治疗术 Lv.1`
const SHOP_MD = `## 🏪 商店\n商品列表：\n- 药水 50金币\n- 铁剑 200金币`
const SIGNIN_MD = `## 📅 签到成功！`

export const BUTTON_PANEL_TEMPLATES: FlowTemplate[] = [
  {
    id: 'button-panel-menu-system',
    botCategory: 'game',
    name: '按钮面板菜单系统',
    description: '完整的按钮面板菜单系统：/菜单 → 主菜单面板 → 角色/背包/技能/商店/签到 子面板。演示 send_message 按钮UI + 流程连接实现按钮点击事件。',
    category: '指令',
    tags: ['按钮', '面板', '菜单', 'UI', 'keyboard'],
    author: '内置',
    createdAt: '2026-07-07',
    version: '1.0',
    nodes: [
      // ════════════ 链1 · /菜单 → 主菜单面板 ════════════
      n('m0', 'on_message', '菜单指令', 'trigger', 0, 0, { match: 'command', command: '菜单', prefix: '/' }),
      n('m1', 'send_message', '主菜单面板', 'action', 0, 100, {
        mode: 'keyboard',
        markdown: MENU_MD,
        keyboard: getPanelKeyboard('main_menu'),
        panelId: '',
      }),

      // ════════════ 链2 · btn_角色 → 角色信息 ════════════
      n('c0', 'persistent_op', '读角色数据', 'data', 300, 100, { mode: 'load', key: 'level', scope: 'user' }),
      n('c1', 'persistent_op', '批量读取', 'data', 300, 150, {
        mode: 'batch_load',
        keys: '["level","exp","gold","hp","mp","atk","def"]',
        scope: 'user',
      }),
      n('c2', 'format_text', '格式化角色信息', 'logic', 300, 220, {
        template: '===== 角色信息 =====\n等级: {level}\n经验: {exp}\n金币: {gold}\nHP: {hp}  MP: {mp}\n攻击: {atk}  防御: {def}',
      }),
      n('c3', 'send_message', '发送角色信息', 'action', 300, 300, { mode: 'text', text: '' }),

      // ════════════ 链3 · btn_背包 → 背包面板 ════════════
      n('i0', 'send_message', '背包面板', 'action', 600, 100, {
        mode: 'keyboard',
        markdown: INVENTORY_MD,
        keyboard: getPanelKeyboard('inventory'),
        panelId: '',
      }),

      // ════════════ 链4 · btn_技能 → 技能面板 ════════════
      n('s0', 'send_message', '技能面板', 'action', 900, 100, {
        mode: 'keyboard',
        markdown: SKILLS_MD,
        keyboard: getPanelKeyboard('skills'),
        panelId: '',
      }),

      // ════════════ 链5 · btn_商店 → 商店面板 ════════════
      n('sh0', 'send_message', '商店面板', 'action', 1200, 100, {
        mode: 'keyboard',
        markdown: SHOP_MD,
        keyboard: getPanelKeyboard('shop'),
        panelId: '',
      }),

      // ════════════ 链6 · btn_签到 → 签到奖励 ════════════
      n('si0', 'time_op', '今天日期', 'logic', 1500, 100, { mode: 'now', fmt: '%Y-%m-%d' }),
      n('si1', 'persistent_op', '保存签到日期', 'data', 1500, 150, { mode: 'save', key: 'last_sign_date', scope: 'user' }),
      n('si2', 'persistent_op', '签到次数+1', 'action', 1500, 200, { mode: 'increment', key: 'signin_count', amount: 1, scope: 'user' }),
      n('si3a', 'persistent_op', '经验+100', 'action', 1500, 260, { mode: 'increment', key: 'exp', amount: 100, scope: 'user' }),
      n('si3b', 'persistent_op', '金币+50', 'action', 1500, 300, { mode: 'increment', key: 'gold', amount: 50, scope: 'user' }),
      n('si4', 'format_text', '签到成功文本', 'logic', 1500, 360, {
        template: SIGNIN_MD + '\n获得 100 经验、50 金币！',
      }),
      n('si5', 'send_message', '发送签到结果', 'action', 1500, 400, { mode: 'text', text: '' }),

      // ════════════ 子面板返回 → 主菜单 ════════════
      // 背包面板的"返回菜单"按钮 → 重新发送主菜单
      n('b0', 'send_message', '返回主菜单(从背包)', 'action', 600, 300, {
        mode: 'keyboard',
        markdown: MENU_MD,
        keyboard: getPanelKeyboard('main_menu'),
        panelId: '',
      }),
      // 技能面板的"返回菜单"按钮 → 重新发送主菜单
      n('b1', 'send_message', '返回主菜单(从技能)', 'action', 900, 300, {
        mode: 'keyboard',
        markdown: MENU_MD,
        keyboard: getPanelKeyboard('main_menu'),
        panelId: '',
      }),
      // 商店面板的"返回菜单"按钮 → 重新发送主菜单
      n('b2', 'send_message', '返回主菜单(从商店)', 'action', 1200, 300, {
        mode: 'keyboard',
        markdown: MENU_MD,
        keyboard: getPanelKeyboard('main_menu'),
        panelId: '',
      }),
    ],
    edges: [
      // 主菜单触发
      e('m0', 'm1', 'next'),

      // 主菜单按钮 → 子面板
      e('m1', 'c0', getBtnPort('main_menu', MENU_BUTTONS.character)),
      e('m1', 'i0', getBtnPort('main_menu', MENU_BUTTONS.inventory)),
      e('m1', 's0', getBtnPort('main_menu', MENU_BUTTONS.skills)),
      e('m1', 'sh0', getBtnPort('main_menu', MENU_BUTTONS.shop)),
      e('m1', 'si0', getBtnPort('main_menu', MENU_BUTTONS.signin)),

      // 角色信息链
      e('c0', 'c1', 'out'),
      e('c1', 'c2', 'out'),
      e('c2', 'c3', 'out'),

      // 签到链
      e('si0', 'si1', 'out'),
      e('si1', 'si2', 'out'),
      e('si2', 'si3a', 'out'),
      e('si3a', 'si3b', 'out'),
      e('si3b', 'si4', 'out'),
      e('si4', 'si5', 'out'),

      // 子面板返回按钮 → 主菜单
      e('i0', 'b0', BACK_PORT),
      e('s0', 'b1', BACK_PORT),
      e('sh0', 'b2', BACK_PORT),
    ],
  },
]
