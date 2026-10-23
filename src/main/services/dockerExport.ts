// src/main/services/dockerExport.ts
// Docker 导出服务：为指定项目生成 Docker 部署包（Dockerfile + docker-compose.yml + 启动脚本等）。
//
// 运行时形态（2026-10-24 起，ADR-003 的部署侧收尾）：
//   部署包 = runtime/（out/main 的 TS 运行时，含 standalone.js）+ 项目目录（.qqbat/ data/ plugins/ src/）
//   容器里执行 `node /app/runtime/standalone.js /app`，不再有 bot.py / pip / requirements.txt。
//
// 设计要点：
// - 不依赖 dockerode 等额外库，仅用 Node.js 内置 fs/path。
// - 产物写到 options.outputDir，与项目目录隔离；outputDir 本身就是可独立构建的构建上下文。
// - 运行时通过 deploy/runtimeBundle 复制（缺 out/main 时直接报错，不产出跑不起来的包）。
// - 支持 napcat / official 两种适配器；napcat 模式可选把 NapCat 打进镜像（它本身也是 Node 程序）。
//
// 生成的文件清单：
//   - Dockerfile / docker-compose.yml / start.sh / .dockerignore / README.md / .env.example
//   - runtime/（standalone.js + chunks + electron 占位包）
//   - .qqbat/ data/ plugins/ src/ .env（按项目实际存在情况）
import { copyFile, mkdir, readdir, writeFile, access } from 'fs/promises'
import { existsSync } from 'fs'
import { join, relative } from 'path'
import {
  copyRuntimeBundle,
  copyRuntimeManifest,
  runtimeEntryRel,
  RUNTIME_DIR_NAME
} from './deploy/runtimeBundle'

/** 适配器类型 */
export type DeployAdapter = 'napcat' | 'official'

/** 导出选项 */
export interface DockerExportOptions {
  /** 适配器类型 */
  adapter: DeployAdapter
  /** 是否在镜像中打包 NapCat（仅 napcat 模式有意义） */
  includeNapcat: boolean
  /** 输出目录（Docker 构建上下文根目录） */
  outputDir: string
  /** 镜像名（默认 qqbat-bot） */
  imageName?: string
  /** 容器对外暴露端口（默认 8080） */
  port?: number
}

/** 导出结果 */
export interface DockerExportResult {
  success: boolean
  /** 输出目录（构建上下文） */
  outputDir: string
  /** Dockerfile 绝对路径 */
  dockerfilePath: string
  /** 构建命令（提示用户） */
  buildCommand: string
  /** 运行命令（提示用户） */
  runCommand: string
  /** 生成的全部文件（相对 outputDir） */
  files: string[]
  /** 错误信息（success=false 时存在） */
  error: string
}

/** 进度回调 */
export type DockerExportProgress = (phase: DockerExportPhase, message: string) => void

export type DockerExportPhase =
  | 'prepare'
  | 'copy-project'
  | 'generate-dockerfile'
  | 'generate-compose'
  | 'generate-scripts'
  | 'generate-readme'
  | 'done'
  | 'error'

/** 项目文件复制白名单（只带运行需要的；不含 node_modules / 缓存） */
const COPY_WHITELIST_DIRS = ['.qqbat', 'data', 'plugins', 'src']
const COPY_WHITELIST_FILES = ['.env']

/** NapCat 容器内安装路径 */
const NAPCAT_DIR = '/app/napcat'

/**
 * 为项目生成 Docker 部署包。
 *
 * @param projectPath 项目根路径（含 .qqbat/flow.json 的目录）
 * @param options 导出选项
 * @param onProgress 可选进度回调
 */
export async function exportProjectToDocker(
  projectPath: string,
  options: DockerExportOptions,
  onProgress?: DockerExportProgress
): Promise<DockerExportResult> {
  const emit = (phase: DockerExportPhase, message: string) => onProgress?.(phase, message)
  const empty: DockerExportResult = {
    success: false,
    outputDir: options.outputDir,
    dockerfilePath: '',
    buildCommand: '',
    runCommand: '',
    files: [],
    error: ''
  }

  try {
    // 1. 校验项目：TS 运行时只要流程文件，不再要求 bot.py
    if (!projectPath || !existsSync(projectPath)) {
      const err = `项目路径不存在: ${projectPath}`
      emit('error', err)
      return { ...empty, error: err }
    }
    const flowPath = join(projectPath, '.qqbat', 'flow.json')
    if (!existsSync(flowPath)) {
      const err = `项目缺少 .qqbat/flow.json: ${flowPath}（先在低代码画布保存一次）`
      emit('error', err)
      return { ...empty, error: err }
    }
    if (!options.outputDir) {
      const err = '输出目录为空'
      emit('error', err)
      return { ...empty, error: err }
    }

    // 2. 准备输出目录
    emit('prepare', `准备输出目录: ${options.outputDir}`)
    await mkdir(options.outputDir, { recursive: true })

    const files: string[] = []
    const record = (rel: string) => {
      if (!files.includes(rel)) files.push(rel)
    }

    // 3. 复制运行时（必须最先做：失败就别复制项目，省得留下半个包）
    emit('copy-project', `复制 TS 运行时到 ${RUNTIME_DIR_NAME}/`)
    const bundle = await copyRuntimeBundle(join(options.outputDir, RUNTIME_DIR_NAME))
    emit('copy-project', `运行时 ${bundle.fileCount} 个文件（源: ${bundle.sourceDir}）`)
    record(RUNTIME_DIR_NAME + '/')

    // 3.1 运行时依赖清单（package.json + 锁文件）：out/main 对 ws/zod/electron-log/
    // better-sqlite3 是 external，镜像里必须按清单装生产依赖，否则启动即 MODULE_NOT_FOUND
    const manifest = await copyRuntimeManifest(options.outputDir)
    for (const file of manifest.files) record(file)
    emit('copy-project', `运行时依赖清单: ${manifest.files.join(', ')}`)

    // 4. 复制项目文件到输出目录（跳过 outputDir 自身，避免自嵌套）
    const exclude = options.outputDir
    for (const dirName of COPY_WHITELIST_DIRS) {
      const src = join(projectPath, dirName)
      if (existsSync(src) && src !== exclude) {
        await copyDir(src, join(options.outputDir, dirName), exclude)
      }
    }
    for (const fileName of COPY_WHITELIST_FILES) {
      const src = join(projectPath, fileName)
      if (existsSync(src)) {
        await copyFile(src, join(options.outputDir, fileName))
        record(fileName)
      }
    }

    // 5. 生成 Dockerfile
    emit('generate-dockerfile', '生成 Dockerfile')
    const dockerfileContent = generateDockerfile(options, manifest.lockfileName)
    const dockerfilePath = join(options.outputDir, 'Dockerfile')
    await writeFile(dockerfilePath, dockerfileContent, 'utf-8')
    record('Dockerfile')

    // 6. 生成 .dockerignore
    await writeFile(join(options.outputDir, '.dockerignore'), generateDockerignore(), 'utf-8')
    record('.dockerignore')

    // 7. 生成 docker-compose.yml
    emit('generate-compose', '生成 docker-compose.yml')
    await writeFile(
      join(options.outputDir, 'docker-compose.yml'),
      generateDockerCompose(options),
      'utf-8'
    )
    record('docker-compose.yml')

    // 8. 生成 start.sh
    emit('generate-scripts', '生成启动脚本 start.sh')
    await writeFile(join(options.outputDir, 'start.sh'), generateStartSh(options), 'utf-8')
    record('start.sh')

    // 9. 生成 .env.example
    await writeFile(join(options.outputDir, '.env.example'), generateEnvExample(options), 'utf-8')
    record('.env.example')

    // 10. 生成 README.md
    emit('generate-readme', '生成部署说明 README.md')
    await writeFile(join(options.outputDir, 'README.md'), generateReadme(options), 'utf-8')
    record('README.md')

    // 11. 组装构建/运行命令
    const imageName = options.imageName || 'qqbat-bot'
    const port = options.port ?? 8080
    const buildCommand = `docker build -t ${imageName} "${options.outputDir}"`
    const runCommand = `docker run -d --name ${imageName} -p ${port}:${port} --env-file .env ${imageName}`

    emit('done', `导出完成，共生成 ${files.length} 个条目`)
    return {
      success: true,
      outputDir: options.outputDir,
      dockerfilePath,
      buildCommand,
      runCommand,
      files,
      error: ''
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    emit('error', msg)
    return { ...empty, error: msg }
  }
}

// ====== 文件内容生成器 ======

/**
 * 生成 Dockerfile（Node 运行时）。
 *
 * - 基础镜像 node:22-slim（与 electron-vite 的构建目标一致）。
 * - 运行时已在构建上下文里（runtime/），项目目录就是 /app：standalone.js 的第二个参数
 *   是项目根，传 /app 就能读到 /app/.qqbat/flow.json。
 * - 非 root 运行（数据目录仍可写：chown 给运行用户）。
 */
function generateDockerfile(options: DockerExportOptions, lockfileName: string): string {
  const lines: string[] = []
  lines.push('# ====== QQ bat Docker 镜像（TypeScript / Node 运行时）======')
  lines.push('# 由 qqbat DockerExporter 自动生成，勿手改（改项目里的导出配置后重新导出）')
  lines.push('FROM node:22-slim')
  lines.push('')
  lines.push('# 设置时区为中国时区')
  lines.push('ENV TZ=Asia/Shanghai')
  lines.push('RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone')
  lines.push('')
  lines.push('WORKDIR /app')
  lines.push('')
  lines.push('# 时区库 + CA 证书（健康检查不再依赖 procps：见文件末尾 HEALTHCHECK）')
  lines.push(
    'RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata \\'
  )
  lines.push('    && rm -rf /var/lib/apt/lists/*')
  lines.push('')
  if (options.includeNapcat && options.adapter === 'napcat') {
    lines.push('# NapCat（基于 Node 的 OneBot v11 实现）')
    lines.push('RUN apt-get update && apt-get install -y --no-install-recommends curl unzip \\')
    lines.push('    && rm -rf /var/lib/apt/lists/*')
    lines.push(`RUN mkdir -p ${NAPCAT_DIR} && \\`)
    lines.push('    curl -L -o /tmp/napcat.zip \\')
    lines.push(
      '      "https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.Linux.zip" && \\'
    )
    lines.push(`    unzip -q /tmp/napcat.zip -d ${NAPCAT_DIR} && \\`)
    lines.push('    rm -f /tmp/napcat.zip')
    lines.push('')
  }
  lines.push('# 先按锁文件装运行时依赖（这一步最慢，放在复制源码前以命中层缓存）')
  lines.push('# ws / zod / electron-log / better-sqlite3 在 out/main 里是 external，不在包里；')
  lines.push('# better-sqlite3 必须在这里装 Linux 预编译，不能从 Windows 直接拷 .node。')
  lines.push('COPY package.json ./')
  lines.push(`COPY ${lockfileName} ./`)
  // --ignore-scripts：根 package.json 的 prepare（装 git hooks）在镜像里没有意义，而且
  // 仓库脚本不一定齐；原生依赖改为装完后单独 prebuild-install，并当场 require 验证。
  if (lockfileName === 'pnpm-lock.yaml') {
    lines.push('RUN corepack enable && pnpm install --prod --frozen-lockfile --ignore-scripts')
  } else {
    lines.push('RUN npm ci --omit=dev --ignore-scripts')
  }
  lines.push('')
  lines.push('# better-sqlite3 的原生二进制按当前平台现装（不能拷 Windows 的 .node）')
  lines.push('RUN cd node_modules/better-sqlite3 && ./node_modules/.bin/prebuild-install \\')
  lines.push(
    ' && cd /app && node -e "require(\'better-sqlite3\')&&require(\'ws\')&&require(\'zod\')"'
  )
  lines.push('')
  lines.push('# 复制运行时（standalone.js + chunks + electron 占位包）与项目目录')
  lines.push('COPY . /app')
  lines.push('')
  lines.push('# 非 root 运行；数据目录要保持可写')
  lines.push('RUN useradd -m -u 10001 qqbat && chown -R qqbat:qqbat /app')
  lines.push('USER qqbat')
  lines.push('')
  lines.push('ENV NODE_ENV=production \\')
  lines.push('    QQBOT_PROJECT_ROOT=/app')
  lines.push('')
  if (options.includeNapcat && options.adapter === 'napcat') {
    lines.push('RUN chmod +x /app/start.sh')
    lines.push('CMD ["/app/start.sh"]')
  } else {
    lines.push('# 启动：node runtime/standalone.js <项目根>')
    lines.push(`CMD ["node", "/app/${runtimeEntryRel()}", "/app"]`)
  }
  lines.push('')
  lines.push('# 健康检查：TCP 探测翻译器真实监听的端口（每 60s 一次）')
  lines.push('#')
  lines.push('# 为什么不用 pgrep -f standalone.js：进程活着 ≠ 服务可用。翻译器端口绑定失败时')
  lines.push('# 进程仍在跑，pgrep 照样绿 —— 结果是"容器 Healthy、一条消息都收不到"的假健康。')
  lines.push('HEALTHCHECK --interval=60s --timeout=10s --retries=3 \\')
  lines.push(
    '  CMD node -e "let p=Number(process.env.QQBOT_BUS_PORT)||0;try{p=require(\'/app/.qqbat/project.json\').translatorPort||p}catch(e){}if(!p)process.exit(1);const s=require(\'net\').connect(p,\'127.0.0.1\',()=>{s.end();process.exit(0)});s.on(\'error\',()=>process.exit(1));setTimeout(()=>process.exit(1),5000)"'
  )
  lines.push('')
  return lines.join('\n')
}

/** 生成 .dockerignore */
function generateDockerignore(): string {
  return [
    '# 构建上下文排除规则（由 qqbat 生成）',
    '# 注意：不能排除 node_modules/ —— runtime/node_modules/electron 是必需占位包',
    '.git/',
    '.github/',
    '.vscode/',
    '.idea/',
    '',
    '# 日志与临时文件',
    '*.log',
    'bot.log',
    'logs/',
    'tmp/',
    '',
    '# 构建产物与缓存',
    'dist/',
    'build/',
    '__pycache__/',
    '*.pyc',
    '.pytest_cache/',
    '',
    '# 本工具自身生成的非必要文件',
    'Dockerfile.local',
    'docker-compose.override.yml'
  ].join('\n')
}

/** 生成 docker-compose.yml */
function generateDockerCompose(options: DockerExportOptions): string {
  const imageName = options.imageName || 'qqbat-bot'
  const port = options.port ?? 8080
  return [
    '# QQ bat Docker Compose 配置（由 qqbat 自动生成）',
    'services:',
    `  ${imageName}:`,
    `    image: ${imageName}:latest`,
    `    container_name: ${imageName}`,
    '    build: .',
    '    restart: unless-stopped',
    '    ports:',
    `      - "${port}:${port}"`,
    '    env_file:',
    '      - .env',
    '    volumes:',
    '      - ./data:/app/data',
    '      - ./.qqbat:/app/.qqbat',
    '      - ./plugins:/app/plugins',
    ...(options.includeNapcat && options.adapter === 'napcat'
      ? [`      - ./napcat/config:${NAPCAT_DIR}/config`]
      : []),
    '    environment:',
    '      - TZ=Asia/Shanghai',
    '    logging:',
    '      driver: json-file',
    '      options:',
    '        max-size: "10m"',
    '        max-file: "3"',
    ''
  ].join('\n')
}

/** 生成 start.sh */
function generateStartSh(options: DockerExportOptions): string {
  const lines: string[] = []
  lines.push('#!/bin/bash')
  lines.push('# QQ bat 容器启动脚本（由 qqbat 自动生成）')
  lines.push('set -e')
  lines.push('')
  if (options.includeNapcat && options.adapter === 'napcat') {
    lines.push('# 启动 NapCat（后台）')
    lines.push(`cd ${NAPCAT_DIR}`)
    lines.push('node napcat.mjs --no-sandbox -q "${NAPCAT_QQ:-10000}" &')
    lines.push('NAPCAT_PID=$!')
    lines.push('sleep 5')
    lines.push('cd /app')
    lines.push('node /app/' + runtimeEntryRel() + ' /app &')
    lines.push('RUNTIME_PID=$!')
    lines.push('trap "kill $NAPCAT_PID $RUNTIME_PID 2>/dev/null; exit" SIGTERM SIGINT')
    lines.push('wait -n')
  } else {
    lines.push('cd /app')
    lines.push('exec node /app/' + runtimeEntryRel() + ' /app')
  }
  lines.push('')
  return lines.join('\n')
}

/** 生成 .env.example */
function generateEnvExample(options: DockerExportOptions): string {
  const lines: string[] = []
  lines.push('# QQ bot 环境变量示例（复制为 .env 后填写真实值）')
  lines.push('')
  lines.push('# 项目根（容器内固定为 /app，一般不用改）')
  lines.push('QQBOT_PROJECT_ROOT=/app')
  lines.push('')
  if (options.adapter === 'napcat') {
    lines.push('# OneBot 反向 WS 地址（翻译器监听端口取自项目 project.json 的 translatorPort）')
    lines.push('ONEBOT_WS_URLS=["ws://127.0.0.1:8080/onebot/v11/ws"]')
    lines.push('')
    lines.push('# NapCat 登录 QQ 号')
    lines.push('NAPCAT_QQ=10000')
  } else {
    lines.push('# 官方适配器凭证')
    lines.push('QQ_APP_ID=')
    lines.push('QQ_APP_SECRET=')
    lines.push('QQ_SANDBOX=false')
  }
  lines.push('')
  return lines.join('\n')
}

/** 生成 README.md */
function generateReadme(options: DockerExportOptions): string {
  const imageName = options.imageName || 'qqbat-bot'
  const port = options.port ?? 8080
  const lines: string[] = []
  lines.push(`# ${imageName} Docker 部署`)
  lines.push('')
  lines.push('本目录由 qqbat DockerExporter 自动生成，包含运行 QQ bot 所需的全部文件。')
  lines.push('运行时是 TypeScript 版（Node 22），**不需要 Python / pip / bot.py**。')
  lines.push('')
  lines.push('## 文件清单')
  lines.push('')
  lines.push('| 文件 | 说明 |')
  lines.push('| --- | --- |')
  lines.push('| `Dockerfile` | 镜像构建脚本（node:22-slim） |')
  lines.push('| `docker-compose.yml` | 一键启动配置 |')
  lines.push('| `' + RUNTIME_DIR_NAME + '/` | TS 运行时（standalone.js + chunks + electron 占位包） |')
  lines.push('| `start.sh` | 容器启动入口脚本 |')
  lines.push('| `.dockerignore` | 构建上下文排除规则 |')
  lines.push('| `.env.example` | 环境变量示例 |')
  lines.push('| `.qqbat/flow.json` | 流程定义（机器人的全部逻辑） |')
  lines.push('| `data/` | 玩家数据、配置表、日志 |')
  lines.push('| `plugins/` | 项目级节点插件 |')
  lines.push('')
  lines.push('## 快速开始')
  lines.push('')
  lines.push('```bash')
  lines.push('cp .env.example .env')
  lines.push('# 编辑 .env，填入 QQ_APP_ID / QQ_APP_SECRET（或 NapCat 相关配置）')
  lines.push('docker compose up -d --build')
  lines.push('docker compose logs -f')
  lines.push('```')
  lines.push('')
  lines.push('或手动构建/运行：')
  lines.push('')
  lines.push('```bash')
  lines.push(`docker build -t ${imageName} .`)
  lines.push(`docker run -d --name ${imageName} -p ${port}:${port} --env-file .env ${imageName}`)
  lines.push(`docker logs -f ${imageName}`)
  lines.push('```')
  lines.push('')
  lines.push('## 本地直接跑（不用 Docker）')
  lines.push('')
  lines.push('```bash')
  lines.push('node ' + runtimeEntryRel() + ' .')
  lines.push('```')
  lines.push('')
  lines.push('## 适配器说明')
  lines.push('')
  if (options.adapter === 'napcat') {
    lines.push('本镜像使用 NapCat 适配器（OneBot v11）。')
    lines.push('')
    if (options.includeNapcat) {
      lines.push(`镜像内已打包 NapCat（${NAPCAT_DIR}），start.sh 会先拉起 NapCat 再启动运行时。`)
      lines.push('首次启动需要扫码登录，可通过 `docker logs` 查看二维码。')
    } else {
      lines.push('镜像未打包 NapCat，需要外部 NapCat 通过 `ONEBOT_WS_URLS` 连接。')
    }
  } else {
    lines.push('本镜像使用 QQ 官方机器人 API 适配器，需要在 `.env` 填写 `QQ_APP_ID` 与 `QQ_APP_SECRET`。')
  }
  lines.push('')
  lines.push('## 数据持久化')
  lines.push('')
  lines.push('`data/`、`.qqbat/`、`plugins/` 通过卷挂载持久化，容器重建后数据不丢失。')
  lines.push('')
  lines.push('## 常用运维命令')
  lines.push('')
  lines.push('```bash')
  lines.push(`docker logs -f ${imageName}`)
  lines.push(`docker restart ${imageName}`)
  lines.push(`docker exec -it ${imageName} bash`)
  lines.push(`docker rm -f ${imageName}`)
  lines.push('```')
  lines.push('')
  return lines.join('\n')
}

// ====== 工具函数 ======

/** 递归复制目录（跳过缓存与依赖目录；exclude 用于跳过 outputDir 自身） */
async function copyDir(src: string, dest: string, exclude?: string): Promise<void> {
  if (exclude && (src === exclude || dest === exclude)) return
  await mkdir(dest, { recursive: true })
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    if (exclude && srcPath === exclude) continue
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      if (
        entry.name === '__pycache__' ||
        entry.name === '.pytest_cache' ||
        entry.name === 'node_modules' ||
        entry.name === '.git'
      ) {
        continue
      }
      await copyDir(srcPath, destPath, exclude)
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) continue
      await copyFile(srcPath, destPath)
    }
  }
}

/**
 * 安全检查：确保目标路径在 baseDir 之内（防止路径穿越）。
 *
 * @deprecated 目前 exportProjectToDocker 直接按白名单复制，用不到它；保留给未来的
 * 自定义导出路径功能（测试仍覆盖它的边界行为）。
 */
export async function _checkPath(baseDir: string, target: string): Promise<boolean> {
  try {
    const rel = relative(baseDir, target)
    if (rel.startsWith('..') || rel === '') return false
    await access(target)
    return true
  } catch {
    return false
  }
}

// 兼容性导出：部分调用方使用 `new DockerExporter()` 风格
export class DockerExporter {
  async exportProject(
    projectPath: string,
    options: DockerExportOptions,
    onProgress?: DockerExportProgress
  ): Promise<DockerExportResult> {
    return exportProjectToDocker(projectPath, options, onProgress)
  }
}
