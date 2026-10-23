// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { BaseAdapter } from "./adapter";

var SandboxAdapter = class extends BaseAdapter {
	/** 机器人"发出"的消息记录（沙箱不真的发） */
	sent = [];
	/** 已产出的事件数（便于测试断言"stop 之后不再增加"） */
	produced = 0;
	options;
	constructor(ctx, options = {}) {
		super(ctx);
		const cfg = ctx.config;
		this.options = {
			fakeUsers: options.fakeUsers ?? cfg.fakeUsers ?? ["10001"],
			fakeGroupId: options.fakeGroupId ?? cfg.fakeGroupId ?? "20001",
			echoPrefix: options.echoPrefix ?? cfg.echoPrefix ?? "[sandbox] ",
			now: options.now ?? (() => Date.now())
		};
	}
	async start() {
		this.ctx.status = "connected";
	}
	async stop() {
		this.cleanup();
		this.ctx.status = "disconnected";
	}
	/**
	* 沙箱的"发送"= 记下来。
	*
	* 这是沙箱最有价值的一点：真实平台这里会走网络，测试只能 mock；
	* 而沙箱把"机器人说了什么"变成**可读的数据**，端到端测试因此能断言回复内容。
	*/
	async sendMessage(message) {
		const m = message ?? {};
		const target = m.target ?? {
			type: "private",
			id: this.options.fakeUsers[0] ?? "0"
		};
		this.sent.push({
			target,
			text: String(m.text ?? "")
		});
	}
	/** 生成一条假"群消息"标准事件（并推给订阅者） */
	emitGroupMessage(text, over = {}) {
		if (this.ctx.status !== "connected") return null;
		const userId = over.userId ?? this.options.fakeUsers[0] ?? "10001";
		const event = {
			platform: "sandbox",
			type: "message",
			subType: "group",
			userId,
			groupId: over.groupId ?? this.options.fakeGroupId,
			rawMessage: text,
			parsed: {
				args: [],
				mentions: [],
				rawSegments: text ? [{
					type: "text",
					data: { text }
				}] : []
			},
			isToMe: true,
			displayName: over.displayName ?? `沙箱用户${userId}`,
			role: over.role ?? "member",
			timestamp: this.options.now(),
			messageId: over.messageId ?? `sandbox-${this.produced + 1}`,
			...over,
			reply: async () => {}
		};
		this.produced++;
		this.dispatch(event);
		return event;
	}
	/** 生成一条假"私聊"标准事件 */
	emitPrivateMessage(text, over = {}) {
		return this.emitGroupMessage(text, {
			...over,
			subType: "private",
			groupId: void 0
		});
	}
	/** 已产出的事件数（测试用） */
	get producedCount() {
		return this.produced;
	}
	/** 这条假消息的"机器人回复"应该是什么（把 echoPrefix 接上） */
	echoed(text) {
		return `${this.options.echoPrefix}${text}`;
	}
	dispatch(event) {
		for (const cb of this.eventHandlers) try {
			cb(event);
		} catch {}
	}
};

export { SandboxAdapter };
