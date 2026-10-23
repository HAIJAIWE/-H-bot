// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as fs from "fs";
import * as path from "path";
import { RUNTIME_ENTRY, detectLockfile, exportProjectToDocker, getAppRoot } from "./dockerExport";
import * as fs_promises from "fs/promises";
import { createTempWorkspace, disposeTempWorkspace } from "../infra/tempWorkspace";

/** SSH 握手超时（等待服务器 ready 事件） */
var SSH_READY_TIMEOUT_MS = 3e4;
/** SSH 连接总超时（含认证，超过此时间强制断开） */
var SSH_CONNECT_TIMEOUT_MS = 35e3;
/**
* 远程 shell 字符串安全转义：用单引号包裹并把内部单引号转义。
*
* 修复 SSH 命令注入：旧实现直接 `mkdir -p "${remotePath}"` 把 remotePath/imageName
* 拼入远程 shell 命令，双引号内的 `"`、`$`、`` ` ``、`\` 仍会被远端 sh 解析。
* 配合 schemas/deploy.ts 的字符白名单（第一道防御），此处做第二道防御。
*
* 用法：`execRemote(client, \`mkdir -p ${shellQuote(remotePath)}\`, emit)`
*/
function shellQuote(s) {
	return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
/**
* 部署项目到远程服务器
*
* @param projectPath 本地项目路径
* @param config      SSH 部署配置
* @param onProgress  实时日志回调
*/
async function deployProjectViaSsh(projectPath, config, onProgress) {
	const logs = [];
	const emit = (line) => {
		logs.push(line);
		onProgress?.(line);
	};
	const fail = (error, message = "部署失败") => {
		emit(`[ERROR] ${error}`);
		return {
			success: false,
			message,
			logs,
			error
		};
	};
	if (!projectPath || !(0, fs.existsSync)(projectPath)) return fail(`项目路径不存在: ${projectPath}`);
	if (!(0, fs.existsSync)((0, path.join)(projectPath, ".qqbat", "flow.json"))) return fail("项目缺少流程文件 .qqbat/flow.json");
	const appRoot = getAppRoot();
	if (!(0, fs.existsSync)((0, path.join)(appRoot, "out/main/standalone.js"))) return fail(`运行时尚未构建（缺少 ${RUNTIME_ENTRY}）。请先在应用内执行 pnpm run build，再重新部署。`);
	const lockfileName = detectLockfile(appRoot);
	if (!lockfileName) return fail("未找到锁文件（pnpm-lock.yaml / package-lock.json），无法在远程可复现地安装依赖");
	if (!config.host || !config.username) return fail("SSH 主机或用户名为空");
	if (!config.password && !config.privateKey) return fail("必须提供密码或私钥进行认证");
	if (!config.remotePath) return fail("远程部署目录为空");
	emit("[1/6] 加载 ssh2 库...");
	const ssh2 = tryLoadSsh2();
	if (!ssh2) return fail("未安装 ssh2 库。请在项目根目录执行 `npm install ssh2` 后重试。", "缺少 ssh2 依赖");
	emit("[1/6] ssh2 已就绪");
	emit(`[2/6] 连接到 ${config.username}@${config.host}:${config.port}...`);
	let client;
	try {
		const conn = await connectSsh(ssh2, config, emit);
		client = conn.client;
		if (!normalizeHostKeyHash(config.hostFingerprint) && conn.fingerprint) {
			emit(`[ssh] 目标机主机密钥指纹：SHA256:${conn.fingerprint}`);
			emit("[ssh] 想启用校验，请把上面这串指纹填入「主机指纹」后重新部署。");
		}
	} catch (e) {
		return fail(`SSH 连接失败: ${e instanceof Error ? e.message : String(e)}`);
	}
	emit("[2/6] SSH 连接已建立");
	try {
		emit(`[3/6] 创建远程目录: ${config.remotePath}`);
		await execRemote(client, `mkdir -p ${shellQuote(config.remotePath)}`, emit);
		emit("[4/6] 上传运行时与项目文件...");
		const sftp = await openSftp(client, emit);
		try {
			emit(`[4/6] 已上传 ${await uploadRuntimeFiles(sftp, appRoot, lockfileName, config.remotePath, emit)} 个运行时文件`);
			emit(`[4/6] 已上传 ${await uploadProjectFiles(sftp, projectPath, config.remotePath, emit)} 个项目文件`);
			if (config.mode !== "node") {
				emit("[4/6] 生成 Docker 部署文件...");
				const dockerOptions = {
					adapter: config.adapter,
					outputDir: "",
					imageName: config.imageName,
					port: config.containerPort
				};
				await uploadDockerFiles(sftp, projectPath, config.remotePath, dockerOptions, emit);
			}
		} finally {
			await closeSftp(sftp, emit);
		}
		if (config.mode === "node") {
			emit("[5/6] 远程安装依赖并启动 Node 运行时（直接 node 模式）...");
			const installCmd = lockfileName === "pnpm-lock.yaml" ? "corepack enable >/dev/null 2>&1; pnpm install --prod --frozen-lockfile" : "npm ci --omit=dev";
			const projectRoot = `${config.remotePath}/project`;
			const cmd = `cd ${shellQuote(config.remotePath)} && ${installCmd} && QQBOT_PROJECT_ROOT=${shellQuote(projectRoot)} nohup node ${shellQuote(RUNTIME_ENTRY)} > runtime.log 2>&1 & echo "PID=$!"`;
			const pidMatch = (await execRemote(client, cmd, emit)).match(/PID=(\d+)/);
			if (pidMatch) {
				emit(`[6/6] 运行时已启动，PID=${pidMatch[1]}`);
				return {
					success: true,
					message: `远程启动成功，PID=${pidMatch[1]}`,
					logs,
					error: "",
					remoteId: pidMatch[1]
				};
			}
			return {
				success: true,
				message: "启动命令已发送（PID 未捕获，请通过日志确认）",
				logs,
				error: ""
			};
		}
		emit("[5/6] 远程构建 Docker 镜像（这一步可能耗时几分钟）...");
		const imageName = config.imageName || "qqbat-bot";
		const port = config.containerPort ?? 8080;
		await execRemote(client, `cd ${shellQuote(config.remotePath)} && docker build -t ${shellQuote(imageName)} .`, emit);
		emit("[6/6] 停止旧容器并启动新容器...");
		await execRemote(client, `docker rm -f ${shellQuote(imageName)} 2>/dev/null || true`, emit);
		const projectRoot = `${config.remotePath}/project`;
		const runCmd = `docker run -d --name ${shellQuote(imageName)} -p ${shellQuote(String(port))}:${shellQuote(String(port))} --env-file ${shellQuote(projectRoot + "/.env")} -v ${shellQuote(projectRoot + "/.qqbat")}:/app/project/.qqbat -v ${shellQuote(projectRoot + "/data")}:/app/project/data --restart unless-stopped ${shellQuote(imageName)}`;
		const cid = (await execRemote(client, runCmd, emit)).trim().split("\n").pop()?.trim();
		if (cid) {
			emit(`[6/6] 容器已启动，ID=${cid.slice(0, 12)}`);
			return {
				success: true,
				message: `远程部署成功，容器 ${cid.slice(0, 12)} 已启动`,
				logs,
				error: "",
				remoteId: cid.slice(0, 12)
			};
		}
		return {
			success: true,
			message: "部署命令已发送（容器 ID 未捕获，请通过 docker ps 确认）",
			logs,
			error: ""
		};
	} catch (e) {
		return fail(`部署过程出错: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		try {
			client.end();
			emit("[cleanup] SSH 连接已关闭");
		} catch {}
	}
}
/**
* 尝试动态加载 ssh2 模块
*
* 使用 createRequire 而不是 require，以兼容 ESM 环境（虽然本项目是 CJS）。
* 失败时返回 null，调用方据此给出清晰的错误提示。
*/
function tryLoadSsh2() {
	try {
		const mod = require("module");
		if (typeof mod.createRequire === "function") return mod.createRequire(__filename)("ssh2");
		return require("ssh2");
	} catch {
		return null;
	}
}
/** ssh2 的 hostHash 摘要算法（与 OpenSSH 的 SHA256 指纹同一套） */
var HOST_KEY_HASH_ALGO = "sha256";
/**
* 归一化主机密钥指纹，便于比较。
*
* 用户可能从 `ssh-keyscan` / OpenSSH 输出里整段复制成 `SHA256:AbC123…`，
* 也可能只复制主体，还可能带上 `=` 补位与空白。ssh2 回报的又是哪种编码，我们不预设 ——
* **两侧都过同一套归一化**，所以只要内部一致就能正确比较，不必猜它给的是 hex 还是 base64。
*/
function normalizeHostKeyHash(raw) {
	return String(raw ?? "").trim().replace(/^SHA256:/i, "").replace(/[\s:]/g, "").replace(/=+$/, "").toLowerCase();
}
/** 主机密钥与已固定的指纹不一致 —— 专门一个类型，便于上层区分"是安全性拒绝"而非网络故障 */
var HostKeyMismatchError = class extends Error {
	expected;
	observed;
	constructor(expected, observed, cause) {
		super(`目标主机密钥与已固定的指纹不一致，已拒绝连接。
  已固定的指纹：${expected}\n  本次观察到的：${observed}\n若你确认换过机器或重装过系统，请核对新指纹后更新配置；否则这可能是一次中间人攻击。`);
		this.expected = expected;
		this.observed = observed;
		this.name = "HostKeyMismatchError";
		if (cause !== void 0) this.cause = cause;
	}
};
/** ssh2 的 hostVerifier 返回 false 时只给一句笼统的握手失败 —— 这里换成能读懂的原因 */
function hostKeyFailure(err, expected, observed) {
	if (expected && observed && normalizeHostKeyHash(observed) !== expected) return new HostKeyMismatchError(expected, observed, err);
	return err instanceof Error ? err : new Error(String(err));
}
/**
* 建立 SSH 连接（**唯一的连接入口**：部署与"测试连接"都走这里，
* 否则校验逻辑会被复制成两份，早晚有一份漏掉）。
*
* 返回的 `fingerprint` 是本次观察到的主机密钥指纹 —— 首次连接时把它交给用户，
* 让他可以固定下来（TOFU）。
*/
function connectSsh(ssh2, config, emit) {
	return new Promise((resolve, reject) => {
		const client = new ssh2.Client();
		const connectOpts = {
			host: config.host,
			port: config.port,
			username: config.username,
			readyTimeout: SSH_READY_TIMEOUT_MS,
			keepaliveInterval: 1e4
		};
		if (config.privateKey) {
			connectOpts.privateKey = config.privateKey;
			if (config.passphrase) connectOpts.passphrase = config.passphrase;
		} else if (config.password) connectOpts.password = config.password;
		const expected = normalizeHostKeyHash(config.hostFingerprint);
		let observed = "";
		connectOpts.hostHash = HOST_KEY_HASH_ALGO;
		connectOpts.hostVerifier = (hashedKey) => {
			observed = String(hashedKey ?? "");
			if (!expected) return true;
			return normalizeHostKeyHash(observed) === expected;
		};
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				try {
					client.end();
				} catch {}
				reject(/* @__PURE__ */ new Error("SSH 连接超时（30s）"));
			}
		}, SSH_CONNECT_TIMEOUT_MS);
		client.on("ready", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				client,
				fingerprint: observed
			});
		});
		client.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(hostKeyFailure(err, expected, observed));
		});
		client.on("close", () => {
			emit("[ssh] 连接关闭");
		});
		try {
			emit(expected ? "[ssh] 已启用主机密钥校验（指纹已固定）。" : "[ssh] ℹ️ 未固定主机密钥指纹：本次将信任目标机并回报其指纹，建议把该指纹填入「主机指纹」后重新部署，以挡住中间人。");
			client.connect(connectOpts);
		} catch (e) {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		}
	});
}
/**
* 「测试连接」：建立连接、校验主机密钥、立刻断开。
*
* 与部署共用 `connectSsh` —— 这里以前是 IPC 层里**另写一遍**的连接代码，
* 于是"校验主机密钥"这种改动极易只加到一半（部署加了、测试连接没加）。
* 收到一份实现就不会漏。
*/
async function testSshConnection(ssh2, config, emit = () => {}) {
	const start = Date.now();
	const { client, fingerprint } = await connectSsh(ssh2, config, emit);
	const latency = Date.now() - start;
	try {
		client.end();
	} catch {}
	return {
		latency,
		fingerprint
	};
}
/** 远程执行命令并收集输出 */
function execRemote(client, command, emit) {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let resolved = false;
		client.exec(command, (err, stream) => {
			if (err) {
				reject(err);
				return;
			}
			stream.on("data", (data) => {
				const text = data.toString("utf-8");
				stdout += text;
				for (const line of text.split("\n")) if (line.trim()) emit(`  [remote] ${line}`);
			});
			stream.stderr.on("data", (data) => {
				const text = data.toString("utf-8");
				stderr += text;
				for (const line of text.split("\n")) if (line.trim()) emit(`  [remote:err] ${line}`);
			});
			let exitCode = null;
			stream.on("close", () => {
				if (resolved) return;
				resolved = true;
				if (exitCode === 0 || exitCode === null) resolve(stdout);
				else reject(/* @__PURE__ */ new Error(`命令异常关闭 (exit=${exitCode}): ${command}\n${stderr}`));
			});
			stream.on("exit", (code) => {
				exitCode = code;
				if (resolved) return;
				resolved = true;
				if (code === 0) resolve(stdout);
				else reject(/* @__PURE__ */ new Error(`命令退出码 ${code}: ${command}\n${stderr}`));
			});
		});
	});
}
/** 打开 SFTP 通道 */
function openSftp(client, emit) {
	return new Promise((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) {
				emit(`[sftp] 打开失败: ${err.message}`);
				reject(err);
			} else resolve(sftp);
		});
	});
}
/** 关闭 SFTP 通道 */
function closeSftp(sftp, _emit) {
	return new Promise((resolve) => {
		try {
			sftp.end();
		} catch {}
		resolve();
	});
}
/** 递归确保远程目录存在 */
function ensureRemoteDir(sftp, remoteDir) {
	return new Promise((resolve) => {
		sftp.stat(remoteDir, (statErr, stats) => {
			if (!statErr && stats.isDirectory()) {
				resolve();
				return;
			}
			const parts = remoteDir.split("/").filter(Boolean);
			let current = remoteDir.startsWith("/") ? "/" : "";
			const next = (idx) => {
				if (idx >= parts.length) {
					resolve();
					return;
				}
				current = current === "/" ? `/${parts[idx]}` : `${current}/${parts[idx]}`;
				sftp.mkdir(current, () => {
					next(idx + 1);
				});
			};
			next(0);
		});
	});
}
/** 上传单个文件（fastPut） */
function uploadFile(sftp, localPath, remotePath) {
	return new Promise((resolve, reject) => {
		sftp.fastPut(localPath, remotePath, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
/** 上传项目核心文件（上传到 remotePath/project，与镜像内布局一致） */
async function uploadProjectFiles(sftp, projectPath, remotePath, emit) {
	let count = 0;
	const projectDest = `${remotePath}/project`;
	await ensureRemoteDir(sftp, projectDest);
	for (const dirName of [".qqbat", "data"]) {
		const localDir = (0, path.join)(projectPath, dirName);
		if ((0, fs.existsSync)(localDir)) {
			const remoteDir = `${projectDest}/${dirName}`;
			count += await uploadDir(sftp, localDir, remoteDir, emit);
		}
	}
	for (const fileName of [".env"]) {
		const localFile = (0, path.join)(projectPath, fileName);
		if ((0, fs.existsSync)(localFile)) {
			await uploadFile(sftp, localFile, `${projectDest}/${fileName}`);
			emit(`  [upload] project/${fileName}`);
			count++;
		}
	}
	return count;
}
/**
* 上传运行时文件（out/ + package.json + 锁文件）到 remotePath。
*
* 与 docker 模式的构建上下文布局保持一致：容器/远程进程都在 remotePath 下
* 以 `out/main/standalone.js` 为入口，`project/` 为流程项目。
*/
async function uploadRuntimeFiles(sftp, appRoot, lockfileName, remotePath, emit) {
	let count = 0;
	await ensureRemoteDir(sftp, remotePath);
	count += await uploadDir(sftp, (0, path.join)(appRoot, "out"), `${remotePath}/out`, emit);
	for (const f of ["package.json", lockfileName]) {
		const localFile = (0, path.join)(appRoot, f);
		if ((0, fs.existsSync)(localFile)) {
			await uploadFile(sftp, localFile, `${remotePath}/${f}`);
			emit(`  [upload] ${f}`);
			count++;
		}
	}
	return count;
}
/** 递归上传目录 */
async function uploadDir(sftp, localDir, remoteDir, emit) {
	let count = 0;
	await ensureRemoteDir(sftp, remoteDir);
	const entries = await (0, fs_promises.readdir)(localDir, { withFileTypes: true });
	for (const entry of entries) {
		const localEntry = (0, path.join)(localDir, entry.name);
		const remoteEntry = `${remoteDir}/${entry.name}`;
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".cache") continue;
			count += await uploadDir(sftp, localEntry, remoteEntry, emit);
		} else if (entry.isFile()) {
			await uploadFile(sftp, localEntry, remoteEntry);
			emit(`  [upload] ${(0, path.relative)(localDir, localEntry).split("\\").join("/")}`);
			count++;
		}
	}
	return count;
}
/**
* 生成 Docker 部署文件并上传到远程
*
* 这里复用 DockerExporter 的内容生成逻辑，但绕过本地文件系统，
* 直接把生成的字符串内容通过 SFTP 写到远程目录。
*/
async function uploadDockerFiles(sftp, projectPath, remotePath, options, emit) {
	const tmpRoot = await createTempWorkspace("deploy");
	const exportOpts = {
		adapter: options.adapter,
		outputDir: tmpRoot,
		imageName: options.imageName,
		port: options.port
	};
	try {
		await exportProjectToDocker(projectPath, exportOpts);
		for (const fileName of [
			"Dockerfile",
			"docker-compose.yml",
			"start.sh",
			".dockerignore",
			".env.example",
			"README.md"
		]) {
			const localFile = (0, path.join)(tmpRoot, fileName);
			if ((0, fs.existsSync)(localFile)) {
				const remoteFile = `${remotePath}/${fileName}`;
				try {
					await uploadFile(sftp, localFile, remoteFile);
					emit(`  [upload] ${fileName}`);
				} catch (e) {
					emit(`  [upload] ${fileName} 失败: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
		}
	} finally {
		await disposeTempWorkspace(tmpRoot);
	}
}

export { SSH_READY_TIMEOUT_MS, SSH_CONNECT_TIMEOUT_MS, shellQuote, deployProjectViaSsh, tryLoadSsh2, HOST_KEY_HASH_ALGO, normalizeHostKeyHash, HostKeyMismatchError, hostKeyFailure, connectSsh, testSshConnection, execRemote, openSftp, closeSftp, ensureRemoteDir, uploadFile, uploadProjectFiles, uploadRuntimeFiles, uploadDir, uploadDockerFiles };
