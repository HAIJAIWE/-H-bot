// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

var MetricsServiceImpl = class {
	rawMsgCount = 0;
	rawLatencies = [];
	rawErrorCount = 0;
	rawErrorTypes = {};
	rawNodeExecCount = 0;
	samples = [];
	timer = null;
	callbacks = /* @__PURE__ */ new Set();
	intervalMs = 5e3;
	maxSamples = 60;
	/** 记录一条消息的处理耗时 */
	recordMessage(durationMs) {
		this.rawMsgCount++;
		this.rawLatencies.push(durationMs);
	}
	/** 记录一次错误（带错误类型） */
	recordError(errorType = "unknown") {
		this.rawErrorCount++;
		this.rawErrorTypes[errorType] = (this.rawErrorTypes[errorType] || 0) + 1;
	}
	/** 解析一行 stdout，提取 METRIC 数据 */
	recordMetricLine(line) {
		const msgDurMatch = line.match(/\[METRIC:msg:dur:(\d+)ms?\]/);
		if (msgDurMatch) {
			this.recordMessage(parseInt(msgDurMatch[1], 10));
			return;
		}
		const match = line.match(/\[METRIC:([^\]]+)\]/);
		if (!match) return;
		const parts = match[1].split(",");
		for (const part of parts) {
			const [key, val] = part.split("=");
			if (key === "msg_count") this.rawMsgCount += parseInt(val, 10) || 0;
			else if (key === "latency") this.rawLatencies.push(parseInt(val, 10) || 0);
		}
	}
	/** 记录一次节点执行（NODE:enter） */
	recordNodeExecution() {
		this.rawNodeExecCount++;
	}
	/** 立即获取当前聚合快照（不重置计数器） */
	getSnapshot() {
		const latencyCount = this.rawLatencies.length;
		const totalLatency = this.rawLatencies.reduce((a, b) => a + b, 0);
		const totalMsg = this.rawMsgCount || 1;
		const msgPerSec = Math.round(totalMsg / (this.intervalMs / 1e3) * 10) / 10;
		return {
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			msgCount: msgPerSec,
			avgLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
			p95Latency: this.calcP95(this.rawLatencies),
			errorRate: totalMsg > 0 ? Math.round(this.rawErrorCount / totalMsg * 100) : 0,
			nodeExecutions: this.rawNodeExecCount,
			errorTypes: { ...this.rawErrorTypes }
		};
	}
	start() {
		if (this.timer) return;
		this.resetCounters();
		this.timer = setInterval(() => this.aggregate(), this.intervalMs);
	}
	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.resetCounters();
	}
	getHistory() {
		return [...this.samples];
	}
	onData(cb) {
		this.callbacks.add(cb);
		return () => this.callbacks.delete(cb);
	}
	aggregate() {
		const sample = this.getSnapshot();
		this.samples.push(sample);
		if (this.samples.length > this.maxSamples) this.samples = this.samples.slice(-this.maxSamples);
		this.resetCounters();
		for (const cb of this.callbacks) cb(sample);
	}
	calcP95(sortedValues) {
		if (sortedValues.length === 0) return 0;
		const sorted = [...sortedValues].sort((a, b) => a - b);
		const idx = Math.ceil(sorted.length * .95) - 1;
		return sorted[Math.max(0, idx)];
	}
	resetCounters() {
		this.rawMsgCount = 0;
		this.rawLatencies = [];
		this.rawErrorCount = 0;
		this.rawErrorTypes = {};
		this.rawNodeExecCount = 0;
	}
};
var metricsService = new MetricsServiceImpl();

export { MetricsServiceImpl, metricsService };
