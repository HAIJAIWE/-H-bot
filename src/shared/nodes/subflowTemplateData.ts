// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md
import { SUBFLOW_TEMPLATE_DEFS } from "./subflowTemplateDefs";

/** id → i18n 键前缀（闸门据此比对文案） */
var I18N_KEY = {
	"read-player-data": "readPlayerData",
	"save-player-data": "savePlayerData",
	"check-exists": "checkExists",
	"increment-counter": "incrementCounter",
	"format-and-reply": "formatAndReply",
	"context-reply": "contextReply",
	"random-reply": "randomReply",
	"cooldown-check": "cooldownCheck",
	"try-catch-block": "tryCatchBlock",
	"delay-execution": "delayExecution",
	"signin-flow": "signinFlow",
	"combat-round": "combatRound",
	"time-format": "timeFormat",
	"inventory-view": "inventoryView",
	"inventory-add": "inventoryAdd",
	"shop-buy": "shopBuy",
	"quest-accept": "questAccept",
	"pk-attack": "pkAttack",
	cultivate: "cultivate",
	"gacha-pull": "gachaPull",
	leaderboard: "leaderboard"
};
/** id → 中英文案（见文件头：主进程读不到渲染层的 i18n 包，所以文案在这里存一份） */
var TEMPLATE_TEXT = {
	"read-player-data": {
		zh: {
			name: "读取玩家数据",
			description: "从持久化存储读取玩家数据（user 作用域）",
			usageHint: "单节点片段。接入触发器后，通过 result 端口输出玩家数据"
		},
		en: {
			name: "Read player data",
			description: "Read player data from persistent storage (user scope)",
			usageHint: "Single-node snippet. Once wired after a trigger, it outputs the player data on the result port"
		}
	},
	"save-player-data": {
		zh: {
			name: "保存玩家数据",
			description: "将数据保存到持久化存储（user 作用域）",
			usageHint: "单节点片段。通过 value 端口传入要保存的数据"
		},
		en: {
			name: "Save player data",
			description: "Save data to persistent storage (user scope)",
			usageHint: "Single-node snippet. Pass the data to save through the value port"
		}
	},
	"check-exists": {
		zh: {
			name: "检查数据是否存在",
			description: "检查某键是否存在，走 branch_if 分支判断",
			usageHint: "exists 结果连到 branch_if 的 value，true 分支=已存在，false 分支=不存在"
		},
		en: {
			name: "Check whether data exists",
			description: "Check whether a key exists and branch on it with branch_if",
			usageHint: "Wire the exists result to branch_if.value: the true branch means it exists, the false branch means it does not"
		}
	},
	"increment-counter": {
		zh: {
			name: "自增计数器",
			description: "原子自增一个数值型持久化变量（如登录次数）",
			usageHint: "单节点片段。自增 login_count，通过 result 端口输出自增后的新值"
		},
		en: {
			name: "Increment counter",
			description: "Atomically increment a numeric persistent variable (e.g. login count)",
			usageHint: "Single-node snippet. Increments login_count and outputs the new value on the result port"
		}
	},
	"format-and-reply": {
		zh: {
			name: "格式化并回复",
			description: "用模板拼接文本后自动回复消息",
			usageHint: "format_text 格式化后连到 message_send.text 自动回复。已内置 {name}=朋友（可在属性面板的 variables_json 里改），也可以从上游客串节点连一个值进来"
		},
		en: {
			name: "Format and reply",
			description: "Build text from a template and reply automatically",
			usageHint: "format_text formats the text and feeds message_send.text to reply automatically. A built-in {name} value is provided (editable in the variables_json field of the property panel); you can also wire a value in from an upstream node"
		}
	},
	"context-reply": {
		zh: {
			name: "获取上下文并回复",
			description: "获取用户 QQ 号，格式化后回复",
			usageHint: "get_ids 提取 QQ 号 → format_text 格式化 → message_send 回复。var1 绑定 QQ 号"
		},
		en: {
			name: "Get context and reply",
			description: "Get the user's QQ number, format it and reply",
			usageHint: "get_ids extracts the QQ number → format_text formats it → message_send replies. var1 is bound to the QQ number"
		}
	},
	"random-reply": {
		zh: {
			name: "随机回复",
			description: "从列表中随机选择一条消息回复",
			usageHint: "random(choice) 从列表随机选一条回复（已内置三条候选，可在属性面板的 items 里改）。列表是 JSON 数组"
		},
		en: {
			name: "Random reply",
			description: "Pick one message at random from a list and reply with it",
			usageHint: "random(choice) picks one reply at random from the list (three candidates are built in; edit them in the items field of the property panel). The list is a JSON array"
		}
	},
	"cooldown-check": {
		zh: {
			name: "冷却检查",
			description: "读取冷却标记 → 无冷却走 true / 冷却中走 false 提示",
			usageHint: "读取冷却值并判断：!value=true（无冷却）走 true 分支回复\"操作成功\"；false 分支回复\"冷却中\"。true 分支的 message_send 可替换为实际业务逻辑"
		},
		en: {
			name: "Cooldown check",
			description: "Read the cooldown flag → true when free, false while cooling down",
			usageHint: "Read the cooldown value and branch: !value = true (not cooling down) takes the true branch and replies “success”; the false branch replies “cooling down”. Replace the true-branch message_send with your real logic"
		}
	},
	"try-catch-block": {
		zh: {
			name: "异常捕获",
			description: "try_catch 包裹异常处理，try 正常 / catch 异常 / finally 最终",
			usageHint: "单节点片段。try 端口接正常逻辑，catch 端口接异常处理，finally 端口接收尾逻辑"
		},
		en: {
			name: "Exception handling",
			description: "Wrap error handling with try_catch: try for the happy path, catch for errors, finally for cleanup",
			usageHint: "Single-node snippet. Wire normal logic to the try port, error handling to catch, and cleanup to finally"
		}
	},
	"delay-execution": {
		zh: {
			name: "延迟执行",
			description: "等待 3 秒后继续执行后续节点",
			usageHint: "单节点片段。延迟 3 秒后继续，可用于节流、模拟打字、延时回复"
		},
		en: {
			name: "Delayed execution",
			description: "Wait 3 seconds before continuing to the next node",
			usageHint: "Single-node snippet. Continues after a 3-second delay — useful for throttling, typing simulation or delayed replies"
		}
	},
	"signin-flow": {
		zh: {
			name: "签到流程",
			description: "检查签到状态 → 未签到则读取经验并+10 → 保存 → 回复",
			usageHint: "未签到时走 true 分支：读取经验→+10→保存新经验→回复。false 分支可自行添加\"已签到\"提示"
		},
		en: {
			name: "Daily check-in flow",
			description: "Check check-in status → if not yet checked in, read exp and add 10 → save → reply",
			usageHint: "When not yet checked in, the true branch runs: read exp → +10 → save the new exp → reply. Add your own “already checked in” message to the false branch"
		}
	},
	"combat-round": {
		zh: {
			name: "战斗回合",
			description: "读取血量 → 扣除伤害 → 保存新血量 → 回复",
			usageHint: "读取血量(v1，键不存在时按 100 起算)→减去固定伤害 8→保存新血量→格式化→回复。想用真实伤害，把表达式里的 8 换成一个上游节点连入 expression_eval.v2"
		},
		en: {
			name: "Combat round",
			description: "Read HP → subtract damage → save the new HP → reply",
			usageHint: "Read HP (v1, defaults to 100 when the key is missing) → subtract a fixed 8 damage → save the new HP → format → reply. For real damage, replace the 8 in the expression with a value wired from an upstream node into expression_eval.v2"
		}
	},
	"time-format": {
		zh: {
			name: "时间格式化",
			description: "获取当前时间并按 %Y-%m-%d %H:%M 格式输出",
			usageHint: "单节点片段。time_op(now) 已内置 fmt 格式化，通过 datetime 端口输出\"2026-07-10 14:30\"格式的字符串。修改 fmt 可调整格式"
		},
		en: {
			name: "Format time",
			description: "Get the current time and output it as %Y-%m-%d %H:%M",
			usageHint: "Single-node snippet. time_op(now) already formats via fmt and outputs a \"2026-07-10 14:30\" style string on the datetime port. Change fmt to adjust the format"
		}
	},
	"inventory-view": {
		zh: {
			name: "查看背包",
			description: "读取玩家背包数据并格式化展示",
			usageHint: "读取 inventory 持久化变量 → 格式化为背包列表 → 回复。背包数据建议存为列表或字典"
		},
		en: {
			name: "View inventory",
			description: "Read the player's inventory and format it for display",
			usageHint: "Read the inventory persistent variable → format it as an inventory list → reply. Store inventory data as a list or dict"
		}
	},
	"inventory-add": {
		zh: {
			name: "添加物品",
			description: "读取背包 → 追加新物品 → 保存 → 提示获得",
			usageHint: "读取背包列表 → list_op(append) 追加元素 → 保存新列表 → 格式化提示 → 回复。需通过 list_op.item 端口绑定要添加的物品；{var1} 为新列表（会显示为 JSON，可改 expression_eval 计算长度）"
		},
		en: {
			name: "Add item",
			description: "Read inventory → append the new item → save → notify",
			usageHint: "Read the inventory list → list_op(append) appends the element → save the new list → format the notice → reply. Bind the item to add through the list_op.item port; {var1} is the new list (shown as JSON — use expression_eval to compute its length instead)"
		}
	},
	"shop-buy": {
		zh: {
			name: "购买商品",
			description: "读取金币 → 判断是否足够 → 扣费保存/提示不足",
			usageHint: "金币≥100 走 true 分支：扣 100 金币 → 保存 → 回复剩余金币；false 分支回复\"金币不足\"。修改 expression 与 branch_if 表达式可调整价格"
		},
		en: {
			name: "Buy an item",
			description: "Read gold → check whether it is enough → deduct and save, or warn",
			usageHint: "Gold ≥ 100 takes the true branch: deduct 100 → save → reply with the remaining gold; the false branch replies “not enough gold”. Edit the expression and the branch_if condition to change the price"
		}
	},
	"quest-accept": {
		zh: {
			name: "接取任务",
			description: "检查玩家等级 → 满足要求则保存任务 → 回复成功/等级不足",
			usageHint: "等级≥5 走 true 分支：保存 active_quest → 回复成功；false 分支回复\"等级不足\"。需通过第二个 variable_persist.value 端口绑定任务 ID/名称（如从 on_command 的 args 获取）"
		},
		en: {
			name: "Accept a quest",
			description: "Check the player level → save the quest when eligible → reply success or level too low",
			usageHint: "Level ≥ 5 takes the true branch: save active_quest → reply success; the false branch replies “level too low”. Bind the quest ID/name through the second variable_persist.value port (e.g. from the on_command args)"
		}
	},
	"pk-attack": {
		zh: {
			name: "PK 攻击",
			description: "读取攻击力 → 计算伤害 → 保存 → 回复",
			usageHint: "读取 player_atk(v1，键不存在时按 50 起算) → 计算 atk*1.5 → 保存伤害 → 格式化 → 回复。想算真实伤害，把表达式改成 v1*1.5-v2 并从上游连入 v2"
		},
		en: {
			name: "PK attack",
			description: "Read attack power → compute damage → save → reply",
			usageHint: "Read player_atk (v1, defaults to 50 when the key is missing) → compute atk*1.5 → save the damage → format → reply. For real damage, change the expression to v1*1.5-v2 and wire v2 in from upstream"
		}
	},
	cultivate: {
		zh: {
			name: "修炼",
			description: "读取经验 → +10 → 保存新经验 → 回复当前经验",
			usageHint: "读取经验 → +10 → 保存新经验 → 格式化 → 回复。始终保存并回复，如需判断升级可自行添加 branch_if(value >= 100) 分流消息"
		},
		en: {
			name: "Cultivate",
			description: "Read exp → +10 → save the new exp → reply with the current exp",
			usageHint: "Read exp → +10 → save the new exp → format → reply. It always saves and replies; add branch_if(value >= 100) yourself if you want a level-up message"
		}
	},
	"gacha-pull": {
		zh: {
			name: "抽卡",
			description: "加权随机 → 保存抽卡结果 → 格式化 → 回复",
			usageHint: "weighted 随机（SSR/SR/R 按 1:9:90 权重）→ 保存结果 → 格式化 → 回复。始终保存并回复，如需 SSR 特殊提示可自行添加 branch_if(value == \"ssr\") 分流消息"
		},
		en: {
			name: "Gacha pull",
			description: "Weighted random → save the result → format → reply",
			usageHint: "Weighted random (SSR/SR/R at 1:9:90) → save the result → format → reply. It always saves and replies; add branch_if(value == \"ssr\") yourself for a special SSR message"
		}
	},
	leaderboard: {
		zh: {
			name: "排行榜",
			description: "读取积分列表 → 排序 → 格式化 → 回复",
			usageHint: "读取全局 scores 列表 → list_op(sort) 排序 → 格式化为排行榜文本 → 回复。scores 建议存为数值列表，排序后可直接展示"
		},
		en: {
			name: "Leaderboard",
			description: "Read the score list → sort → format → reply",
			usageHint: "Read the global scores list → list_op(sort) sorts it → format it as leaderboard text → reply. Store scores as a numeric list so the sorted output can be shown directly"
		}
	}
};
/** 21 条预置片段：**结构来自 defs**，这里只补 i18n 键与文案 */
var SUBFLOW_TEMPLATE_DATA = SUBFLOW_TEMPLATE_DEFS.map((def) => ({
	...def,
	i18nKey: I18N_KEY[def.id],
	text: TEMPLATE_TEXT[def.id]
}));

export { I18N_KEY, TEMPLATE_TEXT, SUBFLOW_TEMPLATE_DATA };
