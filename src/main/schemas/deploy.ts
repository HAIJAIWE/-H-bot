// src/main/schemas/deploy.ts
// 部署相关的 zod schema：用于校验来自渲染进程的 IPC 参数
import { z } from 'zod'

/** 适配器类型枚举 */
const adapterSchema = z.enum(['napcat', 'official'])

/**
 * 安全字符白名单：用于防止 SSH 远程 shell 命令注入。
 *
 * 背景：sshDeploy.ts 把 remotePath / imageName 拼入远程 shell 命令，
 * 旧 schema 仅 z.string().min(1) 不限制字符集，渲染进程被 XSS 或恶意插件
 * 可构造 remotePath='"/tmp/x";rm -rf /;"' 在远程服务器执行任意命令。
 * 这里在 schema 层第一道拦截，sshDeploy.ts 层再加 shellQuote 防御纵深。
 */

/** 远程部署路径：必须以 / 开头，只允许字母/数字/._-/，禁止 .. 与特殊字符 */
const remotePathSchema = z
  .string()
  .min(1)
  .regex(/^\/[A-Za-z0-9._\-/]+$/, '远程路径只能包含字母、数字、点、下划线、连字符、斜杠，且必须以 / 开头')
  .refine((p) => !p.includes('..'), '远程路径不允许包含 ..')

/** Docker 镜像名：必须符合 Docker 命名规范（小写字母开头，允许字母数字._-） */
const imageNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._\-]*$/i, '镜像名只能包含字母、数字、点、下划线、连字符，且必须以字母或数字开头')
  .optional()

/** Docker 导出参数 schema */
export const dockerExportSchema = z.object({
  /** 项目根路径（包含 bot.py 的目录） */
  projectPath: z.string().min(1),
  /** 适配器类型 */
  adapter: adapterSchema,
  /** 是否在镜像中打包 NapCat */
  includeNapcat: z.boolean().default(false),
  /** 输出目录（Docker 构建上下文根目录） */
  outputDir: z.string().min(1),
  /** 镜像名（可选，默认 qqbat-bot） */
  imageName: imageNameSchema,
  /** 容器对外端口（可选，默认 8080） */
  port: z.number().int().min(1).max(65535).optional()
})

/** SSH 部署参数 schema */
export const sshDeploySchema = z.object({
  /** 项目根路径 */
  projectPath: z.string().min(1),
  /** SSH 主机 */
  host: z.string().min(1),
  /** SSH 端口 */
  port: z.number().int().min(1).max(65535).default(22),
  /** SSH 用户名 */
  username: z.string().min(1),
  /** 密码（与 privateKey 二选一） */
  password: z.string().optional(),
  /** 私钥内容 */
  privateKey: z.string().optional(),
  /** 私钥口令 */
  passphrase: z.string().optional(),
  /** 远程部署目录（白名单校验，防止 SSH 命令注入） */
  remotePath: remotePathSchema,
  /** 适配器类型 */
  adapter: adapterSchema,
  /** 是否打包 NapCat */
  includeNapcat: z.boolean().default(false),
  /** 镜像名（白名单校验，防止 SSH 命令注入） */
  imageName: imageNameSchema,
  /** 容器对外端口（与 SSH port 区分） */
  containerPort: z.number().int().min(1).max(65535).optional(),
  /** 部署模式：docker（容器）/ node（远程主机上的 Node 运行时） */
  mode: z.enum(['docker', 'node']).default('docker')
}).refine(
  (data) => Boolean(data.password) || Boolean(data.privateKey),
  { message: '必须提供 password 或 privateKey 进行认证' }
)

/** SSH 连接测试参数 schema */
export const sshTestConnectionSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional()
}).refine(
  (data) => Boolean(data.password) || Boolean(data.privateKey),
  { message: '必须提供 password 或 privateKey 进行认证' }
)

/** Docker 打开文件夹参数 schema */
export const dockerOpenFolderSchema = z.object({
  path: z.string().min(1)
})

/** 导出类型供 IPC handler 使用 */
export type DockerExportInput = z.infer<typeof dockerExportSchema>
export type SshDeployInput = z.infer<typeof sshDeploySchema>
export type SshTestConnectionInput = z.infer<typeof sshTestConnectionSchema>
export type DockerOpenFolderInput = z.infer<typeof dockerOpenFolderSchema>
