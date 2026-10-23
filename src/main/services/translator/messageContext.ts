// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md

/**
* 被动回复上下文的有效期。
*
* 为什么要回收：`ctx` 是按 openid 记账的（用户 + 群各一条），而**除 stop 时的
* `clear()` 之外没有任何淘汰**。一个长期运行的群机器人会为每个见过的用户/群
* 永久留一条记录 —— 只涨不落。
*
* 为什么可以安全丢：`ctx` 里存的是 `eventId`/`msgId`，它是给 **QQ 被动回复**
* 用的，而被动回复本身就有时效（官方限定在收到消息后的一小段窗口内）。
* 过了窗口这些 id 已经不可能再用上，留着只是占内存。
*/
var CTX_TTL_MS = 6e5;
/** 兜底硬顶：即便都在 TTL 内，也不让条目数无限增长 */
var CTX_MAX_ENTRIES = 2e3;
/**
* 回收被动回复上下文：先丢过期（TTL），再压到硬顶以内。
*
* 抽成**纯函数**是为了能确定性地测：要验证淘汰语义得伪造"很旧的时间戳"，
* 而走真机路径只能靠 fake timers + 灌几百条事件，既慢又脆。
*
* ⚠️ 硬顶那一步**不能**直接砍 Map 头部：`Map` 的迭代顺序是**插入顺序**，
* 对已存在的键再次 `set` 不会把它挪到末尾 —— 所以"最旧的键"不等于"最早插入的键"。
* 必须按 `at` 排序。
*
* @param ctx 上下文表（原地修改）
* @param now 当前时间（毫秒）
*/
function pruneMessageContexts(ctx, now) {
	for (const [key, entry] of ctx) if (now - entry.at > CTX_TTL_MS) ctx.delete(key);
	if (ctx.size <= CTX_MAX_ENTRIES) return;
	const byAge = [...ctx.entries()].sort((a, b) => a[1].at - b[1].at);
	const overflow = ctx.size - CTX_MAX_ENTRIES;
	for (let i = 0; i < overflow; i++) ctx.delete(byAge[i][0]);
}

export { CTX_TTL_MS, CTX_MAX_ENTRIES, pruneMessageContexts };
