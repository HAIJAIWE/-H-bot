// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import { isMessageEvent } from "./standardEvent";

/** 内置中间件 */
var builtinMiddleware = {
	/** 冷却中间件 */
	cooldown: (ms, keyFn) => {
		const cache = /* @__PURE__ */ new Map();
		return async (ctx) => {
			const key = keyFn ? keyFn(ctx.event) : `${ctx.event.platform}:${ctx.event.userId}:${ctx.matched}`;
			const now = Date.now();
			if (now - (cache.get(key) || 0) < ms) {
				ctx.stop();
				return;
			}
			cache.set(key, now);
			await ctx.next();
		};
	},
	/** 频率限制中间件 */
	rateLimit: (max, windowMs, keyFn) => {
		const cache = /* @__PURE__ */ new Map();
		return async (ctx) => {
			const key = keyFn ? keyFn(ctx.event) : `${ctx.event.platform}:${ctx.event.userId}`;
			const now = Date.now();
			const requests = (cache.get(key) || []).filter((t) => now - t < windowMs);
			if (requests.length >= max) {
				ctx.stop();
				return;
			}
			requests.push(now);
			cache.set(key, requests);
			await ctx.next();
		};
	},
	/** 权限中间件 */
	permission: (check) => {
		return async (ctx) => {
			if (!await check(ctx.event)) {
				ctx.stop();
				return;
			}
			await ctx.next();
		};
	},
	/** 日志中间件 */
	logger: (logger) => {
		return async (ctx) => {
			const start = Date.now();
			logger.debug(`[Router] 开始处理: ${ctx.matched ? "匹配" : "无匹配"} ${ctx.event.type}`);
			await ctx.next();
			logger.info(`[Router] 处理完成: ${ctx.matched ? ctx.matched : "skip"} (${Date.now() - start}ms)`);
		};
	},
	/** 仅私聊 */
	privateOnly: () => async (ctx) => {
		if (isMessageEvent(ctx.event) && ctx.event.subType !== "private") {
			ctx.stop();
			return;
		}
		await ctx.next();
	},
	/** 仅群聊 */
	groupOnly: () => async (ctx) => {
		if (isMessageEvent(ctx.event) && ctx.event.subType !== "group") {
			ctx.stop();
			return;
		}
		await ctx.next();
	},
	/** 仅 @我 */
	toMeOnly: () => async (ctx) => {
		if (isMessageEvent(ctx.event) && !ctx.event.isToMe) {
			ctx.stop();
			return;
		}
		await ctx.next();
	}
};
/** 路由器类 */
var Router = class {
	routes = [];
	globalMiddlewares = [];
	config;
	constructor(config) {
		this.config = {
			prefixes: config.prefixes || [],
			stripPrefix: config.stripPrefix ?? true,
			keyPolicy: config.keyPolicy || { maxWords: 2 },
			exact: config.exact || []
		};
	}
	/** 添加全局中间件 */
	use(...middlewares) {
		this.globalMiddlewares.push(...middlewares);
		return this;
	}
	/** 注册路由 */
	on(matcher, ...middlewares) {
		const matchFn = typeof matcher === "function" ? matcher : typeof matcher === "string" ? this.createPrefixMatcher(matcher) : this.createRegexMatcher(matcher);
		return (handler) => {
			this.routes.push({
				match: matchFn,
				middlewares,
				handler
			});
			return this;
		};
	}
	/** 注册命令路由 */
	command(cmd, ...middlewares) {
		return this.on(cmd, ...middlewares);
	}
	/** 注册正则路由 */
	regex(pattern, ...middlewares) {
		return this.on(pattern, ...middlewares);
	}
	/** 精确匹配 */
	exact(text, ...middlewares) {
		return this.on(text, ...middlewares);
	}
	/** 创建前缀匹配器 */
	createPrefixMatcher(prefix) {
		return (event) => {
			if (!isMessageEvent(event)) return {
				matched: false,
				routeText: "",
				params: {},
				remaining: ""
			};
			const text = event.parsed.command || event.rawMessage.trim();
			if (!text.startsWith(prefix)) return {
				matched: false,
				routeText: "",
				params: {},
				remaining: text
			};
			const words = text.slice(prefix.length).trim().split(/\s+/);
			const maxWords = this.config.keyPolicy?.maxWords || 2;
			const args = words.slice(1, maxWords);
			return {
				matched: true,
				routeText: prefix,
				params: {
					arg0: words[0] || "",
					...Object.fromEntries(args.map((v, i) => [`arg${i + 1}`, v]))
				},
				remaining: words.slice(maxWords).join(" ")
			};
		};
	}
	/** 创建正则匹配器 */
	createRegexMatcher(pattern) {
		return (event) => {
			if (!isMessageEvent(event)) return {
				matched: false,
				routeText: "",
				params: {},
				remaining: ""
			};
			const text = event.rawMessage.trim();
			const match = text.match(pattern);
			if (!match) return {
				matched: false,
				routeText: "",
				params: {},
				remaining: text
			};
			return {
				matched: true,
				routeText: match[0],
				params: Object.fromEntries(match.slice(1).map((v, i) => [`group${i + 1}`, v])),
				remaining: text.slice(match[0].length).trim()
			};
		};
	}
	/** 执行路由分发 */
	async dispatch(event) {
		for (const route of this.routes) {
			const match = route.match(event);
			if (!match.matched) continue;
			const ctx = {
				event,
				matched: true,
				params: match.params,
				state: {},
				next: async () => {},
				stop: () => {
					ctx.stopped = true;
				},
				stopped: false
			};
			const allMiddlewares = [...this.globalMiddlewares, ...route.middlewares];
			const executeChain = async (index) => {
				if (ctx.stopped || index >= allMiddlewares.length) {
					await route.handler(ctx);
					return;
				}
				ctx.next = async () => executeChain(index + 1);
				await allMiddlewares[index](ctx);
			};
			await executeChain(0);
			return;
		}
	}
	/** 获取路由信息 */
	getRoutes() {
		return this.routes.map((r) => ({
			match: r.match.toString(),
			middlewares: r.middlewares.length
		}));
	}
};
/** 创建路由器工厂 */
function createRouter(config) {
	return new Router(config);
}

export { builtinMiddleware, Router, createRouter };
