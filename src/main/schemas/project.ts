// src/main/schemas/project.ts
//
// ⚠️ 本文件的形状按 10/18 编译产物 region `src/main/schemas/project.ts` 复原
// （D:/tmp/hbot-out/out/main/index.js）。恢复树里的旧版还停在 NapCat 时代：
// adapter 只认 'napcat' | 'official'、botType 只认 'functional' | 'game' ——
// 而 10/18 的界面（BOT_TYPES / AdapterConfigDialog）发的是 'qq' / 'general' / 'game'
// 与 'official' / 'lark' / 'dingtalk'，于是新建项目永远被 Zod 拒掉
// （invalid_value: adapter / botType），界面只显示一句"创建失败"。
import { z } from 'zod'
import { LLM_PRESET_IDS } from '@shared/types/llm-presets'
import { isWithinProject } from '../services/infra/pathGuard'

/**
 * 新建项目入参。
 *
 * ⚠️ adapter 必须与 `@shared/types/project.ts` 的 `AdapterType` **同步** ——
 * 运行期校验（本 schema）与编译期类型是**两份声明**，只改一处会出现
 * "TS 编译通过、保存时被 Zod 拒绝"（踩过：加了飞书后保存报
 * `Invalid input: expected "official", path: ["adapter"]`）。
 */
export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5-]+$/, '名称只允许字母数字、下划线、连字符、中文'),
  qq: z
    .string()
    .regex(/^\d{5,12}$/, 'QQ 号必须是 5-12 位数字')
    .or(z.literal(''))
    .optional(),
  /** 主适配器（= 项目跑在哪个平台）。 */
  adapter: z.enum(['official', 'lark', 'dingtalk']),
  /** 机器人类型：只影响节点库的平台过滤与「玩家数据」面板的字段分组，不绑定节点。 */
  botType: z.enum(['qq', 'general', 'game']).optional(),
  templateId: z.string().optional(),
  official: z
    .object({
      appId: z.string().optional().default(''),
      appSecret: z.string().optional().default(''),
      sandbox: z.boolean().optional().default(true),
      wsUrl: z.string().optional().default('')
    })
    .default({ appId: '', appSecret: '', sandbox: true, wsUrl: '' }),
  /**
   * 飞书配置。
   *
   * ⚠️ **必须声明**：Zod 会剥掉未声明的字段，界面上填的飞书凭据会**静默丢失**
   * （保存"成功"但读回来是空的）。同样的坑在 `translatorPort` 上踩过。
   */
  lark: z
    .object({
      appId: z.string().optional().default(''),
      appSecret: z.string().optional().default(''),
      eventMode: z.enum(['long-connection', 'webhook']).optional().default('long-connection'),
      domain: z.string().optional(),
      /** 飞书 appSecret 是否已加密（落盘标记；缺了它下一次保存会把密文当明文再迁一遍）。 */
      _encrypted: z.boolean().optional()
    })
    .optional(),
  /**
   * 钉钉配置。
   *
   * ⚠️ **必须声明**（与飞书同一原因）：少了它，界面上填的 AppKey/AppSecret 会静默丢失。
   * 钉钉用 **AppKey / AppSecret**（官方叫法），代码里对应 `clientId` / `clientSecret`。
   */
  dingtalk: z
    .object({
      clientId: z.string().optional().default(''),
      clientSecret: z.string().optional().default(''),
      _encrypted: z.boolean().optional()
    })
    .optional(),
  ai: z
    .object({
      /**
       * 服务商 id（取自 `LLM_PRESET_IDS`）。
       *
       * 用 refine 而不是 `z.enum`：`LLM_PRESET_IDS` 是 `.map()` 出来的 `string[]`
       * 而不是字面量元组，`z.enum` 的入参类型要求元组 —— 加 as const 会逼着一处改两份声明。
       */
      provider: z
        .string()
        .min(1)
        .refine((v) => (LLM_PRESET_IDS as readonly string[]).includes(v), { message: '未知的 AI 服务商' }),
      apiKey: z.string().min(1),
      model: z.string().min(1),
      baseUrl: z.string().url().optional()
    })
    .optional()
})

export const openProjectSchema = z.object({
  path: z.string().min(1)
})

/**
 * 单个 projectPath 参数校验（**不带基准目录的语法层**）。
 *
 * 这里拦两类明显非法的输入：空字节，以及任何 `..` 路径段（合法项目路径是
 * "baseDir 下的绝对路径"，不需要也不应该出现上级目录引用）。
 */
export const projectPathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.includes('\0') && !/(^|[/\\])\.\.([/\\]|$)/.test(p), {
    message: 'projectPath 不能包含上级目录引用（..）'
  })

/**
 * 绑定基准目录的 projectPath 校验：**渲染层传来的路径不可信** ——
 * `..\..\` 这类相对穿越与"指向 baseDir 之外的绝对路径"都必须被拒。
 *
 * 做成工厂函数而不是常量：baseDir 由 `registerAllIpc(baseDir)` 统一注入，
 * 只有走到 `register*Ipc(baseDir)` 时才知道项目根在哪。
 */
export function projectPathSchemaWithin(baseDir: string) {
  return projectPathSchema
    .refine((p) => isWithinProject(baseDir, p), {
      message: `路径越界：projectPath 必须位于 ${baseDir} 内`
    })
    .refine((p) => /^([a-zA-Z]:[\\/]|\/)/.test(p), {
      message: 'projectPath 必须是绝对路径（相对路径会被按进程 cwd 解析，与校验口径不一致）'
    })
}

/**
 * 机器人类型校验（三个取值；定义见 `shared/domain/project/botTypeConfig.ts`）。
 * 它**不绑定节点**，只影响平台标签与「玩家数据」面板的字段分组。
 */
export const botTypeSchema = z.enum(['qq', 'general', 'game'])

/** 新名称参数校验（与 createProjectSchema.name 规则一致） */
export const newNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5-]+$/, '名称只允许字母数字、下划线、连字符、中文')

/** saveConfig 入参：createProjectSchema 字段 + __projectPath（+ 由 service 回写的元字段） */
export const saveConfigSchema = createProjectSchema.extend({
  __projectPath: z.string().min(1),
  translatorPort: z.number().int().positive().optional(),
  portBlock: z.number().int().positive().optional(),
  projectSchemaVersion: z.number().int().positive().optional(),
  createdAt: z.string().optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
