// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md
import * as fs from "fs";
import * as path from "path";
import * as fs_promises from "fs/promises";
import { BUS_WS_PATH } from "../../../shared/protocol/bus";

/** 容器内用户项目目录（QQBOT_PROJECT_ROOT 指向它） */
var CONTAINER_PROJECT_DIR = "/app/project";
/** 项目文件复制白名单（仅复制运行所需的文件） */
var COPY_WHITELIST_DIRS = [".qqbat", "data"];
var COPY_WHITELIST_FILES = [".env"];
/** 独立运行时入口（相对应用根，容器内执行它） */
var RUNTIME_ENTRY = "out/main/standalone.js";
/** 在应用根下探测锁文件（用于可复现安装依赖） */
function detectLockfile(appRoot) {
	return ["pnpm-lock.yaml", "package-lock.json"].find((f) => (0, fs.existsSync)((0, path.join)(appRoot, f))) ?? null;
}
/**
* 解析应用根目录。
* Electron 下用 app.getAppPath()；纯 Node 下回退 cwd（便于测试与 CLI 调用）。
*/
function getAppRoot() {
	try {
		const p = require("electron").app?.getAppPath?.();
		if (p) return p;
	} catch {}
	return process.cwd();
}
/**
* 为项目生成 Docker 部署包
*
* @param projectPath 项目根路径（包含 .qqbat/flow.json 的目录）
* @param options 导出选项
* @param onProgress 可选进度回调
*/
async function exportProjectToDocker(projectPath, options, onProgress) {
	const emit = (phase, message) => onProgress?.(phase, message);
	const empty = {
		success: false,
		outputDir: options.outputDir,
		dockerfilePath: "",
		buildCommand: "",
		runCommand: "",
		files: [],
		error: ""
	};
	try {
		if (!projectPath || !(0, fs.existsSync)(projectPath)) {
			const err = `项目路径不存在: ${projectPath}`;
			emit("error", err);
			return {
				...empty,
				error: err
			};
		}
		const flowPath = (0, path.join)(projectPath, ".qqbat", "flow.json");
		if (!(0, fs.existsSync)(flowPath)) {
			const err = `项目缺少流程文件 .qqbat/flow.json: ${flowPath}`;
			emit("error", err);
			return {
				...empty,
				error: err
			};
		}
		const appRoot = getAppRoot();
		const runtimeOutDir = (0, path.join)(appRoot, "out");
		if (!(0, fs.existsSync)((0, path.join)(appRoot, "out/main/standalone.js"))) {
			const err = `运行时尚未构建（缺少 ${RUNTIME_ENTRY}）。请先在应用内执行 pnpm run build，再重新导出。`;
			emit("error", err);
			return {
				...empty,
				error: err
			};
		}
		const lockfileName = detectLockfile(appRoot);
		if (!lockfileName) {
			const err = "未找到锁文件（pnpm-lock.yaml / package-lock.json），无法在镜像内可复现地安装依赖";
			emit("error", err);
			return {
				...empty,
				error: err
			};
		}
		emit("prepare", `准备输出目录: ${options.outputDir}`);
		await (0, fs_promises.mkdir)(options.outputDir, { recursive: true });
		const files = [];
		const record = (rel) => {
			if (!files.includes(rel)) files.push(rel);
		};
		emit("copy-project", "复制运行时构建产物到构建上下文");
		await copyDir(runtimeOutDir, (0, path.join)(options.outputDir, "out"));
		for (const f of ["package.json", lockfileName]) {
			await (0, fs_promises.copyFile)((0, path.join)(appRoot, f), (0, path.join)(options.outputDir, f));
			record(f);
		}
		const projectDest = (0, path.join)(options.outputDir, "project");
		for (const dirName of COPY_WHITELIST_DIRS) {
			const src = (0, path.join)(projectPath, dirName);
			if ((0, fs.existsSync)(src)) await copyDir(src, (0, path.join)(projectDest, dirName));
		}
		for (const fileName of COPY_WHITELIST_FILES) {
			const src = (0, path.join)(projectPath, fileName);
			if ((0, fs.existsSync)(src)) await (0, fs_promises.copyFile)(src, (0, path.join)(projectDest, fileName));
		}
		emit("generate-dockerfile", "生成 Dockerfile");
		const dockerfileContent = generateDockerfile(options, lockfileName);
		const dockerfilePath = (0, path.join)(options.outputDir, "Dockerfile");
		await (0, fs_promises.writeFile)(dockerfilePath, dockerfileContent, "utf-8");
		record("Dockerfile");
		await (0, fs_promises.writeFile)((0, path.join)(options.outputDir, ".dockerignore"), generateDockerignore(), "utf-8");
		record(".dockerignore");
		emit("generate-compose", "生成 docker-compose.yml");
		await (0, fs_promises.writeFile)((0, path.join)(options.outputDir, "docker-compose.yml"), generateDockerCompose(options), "utf-8");
		record("docker-compose.yml");
		emit("generate-scripts", "生成启动脚本 start.sh");
		await (0, fs_promises.writeFile)((0, path.join)(options.outputDir, "start.sh"), generateStartSh(), "utf-8");
		record("start.sh");
		await (0, fs_promises.writeFile)((0, path.join)(options.outputDir, ".env.example"), generateEnvExample(options), "utf-8");
		record(".env.example");
		emit("generate-readme", "生成部署说明 README.md");
		await (0, fs_promises.writeFile)((0, path.join)(options.outputDir, "README.md"), generateReadme(options), "utf-8");
		record("README.md");
		const imageName = options.imageName || "qqbat-bot";
		const port = options.port ?? 8080;
		const buildCommand = `docker build -t ${imageName} "${options.outputDir}"`;
		const runCommand = `docker run -d --name ${imageName} -p ${port}:${port} --env-file .env ${imageName}`;
		emit("done", `导出完成，共生成 ${files.length} 个文件`);
		return {
			success: true,
			outputDir: options.outputDir,
			dockerfilePath,
			buildCommand,
			runCommand,
			files,
			error: ""
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		emit("error", msg);
		return {
			...empty,
			error: msg
		};
	}
}
/**
* 生成 Dockerfile
*
* 设计：
* - 基于 node:22-slim（运行时是 out/main/standalone.js，纯 Node 服务，不需要额外语言运行时与 Chromium）
* - 依赖安装层单独成层，利用 Docker 层缓存
* - 非 root 用户运行（安全性）
* - 时区设置为中国时区
*/
function generateDockerfile(options, lockfileName) {
	const installCmd = lockfileName === "pnpm-lock.yaml" ? "corepack enable && pnpm install --prod --frozen-lockfile" : "npm ci --omit=dev";
	const lines = [];
	lines.push("# ====== H Bot 制造 运行时镜像 ======");
	lines.push("# 由 qqbat DockerExporter 自动生成");
	lines.push("FROM node:22-slim");
	lines.push("");
	lines.push("# 设置时区为中国时区");
	lines.push("ENV TZ=Asia/Shanghai");
	lines.push("ENV NODE_ENV=production");
	lines.push("RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone");
	lines.push("");
	lines.push("WORKDIR /app");
	lines.push("");
	lines.push("# 先装依赖，利用层缓存（源码变动不会导致重装）");
	lines.push("COPY package.json ./");
	lines.push(`COPY ${lockfileName} ./`);
	lines.push(`RUN ${installCmd}`);
	lines.push("");
	lines.push("# 复制运行时构建产物");
	lines.push("COPY out ./out");
	lines.push("");
	lines.push("# 复制用户流程项目（.qqbat/flow.json、.env、data/）");
	lines.push(`COPY project ./project`);
	lines.push("");
	lines.push("# 非 root 用户运行");
	lines.push("RUN useradd --create-home --shell /bin/bash qqbat && \\");
	lines.push("    chown -R qqbat:qqbat /app");
	lines.push("USER qqbat");
	lines.push("");
	lines.push("# 运行时通过该变量定位流程项目");
	lines.push(`ENV QQBOT_PROJECT_ROOT=${CONTAINER_PROJECT_DIR}`);
	if (options.port) lines.push(`ENV PORT=${options.port}`);
	lines.push("");
	lines.push("# 启动独立运行时（standalone 内部会依次拉起 translator + 官方适配器）");
	lines.push("CMD [\"node\", \"out/main/standalone.js\"]");
	lines.push("");
	lines.push("# 健康检查：TCP 探测**内置翻译器实际监听的端口**（每 60s 一次）");
	lines.push("#");
	lines.push("# 为什么不用 pgrep -f standalone.js：进程活着 ≠ 服务可用。翻译器绑定失败");
	lines.push("# （端口被占、权限不足）时进程仍在跑，pgrep 照样绿 —— 而运行时连不上翻译器，");
	lines.push("# 结果是\"容器 Healthy、机器人一条消息都收不到\"，正是最难查的那种假健康。");
	lines.push("# 端口取值与运行时一致：QQBOT_BUS_PORT > project.json 的 translatorPort。");
	lines.push("HEALTHCHECK --interval=60s --timeout=10s --retries=3 \\");
	lines.push(`  CMD node -e "const cp='${CONTAINER_PROJECT_DIR}/.qqbat/project.json';let p=Number(process.env.QQBOT_BUS_PORT)||0;try{p=require(cp).translatorPort||p}catch(e){}if(!p){process.exit(1)}const s=require('net').connect(p,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),5000)"`);
	lines.push("");
	return lines.join("\n");
}
/** 生成 .dockerignore */
function generateDockerignore() {
	return [
		"# 排除依赖与构建缓存（镜像内会重新安装）",
		"node_modules/",
		"",
		"# 排除 IDE 配置",
		".vscode/",
		".idea/",
		"",
		"# 排除 Git",
		".git/",
		".gitignore",
		"",
		"# 排除日志",
		"*.log",
		"logs/",
		"",
		"# 排除本工具自身生成的非必要文件",
		"Dockerfile.local",
		"docker-compose.override.yml"
	].join("\n");
}
/** 生成 docker-compose.yml */
function generateDockerCompose(options) {
	const imageName = options.imageName || "qqbat-bot";
	const port = options.port ?? 8080;
	const lines = [];
	lines.push("# H Bot 制造 Docker Compose 配置（由 qqbat 自动生成）");
	lines.push("services:");
	lines.push(`  ${imageName}:`);
	lines.push(`    image: ${imageName}:latest`);
	lines.push(`    container_name: ${imageName}`);
	lines.push("    build: .");
	lines.push("    restart: unless-stopped");
	lines.push("    env_file:");
	lines.push("      - .env");
	lines.push("    volumes:");
	lines.push(`      - ./project/.qqbat:${CONTAINER_PROJECT_DIR}/.qqbat`);
	lines.push(`      - ./project/data:${CONTAINER_PROJECT_DIR}/data`);
	lines.push("    environment:");
	lines.push("      - TZ=Asia/Shanghai");
	lines.push("      - NODE_ENV=production");
	lines.push("    logging:");
	lines.push("      driver: json-file");
	lines.push("      options:");
	lines.push("        max-size: \"10m\"");
	lines.push("        max-file: \"3\"");
	lines.push("");
	if (port) {
		lines.push("# 如需暴露运行时端口，取消下面注释");
		lines.push("#    ports:");
		lines.push(`#      - "${port}:${port}"`);
		lines.push("");
	}
	return lines.join("\n");
}
/** 生成 start.sh */
function generateStartSh() {
	return [
		"#!/bin/bash",
		"# H Bot 制造 容器启动脚本（由 qqbat 自动生成）",
		"set -e",
		"",
		`export QQBOT_PROJECT_ROOT="${CONTAINER_PROJECT_DIR}"`,
		"cd /app",
		"exec node out/main/standalone.js",
		""
	].join("\n");
}
/** 生成 .env.example */
function generateEnvExample(options) {
	const lines = [];
	lines.push("# QQ bot 环境变量示例（复制为 .env 后填写真实值）");
	lines.push("");
	lines.push("# ===== 运行时 =====");
	lines.push("# 流程项目目录（镜像内已固定，一般无需修改）");
	lines.push("QQBOT_PROJECT_ROOT=/app/project");
	lines.push("");
	lines.push("# 内置翻译器地址（standalone 会自己拉起它，指向镜像内部即可）");
	lines.push("QQBOT_BUS_HOST=127.0.0.1");
	lines.push("# 翻译器端口 = 项目的 translatorPort（分配规则 1000 + portBlock，见 .qqbat/project.json）");
	lines.push("# 留空/删除本行时会自动读 /app/project/.qqbat/project.json 的 translatorPort");
	lines.push("QQBOT_BUS_PORT=1001");
	lines.push("");
	lines.push("# 日志级别：debug | info | warn | error");
	lines.push("LOG_LEVEL=info");
	lines.push("");
	lines.push("# ===== QQ 官方机器人凭证（standalone 启动时读取；env 优先于本地加密配置）=====");
	lines.push("# 容器是 Linux：没有 Electron safeStorage，加密过的 appSecret 解不开 —— 必须在这里给");
	lines.push("QQ_APP_ID=");
	lines.push("QQ_APP_SECRET=");
	lines.push("QQ_SANDBOX=false");
	if (options.port) {
		lines.push("");
		lines.push("# 运行时对外端口（可选）");
		lines.push(`PORT=${options.port}`);
	}
	lines.push("");
	return lines.join("\n");
}
/** 生成 README.md */
function generateReadme(options) {
	const imageName = options.imageName || "qqbat-bot";
	const port = options.port ?? 8080;
	const lines = [];
	lines.push(`# ${imageName} Docker 部署`);
	lines.push("");
	lines.push("本目录由 qqbat DockerExporter 自动生成，包含运行流程机器人所需的全部文件。");
	lines.push("镜像内运行的是 qqbat 的独立 Node 运行时（`out/main/standalone.js`），不依赖 Electron。");
	lines.push("");
	lines.push("## 文件清单");
	lines.push("");
	lines.push("| 文件 | 说明 |");
	lines.push("| --- | --- |");
	lines.push("| `Dockerfile` | 镜像构建脚本 |");
	lines.push("| `docker-compose.yml` | 一键启动配置 |");
	lines.push("| `start.sh` | 容器启动入口脚本 |");
	lines.push("| `.dockerignore` | 构建上下文排除规则 |");
	lines.push("| `.env.example` | 环境变量示例 |");
	lines.push("| `out/` | 运行时构建产物 |");
	lines.push("| `package.json` | 运行时依赖声明 |");
	lines.push("| `project/.qqbat/flow.json` | 流程定义 |");
	lines.push("| `project/data/` | 运行时数据（持久化） |");
	lines.push("");
	lines.push("## 快速开始");
	lines.push("");
	lines.push("### 1. 准备环境变量");
	lines.push("```bash");
	lines.push("cp .env.example .env");
	lines.push("# 编辑 .env，填入 QQ_APP_ID / QQ_APP_SECRET 即可");
	lines.push("# （镜像内置翻译器与官方适配器，不需要另外准备 OneBot 网关）");
	lines.push("```");
	lines.push("");
	lines.push("### 2. 使用 Docker Compose 启动（推荐）");
	lines.push("```bash");
	lines.push("docker compose up -d --build");
	lines.push("docker compose logs -f");
	lines.push("```");
	lines.push("");
	lines.push("### 3. 或使用 Docker 命令手动构建/运行");
	lines.push("```bash");
	lines.push(`docker build -t ${imageName} .`);
	lines.push(`docker run -d --name ${imageName} --env-file .env ${imageName}`);
	lines.push(`docker logs -f ${imageName}`);
	lines.push("```");
	lines.push("");
	lines.push("## 连接方式");
	lines.push("");
	lines.push("镜像**内置**了 OneBot 翻译器与 QQ 官方适配器，**不需要**另外自备 OneBot 网关。");
	lines.push("启动时 standalone 会依次拉起：翻译器 → 官方适配器 → 运行时（与桌面版同一套装配）：");
	lines.push("");
	lines.push("```");
	lines.push("standalone.js ──(OneBot v11 WS 客户端)──▶ 内置 translator ──(QQ 官方 API/WS)──▶ QQ");
	lines.push("```");
	lines.push("");
	lines.push(`运行时的 WS 目标地址是 \`ws://\${QQBOT_BUS_HOST}:\${QQBOT_BUS_PORT}${BUS_WS_PATH}\``);
	lines.push("—— 它指向的就是**内置**翻译器，默认 `127.0.0.1` + 项目 `.qqbat/project.json` 的");
	lines.push("`translatorPort`，正常情况下无需修改。需要连的只有 QQ 官方，凭证走 `QQ_APP_ID` /");
	lines.push("`QQ_APP_SECRET`（见上一步）。");
	lines.push("");
	if (port) {
		lines.push(`## 端口`);
		lines.push("");
		lines.push(`运行时端口（如需暴露）：${port}`);
		lines.push("");
	}
	lines.push("## 数据持久化");
	lines.push("");
	lines.push("`project/.qqbat/`（流程定义）与 `project/data/`（运行时数据）通过卷挂载持久化，容器重建后不丢失。");
	lines.push("修改流程后重启容器即可生效（运行时对 flow.json 有 mtime 热重载）。");
	lines.push("");
	lines.push("## 常用运维命令");
	lines.push("");
	lines.push("```bash");
	lines.push("# 查看日志");
	lines.push(`docker logs -f ${imageName}`);
	lines.push("");
	lines.push("# 重启容器");
	lines.push(`docker restart ${imageName}`);
	lines.push("");
	lines.push("# 进入容器");
	lines.push(`docker exec -it ${imageName} bash`);
	lines.push("");
	lines.push("# 停止并删除容器");
	lines.push(`docker rm -f ${imageName}`);
	lines.push("```");
	lines.push("");
	return lines.join("\n");
}
/** 递归复制目录（保留子目录结构，跳过依赖与缓存目录） */
async function copyDir(src, dest) {
	await (0, fs_promises.mkdir)(dest, { recursive: true });
	const entries = await (0, fs_promises.readdir)(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = (0, path.join)(src, entry.name);
		const destPath = (0, path.join)(dest, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".cache") continue;
			await copyDir(srcPath, destPath);
		} else if (entry.isFile()) await (0, fs_promises.copyFile)(srcPath, destPath);
	}
}

export { CONTAINER_PROJECT_DIR, COPY_WHITELIST_DIRS, COPY_WHITELIST_FILES, RUNTIME_ENTRY, detectLockfile, getAppRoot, exportProjectToDocker, generateDockerfile, generateDockerignore, generateDockerCompose, generateStartSh, generateEnvExample, generateReadme, copyDir };
