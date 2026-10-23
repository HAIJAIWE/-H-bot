// @ts-nocheck
// 由 10/18 打包产物还原（chunk: nodeExamples-TJgHkwkO.js）；见 _recovery/README-recovery.md

var CTRL_IN = {
	id: "in",
	name: "入",
	kind: "control"
};
var CTRL_OUT = {
	id: "out",
	name: "出",
	kind: "control"
};
var str = (id, name) => ({
	id,
	name,
	kind: "data",
	dataType: "string"
});
var listPort = (id, name) => ({
	id,
	name,
	kind: "data",
	dataType: "list"
});
var NODE_EXAMPLES = [
	{
		id: "echo-text",
		title: "最小节点：读输入，原样返回",
		when: "只是把上游文本加工一下再传下去（不调 API、不存数据）",
		keywords: [
			"文本",
			"加工",
			"返回",
			"字符串",
			"格式化"
		],
		funcName: "echo_text",
		label: "原样返回",
		summary: "把输入文本（或配置里的文本）原样返回，用来验证连线是否通了",
		inputs: [CTRL_IN, str("text", "输入文本")],
		outputs: [CTRL_OUT, str("result", "结果")],
		notes: ["**配置与上游端口在沙箱里是同一个对象**：ctx.config.x 与 ctx.inputs.x 等价，逐级兜底最稳。", "返回对象的 key 必须与 outputs 里的端口 id 一致（这里就是 result）。"],
		handler: [
			"async (ctx) => {",
			"  const text = String(ctx.inputs.text ?? ctx.config.text ?? '');",
			"  ctx.log('原样返回', text);",
			"  return { result: text };",
			"}"
		].join("\n")
	},
	{
		id: "send-group-text",
		title: "调协议端 API 发群消息",
		when: "节点自己要往群里发一条消息（而不是靠下游的「发消息」节点）",
		keywords: [
			"发消息",
			"群消息",
			"通知",
			"发送",
			"公告"
		],
		funcName: "send_group_text",
		label: "发群消息",
		summary: "把传入的文本直接发到当前群，并把发送结果往下传",
		inputs: [
			CTRL_IN,
			str("text", "要发的文本"),
			str("group_id", "群号（可空）")
		],
		outputs: [CTRL_OUT, str("result", "发送结果")],
		notes: [
			"**API 名必须是「可用协议端 API」清单里的**，猜错的名字在干跑自检里就会被拦下。",
			"一律 await；不 await 的话消息可能没发出去节点就结束了。",
			"群号优先取上游端口，其次取事件里的 group_id —— 私聊场景没有 group_id。"
		],
		handler: [
			"async (ctx) => {",
			"  const text = String(ctx.inputs.text ?? '');",
			"  const groupId = String(ctx.inputs.group_id ?? ctx.event?.group_id ?? '');",
			"  if (!text) { ctx.log('没有要发的内容，跳过'); return { result: 'skipped' }; }",
			"  const res = await ctx.bot.callApi('send_group_msg', { group_id: Number(groupId), message: text });",
			"  ctx.log('已发送', groupId);",
			"  return { result: JSON.stringify(res ?? {}) };",
			"}"
		].join("\n")
	},
	{
		id: "random-pick",
		title: "随机抽一个（抽卡/抽奖的核）",
		when: "要从一组候选里随机取一个，或者按权重抽",
		keywords: [
			"随机",
			"抽卡",
			"抽奖",
			"概率",
			"权重",
			"扭蛋",
			"gacha"
		],
		funcName: "random_pick",
		label: "随机抽取",
		summary: "从候选列表里随机抽一个（支持 名字:权重 形式），返回抽中的项",
		inputs: [CTRL_IN, listPort("items", "候选列表")],
		outputs: [
			CTRL_OUT,
			str("result", "抽中项"),
			str("index", "下标")
		],
		notes: [
			"**权重解析要兜住脏数据**：用户填的是逗号分隔字符串，可能带空格或非数字。",
			"随机数用 Math.random() —— 沙箱里可用；不要用 crypto（不在沙箱白名单里）。",
			"抽奖类节点**只负责抽**：扣积分/发奖交给上游或下游（先检查、后扣除）。"
		],
		handler: [
			"async (ctx) => {",
			"  const raw = ctx.inputs.items ?? ctx.config.items ?? [];",
			"  const arr = Array.isArray(raw) ? raw : String(raw).split(',');",
			"  const pool = arr.map((s) => String(s).trim()).filter(Boolean);",
			"  if (pool.length === 0) return { result: '', index: '-1' };",
			"  let total = 0;",
			"  const parsed = pool.map((item) => {",
			"    const parts = item.split(':');",
			"    const weight = Number(parts[1]);",
			"    const use = Number.isFinite(weight) && weight > 0 ? weight : 1;",
			"    total += use;",
			"    return { name: String(parts[0]).trim(), use };",
			"  });",
			"  let r = Math.random() * total;",
			"  for (let i = 0; i < parsed.length; i++) {",
			"    r -= parsed[i].use;",
			"    if (r <= 0) { ctx.log('抽中', parsed[i].name); return { result: parsed[i].name, index: String(i) }; }",
			"  }",
			"  const last = parsed[parsed.length - 1];",
			"  return { result: last.name, index: String(parsed.length - 1) };",
			"}"
		].join("\n")
	},
	{
		id: "call-builtin",
		title: "用 callBuiltin 复用内置节点",
		when: "新能力其实是内置节点串起来，但想在代码里控制细节",
		keywords: [
			"复用",
			"内置节点",
			"存数据",
			"组合"
		],
		funcName: "bump_and_reply",
		label: "计数并回复",
		summary: "用内置节点存一次变量，再把结果发出去（示范 callBuiltin 的用法）",
		inputs: [CTRL_IN, str("text", "回复文本")],
		outputs: [CTRL_OUT, str("result", "结果")],
		notes: [
			"callBuiltin(内置节点 kind, 配置) —— kind 必须是**节点目录里真实存在**的（写错干跑自检会拦）。",
			"与协议端 API 的区别：callBuiltin 走**这台应用自己的能力**（发消息、存变量、读写配置表…）。",
			"能拼就用拼的：整条逻辑都能用画布节点表达时，别写代码节点。"
		],
		handler: [
			"async (ctx) => {",
			"  const text = String(ctx.inputs.text ?? ctx.config.text ?? '');",
			"  await ctx.callBuiltin('save_variable', { mode: 'save', key: 'last_reply', scope: 'user', value: text });",
			"  await ctx.callBuiltin('message_send', { message: text });",
			"  return { result: text };",
			"}"
		].join("\n")
	},
	{
		id: "guard-early-return",
		title: "校验失败就早返回（防炸写法）",
		when: "节点依赖前置条件（参数、上游数据），不满足时应该安静跳过而不是报错",
		keywords: [
			"校验",
			"参数",
			"防错",
			"早返回",
			"容错",
			"判断"
		],
		funcName: "guarded_action",
		label: "带校验的动作",
		summary: "先校验必需参数，缺了就返回原因，不去调外部 API",
		inputs: [
			CTRL_IN,
			str("user_id", "用户ID"),
			str("amount", "数量")
		],
		outputs: [
			CTRL_OUT,
			str("result", "结果"),
			str("ok", "是否成功")
		],
		notes: [
			"**早返回是自定义节点最重要的纪律**：参数缺失时什么都不做，比带着 undefined 去调 API 好得多。",
			"上下文里没有的东西不要硬读：ctx.event 在定时触发时可能是空的 —— 用可选链。",
			"返回结构要**覆盖所有输出端口**（缺一个下游就拿到 undefined，最常见的坑）。"
		],
		handler: [
			"async (ctx) => {",
			"  const userId = String(ctx.inputs.user_id ?? '').trim();",
			"  const amount = Number(ctx.inputs.amount ?? ctx.config.amount ?? 0);",
			"  if (!userId) { ctx.log('缺少 user_id，跳过'); return { result: '缺少用户ID', ok: 'false' }; }",
			"  if (!Number.isFinite(amount) || amount <= 0) {",
			"    return { result: '数量不合法', ok: 'false' };",
			"  }",
			"  const at = String(ctx.event?.user_id ?? '');",
			"  ctx.log('处理', userId, amount, at);",
			"  return { result: userId + ' x ' + String(amount), ok: 'true' };",
			"}"
		].join("\n")
	}
];
/** 紧凑列表（不传 id 时给模型：省上下文，够它判断该查哪条） */
function renderExampleList() {
	return NODE_EXAMPLES.map((e) => "- " + e.id + "｜" + e.title + "：" + e.when).join("\n");
}
/** 单个示例的完整内容（含可直接改的 handler 源码与端口声明） */
function renderExample(id) {
	const e = NODE_EXAMPLES.find((x) => x.id === id);
	if (!e) return null;
	const fence = String.fromCharCode(96, 96, 96);
	return [
		"# " + e.title + "（" + e.id + "）",
		"什么时候用：" + e.when,
		"",
		"建议 funcName：" + e.funcName + "　label：" + e.label,
		"摘要：" + e.summary,
		"",
		"端口（inputs / outputs 参数直接传这个 JSON 字符串）",
		"inputs: " + JSON.stringify(e.inputs),
		"outputs: " + JSON.stringify(e.outputs),
		"",
		"关键点：",
		...e.notes.map((n) => "· " + n),
		"",
		"handler（照它改即可）：",
		"```javascript",
		e.handler,
		fence
	].join("\n");
}
/** 按需求关键词给最相关的示例（命中越多越靠前；都不命中返回空） */
function matchExamples(need, limit = 3) {
	const text = String(need ?? "");
	if (!text.trim()) return [];
	return NODE_EXAMPLES.map((e) => ({
		e,
		score: e.keywords.reduce((s, k) => text.includes(k) ? s + 1 : s, 0) + (text.includes(e.title) ? 1 : 0)
	})).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.e);
}

export { CTRL_IN, CTRL_OUT, str, listPort, NODE_EXAMPLES, renderExampleList, renderExample, matchExamples };
