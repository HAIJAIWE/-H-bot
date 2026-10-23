// @ts-nocheck
// 由 10/18 打包产物还原（chunk: ai-DvGDTK0D.js）；见 _recovery/README-recovery.md

var SUBFLOW_TEMPLATE_DEFS = [
	{
		id: "read-player-data",
		category: "数据读写",
		nodes: [{
			kind: "load_variable",
			config: {
				mode: "load",
				key: "player_data",
				scope: "user"
			}
		}],
		edges: []
	},
	{
		id: "save-player-data",
		category: "数据读写",
		nodes: [{
			kind: "save_variable",
			config: {
				mode: "save",
				key: "player_data",
				scope: "user"
			}
		}],
		edges: []
	},
	{
		id: "check-exists",
		category: "数据读写",
		nodes: [{
			kind: "exists_variable",
			config: {
				key: "signed_today",
				scope: "user"
			}
		}, {
			kind: "branch_if",
			config: { expression: "value" }
		}],
		edges: [{
			from: 0,
			fromPort: "out",
			to: 1,
			toPort: "in"
		}, {
			from: 0,
			fromPort: "exists",
			to: 1,
			toPort: "value"
		}]
	},
	{
		id: "increment-counter",
		category: "数据读写",
		nodes: [{
			kind: "incr_variable",
			config: {
				key: "login_count",
				scope: "user",
				amount: 1
			}
		}],
		edges: []
	},
	{
		id: "format-and-reply",
		category: "消息回复",
		nodes: [{
			kind: "format_text",
			config: {
				template: "你好，{name}！",
				variables_json: "{\"name\":\"朋友\"}"
			}
		}, {
			kind: "message_send",
			config: { mode: "text" }
		}],
		edges: [{
			from: 0,
			fromPort: "out",
			to: 1,
			toPort: "in"
		}, {
			from: 0,
			fromPort: "result",
			to: 1,
			toPort: "text"
		}]
	},
	{
		id: "context-reply",
		category: "消息回复",
		nodes: [
			{
				kind: "get_ids",
				config: { mode: "user_id" }
			},
			{
				kind: "format_text",
				config: { template: "你的QQ是{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "var1"
			},
			{
				from: 1,
				fromPort: "result",
				to: 2,
				toPort: "text"
			}
		]
	},
	{
		id: "random-reply",
		category: "消息回复",
		nodes: [{
			kind: "random",
			config: {
				mode: "choice",
				items: "[\"在的\",\"你好呀\",\"怎么啦\"]"
			}
		}, {
			kind: "message_send",
			config: { mode: "text" }
		}],
		edges: [{
			from: 0,
			fromPort: "out",
			to: 1,
			toPort: "in"
		}, {
			from: 0,
			fromPort: "result",
			to: 1,
			toPort: "text"
		}]
	},
	{
		id: "cooldown-check",
		category: "流程控制",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load",
					key: "cooldown",
					scope: "user"
				}
			},
			{
				kind: "branch_if",
				config: { expression: "!value" }
			},
			{
				kind: "message_send",
				config: {
					mode: "text",
					text: "✅ 操作成功！"
				}
			},
			{
				kind: "message_send",
				config: {
					mode: "text",
					text: "⏳ 冷却中，请稍后再试！"
				}
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "value"
			},
			{
				from: 1,
				fromPort: "true",
				to: 2,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "false",
				to: 3,
				toPort: "in"
			}
		]
	},
	{
		id: "try-catch-block",
		category: "流程控制",
		nodes: [{ kind: "try_catch" }],
		edges: []
	},
	{
		id: "delay-execution",
		category: "流程控制",
		nodes: [{
			kind: "delay",
			config: { seconds: 3 }
		}],
		edges: []
	},
	{
		id: "signin-flow",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load",
					key: "signed_today",
					scope: "user"
				}
			},
			{
				kind: "branch_if",
				config: { expression: "!value" }
			},
			{
				kind: "load_variable",
				config: {
					mode: "load_or_default",
					key: "exp",
					scope: "user",
					default: 0
				}
			},
			{
				kind: "expression_eval",
				config: { expression: "v1 + 10" }
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "exp",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "签到成功！当前经验：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "value"
			},
			{
				from: 1,
				fromPort: "true",
				to: 2,
				toPort: "in"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 2,
				fromPort: "result",
				to: 3,
				toPort: "v1"
			},
			{
				from: 3,
				fromPort: "out",
				to: 4,
				toPort: "in"
			},
			{
				from: 3,
				fromPort: "result",
				to: 4,
				toPort: "value"
			},
			{
				from: 4,
				fromPort: "out",
				to: 5,
				toPort: "in"
			},
			{
				from: 3,
				fromPort: "result",
				to: 5,
				toPort: "var1"
			},
			{
				from: 5,
				fromPort: "out",
				to: 6,
				toPort: "in"
			},
			{
				from: 5,
				fromPort: "result",
				to: 6,
				toPort: "text"
			}
		]
	},
	{
		id: "combat-round",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load_or_default",
					key: "player_hp",
					scope: "user",
					default: 100
				}
			},
			{
				kind: "expression_eval",
				config: { expression: "v1 - 8" }
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "player_hp",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "剩余血量：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "v1"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 2,
				toPort: "value"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 3,
				toPort: "var1"
			},
			{
				from: 3,
				fromPort: "out",
				to: 4,
				toPort: "in"
			},
			{
				from: 3,
				fromPort: "result",
				to: 4,
				toPort: "text"
			}
		]
	},
	{
		id: "time-format",
		category: "时间工具",
		nodes: [{
			kind: "time_read",
			config: {
				mode: "now",
				fmt: "%Y-%m-%d %H:%M"
			}
		}],
		edges: []
	},
	{
		id: "inventory-view",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load",
					key: "inventory",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "🎒 你的背包：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "var1"
			},
			{
				from: 1,
				fromPort: "result",
				to: 2,
				toPort: "text"
			}
		]
	},
	{
		id: "inventory-add",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load_or_default",
					key: "inventory",
					scope: "user",
					default: "[]"
				}
			},
			{
				kind: "list_edit",
				config: {
					mode: "append",
					item: "新手剑"
				}
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "inventory",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "✅ 已获得新物品！当前背包：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "source_list"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 2,
				toPort: "value"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 3,
				toPort: "var1"
			},
			{
				from: 3,
				fromPort: "out",
				to: 4,
				toPort: "in"
			},
			{
				from: 3,
				fromPort: "result",
				to: 4,
				toPort: "text"
			}
		]
	},
	{
		id: "shop-buy",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load",
					key: "gold",
					scope: "user"
				}
			},
			{
				kind: "branch_if",
				config: { expression: "value >= 100" }
			},
			{
				kind: "expression_eval",
				config: { expression: "v1 - 100" }
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "gold",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "✅ 购买成功！剩余金币：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			},
			{
				kind: "message_send",
				config: {
					mode: "text",
					text: "❌ 金币不足，需要 100 金币！"
				}
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "value"
			},
			{
				from: 1,
				fromPort: "true",
				to: 2,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 2,
				toPort: "v1"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 2,
				fromPort: "result",
				to: 3,
				toPort: "value"
			},
			{
				from: 3,
				fromPort: "out",
				to: 4,
				toPort: "in"
			},
			{
				from: 2,
				fromPort: "result",
				to: 4,
				toPort: "var1"
			},
			{
				from: 4,
				fromPort: "out",
				to: 5,
				toPort: "in"
			},
			{
				from: 4,
				fromPort: "result",
				to: 5,
				toPort: "text"
			},
			{
				from: 1,
				fromPort: "false",
				to: 6,
				toPort: "in"
			}
		]
	},
	{
		id: "quest-accept",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load",
					key: "player_level",
					scope: "user"
				}
			},
			{
				kind: "branch_if",
				config: { expression: "value >= 5" }
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "active_quest",
					scope: "user"
				}
			},
			{
				kind: "message_send",
				config: {
					mode: "text",
					text: "✅ 任务已接取！"
				}
			},
			{
				kind: "message_send",
				config: {
					mode: "text",
					text: "❌ 等级不足，需达到 5 级！"
				}
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "value"
			},
			{
				from: 1,
				fromPort: "true",
				to: 2,
				toPort: "in"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "false",
				to: 4,
				toPort: "in"
			}
		]
	},
	{
		id: "pk-attack",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load_or_default",
					key: "player_atk",
					scope: "user",
					default: 50
				}
			},
			{
				kind: "expression_eval",
				config: { expression: "v1 * 1.5" }
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "last_damage",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "⚔️ 造成伤害：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "v1"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 2,
				toPort: "value"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 3,
				toPort: "var1"
			},
			{
				from: 3,
				fromPort: "out",
				to: 4,
				toPort: "in"
			},
			{
				from: 3,
				fromPort: "result",
				to: 4,
				toPort: "text"
			}
		]
	},
	{
		id: "cultivate",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load_or_default",
					key: "exp",
					scope: "user",
					default: 0
				}
			},
			{
				kind: "expression_eval",
				config: { expression: "v1 + 10" }
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "exp",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "🌟 修炼成功！当前经验：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "v1"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 2,
				toPort: "value"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "result",
				to: 3,
				toPort: "var1"
			},
			{
				from: 3,
				fromPort: "out",
				to: 4,
				toPort: "in"
			},
			{
				from: 3,
				fromPort: "result",
				to: 4,
				toPort: "text"
			}
		]
	},
	{
		id: "gacha-pull",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "random",
				config: {
					mode: "weighted",
					items: "[{\"value\":\"ssr\",\"weight\":1},{\"value\":\"sr\",\"weight\":9},{\"value\":\"r\",\"weight\":90}]"
				}
			},
			{
				kind: "save_variable",
				config: {
					mode: "save",
					key: "last_pull",
					scope: "user"
				}
			},
			{
				kind: "format_text",
				config: { template: "🎉 抽到：{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "value"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 2,
				toPort: "var1"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 2,
				fromPort: "result",
				to: 3,
				toPort: "text"
			}
		]
	},
	{
		id: "leaderboard",
		category: "游戏逻辑",
		nodes: [
			{
				kind: "load_variable",
				config: {
					mode: "load",
					key: "scores",
					scope: "global"
				}
			},
			{
				kind: "list_transform",
				config: { mode: "sort" }
			},
			{
				kind: "format_text",
				config: { template: "🏆 排行榜：\n{var1}" }
			},
			{
				kind: "message_send",
				config: { mode: "text" }
			}
		],
		edges: [
			{
				from: 0,
				fromPort: "out",
				to: 1,
				toPort: "in"
			},
			{
				from: 1,
				fromPort: "out",
				to: 2,
				toPort: "in"
			},
			{
				from: 2,
				fromPort: "out",
				to: 3,
				toPort: "in"
			},
			{
				from: 0,
				fromPort: "result",
				to: 1,
				toPort: "source_list"
			},
			{
				from: 1,
				fromPort: "result",
				to: 2,
				toPort: "var1"
			},
			{
				from: 2,
				fromPort: "result",
				to: 3,
				toPort: "text"
			}
		]
	}
];

export { SUBFLOW_TEMPLATE_DEFS };
