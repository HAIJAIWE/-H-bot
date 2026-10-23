// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as util from "util";
import * as child_process from "child_process";
import * as os from "os";
import * as electron from "electron";
import { init_logger, logger } from "../infra/logger";

var execAsync = (0, util.promisify)(child_process.exec);
/**
* 构造读取外部进程用量的 PowerShell 脚本。
*
* ## 为什么不再用 wmic
*
* 原实现调用 `wmic process where ProcessId=… get … /format:csv`。两个问题：
*
* 1. **wmic 已经被移除**：微软自 Windows 10 21H1 起弃用、Windows 11 24H2 起默认不再安装。
*    本机实测 `Get-Command wmic` 为 NOT FOUND ⇒ 这条路在现在的 Windows 上**必然失败**。
* 2. **列序解析是错的**（即使 wmic 还在）：`/format:csv` 的首列是 `Node`（主机名），
*    代码却按 `parts[2]/[3]/[4]` 取 KernelModeTime/UserModeTime/WorkingSetSize ——
*    实际应为 `parts[1]/[2]/[3]`。于是 CPU 时间取错列、`parts[4]` 恒为 undefined，
*    内存被 `|| 0` 兜成 0。
*
* 改用 `Get-Process`：它是 PowerShell 内置 cmdlet，不依赖 WMI/wmic。
* 取 `PrivilegedProcessorTime.Ticks` / `UserProcessorTime.Ticks`（单位同为 100ns tick，
* 因此上层 `delta / 10000 / elapsedMs` 的算法**无需改动**）与 `WorkingSet64`（字节）。
*/
function buildWindowsProcessUsageScript(pid) {
	return `Get-Process -Id ${pid} | Select-Object @{n='k';e={\$_.PrivilegedProcessorTime.Ticks}},@{n='u';e={\$_.UserProcessorTime.Ticks}},@{n='ws';e={\$_.WorkingSet64}} | ConvertTo-Json -Compress`;
}
/**
* 解析 {@link buildWindowsProcessUsageScript} 的输出。
*
* 抽成纯函数是为了能单测：解析逻辑出错（列错位、字段名不匹配）在真机上表现为
* "内存恒为 0"，极难排查，必须由用例钉住。无法解析时返回 null，由调用方决定
* 如何降级 —— 不在这里假装成 0。
*/
function parseWindowsProcessUsage(stdout) {
	const trimmed = stdout.trim();
	if (!trimmed) return null;
	let parsed;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const record = parsed;
	const toNumber = (v) => {
		const n = typeof v === "number" ? v : Number(v);
		return Number.isFinite(n) ? n : 0;
	};
	return {
		kernelTicks: toNumber(record["k"]),
		userTicks: toNumber(record["u"]),
		workingSetBytes: toNumber(record["ws"])
	};
}
var ResourceMonitor = class {
	timer = null;
	samples = [];
	alerts = [];
	intervalMs = 5e3;
	maxSamples = 60;
	lastCpuUsage = null;
	lastCpuTime = 0;
	monitoredPid = null;
	startTime = 0;
	limit = { maxMemoryMB: 1024 };
	warnedMemory = false;
	warnedCPU = false;
	killedDueToLimit = false;
	/** 获取当前配置 */
	getConfig() {
		return {
			maxMemoryMB: this.limit.maxMemoryMB ?? 1024,
			maxCPUPercent: this.limit.maxCPUPercent ?? 100
		};
	}
	/** 设置资源限制阈值 */
	setLimit(limit) {
		this.limit = {
			maxMemoryMB: 1024,
			...limit
		};
		this.warnedMemory = false;
		this.warnedCPU = false;
		this.killedDueToLimit = false;
		this.broadcast("resourceMonitor:config", this.getConfig());
	}
	/** 获取告警列表 */
	getAlerts() {
		return [...this.alerts];
	}
	/** 开始监控指定进程 */
	startMonitoring(pid) {
		if (this.timer) return;
		this.monitoredPid = pid;
		this.startTime = Date.now();
		this.lastCpuUsage = null;
		this.lastCpuTime = 0;
		this.samples = [];
		this.alerts = [];
		this.killedDueToLimit = false;
		this.collect();
		this.timer = setInterval(() => this.collect(), this.intervalMs);
	}
	/** 停止监控 */
	stopMonitoring() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.monitoredPid = null;
	}
	/** 立即获取当前资源占用 */
	getUsage() {
		const pid = this.monitoredPid;
		if (pid === null || pid === process.pid) {
			const mem = process.memoryUsage();
			const total = (0, os.totalmem)();
			const memoryPercent = total > 0 ? Math.round(mem.rss / total * 100 * 10) / 10 : 0;
			return {
				cpuPercent: this.samples.length > 0 ? this.samples[this.samples.length - 1].cpuPercent : 0,
				memoryMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
				memoryPercent,
				uptime: this.startTime > 0 ? Math.round((Date.now() - this.startTime) / 1e3) : 0
			};
		}
		if (this.samples.length > 0) {
			const last = this.samples[this.samples.length - 1];
			return {
				cpuPercent: last.cpuPercent,
				memoryMB: last.memoryMB,
				memoryPercent: last.memoryPercent,
				uptime: this.startTime > 0 ? Math.round((Date.now() - this.startTime) / 1e3) : 0
			};
		}
		return {
			cpuPercent: 0,
			memoryMB: 0,
			memoryPercent: 0,
			uptime: 0
		};
	}
	/** 获取历史采样点（用于图表） */
	getHistory() {
		return [...this.samples];
	}
	async collect() {
		const pid = this.monitoredPid;
		const now = Date.now();
		const total = (0, os.totalmem)();
		let cpuPercent = 0;
		let memoryMB = 0;
		if (pid === null || pid === process.pid) {
			const mem = process.memoryUsage();
			const cpu = process.cpuUsage();
			if (this.lastCpuUsage && this.lastCpuTime > 0) {
				const totalDiff = cpu.user - this.lastCpuUsage.user + (cpu.system - this.lastCpuUsage.system);
				const elapsedMicro = (now - this.lastCpuTime) * 1e3;
				cpuPercent = elapsedMicro > 0 ? Math.min(100, Math.round(totalDiff / elapsedMicro * 100)) : 0;
			}
			this.lastCpuUsage = {
				user: cpu.user,
				system: cpu.system
			};
			this.lastCpuTime = now;
			memoryMB = Math.round(mem.rss / 1024 / 1024 * 10) / 10;
		} else {
			const result = await this.readExternalProcessUsage(pid);
			cpuPercent = result.cpuPercent;
			memoryMB = result.memoryMB;
			this.lastCpuTime = now;
		}
		const memoryPercent = total > 0 ? Math.round(memoryMB / (total / 1024 / 1024) * 100 * 10) / 10 : 0;
		const point = {
			cpuPercent,
			memoryMB,
			memoryPercent,
			timestamp: now
		};
		this.samples.push(point);
		if (this.samples.length > this.maxSamples) this.samples = this.samples.slice(-this.maxSamples);
		this.checkLimits(cpuPercent, memoryMB);
		const usage = {
			cpuPercent,
			memoryMB,
			memoryPercent,
			uptime: this.startTime > 0 ? Math.round((now - this.startTime) / 1e3) : 0
		};
		this.broadcast("resourceMonitor:usage", usage);
		this.broadcast("resourceMonitor:status", {
			usage,
			config: this.getConfig(),
			lastAlert: this.alerts.length > 0 ? this.alerts[this.alerts.length - 1] : null
		});
	}
	/** 使用 PowerShell 读取外部进程资源（Win32 / Unix 分别处理） */
	async readExternalProcessUsage(pid) {
		try {
			if (process.platform === "win32") {
				const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -Command "${buildWindowsProcessUsageScript(pid)}"`, {
					encoding: "utf-8",
					timeout: 3e3
				});
				const usage = parseWindowsProcessUsage(stdout);
				if (usage) {
					const totalTime = usage.kernelTicks + usage.userTicks;
					const elapsed = Date.now() - this.lastCpuTime;
					const cpuPercent = elapsed > 0 ? Math.min(100, Math.round((totalTime - (this.lastCpuUsage?.system ?? 0) - (this.lastCpuUsage?.user ?? 0)) / 1e4 / elapsed * 100)) : 0;
					this.lastCpuUsage = {
						user: usage.userTicks,
						system: usage.kernelTicks
					};
					return {
						cpuPercent,
						memoryMB: Math.round(usage.workingSetBytes / 1024 / 1024 * 10) / 10
					};
				}
				logger.warn(`[ResourceMonitor] 无法解析外部进程用量输出（pid=${pid}），本次采样按失败处理`);
			} else {
				const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o %cpu,rss --no-headers 2>/dev/null`, {
					encoding: "utf-8",
					timeout: 3e3
				});
				const trimmed = psOutput.trim();
				if (trimmed) {
					const [cpuStr, rssStr] = trimmed.split(/\s+/);
					return {
						cpuPercent: Math.round(parseFloat(cpuStr) * 10) / 10 || 0,
						memoryMB: Math.round((parseInt(rssStr, 10) || 0) / 1024 * 10) / 10
					};
				}
			}
		} catch (e) {
			logger.warn(`[ResourceMonitor] 读取外部进程用量失败（pid=${pid}）: ${e instanceof Error ? e.message : String(e)}`);
		}
		return {
			cpuPercent: 0,
			memoryMB: 0
		};
	}
	checkLimits(cpuPercent, memoryMB) {
		const now = Date.now();
		const maxMem = this.limit.maxMemoryMB ?? 1024;
		if (memoryMB > maxMem && !this.warnedMemory && !this.killedDueToLimit) {
			this.warnedMemory = true;
			const alert = {
				type: "memory",
				message: `内存超出限制: ${memoryMB}MB > ${maxMem}MB`,
				timestamp: now,
				value: memoryMB,
				limit: maxMem
			};
			this.alerts.push(alert);
			logger.warn(`[ResourceMonitor] ${alert.message}`);
			this.killProcessDueToLimit("memory");
		}
		const maxCPU = this.limit.maxCPUPercent ?? 100;
		if (maxCPU < 100 && cpuPercent > maxCPU && !this.warnedCPU && !this.killedDueToLimit) {
			this.warnedCPU = true;
			const alert = {
				type: "cpu",
				message: `CPU 超出限制: ${cpuPercent}% > ${maxCPU}%`,
				timestamp: now,
				value: cpuPercent,
				limit: maxCPU
			};
			this.alerts.push(alert);
			logger.warn(`[ResourceMonitor] ${alert.message}`);
			this.killProcessDueToLimit("cpu");
		}
		if (this.alerts.length > 100) this.alerts = this.alerts.slice(-100);
	}
	killProcessDueToLimit(type) {
		const pid = this.monitoredPid;
		if (pid === null || pid === process.pid) {
			logger.warn(`[ResourceMonitor] 无法 kill 当前 Electron 进程`);
			return;
		}
		this.killedDueToLimit = true;
		logger.warn(`[ResourceMonitor] 因 ${type} 超限，kill 进程 PID=${pid}`);
		try {
			if (process.platform === "win32") (0, child_process.spawn)("taskkill", [
				"/pid",
				String(pid),
				"/T",
				"/F"
			]);
			else process.kill(pid, "SIGKILL");
		} catch (err) {
			logger.error(`[ResourceMonitor] kill 进程失败:`, err);
		}
		this.broadcast("resourceMonitor:alert", {
			type,
			message: `进程 ${pid} 因 ${type} 超限已被终止`,
			timestamp: Date.now()
		});
	}
	broadcast(channel, data) {
		for (const win of electron.BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, data);
	}
};
var resourceMonitor = new ResourceMonitor();

export { execAsync, buildWindowsProcessUsageScript, parseWindowsProcessUsage, ResourceMonitor, resourceMonitor };
