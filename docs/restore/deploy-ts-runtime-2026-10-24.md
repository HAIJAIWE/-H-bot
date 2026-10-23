# 部署链路 TS 化：Docker / SSH 走纯 Node 运行时（2026-10-24）

> 范围：`src/main/services/dockerExport.ts`、`src/main/services/sshDeploy.ts`、`src/main/services/deploy/runtimeBundle.ts`、`src/main/schemas/deploy.ts`。
> 基准：10/18 打包客户端里的 `ops/dockerExport.ts` / `ops/sshDeploy.ts`（`@ts-nocheck` 还原稿，已上线），按它的语义在 `services/` 里做带类型的正式实现。

## 为什么不能只传 runtime/

`electron-vite` 用 `externalizeDepsPlugin` 把 dependencies 全部 external，所以构建产物里**不会**有这些包。
`out/main` 各 chunk 顶层 `require` 的实际依赖：

| chunk | 顶层 require |
| --- | --- |
| `standalone.js` / `builtinCatalog` | `path` `fs` `vm` `electron` `electron-log` |
| `FlowRuntime-*.js` | `electron` `path` `fs` `events` `ws` `zod` `better-sqlite3` `net` `crypto` |
| `aiNodeScaffold` | `path` `fs` |
| `sandbox` | `vm` |

只把 `runtime/` 拷到目标机器会直接 `MODULE_NOT_FOUND: ws`（冒烟实测）。所以部署包必须带
`package.json` + 锁文件，在目标环境装**生产依赖**：

- `src/main/services/deploy/runtimeBundle.ts`：`getAppRoot()` / `detectLockfile()` / `copyRuntimeManifest()`；
- Docker 与 SSH 共用 `nodeInstallShell(lockfileName)` 生成的安装命令，避免两处语义漂移。

## 安装语义（两个非显然的细节）

1. **`--ignore-scripts`**：根 `package.json` 的 `prepare` 是装 git hooks 的，镜像/远程没有 `.git`，
   而且恢复出来的仓库 `scripts/` 并不齐全；让生命周期脚本跑起来只会在构建期制造无关失败。
2. **`better-sqlite3` 必须现装**：它是原生模块，Windows 的 `.node` 拷到 Linux 一定加载失败。
   装完依赖后单独跑 `node_modules/better-sqlite3/node_modules/.bin/prebuild-install`（拉当前平台预编译），
   并紧跟着 `node -e "require('better-sqlite3')&&require('ws')"` 验证——装不上要在**构建期**炸，
   而不是等容器起来后一条消息都收不到。

> `runtime/node_modules/electron` 是占位包（`module.exports = {}`）：它比根 `node_modules` 更靠近 chunk，
> 用来接住 `require("electron")`。生产依赖里没有 electron（devDependency，`pnpm install --prod` 不装）。

## Docker 包形状

```
<outputDir>/
  package.json          # 运行时依赖清单（从 app 根复制）
  pnpm-lock.yaml        # 或 package-lock.json
  Dockerfile
  .dockerignore         # 注意：不能排除 node_modules/（runtime 的 electron 占位包在里面）
  docker-compose.yml
  start.sh
  .env.example
  README.md
  runtime/              # out/main → runtime/（standalone.js + chunks + electron 占位包）
  .qqbat/ data/ ...     # 项目白名单
```

Dockerfile 关键层（顺序决定缓存命中）：

```dockerfile
COPY package.json ./
COPY pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile --ignore-scripts
RUN cd node_modules/better-sqlite3 && ./node_modules/.bin/prebuild-install \
 && cd /app && node -e "require('better-sqlite3')&&require('ws')&&require('zod')"
COPY . /app
CMD ["node", "/app/runtime/standalone.js", "/app"]
```

`HEALTHCHECK` 用 `net.connect` 探 `project.json` 的 `translatorPort`（`QQBOT_BUS_PORT` 优先），
**不用** `pgrep -f standalone.js`：进程活着 ≠ 服务可用，翻译器端口绑定失败时进程还在跑，
`pgrep` 照样绿，结果是"容器 Healthy、一条消息都收不到"。

## SSH（node 模式）

远端目录布局与 Docker 包一致（项目文件在根、`runtime/` 在根），流程：

1. `uploadProjectFiles`：`.qqbat/ data/ plugins/ src/` + `.env`；
2. `uploadRuntimeDir`：复制 `runtime/` 与 `package.json`/锁文件后上传；
3. **同步**执行安装命令（`execRemote` 在非 0 退出时 reject，失败不会静默继续）；
4. `QQBOT_PROJECT_ROOT=<remote> nohup node runtime/standalone.js . > bot.log 2>&1 &`。

前置要求：远端 Node ≥ 22；用 pnpm 锁时容器/主机需要能 `corepack enable`（失败回退 `npm i -g pnpm`）。
`mode` 的 schema 已从 `['docker','python']` 改为 `['docker','node']`（渲染层早就是新语义）。

## 冒烟测试

`tests/main/services/dockerExport.test.ts` + `runtimeBundle.test.ts` 是静态断言；
真正"包能跑"由可选冒烟覆盖（默认 skip）：

```powershell
$env:QQBAT_DEPLOY_SMOKE='1'
node node_modules/vitest/vitest.mjs run tests/_smoke/deploySmoke.test.ts --maxWorkers=1
```

它导出构建上下文后，把仓库 `node_modules` 以 junction 挂到包根（代替镜像里的 pnpm install），
再 `spawn node runtime/standalone.js <bundle>`，等 stdout「已就绪」并 TCP 探端口。
能同时验证：electron 占位包优先级、external 依赖可解析、翻译器真的绑上了端口。

## 已知边界

- **不跑真 Docker build**：没有在 CI 里起 dockerd；镜像层只做静态断言 + 同一套安装命令的本地等价冒烟。
- 构建期需要网络（corepack 拉 pnpm、prebuild-install 拉二进制）。
- `node-pty` 等仅桌面端使用的原生依赖在 `--ignore-scripts` 下没有二进制；standalone 不加载它们。
## 验证结果（2026-10-24）

| 闸门 | 结果 |
| --- | --- |
| `tsc -p tsconfig.node.json` | src 0 错 |
| `tests/main/services/{dockerExport,runtimeBundle}.test.ts` | 5 + 9 例通过 |
| `tests/_smoke/deploySmoke.test.ts`（`QQBAT_DEPLOY_SMOKE=1`） | 通过：导出 → junction node_modules → `node runtime/standalone.js` 起翻译器 → TCP 探端口成功（277ms） |
| `vitest run --maxWorkers=2`（全量） | 226 文件 / 3004 例通过 / 58 skip，**0 failed** |
| `tests/guards` | 12 文件 / 88 通过 + 2 skip |

SSH 路径没有真实远端可打，**只做了静态与单元覆盖**；首次真机部署时应重点看：corepack 是否能在目标机启用、`prebuild-install` 是否能拉到与目标 glibc 匹配的 better-sqlite3 二进制、`bot.log` 里翻译器端口是否绑上。
