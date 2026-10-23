// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

var BatchAccumulator = class {
	buffer = [];
	timer = null;
	windowMs;
	flushFn;
	constructor(windowMs, flushFn) {
		this.windowMs = windowMs;
		this.flushFn = flushFn;
	}
	add(item) {
		this.buffer.push(item);
		if (!this.timer) this.timer = setTimeout(() => this.flush(), this.windowMs);
	}
	flush() {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.buffer.length > 0) {
			const items = this.buffer;
			this.buffer = [];
			this.flushFn(items);
		}
	}
	destroy() {
		this.flush();
	}
};

export { BatchAccumulator };
