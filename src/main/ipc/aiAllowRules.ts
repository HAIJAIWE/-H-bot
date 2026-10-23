// src/main/ipc/aiAllowRules.ts
//
// # 「以后别再问」的规则表：看 / 删单条 / 清空（2026-10-18）
//
// 为什么单独一个文件：`ai.ts` 加完这三条会到 813 行（fileGrowth 红线 800）——
// 而这三条是**审批规则的撤销口**，本来就该和"跑 AI 对话"分开看。
//
// 为什么三条都得有：点过一次「以后别再问」之后，这些动作**不问就直接执行**。
// 没有"看得见、删得掉"的入口，这张表就成了本仓库明文反对的"默认开着却改不了的层"。
import { ipcMain } from 'electron';
import { aiProjectPathSchema, aiRemoveAllowRuleSchema } from '../schemas/ai';
import { clearAllowRules, readAllowRules, removeAllowRule } from '../services/ai/allowRules';
import { tryIpcAsync } from './_shared';

export function registerAiAllowRulesIpc(): void {
  ipcMain.handle('ai:getAllowRules', async (_event, args: unknown) => {
    const parsed = aiProjectPathSchema.safeParse(args);
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` };
    return tryIpcAsync(async () => ({ rules: await readAllowRules(parsed.data.projectPath) }));
  });

  ipcMain.handle('ai:removeAllowRule', async (_event, args: unknown) => {
    const parsed = aiRemoveAllowRuleSchema.safeParse(args);
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` };
    return tryIpcAsync(async () => ({
      rules: await removeAllowRule(parsed.data.projectPath, {
        kind: parsed.data.kind,
        match: parsed.data.match,
      }),
    }));
  });

  ipcMain.handle('ai:clearAllowRules', async (_event, args: unknown) => {
    const parsed = aiProjectPathSchema.safeParse(args);
    if (!parsed.success) return { ok: false, error: `参数校验失败: ${parsed.error.message}` };
    return tryIpcAsync(async () => ({ rules: await clearAllowRules(parsed.data.projectPath) }));
  });
}
